-- 20260731095134_rpc_sumup_pending_queue
-- ricostruita da supabase_migrations.schema_migrations


-- ═══════════════════════════════════════════════════════════════
-- BLOCCO 2: RPC — Pagamenti SumUp con conferma staff
-- Nuovo stato: 'sumup_in_attesa' (attende conferma admin/staff)
-- ═══════════════════════════════════════════════════════════════

-- 2a. user_pay_event_sumup: il socio dichiara di aver pagato con SumUp
-- p_targets = { self: bool, companion_ids: uuid[] }
-- Marca le persone selezionate come 'sumup_in_attesa' (NON scala credito)
CREATE OR REPLACE FUNCTION public.user_pay_event_sumup(
  p_user_id uuid, p_registration_id uuid, p_targets jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_reg   record;
  v_event record;
  v_cid   uuid;
  v_self  boolean;
  v_count int := 0;
BEGIN
  SELECT er.* INTO v_reg FROM event_registrations er
    WHERE er.id=p_registration_id AND er.user_id=p_user_id
      AND er.payment_status NOT IN ('annullato');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Registrazione non trovata'); END IF;

  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  IF v_event.sumup_link IS NULL OR v_event.sumup_link='' THEN
    RETURN jsonb_build_object('ok',false,'error','Nessun link SumUp configurato per questo evento');
  END IF;

  v_self := COALESCE((p_targets->>'self')::boolean, false);

  IF v_self AND v_reg.payment_status='da_saldare' THEN
    UPDATE event_registrations SET payment_status='sumup_in_attesa' WHERE id=p_registration_id;
    v_count := v_count + 1;
  END IF;

  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    UPDATE event_companions
       SET payment_status='sumup_in_attesa', payment_method='sumup'
     WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;

  IF v_count=0 THEN RETURN jsonb_build_object('ok',false,'error','Nessuna persona da segnare'); END IF;

  RETURN jsonb_build_object('ok',true,'marked',v_count,'sumup_link',v_event.sumup_link,
    'message','Segnati '||v_count||' pagamenti SumUp. Attende conferma dello staff.');
END;
$$;

-- 2b. admin_list_pending_sumup: coda pagamenti SumUp da confermare
-- (sia iscrizioni evento sia companions in stato sumup_in_attesa)
CREATE OR REPLACE FUNCTION public.admin_list_pending_sumup(p_operator_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT 'registration'::text AS target_type, er.id AS target_id, er.event_id,
           e.title AS event_title, e.event_date, er.amount,
           u.id AS user_id, u.card_id, u.display_name AS person_name,
           er.created_at AS marked_at
    FROM event_registrations er
    JOIN events e ON e.id=er.event_id
    JOIN users u  ON u.id=er.user_id
    WHERE er.payment_status='sumup_in_attesa'
    UNION ALL
    SELECT 'companion'::text, ec.id, er.event_id,
           e.title, e.event_date, e.price,
           u.id, u.card_id, ec.nome||' '||ec.cognome,
           ec.created_at
    FROM event_companions ec
    JOIN event_registrations er ON er.id=ec.registration_id
    JOIN events e ON e.id=er.event_id
    JOIN users u  ON u.id=er.user_id
    WHERE ec.payment_status='sumup_in_attesa'
    ORDER BY marked_at DESC
  ) x;

  RETURN jsonb_build_object('ok',true,'pending',v_result);
END;
$$;

-- 2c. admin_confirm_sumup_payment: conferma un pagamento SumUp
CREATE OR REPLACE FUNCTION public.admin_confirm_sumup_payment(
  p_operator_id uuid, p_target_type text, p_target_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_amount numeric; v_user_id uuid; v_event_title text; v_person text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  IF p_target_type='registration' THEN
    UPDATE event_registrations SET payment_status='saldato_sumup', paid_at=now(), paid_by=p_operator_id
    WHERE id=p_target_id AND payment_status='sumup_in_attesa'
    RETURNING amount, user_id INTO v_amount, v_user_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Non in attesa'); END IF;

    SELECT e.title, u.display_name INTO v_event_title, v_person
    FROM event_registrations er JOIN events e ON e.id=er.event_id JOIN users u ON u.id=er.user_id
    WHERE er.id=p_target_id;

    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id,payment_method)
    SELECT v_user_id,'event_fee',0,balance,
           'Evento: '||v_event_title||' — '||v_person||' (SumUp confermato)',
           p_operator_id,(SELECT event_id FROM event_registrations WHERE id=p_target_id),'sumup'
    FROM users WHERE id=v_user_id;

  ELSIF p_target_type='companion' THEN
    UPDATE event_companions SET payment_status='saldato_sumup', paid_at=now(), paid_by=p_operator_id
    WHERE id=p_target_id AND payment_status='sumup_in_attesa';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Non in attesa'); END IF;

    SELECT e.title, ec.nome||' '||ec.cognome, er.user_id, e.price
    INTO v_event_title, v_person, v_user_id, v_amount
    FROM event_companions ec
    JOIN event_registrations er ON er.id=ec.registration_id
    JOIN events e ON e.id=er.event_id
    WHERE ec.id=p_target_id;

    INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id,payment_method)
    SELECT v_user_id,'event_fee',0,balance,
           'Evento: '||v_event_title||' — '||v_person||' (SumUp confermato)',
           p_operator_id,(SELECT er.event_id FROM event_companions ec JOIN event_registrations er ON er.id=ec.registration_id WHERE ec.id=p_target_id),'sumup'
    FROM users WHERE id=v_user_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'error','target_type non valido');
  END IF;

  RETURN jsonb_build_object('ok',true,'confirmed',true,'message','Pagamento SumUp confermato');
END;
$$;

-- 2d. admin_reject_sumup_payment: rifiuta e rimette in da_saldare
CREATE OR REPLACE FUNCTION public.admin_reject_sumup_payment(
  p_operator_id uuid, p_target_type text, p_target_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  IF p_target_type='registration' THEN
    UPDATE event_registrations SET payment_status='da_saldare'
    WHERE id=p_target_id AND payment_status='sumup_in_attesa';
  ELSIF p_target_type='companion' THEN
    UPDATE event_companions SET payment_status='da_saldare', payment_method=NULL
    WHERE id=p_target_id AND payment_status='sumup_in_attesa';
  ELSE
    RETURN jsonb_build_object('ok',false,'error','target_type non valido');
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Non in attesa'); END IF;
  RETURN jsonb_build_object('ok',true,'message','Pagamento rifiutato, torna in da_saldare');
END;
$$;
