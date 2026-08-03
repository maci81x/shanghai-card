-- 20260708173925_010_user_gdpr_fields
-- ricostruita da supabase_migrations.schema_migrations


CREATE SEQUENCE IF NOT EXISTS public.card_id_seq START WITH 5;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nome TEXT,
  ADD COLUMN IF NOT EXISTS cognome TEXT,
  ADD COLUMN IF NOT EXISTS codice_fiscale TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS telefono TEXT,
  ADD COLUMN IF NOT EXISTS gdpr_trattamento BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gdpr_privacy_letta BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gdpr_comunicazioni BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gdpr_immagini BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ DEFAULT now();
