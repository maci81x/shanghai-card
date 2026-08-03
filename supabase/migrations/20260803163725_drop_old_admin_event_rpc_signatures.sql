-- 20260803163725_drop_old_admin_event_rpc_signatures
-- ricostruita da supabase_migrations.schema_migrations

-- Rimuovi vecchie signature senza promo_group (rimaste come overload)
DROP FUNCTION IF EXISTS public.admin_create_event(uuid, text, text, timestamptz, text, integer, numeric, text, text, boolean);
DROP FUNCTION IF EXISTS public.admin_update_event(uuid, uuid, text, text, timestamptz, text, integer, numeric, text, text, boolean, boolean, text);
