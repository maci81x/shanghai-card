-- 20260709135241_049_event_companions
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- ╔══════════════════════════════════════════════╗
-- ║  049 — event_companions (nome + cognome)     ║
-- ╚══════════════════════════════════════════════╝

-- 1. TABELLA
CREATE TABLE IF NOT EXISTS event_companions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid        NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
  nome            text        NOT NULL,
  cognome         text        NOT NULL,
  checked_in      boolean     NOT NULL DEFAULT false,
  checked_in_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ec_reg ON event_companions(registration_id);

-- 2. DROP old party RPCs
DROP FUNCTION IF EXISTS user_update_party(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS staff_update_party(uuid, uuid, integer, text);

-- ── 3. user_add_companions ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS user_add_companions(uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION user_add_companions(
  p_user_id        uuid,
  p_registration_id uuid,
  p_companions      jsonb   -- array [{nome, cognome}]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_reg       record;
  v_comp      jsonb;
  v_new_size  int;
  v_price     numeric;
BEGIN
  SELECT * INTO v_reg FROM event_registrations
    WHERE id = p_registration_id AND user_id = p_user_id AND payment_status != 'annullato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Registrazione non trovata'); END IF;

  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_companions) LOOP
    IF trim(COALESCE(v_comp->>'nome','')) = '' OR trim(COALESCE(v_comp->>'cognome','')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Nome e cognome obbligatori');
    END IF;
    INSERT INTO event_companions(registration_id, nome, cognome)
    VALUES (p_registration_id, trim(v_comp->>'nome'), trim(v_comp->>'cognome'));
  END LOOP;

  SELECT 1 + COUNT(*) INTO v_new_size FROM event_companions WHERE registration_id = p_registration_id;

  IF v_reg.payment_status = 'da_saldare' THEN
    SELECT price INTO v_price FROM events WHERE id = v_reg.event_id;
    UPDATE event_registrations SET party_size = v_new_size, amount = v_new_size * COALESCE(v_price, 0) WHERE id = p_registration_id;
  ELSE
    UPDATE event_registrations SET party_size = v_new_size WHERE id = p_registration_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'party_size', v_new_size,
    'companions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ec.id, 'nome', ec.nome, 'cognome', ec.cognome, 'checked_in', ec.checked_in) ORDER BY ec.created_at)
      FROM event_companions ec WHERE ec.registration_id = p_registration_id
    ), '[]'::jsonb)
  );
END;
$$;

-- ── 4. user_remove_companion ────────────────────────────────────────────
DROP FUNCTION IF EXISTS user_remove_companion(uuid, uuid);
CREATE OR REPLACE FUNCTION user_remove_companion(
  p_user_id      uuid,
  p_companion_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_reg       record;
  v_new_size  int;
  v_price     numeric;
BEGIN
  SELECT er.* INTO v_reg
    FROM event_companions ec
    JOIN event_registrations er ON er.id = ec.registration_id
    WHERE ec.id = p_companion_id AND er.user_id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Accompagnatore non trovato'); END IF;
  IF v_reg.payment_status != 'da_saldare' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non puoi rimuovere dopo il pagamento');
  END IF;

  DELETE FROM event_companions WHERE id = p_companion_id;

  SELECT 1 + COUNT(*) INTO v_new_size FROM event_companions WHERE registration_id = v_reg.id;
  SELECT price INTO v_price FROM events WHERE id = v_reg.event_id;
  UPDATE event_registrations SET party_size = v_new_size, amount = v_new_size * COALESCE(v_price, 0) WHERE id = v_reg.id;

  RETURN jsonb_build_object(
    'ok', true, 'party_size', v_new_size,
    'companions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ec.id, 'nome', ec.nome, 'cognome', ec.cognome, 'checked_in', ec.checked_in) ORDER BY ec.created_at)
      FROM event_companions ec WHERE ec.registration_id = v_reg.id
    ), '[]'::jsonb)
  );
END;
$$;

