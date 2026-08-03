-- 20260803052310_sumup_links_link_to_events
-- ricostruita da supabase_migrations.schema_migrations

-- Aggiunge event_id opzionale: NULL = link generico ricariche (comportamento attuale),
-- non-NULL = link SumUp specifico per un evento (nuova feature multi-fascia prezzo).
ALTER TABLE public.sumup_links 
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

-- Indice per query "tutti i link di questo evento"
CREATE INDEX IF NOT EXISTS idx_sumup_links_event_id 
  ON public.sumup_links(event_id) WHERE event_id IS NOT NULL;

-- Indice per query "tutti i link ricariche (event_id IS NULL)"
CREATE INDEX IF NOT EXISTS idx_sumup_links_recharge 
  ON public.sumup_links(active, sort_order) WHERE event_id IS NULL;

COMMENT ON COLUMN public.sumup_links.event_id IS 
  'NULL = link ricarica generico. UUID = link SumUp specifico per quell''evento (es. fasce di prezzo adulti/bambini).';
