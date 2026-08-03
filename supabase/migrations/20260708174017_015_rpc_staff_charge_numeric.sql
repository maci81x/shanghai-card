-- 20260708174017_015_rpc_staff_charge_numeric
-- ricostruita da supabase_migrations.schema_migrations


DROP FUNCTION IF EXISTS public.staff_charge(UUID, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.staff_recharge(UUID, TEXT, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.staff_recharge(
  p_operator_id UUID, p_card_id TEXT, p_amount NUMERIC, p_description TEXT DEFAULT 'Ricarica'
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_operator public.users%ROWTYPE;
  v_tx_id UUID;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok', false, 'error', 'Operatore non autorizzato');
  END IF;
  IF p_amount <= 0 THEN RETURN json_build_object('ok', false, 'error', 'Importo non valido'); END IF;

  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;

  UPDATE public.users SET balance = balance + p_amount, updated_at = now() WHERE id = v_user.id;

  INSERT INTO public.transactions (user_id, type, amount, balance_after, description, operator_id)
  VALUES (v_user.id, 'recharge', p_amount, v_user.balance + p_amount, p_description, p_operator_id)
  RETURNING id INTO v_tx_id;

  RETURN json_build_object('ok', true,
    'transaction_id', v_tx_id, 'card_id', v_user.card_id,
    'display_name', v_user.display_name,
    'recharged', p_amount, 'new_balance', v_user.balance + p_amount);
END; $$;

CREATE OR REPLACE FUNCTION public.staff_charge(
  p_operator_id UUID, p_card_id TEXT, p_amount NUMERIC, p_description TEXT DEFAULT 'Consumazione'
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_operator public.users%ROWTYPE;
  v_promo public.promos%ROWTYPE;
  v_discount NUMERIC := 0;
  v_final_amount NUMERIC;
  v_tx_id UUID;
  v_promo_applied TEXT := NULL;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok', false, 'error', 'Operatore non autorizzato');
  END IF;
  IF p_amount <= 0 THEN RETURN json_build_object('ok', false, 'error', 'Importo non valido'); END IF;

  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;

  SELECT * INTO v_promo FROM public.promos
    WHERE active = true
      AND (valid_until IS NULL OR valid_until > now())
      AND (max_uses IS NULL OR current_uses < max_uses)
    ORDER BY discount_value DESC LIMIT 1;

  IF FOUND THEN
    IF v_promo.discount_type = 'percent' THEN
      v_discount := round(p_amount * v_promo.discount_value / 100, 2);
    ELSE
      v_discount := LEAST(v_promo.discount_value, p_amount);
    END IF;
    v_promo_applied := v_promo.code;
    UPDATE public.promos SET current_uses = current_uses + 1 WHERE id = v_promo.id;
  END IF;

  v_final_amount := p_amount - v_discount;

  IF v_user.balance < v_final_amount THEN
    RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente',
      'balance', v_user.balance, 'requested', v_final_amount);
  END IF;

  UPDATE public.users SET balance = balance - v_final_amount, updated_at = now() WHERE id = v_user.id;

  INSERT INTO public.transactions (user_id, type, amount, balance_after, description, operator_id)
  VALUES (v_user.id, 'purchase', -v_final_amount, v_user.balance - v_final_amount,
    p_description || CASE WHEN v_promo_applied IS NOT NULL
      THEN ' (promo ' || v_promo_applied || ': -€' || v_discount || ')'
      ELSE '' END,
    p_operator_id)
  RETURNING id INTO v_tx_id;

  RETURN json_build_object('ok', true,
    'transaction_id', v_tx_id, 'card_id', v_user.card_id,
    'display_name', v_user.display_name,
    'original_amount', p_amount, 'discount', v_discount,
    'charged', v_final_amount, 'promo_code', v_promo_applied,
    'old_balance', v_user.balance, 'new_balance', v_user.balance - v_final_amount);
END; $$;
