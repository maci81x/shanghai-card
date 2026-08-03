-- 20260708173927_011_event_guests_table
-- ricostruita da supabase_migrations.schema_migrations


CREATE TABLE IF NOT EXISTS public.event_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  registered_by UUID REFERENCES public.users(id),
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  paid BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_guests_event ON public.event_guests(event_id);
ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;
