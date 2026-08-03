-- 20260731152110_fix_event_registrations_payment_method_column
-- ricostruita da supabase_migrations.schema_migrations

-- Fix: event_registrations was missing the payment_method column that
-- get_user_state and user_change_event_payment_method both reference.
-- (event_companions already had it; event_registrations did not.)
ALTER TABLE public.event_registrations 
  ADD COLUMN IF NOT EXISTS payment_method text;
