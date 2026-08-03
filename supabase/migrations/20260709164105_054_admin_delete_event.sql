-- 20260709164105_054_admin_delete_event
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

DROP FUNCTION IF EXISTS admin_delete_event(uuid, uuid);
DROP FUNCTION IF EXISTS admin_delete_event(uuid);

CREATE OR REPLACE FUNCTION admin_delete_event(p_admin_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_admin_id;
  IF v_role NOT IN ('admin','staff') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non autorizzato');
  END IF;

  -- Elimina prima i dati dipendenti
  DELETE FROM event_companions WHERE registration_id IN (
    SELECT id FROM event_registrations WHERE event_id = p_event_id
  );
  DELETE FROM event_registrations WHERE event_id = p_event_id;
  DELETE FROM events WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
