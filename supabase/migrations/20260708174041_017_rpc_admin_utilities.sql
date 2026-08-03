-- 20260708174041_017_rpc_admin_utilities
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.admin_reset_pin(p_card_id TEXT, p_new_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF length(p_new_pin) < 4 OR length(p_new_pin) > 6 THEN
    RETURN json_build_object('ok', false, 'error', 'PIN deve essere 4-6 cifre');
  END IF;
  UPDATE public.users SET pin_hash = crypt(p_new_pin, gen_salt('bf')), updated_at = now()
    WHERE card_id = upper(trim(p_card_id));
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;
  RETURN json_build_object('ok', true, 'message', 'PIN resettato per ' || upper(trim(p_card_id)));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_event_guests(p_event_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (SELECT coalesce(json_agg(row_to_json(g)), '[]'::json)
    FROM (SELECT id, nome, cognome, email, telefono, paid, created_at
          FROM public.event_guests WHERE event_id = p_event_id
          ORDER BY created_at) g);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_export_all()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN json_build_object(
    'users', (SELECT coalesce(json_agg(row_to_json(u)), '[]'::json)
      FROM (SELECT id, card_id, display_name, nome, cognome, codice_fiscale, email, telefono,
                   role, balance, active, created_at FROM public.users ORDER BY card_id) u),
    'transactions', (SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
      FROM (SELECT t.id, t.user_id, u.card_id, u.display_name, t.type, t.amount,
                   t.balance_after, t.description, t.operator_id,
                   op.display_name AS operator_name, t.created_at
            FROM public.transactions t
            JOIN public.users u ON u.id = t.user_id
            LEFT JOIN public.users op ON op.id = t.operator_id
            ORDER BY t.created_at DESC) t),
    'event_registrations', (SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (SELECT er.id, u.card_id, u.display_name, ev.title AS event_title,
                   er.status, er.created_at
            FROM public.event_registrations er
            JOIN public.users u ON u.id = er.user_id
            JOIN public.events ev ON ev.id = er.event_id
            ORDER BY er.created_at DESC) r),
    'event_guests', (SELECT coalesce(json_agg(row_to_json(g)), '[]'::json)
      FROM (SELECT eg.id, eg.nome, eg.cognome, eg.email, eg.telefono, eg.paid,
                   ev.title AS event_title, eg.created_at
            FROM public.event_guests eg
            JOIN public.events ev ON ev.id = eg.event_id
            ORDER BY eg.created_at DESC) g)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_transaction_stats(p_days INTEGER DEFAULT 30)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (SELECT coalesce(json_agg(row_to_json(d)), '[]'::json)
    FROM (
      SELECT date_trunc('day', created_at)::date AS giorno,
             sum(CASE WHEN type = 'recharge' THEN amount ELSE 0 END) AS ricariche,
             sum(CASE WHEN type IN ('purchase','event_fee') THEN abs(amount) ELSE 0 END) AS spese,
             count(*) AS num_transazioni
      FROM public.transactions
      WHERE created_at >= current_date - (p_days || ' days')::interval
      GROUP BY date_trunc('day', created_at)::date
      ORDER BY giorno
    ) d);
END; $$;
