-- 20260708162652_006_rpc_admin
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT coalesce(json_agg(row_to_json(u)), '[]'::json) FROM (SELECT id, card_id, display_name, role, balance, active, created_at FROM public.users ORDER BY role, display_name) u);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_transactions(p_limit INTEGER DEFAULT 50)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT t.id, t.user_id, u.card_id, u.display_name, t.type, t.amount, t.balance_after, t.description, t.operator_id, op.display_name AS operator_name, t.created_at FROM public.transactions t JOIN public.users u ON u.id = t.user_id LEFT JOIN public.users op ON op.id = t.operator_id ORDER BY t.created_at DESC LIMIT p_limit) t);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN json_build_object(
    'total_users', (SELECT count(*) FROM public.users WHERE role = 'user' AND active = true),
    'total_staff', (SELECT count(*) FROM public.users WHERE role = 'staff' AND active = true),
    'total_balance', (SELECT coalesce(sum(balance), 0) FROM public.users WHERE role = 'user' AND active = true),
    'total_recharges', (SELECT coalesce(sum(amount), 0) FROM public.transactions WHERE type = 'recharge'),
    'total_purchases', (SELECT coalesce(sum(abs(amount)), 0) FROM public.transactions WHERE type = 'purchase'),
    'total_events', (SELECT count(*) FROM public.events WHERE active = true),
    'total_registrations', (SELECT count(*) FROM public.event_registrations WHERE status = 'confirmed'),
    'transactions_today', (SELECT count(*) FROM public.transactions WHERE created_at >= current_date)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_user(p_card_id TEXT, p_display_name TEXT, p_pin TEXT, p_role TEXT DEFAULT 'user')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_role NOT IN ('user','staff','admin') THEN RETURN json_build_object('ok', false, 'error', 'Ruolo non valido'); END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE card_id = upper(trim(p_card_id))) THEN RETURN json_build_object('ok', false, 'error', 'Card ID già esistente'); END IF;
  INSERT INTO public.users (card_id, display_name, pin_hash, role) VALUES (upper(trim(p_card_id)), p_display_name, public.crypt(p_pin, public.gen_salt('bf')), p_role) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'card_id', upper(trim(p_card_id)));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_event(p_title TEXT, p_description TEXT DEFAULT NULL, p_event_date TIMESTAMPTZ DEFAULT NULL, p_location TEXT DEFAULT NULL, p_max_participants INTEGER DEFAULT NULL, p_price INTEGER DEFAULT 0)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.events (title, description, event_date, location, max_participants, price) VALUES (p_title, p_description, p_event_date, p_location, p_max_participants, p_price) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'title', p_title);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_gadget(p_name TEXT, p_description TEXT DEFAULT NULL, p_price INTEGER DEFAULT 500, p_stock INTEGER DEFAULT 10, p_image_url TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.gadgets (name, description, price, stock, image_url) VALUES (p_name, p_description, p_price, p_stock, p_image_url) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'name', p_name);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_create_promo(p_code TEXT, p_description TEXT DEFAULT NULL, p_discount_type TEXT DEFAULT 'fixed', p_discount_value INTEGER DEFAULT 100, p_valid_until TIMESTAMPTZ DEFAULT NULL, p_max_uses INTEGER DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.promos (code, description, discount_type, discount_value, valid_until, max_uses) VALUES (upper(trim(p_code)), p_description, p_discount_type, p_discount_value, p_valid_until, p_max_uses) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'code', upper(trim(p_code)));
END; $$;
