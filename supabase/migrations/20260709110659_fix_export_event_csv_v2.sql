-- 20260709110659_fix_export_event_csv_v2
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.admin_export_event_csv(uuid);

CREATE OR REPLACE FUNCTION public.admin_export_event_csv(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event RECORD;
  v_reg   jsonb;
  v_soci  jsonb;
  v_ospiti jsonb;
BEGIN
  SELECT title, event_date INTO v_event FROM events WHERE id = p_event_id;

  -- Usa admin_list_event_registrations che funziona già
  SELECT admin_list_event_registrations(p_event_id) INTO v_reg;

  v_soci   := COALESCE(v_reg->'soci', '[]'::jsonb);
  v_ospiti := COALESCE(v_reg->'ospiti', '[]'::jsonb);

  RETURN jsonb_build_object(
    'evento',      v_event.title,
    'data_evento', v_event.event_date,
    'iscritti', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'tipo',            r->>'tipo',
          'card_id',         r->>'card_id',
          'display_name',    COALESCE(r->>'display_name', ''),
          'nome',            COALESCE(r->>'nome', ''),
          'cognome',         COALESCE(r->>'cognome', ''),
          'telefono',        COALESCE(r->>'telefono', ''),
          'email',           COALESCE(r->>'email', ''),
          'amount',          (r->>'amount')::numeric,
          'payment_status',  r->>'payment_status',
          'checked_in',      (r->>'checked_in')::boolean,
          'paid_at',         r->>'paid_at',
          'operatore',       COALESCE(r->>'operatore', ''),
          'created_at',      r->>'created_at'
        )
      )
      FROM (
        SELECT jsonb_array_elements(v_soci) || jsonb_build_object('tipo','socio') AS r
        UNION ALL
        SELECT jsonb_array_elements(v_ospiti) || jsonb_build_object('tipo','ospite') AS r
      ) sub
    )
  );
END;
$$;
