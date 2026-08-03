-- 20260709133619_047_fix_v_promo_record
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.staff_fulfill_gadget_reservation(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.staff_fulfill_gadget_reservation(
  p_operator_id    UUID,
  p_reservation_id UUID,
  p_payment_method TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res        RECORD;
  v_gadget     RECORD;
  v_promo      RECORD;
  v_promo_code TEXT    := NULL;
  v_amount     NUMERIC(10,2);
  v_discount   NUMERIC(10,2) := 0;
  v_final      NUMERIC(10,2);
  v_new_bal    NUMERIC(10,2);
BEGIN
  -- Verifica operatore
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_operator_id AND active = true AND role IN ('admin','staff')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Operatore non autorizzato');
  END IF;

  -- Leggi prenotazione
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
    -- Cerca promo attiva solo per pagamento credito
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

  UPDATE public.gadget_reservations
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
    'promo_code',     v_promo_code,
    'discount',       v_discount,
    'charged',        v_final,
    'payment_method', p_payment_method
  );
END;
$$;