-- ── 5. staff_add_companions ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS staff_add_companions(uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION staff_add_companions(
  p_operator_id     uuid,
  p_registration_id uuid,
  p_companions      jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_op        record;
  v_reg       record;
  v_comp      jsonb;
  v_new_size  int;
BEGIN
  SELECT * INTO v_op FROM users WHERE id = p_operator_id AND role IN ('staff','admin') AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Non autorizzato'); END IF;

  SELECT * INTO v_reg FROM event_registrations WHERE id = p_registration_id AND payment_status != 'annullato';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Registrazione non trovata'); END IF;

  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_companions) LOOP
    IF trim(COALESCE(v_comp->>'nome','')) = '' OR trim(COALESCE(v_comp->>'cognome','')) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Nome e cognome obbligatori');
    END IF;
    INSERT INTO event_companions(registration_id, nome, cognome)
    VALUES (p_registration_id, trim(v_comp->>'nome'), trim(v_comp->>'cognome'));
  END LOOP;

  SELECT 1 + COUNT(*) INTO v_new_size FROM event_companions WHERE registration_id = p_registration_id;
  UPDATE event_registrations SET party_size = v_new_size WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'ok', true, 'party_size', v_new_size,
    'companions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ec.id, 'nome', ec.nome, 'cognome', ec.cognome, 'checked_in', ec.checked_in) ORDER BY ec.created_at)
      FROM event_companions ec WHERE ec.registration_id = p_registration_id
    ), '[]'::jsonb)
  );
END;
$$;

-- ── 6. staff_remove_companion ───────────────────────────────────────────
DROP FUNCTION IF EXISTS staff_remove_companion(uuid, uuid);
CREATE OR REPLACE FUNCTION staff_remove_companion(
  p_operator_id  uuid,
  p_companion_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_op       record;
  v_reg_id   uuid;
  v_new_size int;
BEGIN
  SELECT * INTO v_op FROM users WHERE id = p_operator_id AND role IN ('staff','admin') AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Non autorizzato'); END IF;

  SELECT registration_id INTO v_reg_id FROM event_companions WHERE id = p_companion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Accompagnatore non trovato'); END IF;

  DELETE FROM event_companions WHERE id = p_companion_id;

  SELECT 1 + COUNT(*) INTO v_new_size FROM event_companions WHERE registration_id = v_reg_id;
  UPDATE event_registrations SET party_size = v_new_size WHERE id = v_reg_id;

  RETURN jsonb_build_object(
    'ok', true, 'party_size', v_new_size,
    'companions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ec.id, 'nome', ec.nome, 'cognome', ec.cognome, 'checked_in', ec.checked_in) ORDER BY ec.created_at)
      FROM event_companions ec WHERE ec.registration_id = v_reg_id
    ), '[]'::jsonb)
  );
END;
$$;

-- ── 7. staff_checkin_companion ──────────────────────────────────────────
DROP FUNCTION IF EXISTS staff_checkin_companion(uuid, uuid);
CREATE OR REPLACE FUNCTION staff_checkin_companion(
  p_operator_id  uuid,
  p_companion_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_op record;
  v_found boolean;
BEGIN
  SELECT * INTO v_op FROM users WHERE id = p_operator_id AND role IN ('staff','admin') AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Non autorizzato'); END IF;

  UPDATE event_companions SET checked_in = true, checked_in_at = now() WHERE id = p_companion_id;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF NOT v_found THEN RETURN jsonb_build_object('ok', false, 'error', 'Accompagnatore non trovato'); END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 8. admin_list_event_registrations (+ companions) ───────────────────
DROP FUNCTION IF EXISTS admin_list_event_registrations(uuid);
CREATE OR REPLACE FUNCTION admin_list_event_registrations(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_total BIGINT;
BEGIN
  SELECT COALESCE(SUM(party_size), 0) INTO v_total
    FROM public.event_registrations
    WHERE event_id = p_event_id AND payment_status != 'annullato';

  RETURN json_build_object(
    'total', v_total,
    'soci', (
      SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
      FROM (
        SELECT er.id AS registration_id,
               u.card_id, u.display_name,
               er.nome, er.cognome, er.telefono,
               er.payment_status, er.amount,
               er.paid_at,
               er.checked_in, er.checked_in_at,
               er.party_size, er.party_notes,
               op.display_name AS operatore,
               er.created_at,
               COALESCE((
                 SELECT json_agg(json_build_object(
                   'id',           ec.id,
                   'nome',         ec.nome,
                   'cognome',      ec.cognome,
                   'checked_in',   ec.checked_in,
                   'checked_in_at',ec.checked_in_at
                 ) ORDER BY ec.created_at)
                 FROM event_companions ec WHERE ec.registration_id = er.id
               ), '[]'::json) AS companions
        FROM public.event_registrations er
        JOIN public.users u ON u.id = er.user_id
        LEFT JOIN public.users op ON op.id = er.paid_by
        WHERE er.event_id = p_event_id AND er.payment_status != 'annullato'
        ORDER BY er.created_at
      ) r
    ),
    'ospiti', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT eg.id, eg.nome, eg.cognome, eg.telefono, eg.email,
               eg.payment_status, eg.amount, eg.paid_at,
               eg.checked_in, eg.checked_in_at,
               op.display_name AS operatore, eg.created_at
        FROM public.event_guests eg
        LEFT JOIN public.users op ON op.id = eg.paid_by
        WHERE eg.event_id = p_event_id
        ORDER BY eg.created_at
      ) g
    )
  );
