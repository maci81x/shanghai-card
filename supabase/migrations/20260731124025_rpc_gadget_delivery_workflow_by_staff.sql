-- 20260731124025_rpc_gadget_delivery_workflow_by_staff
-- ricostruita da supabase_migrations.schema_migrations

-- ═══════════════════════════════════════════════════════════════
-- Migration 7: gadget delivery workflow (staff-driven)
-- ═══════════════════════════════════════════════════════════════
-- Flusso: socio prenota (senza addebito né stock scaling) → dichiara metodo
-- pagamento previsto → staff consegna via nuova RPC che è la SOLA che
-- decrementa lo stock e addebita il credito.

-- ─── 1) Drop old user_reserve_gadget overloads (both 3-arg and 4-arg) ───
DROP FUNCTION IF EXISTS public.user_reserve_gadget(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.user_reserve_gadget(uuid, uuid, integer, text);

-- ─── 2) Recreate user_reserve_gadget with payment_method ───
CREATE OR REPLACE FUNCTION public.user_reserve_gadget(
  p_user_id uuid, p_gadget_id uuid,
  p_quantity integer DEFAULT 1,
  p_size text DEFAULT NULL,
  p_payment_method text DEFAULT 'credito'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_gadget RECORD; v_size_row RECORD;
  v_reserved integer; v_avail integer; v_res_id uuid; v_waitlist boolean := false;
BEGIN
  IF p_payment_method NOT IN ('credito','contanti','sumup') THEN
    RETURN jsonb_build_object('ok',false,'error','Metodo pagamento non valido');
  END IF;

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
      INSERT INTO gadget_reservations(user_id, gadget_id, quantity, size, status, payment_method, payment_amount)
      VALUES (p_user_id, p_gadget_id, p_quantity, p_size, 'prenotato', p_payment_method, v_gadget.price*p_quantity)
      RETURNING id INTO v_res_id;
    ELSE
      v_waitlist := true;
      INSERT INTO gadget_reservations(user_id, gadget_id, quantity, size, status, payment_method, payment_amount)
      VALUES (p_user_id, p_gadget_id, p_quantity, p_size, 'attesa_ordine', p_payment_method, v_gadget.price*p_quantity)
      RETURNING id INTO v_res_id;
    END IF;
  ELSE
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations WHERE gadget_id=p_gadget_id AND status='prenotato';
    v_avail := v_gadget.stock - v_reserved;

    IF v_avail < p_quantity THEN
      RETURN jsonb_build_object('ok',false,'error','Disponibilità insufficiente (disponibili: '||v_avail||')');
    END IF;
    INSERT INTO gadget_reservations(user_id, gadget_id, quantity, status, payment_method, payment_amount)
    VALUES (p_user_id, p_gadget_id, p_quantity, 'prenotato', p_payment_method, v_gadget.price*p_quantity)
    RETURNING id INTO v_res_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'reservation_id',v_res_id,
    'gadget_name',v_gadget.name,'quantity',p_quantity,'size',p_size,
    'payment_method',p_payment_method,
    'price_each',v_gadget.price,'total_price',v_gadget.price*p_quantity,
    'waitlist',v_waitlist,
    'message', CASE WHEN v_waitlist
      THEN 'Taglia esaurita. Al raggiungimento di un numero adeguato verrà effettuato l''ordine.'
      ELSE 'Prenotato. Da ritirare presso lo staff.' END);
END;
$function$;

