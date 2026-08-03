-- 20260709142302_050_per_person_payment
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- ╔══════════════════════════════════════════════╗
-- ║  050 — pagamento per-persona (eventi)        ║
-- ╚══════════════════════════════════════════════╝

-- 1. Nuove colonne su event_companions
ALTER TABLE event_companions
  ADD COLUMN IF NOT EXISTS payment_status  text        NOT NULL DEFAULT 'da_saldare',
  ADD COLUMN IF NOT EXISTS paid_at         timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by         uuid,
  ADD COLUMN IF NOT EXISTS payment_method  text;

-- ── 2. user_pay_event_people ────────────────────────────────────────────
DROP FUNCTION IF EXISTS user_pay_event_people(uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION user_pay_event_people(
  p_user_id         uuid,
  p_registration_id uuid,
  p_targets         jsonb  -- {"self":bool,"companion_ids":["uuid",...]}
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user   record;
  v_reg    record;
  v_event  record;
  v_comp   record;
  v_cid    uuid;
  v_price  numeric;
  v_count  int     := 0;
  v_names  text[]  := '{}';
  v_total  numeric;
  v_self   boolean;
  v_new_bal numeric;
BEGIN
  SELECT * INTO v_user FROM users WHERE id=p_user_id AND active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Utente non trovato'); END IF;

  SELECT er.* INTO v_reg FROM event_registrations er
    WHERE er.id=p_registration_id AND er.user_id=p_user_id AND er.payment_status != 'annullato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Registrazione non trovata'); END IF;

  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  v_price := COALESCE(v_event.price, 0);
  v_self  := COALESCE((p_targets->>'self')::boolean, false);

  IF v_self AND v_reg.payment_status = 'da_saldare' THEN
    v_count := v_count + 1;
    v_names := array_append(v_names, v_user.display_name);
  END IF;

  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    SELECT * INTO v_comp FROM event_companions
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
    IF FOUND THEN
      v_count := v_count + 1;
      v_names := array_append(v_names, v_comp.nome||' '||v_comp.cognome);
    END IF;
  END LOOP;

  IF v_count = 0 THEN RETURN jsonb_build_object('ok',false,'error','Nessuna persona da saldare selezionata'); END IF;
  v_total := v_count * v_price;

  IF v_user.balance < v_total THEN
    RETURN jsonb_build_object('ok',false,'error',
      'Saldo insufficiente (servono '||to_char(v_total,'FM990.00')||' €, hai '||to_char(v_user.balance,'FM990.00')||' €)');
  END IF;

  UPDATE users SET balance=balance-v_total, updated_at=now() WHERE id=p_user_id
    RETURNING balance INTO v_new_bal;

  INSERT INTO transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
    VALUES(p_user_id,'event_fee',-v_total,v_new_bal,
      'Evento: '||v_event.title||' — '||v_count||' pers.: '||array_to_string(v_names,', '),
      p_user_id, v_reg.event_id);

  IF v_self AND v_reg.payment_status='da_saldare' THEN
    UPDATE event_registrations SET payment_status='saldato_credito',paid_at=now(),paid_by=p_user_id WHERE id=p_registration_id;
  END IF;

  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    UPDATE event_companions SET payment_status='saldato_credito',paid_at=now(),paid_by=p_user_id,payment_method='credito'
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
  END LOOP;

  RETURN jsonb_build_object('ok',true,'paid_count',v_count,'total',v_total,'new_balance',v_new_bal,
    'message','Pagato '||v_count||' pers.: '||array_to_string(v_names,', '));
END;
$$;

-- ── 3. staff_pay_event_people ───────────────────────────────────────────
DROP FUNCTION IF EXISTS staff_pay_event_people(uuid, uuid, jsonb, text);
CREATE OR REPLACE FUNCTION staff_pay_event_people(
  p_operator_id     uuid,
  p_registration_id uuid,
  p_targets         jsonb,
  p_method          text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_op    record;
  v_user  record;
  v_reg   record;
  v_event record;
  v_comp  record;
  v_cid   uuid;
  v_price numeric;
  v_count int    := 0;
  v_names text[] := '{}';
  v_total numeric;
  v_self  boolean;
  v_status text;
  v_new_bal numeric;
BEGIN
  SELECT * INTO v_op FROM users WHERE id=p_operator_id AND role IN ('staff','admin') AND active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Non autorizzato'); END IF;

  SELECT er.* INTO v_reg FROM event_registrations er
    WHERE er.id=p_registration_id AND er.payment_status != 'annullato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Registrazione non trovata'); END IF;

  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  SELECT * INTO v_user  FROM users  WHERE id=v_reg.user_id;
  v_price := COALESCE(v_event.price, 0);
  v_self  := COALESCE((p_targets->>'self')::boolean, false);

  IF v_self AND v_reg.payment_status='da_saldare' THEN
    v_count := v_count + 1;
    v_names := array_append(v_names, v_user.display_name);
  END IF;

  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    SELECT * INTO v_comp FROM event_companions
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
    IF FOUND THEN
      v_count := v_count + 1;
      v_names := array_append(v_names, v_comp.nome||' '||v_comp.cognome);
    END IF;
  END LOOP;

  IF v_count = 0 THEN RETURN jsonb_build_object('ok',false,'error','Nessuna persona da saldare'); END IF;
  v_total  := v_count * v_price;
  v_status := CASE p_method WHEN 'credito' THEN 'saldato_credito' WHEN 'sumup' THEN 'saldato_sumup' ELSE 'saldato_contanti' END;

  IF p_method = 'credito' THEN
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
    UPDATE event_registrations SET payment_status=v_status,paid_at=now(),paid_by=p_operator_id WHERE id=p_registration_id;
  END IF;
  FOR v_cid IN SELECT jsonb_array_elements_text(COALESCE(p_targets->'companion_ids','[]'::jsonb))::uuid LOOP
    UPDATE event_companions SET payment_status=v_status,paid_at=now(),paid_by=p_operator_id,payment_method=p_method
      WHERE id=v_cid AND registration_id=p_registration_id AND payment_status='da_saldare';
  END LOOP;

  RETURN jsonb_build_object('ok',true,'paid_count',v_count,'total',v_total,
    'message','Saldato '||v_count||' pers. ('||p_method||'): '||array_to_string(v_names,', '));
END;
$$;

-- ── 4. staff_pay_event — retrocompatibilità: marca anche companions ─────
DROP FUNCTION IF EXISTS staff_pay_event(uuid, uuid, text);
CREATE OR REPLACE FUNCTION staff_pay_event(
  p_operator_id    uuid,
  p_registration_id uuid,
  p_method         text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_operator public.users%ROWTYPE;
  v_reg      public.event_registrations%ROWTYPE;
  v_user     public.users%ROWTYPE;
  v_event    public.events%ROWTYPE;
  v_status   TEXT;
  v_tx_id    UUID;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id=p_operator_id AND active=true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;
  SELECT * INTO v_reg FROM public.event_registrations WHERE id=p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Iscrizione non trovata'); END IF;
  IF v_reg.payment_status != 'da_saldare' THEN
    RETURN json_build_object('ok',false,'error','Iscrizione già saldata ('||v_reg.payment_status||')');
  END IF;
  SELECT * INTO v_user  FROM public.users  WHERE id=v_reg.user_id;
  SELECT * INTO v_event FROM public.events WHERE id=v_reg.event_id;

  IF p_method='credito' THEN
    IF v_user.balance < COALESCE(v_reg.amount,0) THEN
      RETURN json_build_object('ok',false,'error','Saldo insufficiente','balance',v_user.balance,'required',v_reg.amount);
    END IF;
    UPDATE public.users SET balance=balance-v_reg.amount,updated_at=now() WHERE id=v_user.id;
    INSERT INTO public.transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
      VALUES(v_user.id,'event_fee',-v_reg.amount,v_user.balance-v_reg.amount,
             'Evento: '||v_event.title||' (credito)',p_operator_id,v_reg.event_id) RETURNING id INTO v_tx_id;
    v_status := 'saldato_credito';
  ELSIF p_method='sumup' THEN
    v_status := 'saldato_sumup';
    INSERT INTO public.transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
      VALUES(v_user.id,'event_fee',0,v_user.balance,'Evento: '||v_event.title||' (SumUp)',p_operator_id,v_reg.event_id) RETURNING id INTO v_tx_id;
  ELSIF p_method='contanti' THEN
    v_status := 'saldato_contanti';
    INSERT INTO public.transactions(user_id,type,amount,balance_after,description,operator_id,ref_id)
      VALUES(v_user.id,'event_fee',0,v_user.balance,'Evento: '||v_event.title||' (contanti)',p_operator_id,v_reg.event_id) RETURNING id INTO v_tx_id;
  ELSE
    RETURN json_build_object('ok',false,'error','Metodo non valido: credito | sumup | contanti');
  END IF;

  UPDATE public.event_registrations
    SET payment_status=v_status,paid_at=now(),paid_by=p_operator_id,transaction_id=v_tx_id,status='confirmed'
    WHERE id=p_registration_id;

  -- Retrocompatibilità: segna anche tutti i companions da_saldare
  UPDATE event_companions SET payment_status=v_status,paid_at=now(),paid_by=p_operator_id,payment_method=p_method
    WHERE registration_id=p_registration_id AND payment_status='da_saldare';

  RETURN json_build_object(
    'ok',true,'registration_id',p_registration_id,'card_id',v_user.card_id,
    'display_name',v_user.display_name,'event',v_event.title,'method',p_method,
    'amount',v_reg.amount,
    'new_balance',CASE WHEN p_method='credito' THEN v_user.balance-v_reg.amount ELSE v_user.balance END,
    'operator',v_operator.display_name,'message','Pagamento registrato: '||v_event.title||' ('||p_method||')'
  );
END;
$$;

-- ── 5. admin_event_dashboard — paganti = persone individuali ────────────
DROP FUNCTION IF EXISTS admin_event_dashboard(uuid);
CREATE OR REPLACE FUNCTION admin_event_dashboard(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_reg_total    BIGINT := 0;
  v_gst_total    BIGINT := 0;
  v_reg_paid     BIGINT := 0;
  v_comp_paid    BIGINT := 0;
  v_gst_paid     BIGINT := 0;
  v_reg_present  BIGINT := 0;
  v_comp_present BIGINT := 0;
  v_gst_present  BIGINT := 0;
  v_incasso      NUMERIC := 0;
  v_incasso_gst  NUMERIC := 0;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN payment_status!='annullato' THEN party_size ELSE 0 END),0),
    COUNT(*) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),
    COUNT(*) FILTER (WHERE checked_in=true),
    COALESCE(SUM(amount) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),0)
  INTO v_reg_total,v_reg_paid,v_reg_present,v_incasso
  FROM event_registrations WHERE event_id=p_event_id;

  SELECT
    COUNT(*) FILTER (WHERE payment_status!='annullato'),
    COUNT(*) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),
    COUNT(*) FILTER (WHERE checked_in=true),
    COALESCE(SUM(amount) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),0)
  INTO v_gst_total,v_gst_paid,v_gst_present,v_incasso_gst
  FROM event_guests WHERE event_id=p_event_id;

  SELECT COUNT(*) INTO v_comp_paid
  FROM event_companions ec JOIN event_registrations er ON er.id=ec.registration_id
  WHERE er.event_id=p_event_id AND ec.payment_status NOT IN ('da_saldare') AND er.payment_status!='annullato';

  SELECT COUNT(*) INTO v_comp_present
  FROM event_companions ec JOIN event_registrations er ON er.id=ec.registration_id
  WHERE er.event_id=p_event_id AND ec.checked_in=true;

  RETURN json_build_object(
    'ok',true,
    'total_iscritti', v_reg_total + v_gst_total,
    'total_paganti',  v_reg_paid  + v_comp_paid  + v_gst_paid,
    'total_presenti', v_reg_present+v_comp_present+v_gst_present,
    'incasso_totale', v_incasso   + v_incasso_gst
  );
