-- 20260709114625_039c_fix_fulfill_balance_after
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.staff_fulfill_gadget_reservation(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.staff_fulfill_gadget_reservation(
  p_operator_id     uuid,
  p_reservation_id  uuid,
  p_payment_method  text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_res       RECORD;
  v_gadget    RECORD;
  v_promo     RECORD;
  v_amount    numeric(10,2);
  v_discount  numeric(10,2) := 0;
  v_final     numeric(10,2);
  v_new_bal   numeric(10,2);
BEGIN
  SELECT gr.id, gr.gadget_id, gr.quantity, gr.status,
         u.id AS uid, u.card_id, u.display_name, u.balance
  INTO v_res
  FROM gadget_reservations gr
  JOIN users u ON u.id = gr.user_id
  WHERE gr.id = p_reservation_id AND gr.status = 'prenotato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Prenotazione non trovata o già evasa'); END IF;

  SELECT * INTO v_gadget FROM gadgets WHERE id = v_res.gadget_id;
  v_amount := v_gadget.price * v_res.quantity;
  v_final  := v_amount;

  IF p_payment_method = 'credito' THEN
    SELECT * INTO v_promo FROM promos
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

    v_new_bal := v_res.balance - v_final;
    UPDATE users SET balance = v_new_bal WHERE id = v_res.uid;

    INSERT INTO transactions (user_id, type, amount, balance_after, description, operator_id)
    VALUES (v_res.uid, 'charge', v_final, v_new_bal,
            'Gadget: ' || v_gadget.name || ' x' || v_res.quantity,
            p_operator_id);
  END IF;

  UPDATE gadget_reservations
  SET status = 'consegnato', fulfilled_at = now(), fulfilled_by = p_operator_id
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'card_id',        v_res.card_id,
    'display_name',   v_res.display_name,
    'gadget_name',    v_gadget.name,
    'quantity',       v_res.quantity,
    'amount',         v_amount,
    'promo_applied',  v_discount > 0,
    'promo_code',     CASE WHEN v_discount > 0 THEN v_promo.code ELSE NULL END,
    'discount',       v_discount,
    'charged',        v_final,
    'payment_method', p_payment_method
  );
END;
$$;
