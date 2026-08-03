-- 20260802154118_promo_bonus_schema_and_helpers
-- ricostruita da supabase_migrations.schema_migrations

-- === 1. SCHEMA ===
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type = ANY (ARRAY['recharge','purchase','event_fee','refund','transfer_out','transfer_in','promo_bonus']));

ALTER TABLE events ADD COLUMN IF NOT EXISTS promo_group text;
CREATE INDEX IF NOT EXISTS idx_events_promo_group ON events(promo_group) WHERE promo_group IS NOT NULL;

ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS promo_bonus_amount numeric;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS promo_position int;

CREATE TABLE IF NOT EXISTS promo_bonus_config (
  promo_group text NOT NULL,
  position int NOT NULL,
  bonus_pct numeric NOT NULL,
  label text,
  PRIMARY KEY (promo_group, position)
);

INSERT INTO promo_bonus_config(promo_group, position, bonus_pct, label)
VALUES 
  ('cene_estive_2026', 2, 10, 'Cene Estive 2026'),
  ('cene_estive_2026', 4, 15, 'Cene Estive 2026'),
  ('cene_estive_2026', 6, 20, 'Cene Estive 2026')
ON CONFLICT (promo_group, position) DO UPDATE 
  SET bonus_pct = EXCLUDED.bonus_pct, label = EXCLUDED.label;


