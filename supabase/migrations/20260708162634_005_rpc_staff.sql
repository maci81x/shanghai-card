-- 20260708162634_005_rpc_staff
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.staff_lookup(p_card_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;
  RETURN json_build_object('ok', true, 'user', json_build_object('id', v_user.id, 'card_id', v_user.card_id, 'display_name', v_user.display_name, 'role', v_user.role, 'balance', v_user.balance));
END; $$;

CREATE OR REPLACE FUNCTION public.staff_recharge(p_operator_id UUID, p_card_id TEXT, p_amount INTEGER)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE; v_operator public.users%ROWTYPE; v_tx_id UUID;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN RETURN json_build_object('ok', false, 'error', 'Operatore non autorizzato'); END IF;
  IF p_amount <= 0 THEN RETURN json_build_object('ok', false, 'error', 'Importo non valido'); END IF;
  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;
  UPDATE public.users SET balance = balance + p_amount, updated_at = now() WHERE id = v_user.id;
  INSERT INTO public.transactions (user_id, type, amount, balance_after, description, operator_id) VALUES (v_user.id, 'recharge', p_amount, v_user.balance + p_amount, 'Ricarica da ' || v_operator.display_name, p_operator_id) RETURNING id INTO v_tx_id;
  RETURN json_build_object('ok', true, 'transaction_id', v_tx_id, 'card_id', v_user.card_id, 'display_name', v_user.display_name, 'old_balance', v_user.balance, 'new_balance', v_user.balance + p_amount, 'amount', p_amount);
END; $$;

CREATE OR REPLACE FUNCTION public.staff_charge(p_operator_id UUID, p_card_id TEXT, p_amount INTEGER, p_description TEXT DEFAULT 'Addebito')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE; v_operator public.users%ROWTYPE; v_tx_id UUID;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN RETURN json_build_object('ok', false, 'error', 'Operatore non autorizzato'); END IF;
  IF p_amount <= 0 THEN RETURN json_build_object('ok', false, 'error', 'Importo non valido'); END IF;
  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;
  IF v_user.balance < p_amount THEN RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente', 'balance', v_user.balance, 'requested', p_amount); END IF;
  UPDATE public.users SET balance = balance - p_amount, updated_at = now() WHERE id = v_user.id;
  INSERT INTO public.transactions (user_id, type, amount, balance_after, description, operator_id) VALUES (v_user.id, 'purchase', -p_amount, v_user.balance - p_amount, p_description || ' (op: ' || v_operator.display_name || ')', p_operator_id) RETURNING id INTO v_tx_id;
  RETURN json_build_object('ok', true, 'transaction_id', v_tx_id, 'card_id', v_user.card_id, 'display_name', v_user.display_name, 'old_balance', v_user.balance, 'new_balance', v_user.balance - p_amount, 'amount', p_amount);
END; $$;