END;
$$;

-- ── 6. admin_list_event_registrations — companions con payment_status ───
DROP FUNCTION IF EXISTS admin_list_event_registrations(uuid);
CREATE OR REPLACE FUNCTION admin_list_event_registrations(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_total BIGINT;
BEGIN
  SELECT COALESCE(SUM(party_size),0) INTO v_total
    FROM public.event_registrations WHERE event_id=p_event_id AND payment_status!='annullato';

  RETURN json_build_object(
    'total', v_total,
    'soci', (
      SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
      FROM (
        SELECT er.id AS registration_id, u.card_id, u.display_name,
               er.nome, er.cognome, er.telefono,
               er.payment_status, er.amount, er.paid_at,
               er.checked_in, er.checked_in_at,
               er.party_size, er.party_notes,
               op.display_name AS operatore, er.created_at,
               COALESCE((
                 SELECT json_agg(json_build_object(
                   'id',ec.id,'nome',ec.nome,'cognome',ec.cognome,
                   'checked_in',ec.checked_in,'checked_in_at',ec.checked_in_at,
                   'payment_status',ec.payment_status,'payment_method',ec.payment_method,'paid_at',ec.paid_at
                 ) ORDER BY ec.created_at)
                 FROM event_companions ec WHERE ec.registration_id=er.id
               ),'[]'::json) AS companions
        FROM public.event_registrations er
        JOIN public.users u ON u.id=er.user_id
        LEFT JOIN public.users op ON op.id=er.paid_by
        WHERE er.event_id=p_event_id AND er.payment_status!='annullato'
        ORDER BY er.created_at
      ) r
    ),
    'ospiti', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT eg.id,eg.nome,eg.cognome,eg.telefono,eg.email,
               eg.payment_status,eg.amount,eg.paid_at,
               eg.checked_in,eg.checked_in_at,
               op.display_name AS operatore, eg.created_at
        FROM public.event_guests eg
        LEFT JOIN public.users op ON op.id=eg.paid_by
        WHERE eg.event_id=p_event_id ORDER BY eg.created_at
      ) g
    )
  );
