-- 20260709051936_031_admin_list_event_reg_checkin
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.admin_list_event_registrations(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_total INTEGER;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.event_registrations
    WHERE event_id = p_event_id AND payment_status != 'annullato';

  RETURN json_build_object(
    'total', v_total,
    'soci', (
      SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
      FROM (
        SELECT er.id AS registration_id,
               u.card_id, u.display_name,
               er.nome, er.cognome, er.telefono,
               er.payment_status, er.amount,
               er.paid_at,
               er.checked_in, er.checked_in_at,
               op.display_name AS operatore,
               er.created_at
        FROM public.event_registrations er
        JOIN public.users u ON u.id = er.user_id
        LEFT JOIN public.users op ON op.id = er.paid_by
        WHERE er.event_id = p_event_id AND er.payment_status != 'annullato'
        ORDER BY er.created_at
      ) r
    ),
    'ospiti', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT eg.id, eg.nome, eg.cognome, eg.telefono, eg.email,
               eg.payment_status, eg.amount, eg.paid_at,
               eg.checked_in, eg.checked_in_at,
               op.display_name AS operatore, eg.created_at
        FROM public.event_guests eg
        LEFT JOIN public.users op ON op.id = eg.paid_by
        WHERE eg.event_id = p_event_id
        ORDER BY eg.created_at
      ) g
    )
  );
END; $$;
