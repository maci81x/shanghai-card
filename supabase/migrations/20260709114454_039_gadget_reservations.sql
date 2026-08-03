-- 20260709114454_039_gadget_reservations
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- Tabella prenotazioni gadget
CREATE TABLE IF NOT EXISTS public.gadget_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  gadget_id     uuid NOT NULL REFERENCES gadgets(id),
  quantity      int  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status        text NOT NULL DEFAULT 'prenotato' CHECK (status IN ('prenotato','consegnato','annullato')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  fulfilled_at  timestamptz,
  fulfilled_by  uuid REFERENCES users(id)
);

-- RPC: socio prenota un gadget (NO pagamento)
DROP FUNCTION IF EXISTS public.user_reserve_gadget(uuid, uuid, int);
CREATE OR REPLACE FUNCTION public.user_reserve_gadget(
  p_user_id   uuid,
  p_gadget_id uuid,
  p_quantity  int DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_gadget RECORD;
  v_res_id uuid;
BEGIN
  SELECT * INTO v_gadget FROM gadgets WHERE id = p_gadget_id AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Gadget non disponibile'); END IF;

  INSERT INTO gadget_reservations (user_id, gadget_id, quantity)
  VALUES (p_user_id, p_gadget_id, p_quantity)
  RETURNING id INTO v_res_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'gadget_name', v_gadget.name,
    'quantity', p_quantity,
    'price_each', v_gadget.price,
    'total_price', v_gadget.price * p_quantity
  );
END;
$$;

-- RPC: socio annulla prenotazione
DROP FUNCTION IF EXISTS public.user_cancel_gadget_reservation(uuid, uuid);
CREATE OR REPLACE FUNCTION public.user_cancel_gadget_reservation(
  p_user_id       uuid,
  p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_res RECORD;
BEGIN
  SELECT * INTO v_res FROM gadget_reservations WHERE id = p_reservation_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Prenotazione non trovata'); END IF;
  IF v_res.status != 'prenotato' THEN RETURN jsonb_build_object('ok', false, 'error', 'Non annullabile'); END IF;
  UPDATE gadget_reservations SET status = 'annullato' WHERE id = p_reservation_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- RPC: socio vede le proprie prenotazioni
DROP FUNCTION IF EXISTS public.user_list_gadget_reservations(uuid);
CREATE OR REPLACE FUNCTION public.user_list_gadget_reservations(
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'reservation_id', gr.id,
      'gadget_id',      gr.gadget_id,
      'gadget_name',    g.name,
      'gadget_emoji',   g.emoji,
      'price_each',     g.price,
      'quantity',       gr.quantity,
      'total_price',    g.price * gr.quantity,
      'status',         gr.status,
      'created_at',     gr.created_at
    ) ORDER BY gr.created_at DESC), '[]'::jsonb)
    FROM gadget_reservations gr
    JOIN gadgets g ON g.id = gr.gadget_id
    WHERE gr.user_id = p_user_id AND gr.status != 'annullato'
  );
END;
$$;

-- RPC: staff lista prenotazioni attive
DROP FUNCTION IF EXISTS public.staff_list_gadget_reservations(uuid);
CREATE OR REPLACE FUNCTION public.staff_list_gadget_reservations(
  p_operator_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'reservation_id', gr.id,
      'card_id',        u.card_id,
      'display_name',   u.display_name,
      'gadget_name',    g.name,
      'gadget_emoji',   g.emoji,
      'price_each',     g.price,
      'quantity',       gr.quantity,
      'total_price',    g.price * gr.quantity,
      'status',         gr.status,
      'created_at',     gr.created_at
    ) ORDER BY gr.created_at), '[]'::jsonb)
    FROM gadget_reservations gr
    JOIN users u ON u.id = gr.user_id
    JOIN gadgets g ON g.id = gr.gadget_id
    WHERE gr.status = 'prenotato'
  );
END;
$$;

-- RPC: staff consegna gadget e incassa
DROP FUNCTION IF EXISTS public.staff_fulfill_gadget_reservation(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.staff_fulfill_gadget_reservation(
  p_operator_id     uuid,
  p_reservation_id  uuid,
  p_payment_method  text  -- 'credito' | 'contanti' | 'sumup'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_res       RECORD;
  v_gadget    RECORD;
  v_user      RECORD;
  v_promo     RECORD;
  v_amount    numeric(10,2);
  v_discount  numeric(10,2) := 0;
  v_final     numeric(10,2);
  v_tx_id     uuid;
BEGIN
  SELECT gr.*, u.id AS uid, u.card_id, u.display_name, u.balance
  INTO v_res
  FROM gadget_reservations gr
  JOIN users u ON u.id = gr.user_id
  WHERE gr.id = p_reservation_id AND gr.status = 'prenotato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Prenotazione non trovata o già evasa'); END IF;

  SELECT * INTO v_gadget FROM gadgets WHERE id = v_res.gadget_id;
  v_amount := v_gadget.price * v_res.quantity;
  v_final  := v_amount;

  -- Promo solo su pagamento a credito
  IF p_payment_method = 'credito' THEN
    SELECT * INTO v_promo
    FROM promos
    WHERE active = true
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now())
    ORDER BY created_at DESC LIMIT 1;

    IF FOUND THEN
      IF v_promo.discount_type = 'percent' THEN
        v_discount := round(v_amount * v_promo.discount_value / 100, 2);
      ELSE
        v_discount := LEAST(v_promo.discount_value, v_amount);
      END IF;
      v_final := v_amount - v_discount;
    END IF;

    IF v_res.balance < v_final THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Saldo insufficiente');
    END IF;

    UPDATE users SET balance = balance - v_final WHERE id = v_res.uid;

    INSERT INTO transactions (user_id, type, amount, description, operator_id)
    VALUES (v_res.uid, 'charge', v_final,
            'Gadget: ' || v_gadget.name || ' x' || v_res.quantity,
            p_operator_id)
    RETURNING id INTO v_tx_id;
  END IF;

  UPDATE gadget_reservations
  SET status = 'consegnato', fulfilled_at = now(), fulfilled_by = p_operator_id
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'card_id',      v_res.card_id,
    'display_name', v_res.display_name,
    'gadget_name',  v_gadget.name,
    'quantity',     v_res.quantity,
    'amount',       v_amount,
    'promo_applied', v_discount > 0,
    'promo_code',   CASE WHEN v_discount > 0 THEN v_promo.code ELSE NULL END,
    'discount',     v_discount,
    'charged',      v_final,
    'payment_method', p_payment_method
  );
END;
$$;
