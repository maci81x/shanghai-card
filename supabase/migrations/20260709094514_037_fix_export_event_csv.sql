-- 20260709094514_037_fix_export_event_csv
-- ricostruita da supabase_migrations.schema_migrations


DROP FUNCTION IF EXISTS public.admin_export_event_csv(uuid);

CREATE OR REPLACE FUNCTION public.admin_export_event_csv(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  RETURN json_build_object(
    'evento',      v_event.title,
    'data_evento', v_event.event_date,
    'iscritti', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT 'socio'                                  AS tipo,
               u.card_id,
               coalesce(nullif(er.nome,''),  u.nome)    AS nome,
               coalesce(nullif(er.cognome,''), u.cognome) AS cognome,
               coalesce(er.telefono, u.telefono)        AS telefono,
               u.email,
               er.amount,
               er.payment_status,
               er.checked_in,
               er.paid_at,
               op.display_name                          AS operatore,
               er.created_at
        FROM public.event_registrations er
        JOIN public.users u  ON u.id  = er.user_id
        LEFT JOIN public.users op ON op.id = er.paid_by
        WHERE er.event_id = p_event_id AND er.payment_status != 'annullato'
        UNION ALL
        SELECT 'ospite'        AS tipo,
               NULL            AS card_id,
               eg.nome, eg.cognome, eg.telefono, eg.email,
               eg.amount, eg.payment_status,
               eg.checked_in,
               eg.paid_at,
               op.display_name AS operatore,
               eg.created_at
        FROM public.event_guests eg
        LEFT JOIN public.users op ON op.id = eg.paid_by
        WHERE eg.event_id = p_event_id
        ORDER BY created_at
      ) r
    )
  );
END;
$$;
