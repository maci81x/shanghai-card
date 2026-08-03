-- 20260708194222_021_event_payment_model
-- ricostruita da supabase_migrations.schema_migrations


-- ── event_registrations: aggiungi campi pagamento + anagrafica ──────
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'da_saldare',
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS nome TEXT,
  ADD COLUMN IF NOT EXISTS cognome TEXT,
  ADD COLUMN IF NOT EXISTS telefono TEXT;

-- Aggiorna i record esistenti con 'confirmed' → 'saldato_credito' (erano pagati subito)
UPDATE public.event_registrations
  SET payment_status = 'saldato_credito'
  WHERE status = 'confirmed';

-- ── event_guests: aggiungi campi pagamento ───────────────────────────
ALTER TABLE public.event_guests
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'da_saldare',
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.users(id);

-- Aggiorna i record esistenti dove paid=true → 'saldato_contanti'
UPDATE public.event_guests
  SET payment_status = 'saldato_contanti', paid_at = created_at
  WHERE paid = true;

-- Indice su payment_status per query veloci
CREATE INDEX IF NOT EXISTS idx_ev_reg_payment ON public.event_registrations(payment_status);
CREATE INDEX IF NOT EXISTS idx_ev_guest_payment ON public.event_guests(payment_status);