-- ─── 3) user_modify_gadget_reservation: allow changing payment_method too ───
CREATE OR REPLACE FUNCTION public.user_modify_gadget_reservation(
  p_user_id uuid, p_reservation_id uuid,
  p_new_size text DEFAULT NULL,
  p_new_quantity integer DEFAULT NULL,
  p_new_payment_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_res RECORD; v_gadget RECORD; v_size_row RECORD;
  v_new_size text; v_new_qty int; v_new_method text;
  v_reserved int; v_avail int;
BEGIN
  SELECT * INTO v_res FROM gadget_reservations
    WHERE id=p_reservation_id AND user_id=p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Prenotazione non trovata'); END IF;
  IF v_res.status = 'consegnato' THEN
    RETURN jsonb_build_object('ok',false,'error','Già consegnata, non modificabile');
  END IF;
  IF v_res.status = 'annullato' THEN
    RETURN jsonb_build_object('ok',false,'error','Prenotazione annullata');
  END IF;

  SELECT * INTO v_gadget FROM gadgets WHERE id=v_res.gadget_id;

  v_new_size   := COALESCE(NULLIF(p_new_size,''), v_res.size);
  v_new_qty    := COALESCE(p_new_quantity, v_res.quantity);
  v_new_method := COALESCE(NULLIF(p_new_payment_method,''), v_res.payment_method);

  IF v_new_qty < 1 THEN
    RETURN jsonb_build_object('ok',false,'error','Quantità deve essere >= 1');
  END IF;
  IF v_new_method NOT IN ('credito','contanti','sumup') THEN
    RETURN jsonb_build_object('ok',false,'error','Metodo pagamento non valido');
  END IF;

  IF v_gadget.has_sizes THEN
    SELECT * INTO v_size_row FROM gadget_sizes WHERE gadget_id=v_res.gadget_id AND size=v_new_size;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Taglia non esistente'); END IF;

    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations
    WHERE gadget_id=v_res.gadget_id AND size=v_new_size
      AND status='prenotato' AND id<>p_reservation_id;
    v_avail := v_size_row.stock - v_reserved;

    UPDATE gadget_reservations
    SET size=v_new_size, quantity=v_new_qty, payment_method=v_new_method,
        payment_amount=v_gadget.price*v_new_qty,
        status=CASE WHEN v_avail>=v_new_qty THEN 'prenotato' ELSE 'attesa_ordine' END
    WHERE id=p_reservation_id;
  ELSE
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved
    FROM gadget_reservations
    WHERE gadget_id=v_res.gadget_id AND status='prenotato' AND id<>p_reservation_id;
    v_avail := v_gadget.stock - v_reserved;
    IF v_avail < v_new_qty THEN
      RETURN jsonb_build_object('ok',false,'error','Disponibilità insufficiente');
    END IF;

    UPDATE gadget_reservations
    SET quantity=v_new_qty, payment_method=v_new_method,
        payment_amount=v_gadget.price*v_new_qty
    WHERE id=p_reservation_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'size',v_new_size,'quantity',v_new_qty,
    'payment_method',v_new_method,'message','Prenotazione aggiornata');
END;
$function$;

