-- 20260718173430_user_transfer_credit
-- ricostruita da supabase_migrations.schema_migrations


-- Trasferimento credito tra soci
-- Il socio mittente si autentica con card_id + pin
-- Il destinatario è identificato dal suo card_id
-- Atomico: debit + credit + 2 tx (categoria 'trasferimento')

create or replace function public.user_transfer_credit(
  p_sender_card text,
  p_sender_pin text,
  p_recipient_card text,
  p_amount numeric,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sender users%rowtype;
  v_recipient users%rowtype;
  v_new_sender_balance numeric;
  v_new_recipient_balance numeric;
  v_desc_out text;
  v_desc_in text;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Importo non valido');
  end if;

  -- Autentica mittente
  select * into v_sender from users
    where upper(card_id) = upper(trim(p_sender_card))
      and active = true
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Tessera mittente non trovata');
  end if;
  if v_sender.pin_hash is null
     or v_sender.pin_hash <> crypt(p_sender_pin, v_sender.pin_hash) then
    return jsonb_build_object('ok', false, 'error', 'PIN errato');
  end if;

  -- Trova destinatario
  select * into v_recipient from users
    where upper(card_id) = upper(trim(p_recipient_card))
      and active = true
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Tessera destinatario non trovata');
  end if;

  if v_recipient.id = v_sender.id then
    return jsonb_build_object('ok', false, 'error', 'Non puoi trasferire credito a te stesso');
  end if;

  if v_sender.balance < p_amount then
    return jsonb_build_object('ok', false, 'error', 'Credito insufficiente');
  end if;

  -- Aggiorna saldi
  update users set balance = balance - p_amount
    where id = v_sender.id
    returning balance into v_new_sender_balance;

  update users set balance = balance + p_amount
    where id = v_recipient.id
    returning balance into v_new_recipient_balance;

  v_desc_out := 'Trasferimento a ' || v_recipient.nome || ' ' || coalesce(v_recipient.cognome,'')
                || ' (' || v_recipient.card_id || ')'
                || case when p_note is not null and length(trim(p_note))>0
                        then ' — ' || trim(p_note) else '' end;
  v_desc_in  := 'Trasferimento da ' || v_sender.nome || ' ' || coalesce(v_sender.cognome,'')
                || ' (' || v_sender.card_id || ')'
                || case when p_note is not null and length(trim(p_note))>0
                        then ' — ' || trim(p_note) else '' end;

  -- Movimento uscita (mittente)
  insert into transactions
    (user_id, type, amount, balance_after, description, operator_id, category)
  values
    (v_sender.id, 'transfer_out', -p_amount, v_new_sender_balance,
     v_desc_out, v_recipient.id, 'trasferimento');

  -- Movimento entrata (destinatario)
  insert into transactions
    (user_id, type, amount, balance_after, description, operator_id, category)
  values
    (v_recipient.id, 'transfer_in', p_amount, v_new_recipient_balance,
     v_desc_in, v_sender.id, 'trasferimento');

  return jsonb_build_object(
    'ok', true,
    'new_balance', v_new_sender_balance,
    'recipient_name', v_recipient.nome || ' ' || coalesce(v_recipient.cognome,''),
    'recipient_card', v_recipient.card_id,
    'amount', p_amount
  );
end;
$$;

grant execute on function public.user_transfer_credit(text, text, text, numeric, text) to anon, authenticated;

-- Lookup destinatario per anteprima (senza credenziali sensibili)
create or replace function public.user_search_recipient(
  p_query text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_results jsonb;
begin
  if p_query is null or length(trim(p_query)) < 2 then
    return jsonb_build_object('ok', true, 'results', '[]'::jsonb);
  end if;

  select jsonb_agg(jsonb_build_object(
      'card_id', card_id,
      'nome', nome,
      'cognome', cognome
    ))
    into v_results
  from (
    select card_id, nome, cognome
    from users
    where active = true
      and role = 'user'
      and (
        upper(card_id) = upper(trim(p_query))
        or unaccent(lower(nome || ' ' || coalesce(cognome,''))) like unaccent(lower('%' || trim(p_query) || '%'))
      )
    order by nome, cognome
    limit 10
  ) t;

  return jsonb_build_object('ok', true, 'results', coalesce(v_results, '[]'::jsonb));
end;
$$;

grant execute on function public.user_search_recipient(text) to anon, authenticated;