END;
$$;

-- ── 7. get_user_state — my_event_regs con event_price, companion payment ─
DROP FUNCTION IF EXISTS get_user_state(uuid);
CREATE OR REPLACE FUNCTION get_user_state(p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id=p_user_id AND active=true;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Utente non trovato'); END IF;

  RETURN json_build_object(
    'ok',true,'balance',v_user.balance,
    'transactions',(
      SELECT coalesce(json_agg(row_to_json(t)),'[]'::json)
      FROM(SELECT id,type,amount,balance_after,description,created_at FROM public.transactions
           WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 30) t
    ),
    'pending_events',(
      SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
      FROM(SELECT er.id AS registration_id,er.event_id,ev.title AS evento,ev.event_date,
                  er.amount,er.payment_status,ev.sumup_link,er.party_size,er.party_notes
           FROM public.event_registrations er JOIN public.events ev ON ev.id=er.event_id
           WHERE er.user_id=p_user_id AND er.payment_status='da_saldare' ORDER BY ev.event_date) r
    ),
    'my_event_ids',(
      SELECT coalesce(json_agg(er.event_id::text),'[]'::json)
      FROM public.event_registrations er
      WHERE er.user_id=p_user_id AND er.payment_status!='annullato'
    ),
    'my_event_regs',(
      SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
      FROM(
        SELECT er.id AS registration_id, er.event_id::text AS event_id,
               ev.price AS event_price, ev.title AS event_title,
               er.party_size, er.party_notes, er.payment_status,
               COALESCE((
                 SELECT json_agg(json_build_object(
                   'id',ec.id,'nome',ec.nome,'cognome',ec.cognome,
                   'checked_in',ec.checked_in,'payment_status',ec.payment_status
                 ) ORDER BY ec.created_at)
                 FROM event_companions ec WHERE ec.registration_id=er.id
               ),'[]'::json) AS companions
        FROM public.event_registrations er
        JOIN public.events ev ON ev.id=er.event_id
        WHERE er.user_id=p_user_id AND er.payment_status!='annullato'
      ) r
    )
  );
END;
$$;

-- ── 8. admin_export_event_csv — companion con payment_status ────────────
DROP FUNCTION IF EXISTS admin_export_event_csv(uuid);
CREATE OR REPLACE FUNCTION admin_export_event_csv(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_event  record;
  v_reg    jsonb;
  v_soci   jsonb;
  v_ospiti jsonb;
BEGIN
  SELECT title,event_date INTO v_event FROM events WHERE id=p_event_id;
  SELECT admin_list_event_registrations(p_event_id)::jsonb INTO v_reg;
  v_soci   := COALESCE(v_reg->'soci','[]'::jsonb);
  v_ospiti := COALESCE(v_reg->'ospiti','[]'::jsonb);

  RETURN jsonb_build_object(
    'evento',v_event.title,'data_evento',v_event.event_date,
    'iscritti',(
      SELECT COALESCE(jsonb_agg(row_obj),'[]'::jsonb) FROM(
        SELECT jsonb_build_object(
          'tipo','socio','card_id',s->>'card_id','display_name',COALESCE(s->>'display_name',''),
          'nome',COALESCE(s->>'nome',''),'cognome',COALESCE(s->>'cognome',''),
          'telefono',COALESCE(s->>'telefono',''),'email','','amount',(s->>'amount')::numeric,
          'payment_status',s->>'payment_status','checked_in',(s->>'checked_in')::boolean,
          'operatore',COALESCE(s->>'operatore',''),'created_at',s->>'created_at'
        ) AS row_obj FROM jsonb_array_elements(v_soci) AS s
        UNION ALL
        SELECT jsonb_build_object(
          'tipo','accompagnatore','card_id',s->>'card_id','display_name',COALESCE(s->>'display_name',''),
          'nome',c->>'nome','cognome',c->>'cognome','telefono','','email','','amount',0,
          'payment_status',COALESCE(c->>'payment_status','da_saldare'),
          'checked_in',(c->>'checked_in')::boolean,'operatore','','created_at',s->>'created_at'
        ) AS row_obj
        FROM jsonb_array_elements(v_soci) AS s,
             jsonb_array_elements(COALESCE(s->'companions','[]'::jsonb)) AS c
        UNION ALL
        SELECT jsonb_build_object(
          'tipo','ospite','card_id','','display_name',TRIM(COALESCE(g->>'nome','')||' '||COALESCE(g->>'cognome','')),
          'nome',COALESCE(g->>'nome',''),'cognome',COALESCE(g->>'cognome',''),
          'telefono',COALESCE(g->>'telefono',''),'email',COALESCE(g->>'email',''),
          'amount',(g->>'amount')::numeric,'payment_status',g->>'payment_status',
          'checked_in',(g->>'checked_in')::boolean,'operatore',COALESCE(g->>'operatore',''),'created_at',g->>'created_at'
        ) AS row_obj FROM jsonb_array_elements(v_ospiti) AS g
      ) sub
    )
  );
END;
$$;
