-- 20260709131612_046_party_size
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- 1. Aggiungi party_size e party_notes a event_registrations
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS party_size INT NOT NULL DEFAULT 1 CHECK(party_size >= 1),
  ADD COLUMN IF NOT EXISTS party_notes TEXT;

-- 2. Drop e ricrea user_register_event con parametri party
DROP FUNCTION IF EXISTS public.user_register_event(uuid, uuid);
CREATE OR REPLACE FUNCTION public.user_register_event(
  p_user_id     UUID,
  p_event_id    UUID,
  p_party_size  INT  DEFAULT 1,
  p_party_notes TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user    public.users%ROWTYPE;
  v_event   public.events%ROWTYPE;
  v_reg_id  UUID;
  v_count   INTEGER;
  v_pstatus TEXT;
  v_psize   INT;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Evento non trovato'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE user_id = p_user_id AND event_id = p_event_id AND payment_status != 'annullato'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'Già iscritto a questo evento');
  END IF;

  IF v_event.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.event_registrations
    WHERE event_id = p_event_id AND payment_status != 'annullato';
    IF v_count >= v_event.max_participants THEN
      RETURN json_build_object('ok', false, 'error', 'Evento al completo');
    END IF;
  END IF;

  v_pstatus := CASE WHEN coalesce(v_event.price, 0) = 0 THEN 'gratuito' ELSE 'da_saldare' END;
  v_psize   := GREATEST(1, COALESCE(p_party_size, 1));

  INSERT INTO public.event_registrations
    (user_id, event_id, status, payment_status, amount, nome, cognome, telefono, party_size, party_notes)
  VALUES
    (p_user_id, p_event_id, 'confirmed', v_pstatus,
     coalesce(v_event.price, 0),
     v_user.nome, v_user.cognome, v_user.telefono,
     v_psize, p_party_notes)
  RETURNING id INTO v_reg_id;

  RETURN json_build_object(
    'ok',              true,
    'registration_id', v_reg_id,
    'event',           v_event.title,
    'amount',          coalesce(v_event.price, 0),
    'payment_status',  v_pstatus
  );
END;
$$;

-- 3. Crea user_update_party
CREATE OR REPLACE FUNCTION public.user_update_party(
  p_user_id         UUID,
  p_registration_id UUID,
  p_party_size      INT,
  p_party_notes     TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.event_registrations
  SET party_size  = GREATEST(1, COALESCE(p_party_size, 1)),
      party_notes = p_party_notes
  WHERE id = p_registration_id AND user_id = p_user_id AND payment_status != 'annullato';

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Registrazione non trovata');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

-- 4. Crea staff_update_party
CREATE OR REPLACE FUNCTION public.staff_update_party(
  p_operator_id     UUID,
  p_registration_id UUID,
  p_party_size      INT,
  p_party_notes     TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = p_operator_id AND active = true;
  IF v_role NOT IN ('admin', 'staff') THEN
    RETURN json_build_object('ok', false, 'error', 'Non autorizzato');
  END IF;

  UPDATE public.event_registrations
  SET party_size  = GREATEST(1, COALESCE(p_party_size, 1)),
      party_notes = p_party_notes
  WHERE id = p_registration_id AND payment_status != 'annullato';

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Registrazione non trovata');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

-- 5. Aggiorna admin_event_dashboard: SUM(party_size) per total_iscritti soci
DROP FUNCTION IF EXISTS public.admin_event_dashboard(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_dashboard(p_event_id UUID)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reg_total   BIGINT; v_reg_paid    BIGINT;
  v_reg_present BIGINT; v_reg_incasso NUMERIC;
  v_gst_total   BIGINT; v_gst_paid    BIGINT;
  v_gst_present BIGINT; v_gst_incasso NUMERIC;
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

  RETURN json_build_object(
    'ok',             true,
    'total_iscritti', COALESCE(v_reg_total,0) + COALESCE(v_gst_total,0),
    'total_paganti',  COALESCE(v_reg_paid,0)  + COALESCE(v_gst_paid,0),
    'total_presenti', COALESCE(v_reg_present,0)+ COALESCE(v_gst_present,0),
    'incasso_totale', COALESCE(v_reg_incasso,0)+ COALESCE(v_gst_incasso,0)
  );
END;
$$;

-- 6. Aggiorna admin_list_event_registrations: aggiungi party_size e party_notes
DROP FUNCTION IF EXISTS public.admin_list_event_registrations(uuid);
CREATE OR REPLACE FUNCTION public.admin_list_event_registrations(p_event_id UUID)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
               er.created_at
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

-- 7. Aggiorna get_user_state: aggiungi my_event_regs con party data
DROP FUNCTION IF EXISTS public.get_user_state(uuid);
CREATE OR REPLACE FUNCTION public.get_user_state(p_user_id UUID)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
        SELECT er.id       AS registration_id,
               er.event_id,
               ev.title    AS evento,
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
        SELECT er.id AS registration_id,
               er.event_id::text AS event_id,
               er.party_size,
               er.party_notes,
               er.payment_status
        FROM public.event_registrations er
        WHERE er.user_id = p_user_id AND er.payment_status != 'annullato'
      ) r
    )
  );
END;
$$;

-- 8. Aggiorna admin_export_event_csv: aggiungi party_size e party_notes
DROP FUNCTION IF EXISTS public.admin_export_event_csv(uuid);
CREATE OR REPLACE FUNCTION public.admin_export_event_csv(p_event_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event  RECORD;
  v_reg    jsonb;
  v_soci   jsonb;
  v_ospiti jsonb;
BEGIN
  SELECT title, event_date INTO v_event FROM events WHERE id = p_event_id;
  SELECT admin_list_event_registrations(p_event_id) INTO v_reg;
  v_soci   := COALESCE(v_reg->'soci', '[]'::jsonb);
  v_ospiti := COALESCE(v_reg->'ospiti', '[]'::jsonb);

  RETURN jsonb_build_object(
    'evento',      v_event.title,
    'data_evento', v_event.event_date,
    'iscritti', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'tipo',           r->>'tipo',
          'card_id',        r->>'card_id',
          'display_name',   COALESCE(r->>'display_name', ''),
          'nome',           COALESCE(r->>'nome', ''),
          'cognome',        COALESCE(r->>'cognome', ''),
          'telefono',       COALESCE(r->>'telefono', ''),
          'email',          COALESCE(r->>'email', ''),
          'amount',         (r->>'amount')::numeric,
          'payment_status', r->>'payment_status',
          'party_size',     COALESCE((r->>'party_size')::int, 1),
          'party_notes',    COALESCE(r->>'party_notes', ''),
          'checked_in',     (r->>'checked_in')::boolean,
          'paid_at',        r->>'paid_at',
          'operatore',      COALESCE(r->>'operatore', ''),
          'created_at',     r->>'created_at'
        )
      )
      FROM (
        SELECT jsonb_array_elements(v_soci)   || jsonb_build_object('tipo','socio')  AS r
        UNION ALL
        SELECT jsonb_array_elements(v_ospiti) || jsonb_build_object('tipo','ospite') AS r
      ) sub
    )
  );
END;
$$;
