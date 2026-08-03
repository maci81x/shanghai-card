-- 20260709051834_030_staff_active_registrations
-- ricostruita da supabase_migrations.schema_migrations


-- RPC: registrazioni attive di un socio (per check-in cassa)
-- Restituisce eventi non cancellati con data >= oggi - 1 giorno
CREATE OR REPLACE FUNCTION public.staff_list_active_registrations(
  p_operator_id uuid,
  p_card_id text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_op  public.users%ROWTYPE;
  v_usr public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_op.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;

  SELECT * INTO v_usr FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true;
  IF NOT FOUND THEN
    RETURN json_build_object('ok',false,'error','Tessera non trovata');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'registrations', (
      SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
      FROM (
        SELECT er.id AS registration_id,
               ev.title AS evento,
               ev.event_date,
               er.payment_status,
               er.checked_in,
               er.checked_in_at
        FROM public.event_registrations er
        JOIN public.events ev ON ev.id = er.event_id
        WHERE er.user_id = v_usr.id
          AND er.payment_status != 'annullato'
          AND ev.event_date >= (now() - interval '1 day')
        ORDER BY ev.event_date
      ) r
    )
  );
END; $$;
