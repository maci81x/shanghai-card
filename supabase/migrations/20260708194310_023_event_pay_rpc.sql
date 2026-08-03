-- 20260708194310_023_event_pay_rpc
-- ricostruita da supabase_migrations.schema_migrations


-- ── Staff/Admin paga evento per conto del socio ──────────────────────
CREATE OR REPLACE FUNCTION public.staff_pay_event(
  p_operator_id UUID,
  p_registration_id UUID,
  p_method TEXT  -- 'credito' | 'sumup' | 'contanti'
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_operator public.users%ROWTYPE;
  v_reg      public.event_registrations%ROWTYPE;
  v_user     public.users%ROWTYPE;
  v_event    public.events%ROWTYPE;
  v_status   TEXT;
  v_tx_id    UUID;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok', false, 'error', 'Operatore non autorizzato');
  END IF;

  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Iscrizione non trovata');
  END IF;
  IF v_reg.payment_status != 'da_saldare' THEN
    RETURN json_build_object('ok', false, 'error', 'Iscrizione già saldata (' || v_reg.payment_status || ')');
  END IF;

  SELECT * INTO v_user  FROM public.users  WHERE id = v_reg.user_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_reg.event_id;

  IF p_method = 'credito' THEN
    IF v_user.balance < coalesce(v_reg.amount, 0) THEN
      RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente',
        'balance', v_user.balance, 'required', v_reg.amount);
    END IF;
    UPDATE public.users SET balance = balance - v_reg.amount, updated_at = now()
      WHERE id = v_user.id;
    INSERT INTO public.transactions
      (user_id, type, amount, balance_after, description, operator_id, ref_id)
    VALUES
      (v_user.id, 'event_fee', -v_reg.amount,
       v_user.balance - v_reg.amount,
       'Evento: ' || v_event.title || ' (pagato in cassa, credito)',
       p_operator_id, v_reg.event_id)
    RETURNING id INTO v_tx_id;
    v_status := 'saldato_credito';

  ELSIF p_method = 'sumup' THEN
    v_status := 'saldato_sumup';
    INSERT INTO public.transactions
      (user_id, type, amount, balance_after, description, operator_id, ref_id)
    VALUES
      (v_user.id, 'event_fee', 0,
       v_user.balance,
       'Evento: ' || v_event.title || ' (SumUp)',
       p_operator_id, v_reg.event_id)
    RETURNING id INTO v_tx_id;

  ELSIF p_method = 'contanti' THEN
    v_status := 'saldato_contanti';
    INSERT INTO public.transactions
      (user_id, type, amount, balance_after, description, operator_id, ref_id)
    VALUES
      (v_user.id, 'event_fee', 0,
       v_user.balance,
       'Evento: ' || v_event.title || ' (contanti)',
       p_operator_id, v_reg.event_id)
    RETURNING id INTO v_tx_id;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'Metodo non valido: credito | sumup | contanti');
  END IF;

  UPDATE public.event_registrations
    SET payment_status = v_status,
        paid_at = now(),
        paid_by = p_operator_id,
        transaction_id = v_tx_id,
        status = 'confirmed'
    WHERE id = p_registration_id;

  RETURN json_build_object(
    'ok', true,
    'registration_id', p_registration_id,
    'card_id', v_user.card_id,
    'display_name', v_user.display_name,
    'event', v_event.title,
    'method', p_method,
    'amount', v_reg.amount,
    'new_balance', CASE WHEN p_method = 'credito' THEN v_user.balance - v_reg.amount ELSE v_user.balance END,
    'operator', v_operator.display_name,
    'message', 'Pagamento registrato: ' || v_event.title || ' (' || p_method || ')'
  );
END; $$;

-- ── Il socio paga da solo col suo credito ────────────────────────────
CREATE OR REPLACE FUNCTION public.user_pay_event_credit(
  p_user_id UUID,
  p_registration_id UUID
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user  public.users%ROWTYPE;
  v_reg   public.event_registrations%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tx_id UUID;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;

  SELECT * INTO v_reg FROM public.event_registrations
    WHERE id = p_registration_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Iscrizione non trovata');
  END IF;
  IF v_reg.payment_status != 'da_saldare' THEN
    RETURN json_build_object('ok', false, 'error', 'Già saldato (' || v_reg.payment_status || ')');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_reg.event_id;

  IF v_user.balance < coalesce(v_reg.amount, 0) THEN
    RETURN json_build_object('ok', false, 'error', 'Saldo insufficiente',
      'balance', v_user.balance, 'required', v_reg.amount);
  END IF;

  UPDATE public.users SET balance = balance - v_reg.amount, updated_at = now()
    WHERE id = p_user_id;

  INSERT INTO public.transactions
    (user_id, type, amount, balance_after, description, ref_id)
  VALUES
    (p_user_id, 'event_fee', -v_reg.amount,
     v_user.balance - v_reg.amount,
     'Evento: ' || v_event.title || ' (credito)', v_reg.event_id)
  RETURNING id INTO v_tx_id;

  UPDATE public.event_registrations
    SET payment_status = 'saldato_credito',
        paid_at = now(),
        paid_by = p_user_id,
        transaction_id = v_tx_id,
        status = 'confirmed'
    WHERE id = p_registration_id;

  RETURN json_build_object(
    'ok', true,
    'event', v_event.title,
    'amount', v_reg.amount,
    'new_balance', v_user.balance - v_reg.amount,
    'message', 'Pagato con credito: ' || v_event.title
  );
END; $$;
