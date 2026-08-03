-- 20260731114651_rpc_cash_payment_queue_and_dashboard_fix
-- ricostruita da supabase_migrations.schema_migrations

-- ═══════════════════════════════════════════════════════════════
-- Migration 6: cash payment queue + dashboard fix (soci without staff)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1) admin_dashboard: total_soci = only non-staff active users ───
CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN json_build_object(
    'total_soci',         (SELECT count(*) FROM public.users WHERE role='user' AND active=true AND is_staff=false),
    'total_soci_staff',   (SELECT count(*) FROM public.users WHERE role='user' AND active=true AND is_staff=true),
    'total_users',        (SELECT count(*) FROM public.users WHERE role='user' AND active=true AND is_staff=false),
    'total_staff',        (SELECT count(*) FROM public.users WHERE role='user' AND active=true AND is_staff=true),
    'total_balance',      (SELECT coalesce(sum(balance),0) FROM public.users WHERE role='user' AND active=true),
    'total_recharges',    (SELECT coalesce(sum(amount),0) FROM public.transactions WHERE type='recharge'),
    'total_purchases',    (SELECT coalesce(sum(abs(amount)),0) FROM public.transactions WHERE type='purchase'),
    'total_events',       (SELECT count(*) FROM public.events WHERE active=true),
    'total_registrations',(SELECT count(*) FROM public.event_registrations WHERE status='confirmed'),
    'transactions_today', (SELECT count(*) FROM public.transactions WHERE created_at>=current_date),
    'pending_sumup_count',(SELECT (SELECT count(*) FROM event_registrations WHERE payment_status='sumup_in_attesa')
                                + (SELECT count(*) FROM event_companions    WHERE payment_status='sumup_in_attesa')),
    'pending_cash_count', (SELECT (SELECT count(*) FROM event_registrations WHERE payment_status='cassa_in_attesa')
                                + (SELECT count(*) FROM event_companions    WHERE payment_status='cassa_in_attesa')),
    'pending_payments_count',(SELECT (SELECT count(*) FROM event_registrations WHERE payment_status IN ('sumup_in_attesa','cassa_in_attesa'))
                                   + (SELECT count(*) FROM event_companions    WHERE payment_status IN ('sumup_in_attesa','cassa_in_attesa'))),
    'pending_refund_count',(SELECT count(*) FROM public.refund_queue WHERE status='da_gestire'),
    'waitlist_count',      (SELECT count(*) FROM public.gadget_reservations WHERE status='attesa_ordine')
  );
END; $function$;

-- ─── 2) user_pay_event_cash: mark payment as "cassa_in_attesa" ───
CREATE OR REPLACE FUNCTION public.user_pay_event_cash(p_user_id uuid, p_registration_id uuid, p_targets jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_reg   record;
  v_cid   uuid;
  v_self  boolean;
  v_count int := 0;
BEGIN
  SELECT er.* INTO v_reg FROM event_registrations er
    WHERE er.id=p_registration_id AND er.user_id=p_user_id
      AND er.payment_status NOT IN ('annullato');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Registrazione non trovata'); END IF;

  v_self := COALESCE((p_targets->>'self')::boolean, false);

  IF v_self AND v_reg.payment_status='da_saldare' THEN
    UPDATE event_registrations SET payment_status='cassa_in_attesa' WHERE id=p_registration_id;
    v_count := v_count + 1;
  END IF;

  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    UPDATE event_companions
       SET payment_status='cassa_in_attesa', payment_method='cassa'
     WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;

  IF v_count=0 THEN RETURN jsonb_build_object('ok',false,'error','Nessuna persona da segnare'); END IF;

  RETURN jsonb_build_object('ok',true,'marked',v_count,
    'message','Segnati '||v_count||' pagamenti in cassa. Attende conferma dello staff.');
END;
$function$;

-- ─── 3) admin_list_pending_payments: unified queue (SumUp + Cash) ───
CREATE OR REPLACE FUNCTION public.admin_list_pending_payments(p_operator_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT 'registration'::text AS target_type, er.id AS target_id, er.event_id,
           e.title AS event_title, e.event_date, er.amount,
           u.id AS user_id, u.card_id, u.display_name AS person_name,
           er.created_at AS marked_at,
           CASE WHEN er.payment_status='sumup_in_attesa' THEN 'sumup' ELSE 'cassa' END AS payment_method
    FROM event_registrations er
    JOIN events e ON e.id=er.event_id
    JOIN users u  ON u.id=er.user_id
    WHERE er.payment_status IN ('sumup_in_attesa','cassa_in_attesa')
    UNION ALL
    SELECT 'companion'::text, ec.id, er.event_id,
           e.title, e.event_date, e.price,
           u.id, u.card_id, ec.nome||' '||ec.cognome,
           ec.created_at,
           CASE WHEN ec.payment_status='sumup_in_attesa' THEN 'sumup' ELSE 'cassa' END
    FROM event_companions ec
    JOIN event_registrations er ON er.id=ec.registration_id
    JOIN events e ON e.id=er.event_id
    JOIN users u  ON u.id=er.user_id
    WHERE ec.payment_status IN ('sumup_in_attesa','cassa_in_attesa')
    ORDER BY marked_at DESC
  ) x;

  RETURN jsonb_build_object('ok',true,'pending',v_result);
END;
$function$;

-- ─── 4) admin_confirm_payment: unified confirmation (SumUp + Cash) ───
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(p_operator_id uuid, p_target_type text, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE 
  v_amount numeric; v_user_id uuid; v_event_title text; v_person text;
  v_prev_status text; v_final_status text; v_pay_method text; v_desc_suffix text;
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
    RETURNING amount, user_id INTO v_amount, v_user_id;

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
    WHERE id=p_target_id;

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

  RETURN jsonb_build_object('ok',true,'confirmed',true,'payment_method',v_pay_method,'message','Pagamento confermato');
END;
$function$;

-- ─── 5) admin_reject_payment: unified rejection (SumUp + Cash) ───
CREATE OR REPLACE FUNCTION public.admin_reject_payment(p_operator_id uuid, p_target_type text, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  IF p_target_type='registration' THEN
    UPDATE event_registrations SET payment_status='da_saldare'
    WHERE id=p_target_id AND payment_status IN ('sumup_in_attesa','cassa_in_attesa');
  ELSIF p_target_type='companion' THEN
    UPDATE event_companions SET payment_status='da_saldare', payment_method=NULL
    WHERE id=p_target_id AND payment_status IN ('sumup_in_attesa','cassa_in_attesa');
  ELSE
    RETURN jsonb_build_object('ok',false,'error','target_type non valido');
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Non in attesa'); END IF;
  RETURN jsonb_build_object('ok',true,'message','Pagamento rifiutato, torna in da_saldare');
END;
$function$;

-- ─── Grant execute to authenticated (RLS enforcement inside functions) ───
GRANT EXECUTE ON FUNCTION public.user_pay_event_cash(uuid,uuid,jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_payments(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(uuid,text,uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid,text,uuid) TO authenticated, anon;
