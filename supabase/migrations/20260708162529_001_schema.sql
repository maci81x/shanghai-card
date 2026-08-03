-- 20260708162529_001_schema
-- ricostruita da supabase_migrations.schema_migrations


-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- USERS
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','staff','admin')),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- EVENTS
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMPTZ,
  location TEXT,
  max_participants INTEGER,
  price INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GADGETS
CREATE TABLE IF NOT EXISTS public.gadgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK (price > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PROMOS
CREATE TABLE IF NOT EXISTS public.promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed','percent')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  max_uses INTEGER,
  current_uses INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  type TEXT NOT NULL CHECK (type IN ('recharge','purchase','event_fee','refund')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  ref_id UUID,
  operator_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- EVENT_REGISTRATIONS
CREATE TABLE IF NOT EXISTS public.event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  event_id UUID NOT NULL REFERENCES public.events(id),
  transaction_id UUID REFERENCES public.transactions(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_id)
);

-- SUMUP_LINKS
CREATE TABLE IF NOT EXISTS public.sumup_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_reg_user ON public.event_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_event ON public.event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_users_card ON public.users(card_id);

-- RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gadgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sumup_links ENABLE ROW LEVEL SECURITY;
