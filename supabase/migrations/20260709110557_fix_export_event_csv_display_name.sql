-- 20260709110557_fix_export_event_csv_display_name
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- Drop existing version
DROP FUNCTION IF EXISTS public.admin_export_event_csv(uuid);

CREATE OR REPLACE FUNCTION public.admin_export_event_csv(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event RECORD;
  v_result jsonb;
BEGIN
  SELECT title, event_date INTO v_event FROM events WHERE id = p_event_id;

  SELECT jsonb_build_object(
    'evento', v_event.title,
    'data_evento', v_event.event_date,
    'iscritti', COALESCE((
      SELECT jsonb_agg(row_to_json(r.*))
      FROM (
        -- Soci
        SELECT
          'socio'::text AS tipo,
          u.card_id,
          u.display_name,
          NULL::text AS nome,
          NULL::text AS cognome,
          NULL::text AS telefono,
          NULL::text AS email,
          er.amount,
          er.payment_status,
          er.checked_in,
          er.paid_at,
          op.display_name AS operatore,
          er.created_at
        FROM event_registrations er
        JOIN users u ON u.id = er.user_id
        LEFT JOIN users op ON op.id = er.operator_id
        WHERE er.event_id = p_event_id AND er.registration_type = 'socio'

        UNION ALL

        -- Ospiti
        SELECT
          'ospite'::text AS tipo,
          NULL::text AS card_id,
          (COALESCE(eg.nome,'') || ' ' || COALESCE(eg.cognome,''))::text AS display_name,
          eg.nome,
          eg.cognome,
          eg.telefono,
          eg.email,
          eg.amount,
          eg.payment_status,
          eg.checked_in,
          eg.paid_at,
          op.display_name AS operatore,
          eg.created_at
        FROM event_guests eg
        LEFT JOIN users op ON op.id = eg.operator_id
        WHERE eg.event_id = p_event_id

        ORDER BY tipo, created_at
      ) r
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
