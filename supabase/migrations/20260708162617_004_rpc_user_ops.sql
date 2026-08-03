-- 20260708162617_004_rpc_user_ops
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.user_buy_gadget(p_user_id UUID, p_gadget_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE; v_gadget public.gadgets%ROWTYPE; v_tx_id UUID;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;
  SELECT * INTO v_gadget FROM public.gadgets WHERE id = p_gadget_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Gadget non trovato'); END IF;
  IF v_gadget.stock <= 0 THEN RETURN json_build_object('ok', false, 'error', 'Gadget esaurito'); END IF;
  IF v_user.balance < v_gadget.price THEN RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente', 'balance', v_user.balance, 'price', v_gadget.price); END IF;
  UPDATE public.users SET balance = balance - v_gadget.price, updated_at = now() WHERE id = p_user_id;
  UPDATE public.gadgets SET stock = stock - 1 WHERE id = p_gadget_id;
  INSERT INTO public.transactions (user_id, type, amount, balance_after, description, ref_id) VALUES (p_user_id, 'purchase', -v_gadget.price, v_user.balance - v_gadget.price, 'Acquisto: ' || v_gadget.name, p_gadget_id) RETURNING id INTO v_tx_id;
  RETURN json_build_object('ok', true, 'new_balance', v_user.balance - v_gadget.price, 'transaction_id', v_tx_id, 'gadget', v_gadget.name);
END; $$;

CREATE OR REPLACE FUNCTION public.user_register_event(p_user_id UUID, p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE; v_event public.events%ROWTYPE; v_tx_id UUID; v_reg_id UUID; v_count INTEGER;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Evento non trovato'); END IF;
  IF EXISTS (SELECT 1 FROM public.event_registrations WHERE user_id = p_user_id AND event_id = p_event_id AND status = 'confirmed') THEN RETURN json_build_object('ok', false, 'error', 'Già iscritto a questo evento'); END IF;
  IF v_event.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.event_registrations WHERE event_id = p_event_id AND status = 'confirmed';
    IF v_count >= v_event.max_participants THEN RETURN json_build_object('ok', false, 'error', 'Evento al completo'); END IF;
  END IF;
  IF v_event.price > 0 THEN
    IF v_user.balance < v_event.price THEN RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente', 'balance', v_user.balance, 'price', v_event.price); END IF;
    UPDATE public.users SET balance = balance - v_event.price, updated_at = now() WHERE id = p_user_id;
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, ref_id) VALUES (p_user_id, 'event_fee', -v_event.price, v_user.balance - v_event.price, 'Iscrizione: ' || v_event.title, p_event_id) RETURNING id INTO v_tx_id;
  END IF;
  INSERT INTO public.event_registrations (user_id, event_id, transaction_id) VALUES (p_user_id, p_event_id, v_tx_id) RETURNING id INTO v_reg_id;
  RETURN json_build_object('ok', true, 'registration_id', v_reg_id, 'new_balance', CASE WHEN v_event.price > 0 THEN v_user.balance - v_event.price ELSE v_user.balance END, 'event', v_event.title);
END; $$;
