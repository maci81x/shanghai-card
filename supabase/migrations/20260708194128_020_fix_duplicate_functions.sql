-- 20260708194128_020_fix_duplicate_functions
-- ricostruita da supabase_migrations.schema_migrations


-- Rimuove la versione INTEGER di staff_recharge (OID 17737 — trovata in pg_proc)
DROP FUNCTION IF EXISTS public.staff_recharge(uuid, text, integer);
DROP FUNCTION IF EXISTS public.staff_recharge(uuid, text, integer, text);

-- Precauzione: rimuove eventuali duplicati INTEGER rimasti per le altre funzioni
DROP FUNCTION IF EXISTS public.staff_charge(uuid, text, integer);
DROP FUNCTION IF EXISTS public.staff_charge(uuid, text, integer, text);
DROP FUNCTION IF EXISTS public.admin_create_gadget(text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.admin_create_promo(text, text, text, integer, timestamp with time zone, integer);
DROP FUNCTION IF EXISTS public.admin_create_event(text, text, timestamp with time zone, text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_create_event(text, text, timestamp with time zone, text, integer, numeric);
