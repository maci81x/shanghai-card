-- 20260731095244_rpc_gadget_sizes_and_waitlist
-- ricostruita da supabase_migrations.schema_migrations


-- ═══════════════════════════════════════════════════════════════
-- BLOCCO 3: RPC gadget taglie, waitlist, modifica prenotazione
-- ═══════════════════════════════════════════════════════════════

-- 3a. admin_set_gadget_sizes: imposta l'array delle taglie di un gadget
-- p_sizes = [{"size":"S","stock":5}, {"size":"M","stock":3}, ...]
-- Sostituisce integralmente (upsert + delete taglie rimosse)
CREATE OR REPLACE FUNCTION public.admin_set_gadget_sizes(
  p_admin_id uuid, p_gadget_id uuid, p_sizes jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_row jsonb; v_kept text[] := '{}'; v_i int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_admin_id AND active=true AND role='admin') THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gadgets WHERE id=p_gadget_id) THEN
    RETURN jsonb_build_object('ok',false,'error','Gadget non trovato');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_sizes,'[]'::jsonb)) LOOP
    v_i := v_i + 1;
    INSERT INTO gadget_sizes(gadget_id, size, stock, sort_order)
    VALUES (p_gadget_id, trim(v_row->>'size'),
            GREATEST(0, COALESCE((v_row->>'stock')::int,0)), v_i)
    ON CONFLICT (gadget_id, size) DO UPDATE
      SET stock = EXCLUDED.stock, sort_order = EXCLUDED.sort_order;
    v_kept := array_append(v_kept, trim(v_row->>'size'));
  END LOOP;

  DELETE FROM gadget_sizes WHERE gadget_id=p_gadget_id AND NOT (size = ANY(v_kept));

  UPDATE gadgets SET has_sizes = (v_i > 0) WHERE id=p_gadget_id;

  RETURN jsonb_build_object('ok',true,'sizes_count',v_i,'has_sizes',(v_i>0));
END;
$$;

-- 3b. Overload di user_reserve_gadget con size + waitlist
-- Se la taglia ha stock -> status='prenotato' e prenoto quantità
-- Se stock=0 -> status='attesa_ordine' (non decurta nulla)
CREATE OR REPLACE FUNCTION public.user_reserve_gadget(
  p_user_id uuid, p_gadget_id uuid, p_quantity integer DEFAULT 1, p_size text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_gadget RECORD; v_size_row RECORD;
  v_reserved integer; v_avail integer; v_res_id uuid; v_waitlist boolean := false;
BEGIN
  SELECT * INTO v_gadget FROM gadgets WHERE id=p_gadget_id AND active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Gadget non disponibile'); END IF;

  IF v_gadget.has_sizes THEN
    IF p_size IS NULL OR p_size='' THEN
      RETURN jsonb_build_object('ok',false,'error','Taglia obbligatoria per questo gadget');
    END IF;
    SELECT * INTO v_size_row FROM gadget_sizes WHERE gadget_id=p_gadget_id AND size=p_size;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Taglia non disponibile'); END IF;

    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations
    WHERE gadget_id=p_gadget_id AND size=p_size AND status='prenotato';

    v_avail := v_size_row.stock - v_reserved;

    IF v_avail >= p_quantity THEN
      INSERT INTO gadget_reservations(user_id, gadget_id, quantity, size, status)
      VALUES (p_user_id, p_gadget_id, p_quantity, p_size, 'prenotato')
      RETURNING id INTO v_res_id;
    ELSE
      v_waitlist := true;
      INSERT INTO gadget_reservations(user_id, gadget_id, quantity, size, status)
      VALUES (p_user_id, p_gadget_id, p_quantity, p_size, 'attesa_ordine')
      RETURNING id INTO v_res_id;
    END IF;
  ELSE
    -- gadget senza taglie: comportamento originale
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations WHERE gadget_id=p_gadget_id AND status='prenotato';
    v_avail := v_gadget.stock - v_reserved;

    IF v_avail < p_quantity THEN
      RETURN jsonb_build_object('ok',false,'error','Disponibilità insufficiente (disponibili: '||v_avail||')');
    END IF;
    INSERT INTO gadget_reservations(user_id, gadget_id, quantity, status)
    VALUES (p_user_id, p_gadget_id, p_quantity, 'prenotato')
    RETURNING id INTO v_res_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'reservation_id',v_res_id,
    'gadget_name',v_gadget.name,'quantity',p_quantity,'size',p_size,
    'price_each',v_gadget.price,'total_price',v_gadget.price*p_quantity,
    'waitlist',v_waitlist,
    'message', CASE WHEN v_waitlist
      THEN 'Taglia esaurita. Al raggiungimento di un numero adeguato verrà effettuato l''ordine e sarai avvisato.'
      ELSE 'Prenotato' END);
