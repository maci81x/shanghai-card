-- 20260708162558_003_rpc_catalog_state
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN json_build_object(
    'events', (SELECT coalesce(json_agg(row_to_json(e)), '[]'::json) FROM (SELECT id, title, description, event_date, location, max_participants, price, active FROM public.events WHERE active = true ORDER BY event_date) e),
    'gadgets', (SELECT coalesce(json_agg(row_to_json(g)), '[]'::json) FROM (SELECT id, name, description, price, stock, image_url, active FROM public.gadgets WHERE active = true AND stock > 0 ORDER BY name) g),
    'promos',  (SELECT coalesce(json_agg(row_to_json(p)), '[]'::json) FROM (SELECT id, code, description, discount_type, discount_value, valid_from, valid_until FROM public.promos WHERE active = true AND (valid_until IS NULL OR valid_until > now()) ORDER BY valid_from) p),
    'sumup_links', (SELECT coalesce(json_agg(row_to_json(s)), '[]'::json) FROM (SELECT id, label, amount, url FROM public.sumup_links WHERE active = true ORDER BY amount) s)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.get_user_state(p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;
  RETURN json_build_object('ok', true, 'balance', v_user.balance, 'display_name', v_user.display_name, 'card_id', v_user.card_id,
    'transactions', (SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT id, type, amount, balance_after, description, created_at FROM public.transactions WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 20) t),
    'registrations', (SELECT coalesce(json_agg(json_build_object('id', er.id, 'event_id', er.event_id, 'status', er.status, 'event_title', ev.title, 'event_date', ev.event_date)), '[]'::json) FROM public.event_registrations er JOIN public.events ev ON ev.id = er.event_id WHERE er.user_id = p_user_id AND er.status = 'confirmed')
  );
END; $$;
