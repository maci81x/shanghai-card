-- 20260731095336_rpc_external_guests_and_catalog_state_updates
-- ricostruita da supabase_migrations.schema_migrations


-- ═══════════════════════════════════════════════════════════════
-- BLOCCO 4: iscritti esterni (event_guests) + catalog/state con taglie
-- ═══════════════════════════════════════════════════════════════

-- 4a. Admin aggiunge iscritto esterno manualmente
CREATE OR REPLACE FUNCTION public.admin_create_external_guest(
  p_operator_id uuid, p_event_id uuid,
  p_nome text, p_cognome text, p_email text, p_telefono text,
  p_amount numeric, p_payment_status text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_id uuid; v_event record; v_paid_at timestamptz := NULL;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  IF trim(COALESCE(p_nome,''))='' OR trim(COALESCE(p_cognome,''))='' THEN
    RETURN jsonb_build_object('ok',false,'error','Nome e cognome obbligatori');
  END IF;
  SELECT * INTO v_event FROM events WHERE id=p_event_id AND active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Evento non trovato'); END IF;

  IF p_payment_status IN ('saldato_credito','saldato_sumup','saldato_contanti') THEN
    v_paid_at := now();
  END IF;

  INSERT INTO event_guests(event_id, registered_by, nome, cognome, email, telefono,
                            amount, payment_status, paid_at, paid_by)
  VALUES (p_event_id, p_operator_id, trim(p_nome), trim(p_cognome),
          NULLIF(trim(COALESCE(p_email,'')),''), NULLIF(trim(COALESCE(p_telefono,'')),''),
          COALESCE(p_amount, v_event.price),
          COALESCE(NULLIF(p_payment_status,''),'da_saldare'),
          v_paid_at,
          CASE WHEN v_paid_at IS NOT NULL THEN p_operator_id ELSE NULL END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'guest_id',v_id,'message','Iscritto esterno aggiunto');
END;
$$;

-- 4b. Admin lista iscritti esterni (con filtro evento opzionale)
CREATE OR REPLACE FUNCTION public.admin_list_external_guests(
  p_operator_id uuid, p_event_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  RETURN jsonb_build_object('ok',true,'guests',(
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC),'[]'::jsonb) FROM (
      SELECT g.id, g.event_id, e.title AS event_title, e.event_date,
             g.nome, g.cognome, g.email, g.telefono,
             g.amount, g.payment_status, g.paid_at, g.checked_in,
             g.created_at
      FROM event_guests g JOIN events e ON e.id=g.event_id
      WHERE (p_event_id IS NULL OR g.event_id=p_event_id)
      ORDER BY g.created_at DESC
    ) x));
END;
$$;

-- 4c. Admin conferma pagamento iscritto esterno
CREATE OR REPLACE FUNCTION public.admin_confirm_external_guest(
  p_operator_id uuid, p_guest_id uuid, p_payment_method text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  v_status := CASE p_payment_method
    WHEN 'credito'  THEN 'saldato_credito'
    WHEN 'sumup'    THEN 'saldato_sumup'
    WHEN 'contanti' THEN 'saldato_contanti'
    ELSE 'saldato_contanti' END;
  UPDATE event_guests
     SET payment_status=v_status, paid_at=now(), paid_by=p_operator_id, paid=true
   WHERE id=p_guest_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscritto non trovato'); END IF;
  RETURN jsonb_build_object('ok',true,'message','Pagamento confermato');
END;
$$;

-- 4d. Admin aggiorna dati iscritto esterno
CREATE OR REPLACE FUNCTION public.admin_update_external_guest(
  p_operator_id uuid, p_guest_id uuid,
  p_nome text, p_cognome text, p_email text, p_telefono text, p_amount numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  UPDATE event_guests
     SET nome=trim(p_nome), cognome=trim(p_cognome),
         email=NULLIF(trim(COALESCE(p_email,'')),''),
         telefono=NULLIF(trim(COALESCE(p_telefono,'')),''),
         amount=COALESCE(p_amount,amount)
   WHERE id=p_guest_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscritto non trovato'); END IF;
  RETURN jsonb_build_object('ok',true,'message','Dati aggiornati');
END;
$$;

-- 4e. Admin elimina iscritto esterno
CREATE OR REPLACE FUNCTION public.admin_delete_external_guest(
  p_operator_id uuid, p_guest_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND role='admin') THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato (solo admin)');
  END IF;
  DELETE FROM event_guests WHERE id=p_guest_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Iscritto non trovato'); END IF;
  RETURN jsonb_build_object('ok',true,'message','Iscritto eliminato');
END;
$$;

-- 4f. get_catalog: include taglie
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  RETURN json_build_object(
    'events', (
      SELECT coalesce(json_agg(row_to_json(e)),'[]'::json)
      FROM (SELECT id,title,description,event_date,location,max_participants,price,active,sumup_link,slug,image_url
            FROM public.events WHERE active=true AND visible=true ORDER BY event_date) e
    ),
    'gadgets', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT g.id, g.name, g.description, g.price, g.stock, g.image_url, g.active, g.has_sizes,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('size',s.size,'stock',s.stock)
                                  ORDER BY s.sort_order, s.size)
                 FROM public.gadget_sizes s WHERE s.gadget_id=g.id
               ), '[]'::jsonb) AS sizes
        FROM public.gadgets g
        WHERE g.active=true
          AND (
            g.has_sizes = true  -- se ha taglie mostralo sempre (waitlist gestita)
            OR g.stock > 0      -- se non ha taglie serve stock > 0
          )
        ORDER BY g.name
      ) g
    ),
    'promos', (
      SELECT coalesce(json_agg(row_to_json(p)),'[]'::json)
      FROM (SELECT id,code,description,discount_type,discount_value,valid_from,valid_until,image_url
            FROM public.promos WHERE active=true AND (valid_until IS NULL OR valid_until>now())
            ORDER BY valid_from) p
    ),
    'sumup_links', (
      SELECT coalesce(json_agg(row_to_json(s)),'[]'::json)
      FROM (SELECT id,label,amount,url,sort_order FROM public.sumup_links WHERE active=true
            ORDER BY sort_order, amount NULLS LAST) s
    )
  );