END;
$$;

-- ── 9. admin_event_dashboard (conta check-in companions) ───────────────
DROP FUNCTION IF EXISTS admin_event_dashboard(uuid);
CREATE OR REPLACE FUNCTION admin_event_dashboard(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_reg_total    BIGINT; v_reg_paid    BIGINT;
  v_reg_present  BIGINT; v_reg_incasso NUMERIC;
  v_gst_total    BIGINT; v_gst_paid    BIGINT;
  v_gst_present  BIGINT; v_gst_incasso NUMERIC;
  v_comp_present BIGINT;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN payment_status != 'annullato' THEN party_size ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),
    COUNT(*) FILTER (WHERE checked_in = true),
    COALESCE(SUM(amount) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')), 0)
  INTO v_reg_total, v_reg_paid, v_reg_present, v_reg_incasso
  FROM public.event_registrations WHERE event_id = p_event_id;

  SELECT
    COUNT(*) FILTER (WHERE payment_status != 'annullato'),
    COUNT(*) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),
    COUNT(*) FILTER (WHERE checked_in = true),
    COALESCE(SUM(amount) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')), 0)
  INTO v_gst_total, v_gst_paid, v_gst_present, v_gst_incasso
  FROM public.event_guests WHERE event_id = p_event_id;

  SELECT COUNT(*) INTO v_comp_present
  FROM event_companions ec
  JOIN event_registrations er ON er.id = ec.registration_id
  WHERE er.event_id = p_event_id AND ec.checked_in = true;

  RETURN json_build_object(
    'ok',             true,
    'total_iscritti', COALESCE(v_reg_total,0) + COALESCE(v_gst_total,0),
    'total_paganti',  COALESCE(v_reg_paid,0)  + COALESCE(v_gst_paid,0),
    'total_presenti', COALESCE(v_reg_present,0)+ COALESCE(v_gst_present,0) + COALESCE(v_comp_present,0),
    'incasso_totale', COALESCE(v_reg_incasso,0)+ COALESCE(v_gst_incasso,0)
  );
END;
$$;

-- ── 10. admin_export_event_csv (una riga per persona, companions espansi)
DROP FUNCTION IF EXISTS admin_export_event_csv(uuid);
CREATE OR REPLACE FUNCTION admin_export_event_csv(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_event  record;
  v_reg    jsonb;
  v_soci   jsonb;
  v_ospiti jsonb;
BEGIN
  SELECT title, event_date INTO v_event FROM events WHERE id = p_event_id;
  SELECT admin_list_event_registrations(p_event_id)::jsonb INTO v_reg;
  v_soci   := COALESCE(v_reg->'soci',   '[]'::jsonb);
  v_ospiti := COALESCE(v_reg->'ospiti', '[]'::jsonb);

  RETURN jsonb_build_object(
    'evento',      v_event.title,
    'data_evento', v_event.event_date,
    'iscritti', (
      SELECT COALESCE(jsonb_agg(row_obj), '[]'::jsonb)
      FROM (
        -- Riga socio
        SELECT jsonb_build_object(
          'tipo',           'socio',
          'card_id',        s->>'card_id',
          'display_name',   COALESCE(s->>'display_name',''),
          'nome',           COALESCE(s->>'nome',''),
          'cognome',        COALESCE(s->>'cognome',''),
          'telefono',       COALESCE(s->>'telefono',''),
          'email',          '',
          'amount',         (s->>'amount')::numeric,
          'payment_status', s->>'payment_status',
          'checked_in',     (s->>'checked_in')::boolean,
          'operatore',      COALESCE(s->>'operatore',''),
          'created_at',     s->>'created_at'
        ) AS row_obj
        FROM jsonb_array_elements(v_soci) AS s
        UNION ALL
        -- Righe accompagnatori (una per companion)
        SELECT jsonb_build_object(
          'tipo',           'accompagnatore',
          'card_id',        s->>'card_id',
          'display_name',   COALESCE(s->>'display_name',''),
          'nome',           c->>'nome',
          'cognome',        c->>'cognome',
          'telefono',       '',
          'email',          '',
          'amount',         0,
          'payment_status', s->>'payment_status',
          'checked_in',     (c->>'checked_in')::boolean,
          'operatore',      '',
          'created_at',     s->>'created_at'
        ) AS row_obj
        FROM jsonb_array_elements(v_soci) AS s,
             jsonb_array_elements(COALESCE(s->'companions','[]'::jsonb)) AS c
        UNION ALL
        -- Righe ospiti
        SELECT jsonb_build_object(
          'tipo',           'ospite',
          'card_id',        '',
          'display_name',   TRIM(COALESCE(g->>'nome','') || ' ' || COALESCE(g->>'cognome','')),
          'nome',           COALESCE(g->>'nome',''),
          'cognome',        COALESCE(g->>'cognome',''),
          'telefono',       COALESCE(g->>'telefono',''),
          'email',          COALESCE(g->>'email',''),
          'amount',         (g->>'amount')::numeric,
          'payment_status', g->>'payment_status',
          'checked_in',     (g->>'checked_in')::boolean,
          'operatore',      COALESCE(g->>'operatore',''),
          'created_at',     g->>'created_at'
        ) AS row_obj
        FROM jsonb_array_elements(v_ospiti) AS g
      ) sub
    )
  );
END;
$$;

-- ── 11. get_user_state (my_event_regs con companions) ──────────────────
DROP FUNCTION IF EXISTS get_user_state(uuid);
CREATE OR REPLACE FUNCTION get_user_state(p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;

  RETURN json_build_object(
    'ok', true,
    'balance', v_user.balance,
    'transactions', (
      SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT id, type, amount, balance_after, description, created_at
        FROM public.transactions
        WHERE user_id = p_user_id
        ORDER BY created_at DESC LIMIT 30
      ) t
    ),
    'pending_events', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT er.id        AS registration_id,
               er.event_id,
               ev.title     AS evento,
               ev.event_date,
               er.amount,
               er.payment_status,
               ev.sumup_link,
               er.party_size,
               er.party_notes
        FROM public.event_registrations er
        JOIN public.events ev ON ev.id = er.event_id
        WHERE er.user_id = p_user_id AND er.payment_status = 'da_saldare'
        ORDER BY ev.event_date
      ) r
    ),
    'my_event_ids', (
      SELECT coalesce(json_agg(er.event_id::text), '[]'::json)
      FROM public.event_registrations er
      WHERE er.user_id = p_user_id AND er.payment_status != 'annullato'
    ),
    'my_event_regs', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT er.id                AS registration_id,
               er.event_id::text   AS event_id,
               er.party_size,
               er.party_notes,
               er.payment_status,
               COALESCE((
                 SELECT json_agg(json_build_object(
                   'id',         ec.id,
                   'nome',       ec.nome,
                   'cognome',    ec.cognome,
                   'checked_in', ec.checked_in
                 ) ORDER BY ec.created_at)
                 FROM event_companions ec WHERE ec.registration_id = er.id
               ), '[]'::json) AS companions
        FROM public.event_registrations er
        WHERE er.user_id = p_user_id AND er.payment_status != 'annullato'
      ) r
    )
  );
END;
$$;
