-- 20260709143515_051_gadget_stock_flow
-- ricostruita da supabase_migrations.schema_migrations


-- ═══════════════════════════════════════════════════════
-- Migration 051: gadget stock management + payment tracking
-- ═══════════════════════════════════════════════════════
SET search_path = public, extensions;

-- 1) Aggiungi colonne di pagamento a gadget_reservations
ALTER TABLE gadget_reservations
  ADD COLUMN IF NOT EXISTS payment_method  TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS paid_at         TIMESTAMPTZ;

-- 2) Fix user_reserve_gadget: check stock disponibile prima di prenotare
DROP FUNCTION IF EXISTS user_reserve_gadget(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION user_reserve_gadget(
  p_user_id   uuid,
  p_gadget_id uuid,
  p_quantity  integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_gadget   RECORD;
  v_reserved integer;
  v_avail    integer;
  v_res_id   uuid;
BEGIN
  SELECT * INTO v_gadget FROM gadgets WHERE id = p_gadget_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Gadget non disponibile');
  END IF;

  -- Stock effettivo = totale - già prenotati (non ancora consegnati)
  SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
  FROM gadget_reservations
  WHERE gadget_id = p_gadget_id AND status = 'prenotato';

  v_avail := v_gadget.stock - v_reserved;
  IF v_avail < p_quantity THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Disponibilità insufficiente (disponibili: ' || v_avail || ')');
  END IF;

  INSERT INTO gadget_reservations (user_id, gadget_id, quantity)
  VALUES (p_user_id, p_gadget_id, p_quantity)
  RETURNING id INTO v_res_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'reservation_id', v_res_id,
    'gadget_name',   v_gadget.name,
    'quantity',      p_quantity,
    'price_each',    v_gadget.price,
    'total_price',   v_gadget.price * p_quantity
  );
END;
$$;

-- 3) Fix staff_fulfill_gadget_reservation: scala stock + registra pagamento
DROP FUNCTION IF EXISTS staff_fulfill_gadget_reservation(uuid, uuid, text);

CREATE OR REPLACE FUNCTION staff_fulfill_gadget_reservation(
  p_operator_id    uuid,
  p_reservation_id uuid,
  p_payment_method text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res        RECORD;
  v_gadget     RECORD;
  v_promo      RECORD;
  v_promo_code TEXT        := NULL;
  v_amount     NUMERIC(10,2);
  v_discount   NUMERIC(10,2) := 0;
  v_final      NUMERIC(10,2);
  v_new_bal    NUMERIC(10,2);
  v_new_stock  integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_operator_id AND active = true AND role IN ('admin','staff')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Operatore non autorizzato');
  END IF;

  SELECT gr.id, gr.gadget_id, gr.quantity, gr.status,
         u.id AS uid, u.card_id, u.display_name, u.balance
  INTO v_res
  FROM public.gadget_reservations gr
  JOIN public.users u ON u.id = gr.user_id
  WHERE gr.id = p_reservation_id AND gr.status = 'prenotato';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Prenotazione non trovata o già evasa');
  END IF;

  SELECT * INTO v_gadget FROM public.gadgets WHERE id = v_res.gadget_id;
  v_amount := v_gadget.price * v_res.quantity;
  v_final  := v_amount;

  IF p_payment_method = 'credito' THEN
    SELECT * INTO v_promo FROM public.promos
    WHERE active = true
      AND (valid_from  IS NULL OR valid_from  <= now())
      AND (valid_until IS NULL OR valid_until >= now())
    ORDER BY created_at DESC LIMIT 1;

    IF FOUND THEN
      v_promo_code := v_promo.code;
      IF v_promo.discount_type = 'percent' THEN
        v_discount := round(v_amount * v_promo.discount_value / 100, 2);
      ELSE
        v_discount := LEAST(v_promo.discount_value, v_amount);
      END IF;
      v_final := v_amount - v_discount;
      UPDATE public.promos SET current_uses = current_uses + 1 WHERE id = v_promo.id;
    END IF;

    IF v_res.balance < v_final THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Saldo insufficiente');
    END IF;

    v_new_bal := v_res.balance - v_final;
    UPDATE public.users SET balance = v_new_bal, updated_at = now() WHERE id = v_res.uid;

    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, operator_id)
    VALUES (v_res.uid, 'purchase', -v_final, v_new_bal,
            'Gadget: ' || v_gadget.name || ' x' || v_res.quantity
            || CASE WHEN v_discount > 0 THEN ' (promo ' || v_promo_code || ': -€' || v_discount || ')' ELSE '' END,
            p_operator_id);
  END IF;

  -- Scala lo stock fisico
  UPDATE public.gadgets
  SET stock = GREATEST(stock - v_res.quantity, 0)
  WHERE id = v_res.gadget_id
  RETURNING stock INTO v_new_stock;

  -- Aggiorna prenotazione con dati pagamento
  UPDATE public.gadget_reservations
  SET status         = 'consegnato',
      fulfilled_at   = now(),
      fulfilled_by   = p_operator_id,
      payment_method = p_payment_method,
      payment_amount = v_final,
      paid_at        = now()
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'card_id',        v_res.card_id,
    'display_name',   v_res.display_name,
    'gadget_name',    v_gadget.name,
    'quantity',       v_res.quantity,
    'amount',         v_amount,
    'promo_applied',  v_discount > 0,
    'promo_code',     v_promo_code,
    'discount',       v_discount,
    'charged',        v_final,
    'payment_method', p_payment_method,
    'new_stock',      v_new_stock
  );
END;
$$;

-- 4) Aggiorna staff_gadget_reservation_summary: mostra stock disponibile
DROP FUNCTION IF EXISTS staff_gadget_reservation_summary();

CREATE OR REPLACE FUNCTION staff_gadget_reservation_summary()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN json_build_object(
    'ok', true,
    'gadgets', (
      SELECT COALESCE(json_agg(row_to_json(g)), '[]'::json)
      FROM (
        SELECT
          ga.id,
          ga.name,
          ga.price,
          ga.stock,
          ga.description,
          COALESCE(SUM(gr.quantity) FILTER (WHERE gr.status = 'prenotato'), 0)            AS prenotati,
          ga.stock - COALESCE(SUM(gr.quantity) FILTER (WHERE gr.status = 'prenotato'), 0) AS disponibili,
          COALESCE(
            json_agg(
              json_build_object(
                'reservation_id', gr.id,
                'card_id',        u.card_id,
                'display_name',   u.display_name,
                'quantity',       gr.quantity,
                'created_at',     gr.created_at
              )
            ) FILTER (WHERE gr.status = 'prenotato'),
            '[]'::json
          ) AS prenotazioni
        FROM public.gadgets ga
        LEFT JOIN public.gadget_reservations gr ON gr.gadget_id = ga.id AND gr.status = 'prenotato'
        LEFT JOIN public.users u ON u.id = gr.user_id
        WHERE ga.active = true
        GROUP BY ga.id, ga.name, ga.price, ga.stock, ga.description
        ORDER BY ga.name
      ) g
    )
  );
END;
$$;
