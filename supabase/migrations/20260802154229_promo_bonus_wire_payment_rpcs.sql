-- 20260802154229_promo_bonus_wire_payment_rpcs
-- ricostruita da supabase_migrations.schema_migrations

-- === user_pay_event_credit ===
CREATE OR REPLACE FUNCTION user_pay_event_credit(p_user_id uuid, p_registration_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_user users%ROWTYPE; v_reg event_registrations%ROWTYPE;
  v_event events%ROWTYPE; v_tx_id UUID;
BEGIN
  SELECT * INTO v_user FROM users WHERE id=p_user_id AND active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Utente non trovato'); END IF;
  SELECT * INTO v_reg FROM event_registrations WHERE id=p_registration_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.payment_status <> 'da_saldare' THEN
    RETURN json_build_object('ok',false,'error','Già saldato ('||v_reg.payment_status||')');
  END IF;
  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  IF v_user.balance < COALESCE(v_reg.amount,0) THEN
    RETURN json_build_object('ok',false,'error','Saldo insufficiente','balance',v_user.balance,'required',v_reg.amount);
  END IF;
  UPDATE users SET balance=balance-v_reg.amount, updated_at=now() WHERE id=p_user_id;
  INSERT INTO transactions(user_id,type,amount,balance_after,description,ref_id)
    VALUES(p_user_id,'event_fee',-v_reg.amount,v_user.balance-v_reg.amount,
           'Evento: '||v_event.title||' (credito)', v_reg.event_id) RETURNING id INTO v_tx_id;
  UPDATE event_registrations
    SET payment_status='saldato_credito', paid_at=now(), paid_by=p_user_id,
        transaction_id=v_tx_id, status='confirmed'
    WHERE id=p_registration_id;

  PERFORM _check_and_apply_promo_bonus(p_registration_id, p_user_id);

  RETURN json_build_object('ok',true,'event',v_event.title,'amount',v_reg.amount,
    'new_balance',(SELECT balance FROM users WHERE id=p_user_id),
    'message','Pagato con credito: '||v_event.title);
END; $$;

-- === user_pay_event_people ===
CREATE OR REPLACE FUNCTION user_pay_event_people(p_user_id uuid, p_registration_id uuid, p_targets jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_user record; v_reg record; v_event record; v_comp record; v_cid uuid;
  v_price numeric; v_count int := 0; v_names text[] := '{}';
  v_total numeric; v_self boolean; v_new_bal numeric;
BEGIN
  SELECT * INTO v_user FROM users WHERE id=p_user_id AND active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Utente non trovato'); END IF;
  SELECT er.* INTO v_reg FROM event_registrations er
    WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.payment_status <> 'annullato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Registrazione non trovata'); END IF;
  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  v_price := COALESCE(v_event.price,0);
  v_self := COALESCE((p_targets->>'self')::boolean, false);

  IF v_self AND v_reg.payment_status='da_saldare' THEN
    v_count := v_count+1; v_names := array_append(v_names, v_user.display_name);
  END IF;
  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    SELECT * INTO v_comp FROM event_companions
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
    IF FOUND THEN v_count := v_count+1; v_names := array_append(v_names, v_comp.nome||' '||v_comp.cognome); END IF;
  END LOOP;
  IF v_count=0 THEN RETURN jsonb_build_object('ok',false,'error','Nessuna persona da saldare selezionata'); END IF;
  v_total := v_count*v_price;
  IF v_user.balance < v_total THEN
    RETURN jsonb_build_object('ok',false,'error',
      'Saldo insufficiente (servono '||to_char(v_total,'FM990.00')||' €, hai '||to_char(v_user.balance,'FM990.00')||' €)');
  END IF;
  UPDATE users SET balance=balance-v_total, updated_at=now() WHERE id=p_user_id RETURNING balance INTO v_new_bal;
  INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
    VALUES(p_user_id,'event_fee',-v_total,v_new_bal,
      'Evento: '||v_event.title||' — '||v_count||' pers.: '||array_to_string(v_names,', '),
      p_user_id, v_reg.event_id);
  IF v_self AND v_reg.payment_status='da_saldare' THEN
    UPDATE event_registrations SET payment_status='saldato_credito', paid_at=now(), paid_by=p_user_id
      WHERE id=p_registration_id;
  END IF;
  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    UPDATE event_companions SET payment_status='saldato_credito', paid_at=now(), paid_by=p_user_id, payment_method='credito'
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
  END LOOP;

  PERFORM _check_and_apply_promo_bonus(p_registration_id, p_user_id);

  RETURN jsonb_build_object('ok',true,'paid_count',v_count,'total',v_total,
    'new_balance',(SELECT balance FROM users WHERE id=p_user_id),
    'message','Pagato '||v_count||' pers.: '||array_to_string(v_names,', '));
END; $$;

-- === staff_pay_event ===
CREATE OR REPLACE FUNCTION staff_pay_event(p_operator_id uuid, p_registration_id uuid, p_method text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_operator users%ROWTYPE; v_reg event_registrations%ROWTYPE;
  v_user users%ROWTYPE; v_event events%ROWTYPE;
  v_status text; v_tx_id uuid;
BEGIN
  SELECT * INTO v_operator FROM users WHERE id=p_operator_id AND active=true;
  IF NOT FOUND OR (v_operator.role NOT IN ('staff','admin') AND NOT COALESCE(v_operator.is_staff,false)) THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;
  SELECT * INTO v_reg FROM event_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.payment_status <> 'da_saldare' THEN
    RETURN json_build_object('ok',false,'error','Iscrizione già saldata ('||v_reg.payment_status||')');
  END IF;
  SELECT * INTO v_user FROM users WHERE id=v_reg.user_id;
  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;

  IF p_method='credito' THEN
    IF v_user.balance < COALESCE(v_reg.amount,0) THEN
      RETURN json_build_object('ok',false,'error','Saldo insufficiente','balance',v_user.balance,'required',v_reg.amount);
    END IF;
    UPDATE users SET balance=balance-v_reg.amount, updated_at=now() WHERE id=v_user.id;
    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
      VALUES(v_user.id,'event_fee',-v_reg.amount,v_user.balance-v_reg.amount,
             'Evento: '||v_event.title||' (credito)',p_operator_id,v_reg.event_id) RETURNING id INTO v_tx_id;
    v_status := 'saldato_credito';
  ELSIF p_method='sumup' THEN
    v_status := 'saldato_sumup';
    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
      VALUES(v_user.id,'event_fee',0,v_user.balance,'Evento: '||v_event.title||' (SumUp)',p_operator_id,v_reg.event_id) RETURNING id INTO v_tx_id;
  ELSIF p_method='contanti' THEN
    v_status := 'saldato_contanti';
    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
      VALUES(v_user.id,'event_fee',0,v_user.balance,'Evento: '||v_event.title||' (contanti)',p_operator_id,v_reg.event_id) RETURNING id INTO v_tx_id;
  ELSE
    RETURN json_build_object('ok',false,'error','Metodo non valido');
  END IF;

  UPDATE event_registrations
    SET payment_status=v_status, paid_at=now(), paid_by=p_operator_id, transaction_id=v_tx_id, status='confirmed'
    WHERE id=p_registration_id;
  UPDATE event_companions SET payment_status=v_status, paid_at=now(), paid_by=p_operator_id, payment_method=p_method
    WHERE registration_id=p_registration_id AND payment_status='da_saldare';

  PERFORM _check_and_apply_promo_bonus(p_registration_id, p_operator_id);

  RETURN json_build_object('ok',true,'registration_id',p_registration_id,'card_id',v_user.card_id,
    'display_name',v_user.display_name,'event',v_event.title,'method',p_method,'amount',v_reg.amount,
    'new_balance',(SELECT balance FROM users WHERE id=v_user.id),
    'operator',v_operator.display_name,'message','Pagamento registrato: '||v_event.title||' ('||p_method||')');
END; $$;

-- === staff_pay_event_people ===
CREATE OR REPLACE FUNCTION staff_pay_event_people(p_operator_id uuid, p_registration_id uuid, p_targets jsonb, p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_op record; v_user record; v_reg record; v_event record;
  v_comp record; v_cid uuid; v_price numeric;
  v_count int := 0; v_names text[] := '{}';
  v_total numeric; v_self boolean; v_status text; v_new_bal numeric;
BEGIN
  SELECT * INTO v_op FROM users WHERE id=p_operator_id
    AND (role IN ('staff','admin') OR COALESCE(is_staff,false)) AND active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Non autorizzato'); END IF;
  SELECT er.* INTO v_reg FROM event_registrations er 
    WHERE er.id=p_registration_id AND er.payment_status <> 'annullato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Registrazione non trovata'); END IF;
  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  SELECT * INTO v_user FROM users WHERE id=v_reg.user_id;
  v_price := COALESCE(v_event.price,0);
  v_self := COALESCE((p_targets->>'self')::boolean, false);
  IF v_self AND v_reg.payment_status='da_saldare' THEN
    v_count := v_count+1; v_names := array_append(v_names, v_user.display_name);
  END IF;
  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    SELECT * INTO v_comp FROM event_companions
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
    IF FOUND THEN v_count := v_count+1; v_names := array_append(v_names, v_comp.nome||' '||v_comp.cognome); END IF;
  END LOOP;
  IF v_count=0 THEN RETURN jsonb_build_object('ok',false,'error','Nessuna persona da saldare'); END IF;
  v_total := v_count*v_price;
  v_status := CASE p_method WHEN 'credito' THEN 'saldato_credito' WHEN 'sumup' THEN 'saldato_sumup' ELSE 'saldato_contanti' END;
  IF p_method='credito' THEN
    IF v_user.balance < v_total THEN
      RETURN jsonb_build_object('ok',false,'error',
        'Saldo insufficiente (servono '||to_char(v_total,'FM990.00')||' €, ha '||to_char(v_user.balance,'FM990.00')||' €)');
    END IF;
    UPDATE users SET balance=balance-v_total, updated_at=now() WHERE id=v_reg.user_id RETURNING balance INTO v_new_bal;
  ELSE
    v_new_bal := v_user.balance;
  END IF;
  INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
    VALUES(v_reg.user_id,'event_fee',
      CASE WHEN p_method='credito' THEN -v_total ELSE 0 END, v_new_bal,
      'Evento: '||v_event.title||' — '||v_count||' pers.: '||array_to_string(v_names,', ')||' ('||p_method||')',
      p_operator_id, v_reg.event_id);
  IF v_self AND v_reg.payment_status='da_saldare' THEN
    UPDATE event_registrations SET payment_status=v_status, paid_at=now(), paid_by=p_operator_id WHERE id=p_registration_id;
  END IF;
  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    UPDATE event_companions SET payment_status=v_status, paid_at=now(), paid_by=p_operator_id, payment_method=p_method
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
  END LOOP;

  PERFORM _check_and_apply_promo_bonus(p_registration_id, p_operator_id);

  RETURN jsonb_build_object('ok',true,'paid_count',v_count,'total',v_total,
    'message','Saldato '||v_count||' pers. ('||p_method||'): '||array_to_string(v_names,', '));
END; $$;

-- === admin_confirm_payment ===
CREATE OR REPLACE FUNCTION admin_confirm_payment(p_operator_id uuid, p_target_type text, p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_amount numeric; v_user_id uuid; v_event_title text; v_person text;
  v_prev_status text; v_final_status text; v_pay_method text; v_desc_suffix text;
  v_reg_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  IF p_target_type='registration' THEN
    SELECT payment_status INTO v_prev_status FROM event_registrations WHERE id=p_target_id;
    IF v_prev_status='sumup_in_attesa' THEN
      v_final_status := 'saldato_sumup'; v_pay_method := 'sumup'; v_desc_suffix := ' (SumUp confermato)';
    ELSIF v_prev_status='cassa_in_attesa' THEN
      v_final_status := 'saldato_cassa'; v_pay_method := 'cassa'; v_desc_suffix := ' (Cassa confermato)';
    ELSE
      RETURN jsonb_build_object('ok',false,'error','Non in attesa');
    END IF;
    UPDATE event_registrations SET payment_status=v_final_status, paid_at=now(), paid_by=p_operator_id
      WHERE id=p_target_id
      RETURNING amount, user_id, id INTO v_amount, v_user_id, v_reg_id;
    SELECT e.title, u.display_name INTO v_event_title, v_person
    FROM event_registrations er JOIN events e ON e.id=er.event_id JOIN users u ON u.id=er.user_id
    WHERE er.id=p_target_id;
    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id,payment_method)
    SELECT v_user_id,'event_fee',0,balance,
           'Evento: '||v_event_title||' — '||v_person||v_desc_suffix,
           p_operator_id,(SELECT event_id FROM event_registrations WHERE id=p_target_id),v_pay_method
    FROM users WHERE id=v_user_id;

  ELSIF p_target_type='companion' THEN
    SELECT payment_status INTO v_prev_status FROM event_companions WHERE id=p_target_id;
    IF v_prev_status='sumup_in_attesa' THEN
      v_final_status := 'saldato_sumup'; v_pay_method := 'sumup'; v_desc_suffix := ' (SumUp confermato)';
    ELSIF v_prev_status='cassa_in_attesa' THEN
      v_final_status := 'saldato_cassa'; v_pay_method := 'cassa'; v_desc_suffix := ' (Cassa confermato)';
    ELSE
      RETURN jsonb_build_object('ok',false,'error','Non in attesa');
    END IF;
    UPDATE event_companions SET payment_status=v_final_status, paid_at=now(), paid_by=p_operator_id
      WHERE id=p_target_id
      RETURNING registration_id INTO v_reg_id;
    SELECT e.title, ec.nome||' '||ec.cognome, er.user_id, e.price
    INTO v_event_title, v_person, v_user_id, v_amount
    FROM event_companions ec
    JOIN event_registrations er ON er.id=ec.registration_id
    JOIN events e ON e.id=er.event_id
    WHERE ec.id=p_target_id;
    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id,payment_method)
    SELECT v_user_id,'event_fee',0,balance,
           'Evento: '||v_event_title||' — '||v_person||v_desc_suffix,
           p_operator_id,(SELECT er.event_id FROM event_companions ec JOIN event_registrations er ON er.id=ec.registration_id WHERE ec.id=p_target_id),v_pay_method
    FROM users WHERE id=v_user_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'error','target_type non valido');
  END IF;

  IF v_reg_id IS NOT NULL THEN
    PERFORM _check_and_apply_promo_bonus(v_reg_id, p_operator_id);
  END IF;

  RETURN jsonb_build_object('ok',true,'confirmed',true,'payment_method',v_pay_method,'message','Pagamento confermato');
END; $$;
