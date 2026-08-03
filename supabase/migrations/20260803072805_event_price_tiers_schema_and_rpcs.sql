-- 20260803072805_event_price_tiers_schema_and_rpcs
-- ricostruita da supabase_migrations.schema_migrations

-- =========================================
-- FASE 1: Fasce di prezzo per evento (event_price_tiers)
-- =========================================

-- 1) Schema
CREATE TABLE IF NOT EXISTS public.event_price_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  price numeric NOT NULL CHECK (price >= 0),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_price_tiers_event_active 
  ON public.event_price_tiers(event_id) WHERE active = true;

-- 2) RLS: lettura libera, scritture solo via RPC SECURITY DEFINER
ALTER TABLE public.event_price_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read event tiers" ON public.event_price_tiers;
CREATE POLICY "public read event tiers" ON public.event_price_tiers
  FOR SELECT USING (true);

-- 3) Trigger updated_at
CREATE OR REPLACE FUNCTION public._touch_event_price_tier_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_event_price_tier_updated_at ON public.event_price_tiers;
CREATE TRIGGER trg_touch_event_price_tier_updated_at
  BEFORE UPDATE ON public.event_price_tiers
  FOR EACH ROW EXECUTE FUNCTION public._touch_event_price_tier_updated_at();

-- 4) RPC lista fasce (leggibile a tutti, utile come alternativa al nested select)
CREATE OR REPLACE FUNCTION public.list_event_tiers(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE 
SET search_path='public','extensions' AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.sort_order, t.label), '[]'::jsonb)
  FROM public.event_price_tiers t
  WHERE t.event_id = p_event_id AND t.active = true;
$$;

-- 5) RPC admin CREATE
CREATE OR REPLACE FUNCTION public.admin_add_event_tier(
  p_admin_id uuid,
  p_event_id uuid,
  p_label text,
  p_price numeric,
  p_sort_order int DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER 
SET search_path='public','extensions' AS $$
DECLARE 
  v_count int;
  v_sort int;
  v_new_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin' AND active = true) THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN json_build_object('ok', false, 'error', 'Evento non trovato');
  END IF;
  
  IF p_price IS NULL OR p_price < 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Prezzo non valido (>= 0)');
  END IF;
  
  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Etichetta obbligatoria');
  END IF;
  
  -- Limite 5 fasce attive per evento
  SELECT count(*) INTO v_count 
    FROM public.event_price_tiers 
    WHERE event_id = p_event_id AND active = true;
  IF v_count >= 5 THEN
    RETURN json_build_object('ok', false, 'error', 'Massimo 5 fasce di prezzo per evento');
  END IF;
  
  -- sort_order: se null usa max+10
  IF p_sort_order IS NULL THEN
    SELECT coalesce(max(sort_order), 0) + 10 INTO v_sort 
      FROM public.event_price_tiers WHERE event_id = p_event_id;
  ELSE
    v_sort := p_sort_order;
  END IF;
  
  INSERT INTO public.event_price_tiers (event_id, label, price, sort_order)
  VALUES (p_event_id, trim(p_label), p_price, v_sort)
  RETURNING id INTO v_new_id;
  
  RETURN json_build_object('ok', true, 'id', v_new_id, 'message', 'Fascia aggiunta');
END; $$;

-- 6) RPC admin UPDATE
CREATE OR REPLACE FUNCTION public.admin_update_event_tier(
  p_admin_id uuid,
  p_tier_id uuid,
  p_label text DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_sort_order int DEFAULT NULL,
  p_active boolean DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER 
SET search_path='public','extensions' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin' AND active = true) THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;
  
  IF p_price IS NOT NULL AND p_price < 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Prezzo non valido (>= 0)');
  END IF;
  
  UPDATE public.event_price_tiers SET
    label = CASE WHEN p_label IS NOT NULL AND length(trim(p_label)) > 0 THEN trim(p_label) ELSE label END,
    price = COALESCE(p_price, price),
    sort_order = COALESCE(p_sort_order, sort_order),
    active = COALESCE(p_active, active)
  WHERE id = p_tier_id;
  
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Fascia non trovata'); END IF;
  RETURN json_build_object('ok', true, 'message', 'Fascia aggiornata');
END; $$;

-- 7) RPC admin DELETE (hard delete per Fase 1; Fase 2 valuteremo soft se FK verso registrations)
CREATE OR REPLACE FUNCTION public.admin_delete_event_tier(
  p_admin_id uuid,
  p_tier_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER 
SET search_path='public','extensions' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin' AND active = true) THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;
  
  DELETE FROM public.event_price_tiers WHERE id = p_tier_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Fascia non trovata'); END IF;
  RETURN json_build_object('ok', true, 'message', 'Fascia eliminata');
END; $$;

-- 8) Grants
GRANT EXECUTE ON FUNCTION public.list_event_tiers(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_event_tier(uuid, uuid, text, numeric, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_event_tier(uuid, uuid, text, numeric, int, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_event_tier(uuid, uuid) TO anon, authenticated;

-- Grant SELECT esplicito sulla tabella (RLS gestisce la logica ma serve il grant base)
GRANT SELECT ON public.event_price_tiers TO anon, authenticated;

COMMENT ON TABLE public.event_price_tiers IS 
  'Fasce di prezzo per evento. events.price resta prezzo default per eventi senza fasce. Retrocompat piena.';