END;
$$;

-- 3c. user_modify_gadget_reservation: cambia taglia e/o quantità
-- Se già pagata via credito: gestisce diff con nuovi transaction records
-- Se non pagata (ancora 'prenotato' senza payment_amount): solo update
CREATE OR REPLACE FUNCTION public.user_modify_gadget_reservation(
  p_user_id uuid, p_reservation_id uuid,
  p_new_size text DEFAULT NULL, p_new_quantity integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_res RECORD; v_gadget RECORD; v_size_row RECORD;
  v_new_size text; v_new_qty int;
  v_reserved int; v_avail int;
  v_old_amount numeric; v_new_amount numeric; v_diff numeric;
  v_new_bal numeric;
BEGIN
  SELECT * INTO v_res FROM gadget_reservations
    WHERE id=p_reservation_id AND user_id=p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Prenotazione non trovata'); END IF;
  IF v_res.status = 'consegnato' THEN
    RETURN jsonb_build_object('ok',false,'error','Prenotazione già consegnata, non modificabile');
  END IF;
  IF v_res.status = 'annullato' THEN
    RETURN jsonb_build_object('ok',false,'error','Prenotazione annullata');
  END IF;

  SELECT * INTO v_gadget FROM gadgets WHERE id=v_res.gadget_id;

  v_new_size := COALESCE(NULLIF(p_new_size,''), v_res.size);
  v_new_qty  := COALESCE(p_new_quantity, v_res.quantity);
  IF v_new_qty < 1 THEN
    RETURN jsonb_build_object('ok',false,'error','Quantità deve essere >= 1');
  END IF;

  -- Verifica taglia se has_sizes
  IF v_gadget.has_sizes THEN
    SELECT * INTO v_size_row FROM gadget_sizes WHERE gadget_id=v_res.gadget_id AND size=v_new_size;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Taglia non esistente'); END IF;

    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations
    WHERE gadget_id=v_res.gadget_id AND size=v_new_size
      AND status='prenotato' AND id<>p_reservation_id;

    v_avail := v_size_row.stock - v_reserved;
    IF v_avail < v_new_qty THEN
      RETURN jsonb_build_object('ok',false,'error',
        'Disponibilità insufficiente per taglia '||v_new_size||' (disp: '||v_avail||')');
    END IF;
  ELSE
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations
    WHERE gadget_id=v_res.gadget_id AND status='prenotato' AND id<>p_reservation_id;
    v_avail := v_gadget.stock - v_reserved;
    IF v_avail < v_new_qty THEN
      RETURN jsonb_build_object('ok',false,'error','Disponibilità insufficiente');
    END IF;
  END IF;

  -- Se era pagata via credito, gestisce diff
  IF v_res.payment_method = 'credito' AND v_res.payment_amount IS NOT NULL THEN
    v_old_amount := v_res.payment_amount;
    v_new_amount := v_gadget.price * v_new_qty;
    v_diff := v_new_amount - v_old_amount;

    IF v_diff > 0 THEN
      -- Serve credito extra
      IF (SELECT balance FROM users WHERE id=p_user_id) < v_diff THEN
        RETURN jsonb_build_object('ok',false,'error','Saldo insufficiente per la differenza');
      END IF;
      UPDATE users SET balance=balance-v_diff, updated_at=now()
      WHERE id=p_user_id RETURNING balance INTO v_new_bal;
      INSERT INTO transactions(user_id,type,amount,balance_after,description,ref_id)
      VALUES (p_user_id,'purchase',-v_diff,v_new_bal,
        'Modifica gadget: '||v_gadget.name||' (integrazione)',v_res.gadget_id);
    ELSIF v_diff < 0 THEN
      -- Rimborso credito
      UPDATE users SET balance=balance+ABS(v_diff), updated_at=now()
      WHERE id=p_user_id RETURNING balance INTO v_new_bal;
      INSERT INTO transactions(user_id,type,amount,balance_after,description,ref_id)
      VALUES (p_user_id,'refund',ABS(v_diff),v_new_bal,
        'Modifica gadget: '||v_gadget.name||' (rimborso parziale)',v_res.gadget_id);
    END IF;

    UPDATE gadget_reservations
    SET size=v_new_size, quantity=v_new_qty, payment_amount=v_new_amount, status='prenotato'
    WHERE id=p_reservation_id;
  ELSE
    -- Non ancora pagata: aggiorno solo taglia/qty (ricalcolo status se era waitlist)
    UPDATE gadget_reservations
    SET size=v_new_size, quantity=v_new_qty,
        status=CASE WHEN v_gadget.has_sizes AND v_size_row.stock=0 THEN 'attesa_ordine' ELSE 'prenotato' END
    WHERE id=p_reservation_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'size',v_new_size,'quantity',v_new_qty,'message','Prenotazione aggiornata');