END;
$$;

-- 4g. get_user_state: include size + payment_method + payment_amount nelle prenotazioni gadget
CREATE OR REPLACE FUNCTION public.get_user_state(p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
declare u public.users; tx_result json; ev_result json; gd_result json;
begin
  select * into u from public.users where id = p_user_id;
  if u.id is null then return json_build_object('error','not_found'); end if;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into tx_result
  from (select tx.id, tx.type, tx.amount, tx.balance_after, tx.description,
               tx.created_at, tx.category, tx.payment_method,
               op.display_name as operator_name
        from public.transactions tx
        left join public.users op on op.id = tx.operator_id
        where tx.user_id = u.id
        order by tx.created_at desc limit 30) t;

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into ev_result
  from (
    select er.id as registration_id, er.event_id, er.status, er.payment_status,
           er.amount, er.party_size, er.checked_in,
           e.title as event_title, e.event_date, e.price as event_price,
           e.sumup_link as event_sumup_link,
           coalesce((
             select json_agg(json_build_object(
                      'id', ec.id,'nome', ec.nome,'cognome', ec.cognome,
                      'payment_status', ec.payment_status,
                      'payment_method', ec.payment_method,
                      'checked_in', ec.checked_in
                    ) order by ec.created_at)
             from public.event_companions ec
             where ec.registration_id = er.id
           ), '[]'::json) as companions,
           (case when er.payment_status = 'da_saldare' then 1 else 0 end)
           + coalesce((select count(*) from public.event_companions ec2
                       where ec2.registration_id = er.id and ec2.payment_status='da_saldare'), 0) as unpaid_count,
           (case when er.payment_status = 'sumup_in_attesa' then 1 else 0 end)
           + coalesce((select count(*) from public.event_companions ec3
                       where ec3.registration_id = er.id and ec3.payment_status='sumup_in_attesa'), 0) as sumup_pending_count
    from public.event_registrations er
    join public.events e on e.id = er.event_id
    where er.user_id = u.id and er.status = 'confirmed'
    order by e.event_date desc
  ) r;

  select coalesce(json_agg(row_to_json(g)), '[]'::json) into gd_result
  from (
    select gr.id, gr.gadget_id, gr.quantity, gr.size, gr.status, gr.created_at,
           gr.payment_method, gr.payment_amount, gr.fulfilled_at,
           gd.name as gadget_name, gd.price as gadget_price, gd.has_sizes
    from public.gadget_reservations gr
    join public.gadgets gd on gd.id = gr.gadget_id
    where gr.user_id = u.id
    order by gr.created_at desc
  ) g;

  return json_build_object('ok', true,
    'id', u.id, 'card_id', u.card_id, 'display_name', u.display_name,
    'nome', u.nome, 'cognome', u.cognome, 'email', u.email,
    'balance', u.balance, 'is_staff', u.is_staff,
    'transactions', tx_result,
    'event_registrations', ev_result,
    'gadget_reservations', gd_result);
end $$;
