-- 20260708210827_get_user_state_add_event_ids
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.get_user_state(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;

  RETURN json_build_object(
    'ok', true,
    'balance', v_user.balance,
    'transactions', (
      SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT id, type, amount, balance_after, description, created_at
        FROM public.transactions
        WHERE user_id = p_user_id
        ORDER BY created_at DESC LIMIT 30
      ) t
    ),
    'pending_events', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT er.id          AS registration_id,
               er.event_id,
               ev.title       AS evento,
               ev.event_date,
               er.amount,
               er.payment_status,
               ev.sumup_link
        FROM public.event_registrations er
        JOIN public.events ev ON ev.id = er.event_id
        WHERE er.user_id = p_user_id AND er.payment_status = 'da_saldare'
        ORDER BY ev.event_date
      ) r
    ),
    'my_event_ids', (
      SELECT coalesce(json_agg(er.event_id::text), '[]'::json)
      FROM public.event_registrations er
      WHERE er.user_id = p_user_id AND er.payment_status != 'annullato'
    )
  );
END; $$;
