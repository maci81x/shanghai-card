-- 20260803070829_drop_old_sumup_link_rpc_signatures
-- ricostruita da supabase_migrations.schema_migrations

DROP FUNCTION IF EXISTS public.admin_add_sumup_link(uuid, text, text, numeric);
DROP FUNCTION IF EXISTS public.admin_update_sumup_link(uuid, uuid, text, text, numeric);
