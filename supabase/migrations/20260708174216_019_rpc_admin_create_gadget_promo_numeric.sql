-- 20260708174216_019_rpc_admin_create_gadget_promo_numeric
-- ricostruita da supabase_migrations.schema_migrations


DROP FUNCTION IF EXISTS public.admin_create_gadget(TEXT, TEXT, INTEGER, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.admin_create_gadget(
  p_name TEXT, p_description TEXT DEFAULT NULL,
  p_price NUMERIC DEFAULT 0, p_stock INTEGER DEFAULT 0,
  p_image_url TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT p_name IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'Nome obbligatorio'); END IF;
  INSERT INTO public.gadgets (name, description, price, stock, image_url)
  VALUES (p_name, p_description, p_price, p_stock, p_image_url)
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'name', p_name);
END; $$;

DROP FUNCTION IF EXISTS public.admin_create_promo(TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.admin_create_promo(TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, INTEGER);
CREATE OR REPLACE FUNCTION public.admin_create_promo(
  p_code TEXT, p_description TEXT DEFAULT NULL,
  p_discount_type TEXT DEFAULT 'percent', p_discount_value NUMERIC DEFAULT 10,
  p_valid_until TIMESTAMPTZ DEFAULT NULL, p_max_uses INTEGER DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id UUID;
BEGIN
  IF upper(trim(p_code)) = '' THEN RETURN json_build_object('ok', false, 'error', 'Codice obbligatorio'); END IF;
  IF EXISTS (SELECT 1 FROM public.promos WHERE code = upper(trim(p_code))) THEN
    RETURN json_build_object('ok', false, 'error', 'Codice già esistente');
  END IF;
  INSERT INTO public.promos (code, description, discount_type, discount_value, valid_until, max_uses)
  VALUES (upper(trim(p_code)), p_description, p_discount_type, p_discount_value, p_valid_until, p_max_uses)
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'code', upper(trim(p_code)));
END; $$;
