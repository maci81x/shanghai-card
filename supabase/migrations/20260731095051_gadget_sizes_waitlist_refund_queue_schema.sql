-- 20260731095051_gadget_sizes_waitlist_refund_queue_schema
-- ricostruita da supabase_migrations.schema_migrations


-- ═══════════════════════════════════════════════════════════════
-- BLOCCO 1: SCHEMA — gadget sizes, waitlist, refund queue
-- ═══════════════════════════════════════════════════════════════

-- 1a. Gadgets: flag has_sizes
ALTER TABLE public.gadgets ADD COLUMN IF NOT EXISTS has_sizes bool NOT NULL DEFAULT false;

-- 1b. Tabella gadget_sizes (una riga per (gadget, taglia) con stock indipendente)
CREATE TABLE IF NOT EXISTS public.gadget_sizes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gadget_id  uuid NOT NULL REFERENCES public.gadgets(id) ON DELETE CASCADE,
  size       text NOT NULL,
  stock      integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (gadget_id, size)
);
CREATE INDEX IF NOT EXISTS idx_gadget_sizes_gadget ON public.gadget_sizes(gadget_id);

ALTER TABLE public.gadget_sizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read gadget_sizes" ON public.gadget_sizes;
CREATE POLICY "public read gadget_sizes" ON public.gadget_sizes FOR SELECT USING (true);

-- 1c. gadget_reservations: taglia + stato attesa_ordine
ALTER TABLE public.gadget_reservations ADD COLUMN IF NOT EXISTS size text;

ALTER TABLE public.gadget_reservations DROP CONSTRAINT IF EXISTS gadget_reservations_status_check;
ALTER TABLE public.gadget_reservations ADD CONSTRAINT gadget_reservations_status_check
  CHECK (status IN ('prenotato','consegnato','annullato','attesa_ordine'));

-- 1d. Coda rimborsi (per SumUp)
CREATE TABLE IF NOT EXISTS public.refund_queue (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES public.users(id),
  source_type              text NOT NULL CHECK (source_type IN ('gadget_reservation','event_registration','event_companion')),
  source_id                uuid NOT NULL,
  amount                   numeric NOT NULL,
  original_payment_method  text NOT NULL,
  reason                   text,
  status                   text NOT NULL DEFAULT 'da_gestire' CHECK (status IN ('da_gestire','completato','annullato')),
  created_at               timestamptz DEFAULT now(),
  resolved_at              timestamptz,
  resolved_by              uuid REFERENCES public.users(id),
  notes                    text
);
CREATE INDEX IF NOT EXISTS idx_refund_queue_status ON public.refund_queue(status);
ALTER TABLE public.refund_queue ENABLE ROW LEVEL SECURITY;