END;
$$;

-- 3d. user_cancel_gadget_reservation: se pagato via SumUp -> accoda in refund_queue
CREATE OR REPLACE FUNCTION public.user_cancel_gadget_reservation(
  p_user_id uuid, p_reservation_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_res RECORD; v_gadget RECORD; v_new_bal numeric;
BEGIN
  SELECT * INTO v_res FROM gadget_reservations WHERE id=p_reservation_id AND user_id=p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Prenotazione non trovata'); END IF;
  IF v_res.status NOT IN ('prenotato','attesa_ordine') THEN
    RETURN jsonb_build_object('ok',false,'error','Non annullabile');
  END IF;
  SELECT * INTO v_gadget FROM gadgets WHERE id=v_res.gadget_id;

  UPDATE gadget_reservations SET status='annullato' WHERE id=p_reservation_id;

  IF v_res.payment_amount IS NOT NULL AND v_res.payment_method='credito' THEN
    -- Rimborso automatico
    UPDATE users SET balance=balance+v_res.payment_amount, updated_at=now()
    WHERE id=p_user_id RETURNING balance INTO v_new_bal;
    INSERT INTO transactions(user_id,type,amount,balance_after,description,ref_id)
    VALUES (p_user_id,'refund',v_res.payment_amount,v_new_bal,
      'Annullo gadget: '||v_gadget.name||' (rimborso credito)',v_res.gadget_id);
    RETURN jsonb_build_object('ok',true,'refunded',v_res.payment_amount,'method','credito',
      'message','Annullato. Rimborso credito effettuato.');
  ELSIF v_res.payment_amount IS NOT NULL AND v_res.payment_method='sumup' THEN
    -- Accoda per rimborso manuale staff
    INSERT INTO refund_queue(user_id, source_type, source_id, amount, original_payment_method, reason)
    VALUES (p_user_id, 'gadget_reservation', p_reservation_id, v_res.payment_amount, 'sumup',
      'Annullo prenotazione: '||v_gadget.name);
    RETURN jsonb_build_object('ok',true,'refunded',v_res.payment_amount,'method','sumup',
      'message','Annullato. Rimborso SumUp gestito dallo staff.');
  ELSE
    RETURN jsonb_build_object('ok',true,'message','Annullato');
  END IF;
END;
$$;

-- 3e. Coda rimborsi lato admin
CREATE OR REPLACE FUNCTION public.admin_list_refund_queue(p_operator_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  RETURN jsonb_build_object('ok',true,'items',(
    SELECT COALESCE(jsonb_agg(row_to_json(x)),'[]'::jsonb) FROM (
      SELECT rq.id, rq.source_type, rq.source_id, rq.amount, rq.original_payment_method,
             rq.reason, rq.status, rq.created_at, rq.notes,
             u.card_id, u.display_name AS user_name
      FROM refund_queue rq JOIN users u ON u.id=rq.user_id
      WHERE rq.status='da_gestire'
      ORDER BY rq.created_at
    ) x));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_complete_refund(
  p_operator_id uuid, p_refund_id uuid, p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  UPDATE refund_queue
     SET status='completato', resolved_at=now(), resolved_by=p_operator_id, notes=p_notes
   WHERE id=p_refund_id AND status='da_gestire';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Rimborso non trovato o già gestito'); END IF;
  RETURN jsonb_build_object('ok',true,'message','Rimborso segnato come completato');
END;
$$;
