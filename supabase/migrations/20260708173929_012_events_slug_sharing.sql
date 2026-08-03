-- 20260708173929_012_events_slug_sharing
-- ricostruita da supabase_migrations.schema_migrations


ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS public_registration BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sumup_link TEXT;

UPDATE public.events SET slug = lower(replace(replace(title, ' ', '-'), '''', ''))
  WHERE slug IS NULL;