-- ─── 4) get_catalog: enrich gadgets with reserved_count per size ───
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN json_build_object(
    'events', (
      SELECT coalesce(json_agg(row_to_json(e)),'[]'::json)
      FROM (SELECT id,title,description,event_date,location,max_participants,price,active,sumup_link,slug,image_url
            FROM public.events WHERE active=true AND visible=true ORDER BY event_date) e
    ),
    'gadgets', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT g.id, g.name, g.description, g.price, g.stock, g.image_url, g.active, g.has_sizes,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'size', s.size,
                          'stock', s.stock,
                          'reserved', COALESCE((SELECT SUM(r.quantity) FROM gadget_reservations r 
                                                WHERE r.gadget_id=g.id AND r.size=s.size AND r.status='prenotato'),0),
                          'available', s.stock - COALESCE((SELECT SUM(r.quantity) FROM gadget_reservations r 
                                                            WHERE r.gadget_id=g.id AND r.size=s.size AND r.status='prenotato'),0)
                        ) ORDER BY s.sort_order, s.size)
                 FROM public.gadget_sizes s WHERE s.gadget_id=g.id
               ), '[]'::jsonb) AS sizes,
               COALESCE((SELECT SUM(quantity) FROM gadget_reservations 
                         WHERE gadget_id=g.id AND status='prenotato'),0) AS reserved_total,
               COALESCE((SELECT SUM(quantity) FROM gadget_reservations 
                         WHERE gadget_id=g.id AND status='consegnato'),0) AS delivered_total,
               COALESCE((SELECT SUM(quantity) FROM gadget_reservations 
                         WHERE gadget_id=g.id AND status='attesa_ordine'),0) AS waitlist_total
        FROM public.gadgets g
        WHERE g.active=true
          AND (g.has_sizes = true OR g.stock > 0)
        ORDER BY g.name
      ) g
    ),
    'promos', (
      SELECT coalesce(json_agg(row_to_json(p)),'[]'::json)
      FROM (SELECT id,code,description,discount_type,discount_value,valid_from,valid_until,image_url
            FROM public.promos WHERE active=true AND (valid_until IS NULL OR valid_until>now())
            ORDER BY valid_from) p
    ),
    'sumup_links', (
      SELECT coalesce(json_agg(row_to_json(s)),'[]'::json)
      FROM (SELECT id,label,amount,url,sort_order FROM public.sumup_links WHERE active=true
            ORDER BY sort_order, amount NULLS LAST) s
    )
  );
END;
$function$;

-- ─── 5) staff_list_gadget_reservations: list for staff/admin ───
CREATE OR REPLACE FUNCTION public.staff_list_gadget_reservations(
  p_operator_id uuid,
  p_status_filter text DEFAULT 'prenotato'
)
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

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT r.id AS reservation_id,
           r.gadget_id, g.name AS gadget_name, g.has_sizes,
           r.size, r.quantity, r.payment_method, r.payment_amount, r.status,
           r.created_at, r.fulfilled_at,
           u.id AS user_id, u.card_id, u.display_name AS user_name,
           u.balance AS user_balance,
           g.price AS gadget_price
    FROM gadget_reservations r
    JOIN gadgets g ON g.id=r.gadget_id
    JOIN users u   ON u.id=r.user_id
    WHERE (p_status_filter='all' OR r.status=p_status_filter)
  ) x;

  RETURN jsonb_build_object('ok',true,'reservations',v_result);
END;
$function$;

