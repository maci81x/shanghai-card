-- 20260709060406_035_fix_toggle_visibility
-- ricostruita da supabase_migrations.schema_migrations


-- Rimuove il vecchio overload admin_create_event senza p_slug (causa ambiguità con quello nuovo)
DROP FUNCTION IF EXISTS public.admin_create_event(
  text, text, timestamptz, text, integer, numeric, boolean, text
);
