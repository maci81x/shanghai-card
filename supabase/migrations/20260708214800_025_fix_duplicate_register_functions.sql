-- 20260708214800_025_fix_duplicate_register_functions
-- ricostruita da supabase_migrations.schema_migrations


-- Drop the old overload that redundantly accepts nome/cognome/telefono
-- (user data is read from the users table, not passed as params)
DROP FUNCTION IF EXISTS public.user_register_event(
  p_user_id uuid,
  p_event_id uuid,
  p_nome text,
  p_cognome text,
  p_telefono text
);
