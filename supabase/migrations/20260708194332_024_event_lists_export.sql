-- 20260708194332_024_event_lists_export
-- ricostruita da supabase_migrations.schema_migrations


-- ── Staff: eventi da saldare per un socio ────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_list_pending_events(p_card_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
    FROM (
      SELECT er.id AS registration_id,
             ev.title AS evento,
             ev.event_date,
             er.amount,
             er.payment_status,
             er.created_at AS iscritto_il,
             u.card_id,
             u.display_name
      FROM public.event_registrations er
      JOIN public.events ev ON ev.id = er.event_id
      JOIN public.users  u  ON u.id  = er.user_id
      WHERE u.card_id = upper(trim(p_card_id))
        AND er.payment_status = 'da_saldare'
      ORDER BY ev.event_date
    ) r
  );
END; $$;

-- ── Admin: elenco iscritti a un evento ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_event_registrations(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_total INTEGER;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.event_registrations
    WHERE event_id = p_event_id AND payment_status != 'annullato';

  RETURN json_build_object(
    'total', v_total,
    'soci', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT er.id AS registration_id,
               u.card_id, u.display_name,
               er.nome, er.cognome, er.telefono,
               er.payment_status, er.amount,
               er.paid_at,
               op.display_name AS operatore,
               er.created_at
        FROM public.event_registrations er
        JOIN public.users u  ON u.id = er.user_id
        LEFT JOIN public.users op ON op.id = er.paid_by
        WHERE er.event_id = p_event_id AND er.payment_status != 'annullato'
        ORDER BY er.created_at
      ) r
    ),
    'ospiti', (
      SELECT coalesce(json_agg(row_to_json(g)), '[]'::json)
      FROM (
        SELECT eg.id, eg.nome, eg.cognome, eg.telefono, eg.email,
               eg.payment_status, eg.amount, eg.paid_at,
               op.display_name AS operatore, eg.created_at
        FROM public.event_guests eg
        LEFT JOIN public.users op ON op.id = eg.paid_by
        WHERE eg.event_id = p_event_id
        ORDER BY eg.created_at
      ) g
    )
  );
END; $$;

-- ── Admin: dati per export CSV iscritti ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_export_event_csv(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  RETURN json_build_object(
    'evento', v_event.title,
    'data_evento', v_event.event_date,
    'iscritti', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        -- Soci con card
        SELECT 'socio'           AS tipo,
               u.card_id,
               er.nome,
               er.cognome,
               er.telefono,
               u.email,
               er.amount,
               er.payment_status,
               er.paid_at,
               op.display_name  AS operatore,
               er.created_at
        FROM public.event_registrations er
        JOIN public.users u ON u.id = er.user_id
        LEFT JOIN public.users op ON op.id = er.paid_by
        WHERE er.event_id = p_event_id AND er.payment_status != 'annullato'
        UNION ALL
        -- Ospiti esterni
        SELECT 'ospite'         AS tipo,
               NULL             AS card_id,
               eg.nome, eg.cognome, eg.telefono, eg.email,
               eg.amount, eg.payment_status, eg.paid_at,
               op.display_name  AS operatore,
               eg.created_at
        FROM public.event_guests eg
        LEFT JOIN public.users op ON op.id = eg.paid_by
        WHERE eg.event_id = p_event_id
        ORDER BY created_at
      ) r
    )
  );
END; $$;

-- ── get_user_state aggiornato: include iscrizioni da saldare ─────────
CREATE OR REPLACE FUNCTION public.get_user_state(p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
        SELECT er.id AS registration_id,
               ev.title AS evento, ev.event_date,
               er.amount, er.payment_status,
               ev.sumup_link
        FROM public.event_registrations er
        JOIN public.events ev ON ev.id = er.event_id
        WHERE er.user_id = p_user_id AND er.payment_status = 'da_saldare'
        ORDER BY ev.event_date
      ) r
    )
  );
END; $$;
