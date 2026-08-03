-- 20260731145714_rpc_user_event_edit_and_cancel
-- ricostruita da supabase_migrations.schema_migrations

-- ═══════════════════════════════════════════════════════════════
-- Migration 8: user-side event edit/cancel (change payment, remove
-- self or companion, cancel full registration, rejoin).
-- Refund waterfall coerente con gadget flow.
-- Deadline: fino a event_date (compreso — quindi < event_date).
-- ═══════════════════════════════════════════════════════════════

-- ─── Schema: self_included + companion.status ───
ALTER TABLE public.event_registrations 
  ADD COLUMN IF NOT EXISTS self_included boolean NOT NULL DEFAULT true;

ALTER TABLE public.event_companions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'attivo';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint 
                 WHERE conname='event_companions_status_check') THEN
    ALTER TABLE public.event_companions
      ADD CONSTRAINT event_companions_status_check 
      CHECK (status IN ('attivo','annullato'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_event_companions_status ON public.event_companions(status);

-- ─── Helper: recompute party_size ───
CREATE OR REPLACE FUNCTION public._recompute_party_size(p_reg_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_self boolean; v_count int; v_new int;
BEGIN
  SELECT self_included INTO v_self FROM event_registrations WHERE id=p_reg_id;
  SELECT count(*) INTO v_count FROM event_companions WHERE registration_id=p_reg_id AND status='attivo';
  v_new := (CASE WHEN v_self THEN 1 ELSE 0 END) + v_count;
  UPDATE event_registrations SET party_size = v_new WHERE id=p_reg_id;
  RETURN v_new;
END;
$function$;

-- ─── Helper: process refund for a "unit" (self or companion) that had already paid ───
CREATE OR REPLACE FUNCTION public._process_event_unit_refund(
  p_user_id uuid, 
  p_payment_status text, 
  p_amount numeric, 
  p_source_type text, 
  p_source_id uuid, 
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_new_bal numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('refunded',false,'reason','no_amount');
  END IF;
  
  IF p_payment_status = 'saldato_credito' OR p_payment_status = 'saldato' THEN
    UPDATE users SET balance = balance + p_amount, updated_at = now()
    WHERE id = p_user_id RETURNING balance INTO v_new_bal;
    INSERT INTO transactions(user_id, type, amount, balance_after, description, ref_id)
    VALUES (p_user_id, 'refund', p_amount, v_new_bal, p_reason || ' (rimborso credito)', p_source_id);
    RETURN jsonb_build_object('refunded',true,'method','credito','amount',p_amount);
    
  ELSIF p_payment_status = 'saldato_sumup' THEN
    INSERT INTO refund_queue(user_id, source_type, source_id, amount, original_payment_method, reason)
    VALUES (p_user_id, p_source_type, p_source_id, p_amount, 'sumup', p_reason);
    RETURN jsonb_build_object('refunded',false,'method','sumup','amount',p_amount,'queued',true);
    
  ELSIF p_payment_status = 'saldato_cassa' THEN
    INSERT INTO refund_queue(user_id, source_type, source_id, amount, original_payment_method, reason)
    VALUES (p_user_id, p_source_type, p_source_id, p_amount, 'cassa', p_reason);
    RETURN jsonb_build_object('refunded',false,'method','cassa','amount',p_amount,'queued',true);
    
  ELSE
    -- da_saldare / sumup_in_attesa / cassa_in_attesa: nothing to refund
    RETURN jsonb_build_object('refunded',false,'reason','not_paid');
  END IF;
END;
$function$;

-- ─── 1) user_change_event_payment_method ───
CREATE OR REPLACE FUNCTION public.user_change_event_payment_method(
  p_user_id uuid,
  p_registration_id uuid,
  p_target_type text,      -- 'self' | 'companion'
  p_target_id uuid,        -- registration_id if 'self', companion_id if 'companion'
  p_new_method text        -- 'credito' | 'sumup' | 'cassa'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_reg record; v_cur_status text;
BEGIN
  SELECT er.*, e.event_date INTO v_reg 
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.status='confirmed';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.event_date <= now() THEN
    RETURN jsonb_build_object('ok',false,'error','Evento già iniziato o passato');
  END IF;
  IF p_new_method NOT IN ('credito','sumup','cassa') THEN
    RETURN jsonb_build_object('ok',false,'error','Metodo non valido');
  END IF;

  IF p_target_type='self' THEN
    IF NOT v_reg.self_included THEN
      RETURN jsonb_build_object('ok',false,'error','Non stai partecipando personalmente');
    END IF;
    IF v_reg.payment_status <> 'da_saldare' THEN
      RETURN jsonb_build_object('ok',false,'error','Modificabile solo se ancora da saldare');
    END IF;
    UPDATE event_registrations SET payment_method=p_new_method WHERE id=p_registration_id;
    
  ELSIF p_target_type='companion' THEN
    SELECT payment_status INTO v_cur_status FROM event_companions 
      WHERE id=p_target_id AND registration_id=p_registration_id AND status='attivo';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Accompagnatore non trovato'); END IF;
    IF v_cur_status <> 'da_saldare' THEN
      RETURN jsonb_build_object('ok',false,'error','Modificabile solo se ancora da saldare');
    END IF;
    UPDATE event_companions SET payment_method=p_new_method WHERE id=p_target_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'error','target_type non valido');
  END IF;
  
  RETURN jsonb_build_object('ok',true,'message','Metodo aggiornato');
END;
$function$;

-- ─── 2) user_remove_self_from_event ───
CREATE OR REPLACE FUNCTION public.user_remove_self_from_event(
  p_user_id uuid,
  p_registration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  v_reg record; v_active_comp int; v_refund jsonb; v_event_title text;
BEGIN
  SELECT er.*, e.event_date, e.title INTO v_reg 
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.status='confirmed';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.event_date <= now() THEN
    RETURN jsonb_build_object('ok',false,'error','Evento già iniziato o passato');
  END IF;
  IF NOT v_reg.self_included THEN
    RETURN jsonb_build_object('ok',false,'error','Non stavi partecipando personalmente');
  END IF;
  v_event_title := v_reg.title;

  SELECT count(*) INTO v_active_comp FROM event_companions 
  WHERE registration_id=p_registration_id AND status='attivo';

  -- Refund self quota if paid
  v_refund := _process_event_unit_refund(
    p_user_id, v_reg.payment_status, v_reg.amount, 'event_registration', p_registration_id,
    'Rimozione partecipazione: ' || v_event_title
  );

  IF v_active_comp = 0 THEN
    -- Nessun companion attivo → cancella l'intera iscrizione
    UPDATE event_registrations 
      SET status='cancelled', self_included=false, payment_status='annullato'
      WHERE id=p_registration_id;
    RETURN jsonb_build_object('ok',true,'action','cancelled_full','refund',v_refund,
      'message','Iscrizione annullata');
  ELSE
    -- Ci sono companions attivi → il socio esce ma restano
    UPDATE event_registrations 
      SET self_included=false, payment_status='annullato', payment_method=NULL
      WHERE id=p_registration_id;
    PERFORM _recompute_party_size(p_registration_id);
    RETURN jsonb_build_object('ok',true,'action','self_removed','refund',v_refund,
      'companions_left', v_active_comp,
      'message','Hai tolto la tua partecipazione. Gli accompagnatori restano iscritti.');
  END IF;
END;
$function$;

-- ─── 3) user_remove_companion_from_event ───
CREATE OR REPLACE FUNCTION public.user_remove_companion_from_event(
  p_user_id uuid,
  p_registration_id uuid,
  p_companion_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  v_reg record; v_comp record; v_amount numeric; v_refund jsonb; 
  v_active_comp int; v_event_title text; v_person text;
BEGIN
  SELECT er.*, e.event_date, e.title, e.price INTO v_reg 
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.status='confirmed';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.event_date <= now() THEN
    RETURN jsonb_build_object('ok',false,'error','Evento già iniziato o passato');
  END IF;
  
  SELECT * INTO v_comp FROM event_companions 
  WHERE id=p_companion_id AND registration_id=p_registration_id AND status='attivo';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Accompagnatore non trovato'); END IF;
  
  v_event_title := v_reg.title;
  v_person := v_comp.nome || ' ' || v_comp.cognome;
  v_amount := v_reg.price;  -- prezzo evento singolo (companion quota = prezzo)

  -- Rimborso al socio pagatore (paid_by o user_id titolare)
  v_refund := _process_event_unit_refund(
    COALESCE(v_comp.paid_by, p_user_id), v_comp.payment_status, v_amount,
    'event_companion', p_companion_id,
    'Rimozione ' || v_person || ' da evento: ' || v_event_title
  );

  UPDATE event_companions SET status='annullato' WHERE id=p_companion_id;

  -- Se dopo la rimozione: self escluso e zero companions attivi → cancella iscrizione
  SELECT count(*) INTO v_active_comp FROM event_companions 
    WHERE registration_id=p_registration_id AND status='attivo';
  
  IF NOT v_reg.self_included AND v_active_comp = 0 THEN
    UPDATE event_registrations SET status='cancelled' WHERE id=p_registration_id;
    RETURN jsonb_build_object('ok',true,'action','cancelled_after_removal','refund',v_refund,
      'message','Rimosso. Iscrizione ora vuota, cancellata.');
  END IF;

  PERFORM _recompute_party_size(p_registration_id);
  RETURN jsonb_build_object('ok',true,'action','companion_removed','refund',v_refund,
    'active_companions',v_active_comp,
    'message','Accompagnatore rimosso');
END;
$function$;

-- ─── 4) user_cancel_event_registration ───
CREATE OR REPLACE FUNCTION public.user_cancel_event_registration(
  p_user_id uuid,
  p_registration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  v_reg record; v_comp record; v_refunds jsonb := '[]'::jsonb; 
  v_self_refund jsonb; v_comp_refund jsonb; v_event_title text;
BEGIN
  SELECT er.*, e.event_date, e.title, e.price INTO v_reg 
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.status='confirmed';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.event_date <= now() THEN
    RETURN jsonb_build_object('ok',false,'error','Evento già iniziato o passato');
  END IF;
  v_event_title := v_reg.title;

  -- Refund self if included and paid
  IF v_reg.self_included THEN
    v_self_refund := _process_event_unit_refund(
      p_user_id, v_reg.payment_status, v_reg.amount, 'event_registration', p_registration_id,
      'Annullo iscrizione: ' || v_event_title
    );
    v_refunds := v_refunds || jsonb_build_array(jsonb_build_object('who','self','refund',v_self_refund));
  END IF;

  -- Refund each active companion
  FOR v_comp IN SELECT * FROM event_companions 
                WHERE registration_id=p_registration_id AND status='attivo' LOOP
    v_comp_refund := _process_event_unit_refund(
      COALESCE(v_comp.paid_by, p_user_id), v_comp.payment_status, v_reg.price,
      'event_companion', v_comp.id,
      'Annullo iscrizione: ' || v_event_title || ' — ' || v_comp.nome || ' ' || v_comp.cognome
    );
    v_refunds := v_refunds || jsonb_build_array(
      jsonb_build_object('who','companion','name',v_comp.nome||' '||v_comp.cognome,'refund',v_comp_refund));
    UPDATE event_companions SET status='annullato' WHERE id=v_comp.id;
  END LOOP;

  UPDATE event_registrations 
    SET status='cancelled', payment_status='annullato', self_included=false
    WHERE id=p_registration_id;

  RETURN jsonb_build_object('ok',true,'action','cancelled_full','refunds',v_refunds,
    'message','Iscrizione annullata');
END;
$function$;

-- ─── 5) user_rejoin_event (opzionale, socio riparte dopo remove_self) ───
CREATE OR REPLACE FUNCTION public.user_rejoin_event(
  p_user_id uuid,
  p_registration_id uuid,
  p_payment_method text DEFAULT 'credito'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_reg record; v_used int; v_max int;
BEGIN
  SELECT er.*, e.event_date, e.max_participants INTO v_reg 
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.status='confirmed';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.event_date <= now() THEN
    RETURN jsonb_build_object('ok',false,'error','Evento già iniziato o passato');
  END IF;
  IF v_reg.self_included THEN
    RETURN jsonb_build_object('ok',false,'error','Stai già partecipando');
  END IF;
  IF p_payment_method NOT IN ('credito','sumup','cassa') THEN
    RETURN jsonb_build_object('ok',false,'error','Metodo non valido');
  END IF;

  -- Check disponibilità posti
  IF v_reg.max_participants IS NOT NULL THEN
    SELECT COALESCE(SUM(party_size),0) INTO v_used
    FROM event_registrations WHERE event_id=v_reg.event_id AND status='confirmed';
    IF v_used + 1 > v_reg.max_participants THEN
      RETURN jsonb_build_object('ok',false,'error','Posti esauriti');
    END IF;
  END IF;

  UPDATE event_registrations 
    SET self_included=true, payment_status='da_saldare', payment_method=p_payment_method
    WHERE id=p_registration_id;
  PERFORM _recompute_party_size(p_registration_id);

  RETURN jsonb_build_object('ok',true,'message','Sei di nuovo iscritto. Da saldare.');
END;
$function$;

-- ─── grants ───
GRANT EXECUTE ON FUNCTION public.user_change_event_payment_method(uuid,uuid,text,uuid,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_remove_self_from_event(uuid,uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_remove_companion_from_event(uuid,uuid,uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_cancel_event_registration(uuid,uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_rejoin_event(uuid,uuid,text) TO authenticated, anon;