-- ─── 6) staff_deliver_gadget: THE delivery action ───
CREATE OR REPLACE FUNCTION public.staff_deliver_gadget(
  p_operator_id uuid,
  p_reservation_id uuid,
  p_final_size text DEFAULT NULL,
  p_final_payment_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_res RECORD; v_gadget RECORD; v_size_row RECORD;
  v_final_size text; v_final_method text; v_final_amount numeric;
  v_new_balance numeric; v_op_role text;
BEGIN
  -- authz
  SELECT CASE WHEN role='admin' THEN 'admin' WHEN is_staff THEN 'staff' ELSE NULL END
  INTO v_op_role FROM users WHERE id=p_operator_id AND active=true;
  IF v_op_role IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  SELECT * INTO v_res FROM gadget_reservations WHERE id=p_reservation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Prenotazione non trovata'); END IF;
  IF v_res.status <> 'prenotato' THEN
    RETURN jsonb_build_object('ok',false,'error','Solo prenotazioni in stato prenotato possono essere consegnate (stato: '||v_res.status||')');
  END IF;

  SELECT * INTO v_gadget FROM gadgets WHERE id=v_res.gadget_id;

  v_final_size   := COALESCE(NULLIF(p_final_size,''), v_res.size);
  v_final_method := COALESCE(NULLIF(p_final_payment_method,''), v_res.payment_method, 'credito');
  v_final_amount := v_gadget.price * v_res.quantity;

  IF v_final_method NOT IN ('credito','contanti','sumup') THEN
    RETURN jsonb_build_object('ok',false,'error','Metodo pagamento non valido');
  END IF;

  IF v_gadget.has_sizes THEN
    IF v_final_size IS NULL OR v_final_size='' THEN
      RETURN jsonb_build_object('ok',false,'error','Taglia obbligatoria alla consegna');
    END IF;
    SELECT * INTO v_size_row FROM gadget_sizes WHERE gadget_id=v_res.gadget_id AND size=v_final_size;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Taglia inesistente'); END IF;
    IF v_size_row.stock < v_res.quantity THEN
      RETURN jsonb_build_object('ok',false,'error',
        'Stock insufficiente per taglia '||v_final_size||' (disponibili: '||v_size_row.stock||')');
    END IF;
  ELSE
    IF v_gadget.stock < v_res.quantity THEN
      RETURN jsonb_build_object('ok',false,'error','Stock insufficiente (disponibili: '||v_gadget.stock||')');
    END IF;
  END IF;

  -- credit check + debit
  IF v_final_method='credito' THEN
    IF (SELECT balance FROM users WHERE id=v_res.user_id) < v_final_amount THEN
      RETURN jsonb_build_object('ok',false,'error','Saldo socio insufficiente');
    END IF;
    UPDATE users SET balance=balance - v_final_amount, updated_at=now()
    WHERE id=v_res.user_id RETURNING balance INTO v_new_balance;

    INSERT INTO transactions(user_id, type, amount, balance_after, description, operator_id, ref_id, payment_method)
    VALUES (v_res.user_id, 'purchase', -v_final_amount, v_new_balance,
      'Gadget: '||v_gadget.name||CASE WHEN v_final_size IS NOT NULL THEN ' — taglia '||v_final_size ELSE '' END
        ||' × '||v_res.quantity, p_operator_id, v_res.gadget_id, 'credito');
  ELSE
    -- contanti / sumup: register a zero-amount transaction for audit trail
    SELECT balance INTO v_new_balance FROM users WHERE id=v_res.user_id;
    INSERT INTO transactions(user_id, type, amount, balance_after, description, operator_id, ref_id, payment_method)
    VALUES (v_res.user_id, 'purchase', 0, v_new_balance,
      'Gadget: '||v_gadget.name||CASE WHEN v_final_size IS NOT NULL THEN ' — taglia '||v_final_size ELSE '' END
        ||' × '||v_res.quantity||' — pagato in '||v_final_method||' ('||v_final_amount||' €)',
      p_operator_id, v_res.gadget_id, v_final_method);
  END IF;

  -- decrement stock (on gadget_sizes if has_sizes, else on gadgets)
  IF v_gadget.has_sizes THEN
    UPDATE gadget_sizes SET stock=stock - v_res.quantity
    WHERE gadget_id=v_res.gadget_id AND size=v_final_size;
  ELSE
    UPDATE gadgets SET stock=stock - v_res.quantity WHERE id=v_res.gadget_id;
  END IF;

  -- close the reservation
  UPDATE gadget_reservations
  SET status='consegnato',
      size=v_final_size,
      payment_method=v_final_method,
      payment_amount=v_final_amount,
      fulfilled_at=now(),
      fulfilled_by=p_operator_id,
      paid_at=now()
  WHERE id=p_reservation_id;

  RETURN jsonb_build_object('ok',true,'confirmed',true,
    'gadget_name',v_gadget.name,
    'size',v_final_size,
    'quantity',v_res.quantity,
    'payment_method',v_final_method,
    'total',v_final_amount,
    'new_balance',v_new_balance,
    'message','Consegnato · '||v_gadget.name||CASE WHEN v_final_size IS NOT NULL THEN ' ['||v_final_size||']' ELSE '' END);
END;
$function$;

-- ─── grants ───
GRANT EXECUTE ON FUNCTION public.user_reserve_gadget(uuid,uuid,integer,text,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_modify_gadget_reservation(uuid,uuid,text,integer,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.staff_list_gadget_reservations(uuid,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.staff_deliver_gadget(uuid,uuid,text,text) TO authenticated, anon;