-- === 2. HELPER: _is_event_registration_fully_paid ===
DROP FUNCTION IF EXISTS _is_event_registration_fully_paid(uuid);
CREATE OR REPLACE FUNCTION _is_event_registration_fully_paid(p_reg_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_reg event_registrations%ROWTYPE;
  v_saldato text[] := ARRAY['saldato','saldato_credito','saldato_sumup','saldato_cassa','saldato_contanti'];
  v_unpaid_comp int;
  v_active_comp int;
BEGIN
  SELECT * INTO v_reg FROM event_registrations WHERE id=p_reg_id;
  IF NOT FOUND OR v_reg.status='annullato' OR v_reg.payment_status='annullato' THEN RETURN false; END IF;
  
  IF COALESCE(v_reg.self_included, true) THEN
    IF NOT (v_reg.payment_status = ANY(v_saldato)) THEN RETURN false; END IF;
  END IF;

  SELECT count(*) INTO v_unpaid_comp FROM event_companions
    WHERE registration_id=p_reg_id AND COALESCE(status,'attivo')='attivo' 
      AND NOT (payment_status = ANY(v_saldato));
  IF v_unpaid_comp > 0 THEN RETURN false; END IF;

  -- Se self escluso e nessun companion attivo → registration vuota
  IF NOT COALESCE(v_reg.self_included, true) THEN
    SELECT count(*) INTO v_active_comp FROM event_companions
      WHERE registration_id=p_reg_id AND COALESCE(status,'attivo')='attivo';
    IF v_active_comp = 0 THEN RETURN false; END IF;
  END IF;

  RETURN true;
END; $$;


-- === 3. HELPER: importo totale pagato dal socio per questa registration ===
DROP FUNCTION IF EXISTS _event_reg_amount_paid_by_owner(uuid);
CREATE OR REPLACE FUNCTION _event_reg_amount_paid_by_owner(p_reg_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_reg event_registrations%ROWTYPE;
  v_event events%ROWTYPE;
  v_price numeric; v_amount numeric := 0;
  v_saldato text[] := ARRAY['saldato','saldato_credito','saldato_sumup','saldato_cassa','saldato_contanti'];
  v_n_comp int;
BEGIN
  SELECT * INTO v_reg FROM event_registrations WHERE id=p_reg_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  v_price := COALESCE(v_event.price, 0);

  IF COALESCE(v_reg.self_included, true) AND v_reg.payment_status = ANY(v_saldato) THEN
    v_amount := v_amount + v_price;
  END IF;

  SELECT count(*) INTO v_n_comp FROM event_companions
    WHERE registration_id=p_reg_id AND COALESCE(status,'attivo')='attivo' 
      AND payment_status = ANY(v_saldato);
  v_amount := v_amount + (v_n_comp * v_price);

  RETURN v_amount;
END; $$;


-- === 4. HELPER: applica bonus se eligible ===
DROP FUNCTION IF EXISTS _check_and_apply_promo_bonus(uuid, uuid);
CREATE OR REPLACE FUNCTION _check_and_apply_promo_bonus(p_reg_id uuid, p_operator_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_reg event_registrations%ROWTYPE;
  v_event events%ROWTYPE;
  v_count int; v_pct numeric; v_bonus numeric; v_total_paid numeric;
  v_new_balance numeric;
BEGIN
  SELECT * INTO v_reg FROM event_registrations WHERE id=p_reg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Già processata? esci
  IF v_reg.promo_position IS NOT NULL THEN RETURN; END IF;

  SELECT * INTO v_event FROM events WHERE id=v_reg.event_id;
  IF v_event.promo_group IS NULL THEN RETURN; END IF;

  -- Solo se completamente saldata
  IF NOT _is_event_registration_fully_paid(p_reg_id) THEN RETURN; END IF;

  -- Conta cene già completate nel gruppo (compresa questa)
  SELECT count(*) INTO v_count FROM event_registrations er
    JOIN events e ON e.id=er.event_id
    WHERE er.user_id = v_reg.user_id
      AND e.promo_group = v_event.promo_group
      AND _is_event_registration_fully_paid(er.id);

  -- Marca posizione
  UPDATE event_registrations SET promo_position = v_count WHERE id = p_reg_id;

  -- Cerca soglia
  SELECT bonus_pct INTO v_pct FROM promo_bonus_config
    WHERE promo_group = v_event.promo_group AND position = v_count;

  IF v_pct IS NULL THEN
    UPDATE event_registrations SET promo_bonus_amount = 0 WHERE id = p_reg_id;
    RETURN;
  END IF;

  v_total_paid := _event_reg_amount_paid_by_owner(p_reg_id);
  v_bonus := ROUND(v_total_paid * v_pct / 100, 2);

  IF v_bonus <= 0 THEN
    UPDATE event_registrations SET promo_bonus_amount = 0 WHERE id = p_reg_id;
    RETURN;
  END IF;

  UPDATE users SET balance = balance + v_bonus, updated_at = now()
    WHERE id = v_reg.user_id
    RETURNING balance INTO v_new_balance;

  INSERT INTO transactions(user_id, type, amount, balance_after, description, operator_id, ref_id)
    VALUES(v_reg.user_id, 'promo_bonus', v_bonus, v_new_balance,
      '🌴 Bonus Promo — ' || v_count || 'ª cena (' || v_pct::text || '%): ' || v_event.title,
      p_operator_id, v_reg.event_id);

  UPDATE event_registrations SET promo_bonus_amount = v_bonus WHERE id = p_reg_id;
END; $$;


-- === 5. HELPER: rollback bonus ===
DROP FUNCTION IF EXISTS _rollback_promo_bonus_if_applied(uuid);
CREATE OR REPLACE FUNCTION _rollback_promo_bonus_if_applied(p_reg_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_reg event_registrations%ROWTYPE;
  v_event events%ROWTYPE;
  v_new_balance numeric;
BEGIN
  SELECT * INTO v_reg FROM event_registrations WHERE id=p_reg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Nessun bonus applicato? pulisci comunque marker e esci
  IF COALESCE(v_reg.promo_bonus_amount, 0) <= 0 THEN
    UPDATE event_registrations SET promo_position = NULL, promo_bonus_amount = NULL WHERE id = p_reg_id;
    RETURN;
  END IF;

  SELECT * INTO v_event FROM events WHERE id = v_reg.event_id;

  UPDATE users SET balance = balance - v_reg.promo_bonus_amount, updated_at = now()
    WHERE id = v_reg.user_id
    RETURNING balance INTO v_new_balance;

  INSERT INTO transactions(user_id, type, amount, balance_after, description, ref_id)
    VALUES(v_reg.user_id, 'promo_bonus', -v_reg.promo_bonus_amount, v_new_balance,
      '↩️ Storno Bonus Promo — cancellazione: ' || COALESCE(v_event.title, 'evento'),
      v_reg.event_id);

  UPDATE event_registrations SET promo_bonus_amount = NULL, promo_position = NULL WHERE id = p_reg_id;
END; $$;


-- === 6. TRIGGER: rollback automatico su cancellazione ===
CREATE OR REPLACE FUNCTION _trg_rollback_promo_on_cancel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status) AND NEW.status='annullato' 
     AND COALESCE(NEW.promo_bonus_amount, 0) > 0 THEN
    PERFORM _rollback_promo_bonus_if_applied(NEW.id);
  END IF;
  IF (NEW.payment_status IS DISTINCT FROM OLD.payment_status) AND NEW.payment_status='annullato' 
     AND COALESCE(NEW.promo_bonus_amount, 0) > 0 THEN
    PERFORM _rollback_promo_bonus_if_applied(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rollback_promo_on_cancel ON event_registrations;
CREATE TRIGGER trg_rollback_promo_on_cancel
  AFTER UPDATE ON event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION _trg_rollback_promo_on_cancel();


-- === 7. RPC user_promo_status ===
DROP FUNCTION IF EXISTS user_promo_status(uuid, text);
CREATE OR REPLACE FUNCTION user_promo_status(p_user_id uuid, p_promo_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE
  v_completed int;
  v_next_pos int;
  v_next_pct numeric;
  v_total_bonus numeric;
  v_max_pos int;
  v_label text;
BEGIN
  SELECT count(*) INTO v_completed
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.user_id = p_user_id AND e.promo_group = p_promo_group
    AND _is_event_registration_fully_paid(er.id);

  SELECT position, bonus_pct INTO v_next_pos, v_next_pct
  FROM promo_bonus_config
  WHERE promo_group = p_promo_group AND position > v_completed
  ORDER BY position ASC LIMIT 1;

  SELECT COALESCE(sum(promo_bonus_amount), 0) INTO v_total_bonus
  FROM event_registrations er JOIN events e ON e.id=er.event_id
  WHERE er.user_id = p_user_id AND e.promo_group = p_promo_group
    AND COALESCE(promo_bonus_amount, 0) > 0;

  SELECT max(position) INTO v_max_pos FROM promo_bonus_config WHERE promo_group = p_promo_group;
  SELECT label INTO v_label FROM promo_bonus_config WHERE promo_group = p_promo_group LIMIT 1;

  RETURN jsonb_build_object(
    'promo_group', p_promo_group,
    'label', COALESCE(v_label, p_promo_group),
    'completed', v_completed,
    'next_position', v_next_pos,
    'next_bonus_pct', v_next_pct,
    'total_bonus_received', v_total_bonus,
    'max_position', COALESCE(v_max_pos, 6)
  );
END; $$;

GRANT EXECUTE ON FUNCTION user_promo_status(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION _is_event_registration_fully_paid(uuid) TO anon, authenticated;
