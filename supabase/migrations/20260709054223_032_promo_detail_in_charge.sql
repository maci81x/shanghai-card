-- 20260709054223_032_promo_detail_in_charge
-- ricostruita da supabase_migrations.schema_migrations


-- staff_charge: aggiunge promo_applied, promo_type, promo_discount, final_amount
CREATE OR REPLACE FUNCTION public.staff_charge(
  p_operator_id uuid, p_card_id text,
  p_amount numeric, p_description text DEFAULT 'Consumazione'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE
  v_user     public.users%ROWTYPE;
  v_operator public.users%ROWTYPE;
  v_promo    public.promos%ROWTYPE;
  v_discount NUMERIC := 0;
  v_final    NUMERIC;
  v_tx_id    UUID;
  v_promo_code TEXT := NULL;
  v_promo_type TEXT := NULL;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id=p_operator_id AND active=true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;
  IF p_amount<=0 THEN RETURN json_build_object('ok',false,'error','Importo non valido'); END IF;

  SELECT * INTO v_user FROM public.users WHERE card_id=upper(trim(p_card_id)) AND active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Tessera non trovata'); END IF;

  SELECT * INTO v_promo FROM public.promos
    WHERE active=true AND (valid_until IS NULL OR valid_until>now())
      AND (max_uses IS NULL OR current_uses<max_uses)
    ORDER BY discount_value DESC LIMIT 1;

  IF FOUND THEN
    v_promo_code := v_promo.code;
    v_promo_type := v_promo.discount_type;
    IF v_promo.discount_type='percent' THEN
      v_discount := round(p_amount * v_promo.discount_value / 100, 2);
    ELSE
      v_discount := LEAST(v_promo.discount_value, p_amount);
    END IF;
    UPDATE public.promos SET current_uses=current_uses+1 WHERE id=v_promo.id;
  END IF;

  v_final := p_amount - v_discount;

  IF v_user.balance < v_final THEN
    RETURN json_build_object('ok',false,'error','Saldo insufficiente',
      'balance',v_user.balance,'requested',v_final);
  END IF;

  UPDATE public.users SET balance=balance-v_final, updated_at=now() WHERE id=v_user.id;

  INSERT INTO public.transactions (user_id,type,amount,balance_after,description,operator_id)
  VALUES (v_user.id,'purchase',-v_final, v_user.balance-v_final,
    p_description || CASE WHEN v_promo_code IS NOT NULL
      THEN ' (promo '||v_promo_code||': -€'||v_discount||')' ELSE '' END,
    p_operator_id)
  RETURNING id INTO v_tx_id;

  RETURN json_build_object(
    'ok',true,
    'transaction_id',v_tx_id, 'card_id',v_user.card_id, 'display_name',v_user.display_name,
    'original_amount',p_amount, 'promo_applied',(v_promo_code IS NOT NULL),
    'promo_code',v_promo_code, 'promo_type',v_promo_type,
    'promo_discount',v_discount, 'discount',v_discount,
    'final_amount',v_final, 'charged',v_final,
    'old_balance',v_user.balance, 'new_balance',v_user.balance-v_final
  );
END; $$;

-- user_buy_gadget: aggiunge promo_applied, promo_type, promo_discount, final_amount
CREATE OR REPLACE FUNCTION public.user_buy_gadget(p_user_id uuid, p_gadget_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE
  v_user   public.users%ROWTYPE;
  v_gadget public.gadgets%ROWTYPE;
  v_promo  public.promos%ROWTYPE;
  v_discount NUMERIC := 0;
  v_final    NUMERIC;
  v_tx_id    UUID;
  v_promo_code TEXT := NULL;
  v_promo_type TEXT := NULL;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id=p_user_id AND active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Utente non trovato'); END IF;
  SELECT * INTO v_gadget FROM public.gadgets WHERE id=p_gadget_id AND active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Gadget non trovato'); END IF;
  IF v_gadget.stock<=0 THEN RETURN json_build_object('ok',false,'error','Gadget esaurito'); END IF;

  SELECT * INTO v_promo FROM public.promos
    WHERE active=true AND (valid_until IS NULL OR valid_until>now())
      AND (max_uses IS NULL OR current_uses<max_uses)
    ORDER BY discount_value DESC LIMIT 1;

  IF FOUND THEN
    v_promo_code := v_promo.code;
    v_promo_type := v_promo.discount_type;
    IF v_promo.discount_type='percent' THEN
      v_discount := round(v_gadget.price * v_promo.discount_value / 100, 2);
    ELSE
      v_discount := LEAST(v_promo.discount_value, v_gadget.price);
    END IF;
    UPDATE public.promos SET current_uses=current_uses+1 WHERE id=v_promo.id;
  END IF;

  v_final := v_gadget.price - v_discount;

  IF v_user.balance < v_final THEN
    RETURN json_build_object('ok',false,'error','Saldo insufficiente',
      'balance',v_user.balance,'price',v_final);
  END IF;

  UPDATE public.users SET balance=balance-v_final, updated_at=now() WHERE id=p_user_id;
  UPDATE public.gadgets SET stock=stock-1 WHERE id=p_gadget_id;

  INSERT INTO public.transactions (user_id,type,amount,balance_after,description,ref_id)
  VALUES (p_user_id,'purchase',-v_final, v_user.balance-v_final,
    'Acquisto: '||v_gadget.name || CASE WHEN v_promo_code IS NOT NULL
      THEN ' (promo '||v_promo_code||': -€'||v_discount||')' ELSE '' END,
    p_gadget_id)
  RETURNING id INTO v_tx_id;

  RETURN json_build_object(
    'ok',true, 'new_balance',v_user.balance-v_final,
    'transaction_id',v_tx_id, 'gadget',v_gadget.name,
    'original_amount',v_gadget.price, 'original_price',v_gadget.price,
    'promo_applied',(v_promo_code IS NOT NULL),
    'promo_code',v_promo_code, 'promo_type',v_promo_type,
    'promo_discount',v_discount, 'discount',v_discount,
    'final_amount',v_final, 'charged',v_final
  );
END; $$;

-- staff_preview_charge: calcola promo senza eseguire la transazione
CREATE OR REPLACE FUNCTION public.staff_preview_charge(
  p_operator_id uuid, p_card_id text, p_amount numeric
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE
  v_op    public.users%ROWTYPE;
  v_usr   public.users%ROWTYPE;
  v_promo public.promos%ROWTYPE;
  v_discount NUMERIC := 0;
  v_promo_code TEXT := NULL;
  v_promo_type TEXT := NULL;
BEGIN
  SELECT * INTO v_op FROM public.users WHERE id=p_operator_id AND active=true;
  IF NOT FOUND OR v_op.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;

  SELECT * INTO v_usr FROM public.users WHERE card_id=upper(trim(p_card_id)) AND active=true;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Tessera non trovata'); END IF;

  SELECT * INTO v_promo FROM public.promos
    WHERE active=true AND (valid_until IS NULL OR valid_until>now())
      AND (max_uses IS NULL OR current_uses<max_uses)
    ORDER BY discount_value DESC LIMIT 1;

  IF FOUND THEN
    v_promo_code := v_promo.code;
    v_promo_type := v_promo.discount_type;
    IF v_promo.discount_type='percent' THEN
      v_discount := round(p_amount * v_promo.discount_value / 100, 2);
    ELSE
      v_discount := LEAST(v_promo.discount_value, p_amount);
    END IF;
  END IF;

  RETURN json_build_object(
    'ok',true,
    'original_amount', p_amount,
    'promo_applied',   (v_promo_code IS NOT NULL),
    'promo_code',      v_promo_code,
    'promo_type',      v_promo_type,
    'promo_discount',  v_discount,
    'final_amount',    p_amount - v_discount,
    'balance',         v_usr.balance,
    'display_name',    v_usr.display_name
  );
END; $$;

-- get_catalog: aggiunge sumup_link agli eventi (fix root cause bug SumUp)
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN json_build_object(
    'events', (
      SELECT coalesce(json_agg(row_to_json(e)),'[]'::json)
      FROM (
        SELECT id, title, description, event_date, location,
               max_participants, price, active, sumup_link, slug
        FROM public.events
        WHERE active=true AND visible=true
        ORDER BY event_date
      ) e
    ),
    'gadgets', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT id, name, description, price, stock, image_url, active
        FROM public.gadgets WHERE active=true AND stock>0 ORDER BY name
      ) g
    ),
    'promos', (
      SELECT coalesce(json_agg(row_to_json(p)),'[]'::json)
      FROM (
        SELECT id, code, description, discount_type, discount_value, valid_from, valid_until
        FROM public.promos WHERE active=true AND (valid_until IS NULL OR valid_until>now()) ORDER BY valid_from
      ) p
    ),
    'sumup_links', (
      SELECT coalesce(json_agg(row_to_json(s)),'[]'::json)
      FROM (SELECT id, label, amount, url FROM public.sumup_links WHERE active=true ORDER BY amount) s
    )
  );
END; $$;
