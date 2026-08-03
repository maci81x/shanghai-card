-- 20260708174022_016_rpc_user_buy_gadget_promo
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.user_buy_gadget(p_user_id UUID, p_gadget_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE; v_gadget public.gadgets%ROWTYPE;
  v_promo public.promos%ROWTYPE;
  v_discount NUMERIC := 0; v_final_price NUMERIC;
  v_tx_id UUID; v_promo_applied TEXT := NULL;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;
  SELECT * INTO v_gadget FROM public.gadgets WHERE id = p_gadget_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Gadget non trovato'); END IF;
  IF v_gadget.stock <= 0 THEN RETURN json_build_object('ok', false, 'error', 'Gadget esaurito'); END IF;

  SELECT * INTO v_promo FROM public.promos
    WHERE active = true AND (valid_until IS NULL OR valid_until > now())
      AND (max_uses IS NULL OR current_uses < max_uses)
    ORDER BY discount_value DESC LIMIT 1;

  IF FOUND THEN
    IF v_promo.discount_type = 'percent' THEN
      v_discount := round(v_gadget.price * v_promo.discount_value / 100, 2);
    ELSE
      v_discount := LEAST(v_promo.discount_value, v_gadget.price);
    END IF;
    v_promo_applied := v_promo.code;
    UPDATE public.promos SET current_uses = current_uses + 1 WHERE id = v_promo.id;
  END IF;

  v_final_price := v_gadget.price - v_discount;

  IF v_user.balance < v_final_price THEN
    RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente',
      'balance', v_user.balance, 'price', v_final_price);
  END IF;

  UPDATE public.users SET balance = balance - v_final_price, updated_at = now() WHERE id = p_user_id;
  UPDATE public.gadgets SET stock = stock - 1 WHERE id = p_gadget_id;

  INSERT INTO public.transactions (user_id, type, amount, balance_after, description, ref_id)
  VALUES (p_user_id, 'purchase', -v_final_price, v_user.balance - v_final_price,
    'Acquisto: ' || v_gadget.name || CASE WHEN v_promo_applied IS NOT NULL
      THEN ' (promo ' || v_promo_applied || ': -€' || v_discount || ')' ELSE '' END,
    p_gadget_id)
  RETURNING id INTO v_tx_id;

  RETURN json_build_object('ok', true, 'new_balance', v_user.balance - v_final_price,
    'transaction_id', v_tx_id, 'gadget', v_gadget.name,
    'original_price', v_gadget.price, 'discount', v_discount,
    'charged', v_final_price, 'promo_code', v_promo_applied);
END; $$;
