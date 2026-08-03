-- 20260717205049_charge_category_payment_method
-- ricostruita da supabase_migrations.schema_migrations


-- ========================================
-- Categoria spesa + metodo pagamento ricarica
-- ========================================
alter table public.transactions add column if not exists category text;
alter table public.transactions add column if not exists payment_method text;

-- Aggiorna staff_charge: aggiunge p_category
create or replace function public.staff_charge(
  p_operator_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Consumazione',
  p_category text default 'consumazione'
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare op public.users; target public.users; new_bal numeric;
begin
  select * into op from public.users where id = p_operator_id and is_staff = true;
  if op.id is null then return json_build_object('error','not_staff'); end if;
  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','user_not_found'); end if;
  if not target.active then return json_build_object('error','user_disabled'); end if;
  if target.balance < p_amount then return json_build_object('error','insufficient_balance'); end if;
  new_bal := target.balance - p_amount;
  update public.users set balance = new_bal, updated_at = now() where id = target.id;
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id, category)
  values(target.id, 'purchase', -p_amount, new_bal, p_description, p_operator_id, p_category);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

-- Aggiorna staff_recharge: aggiunge p_payment_method
create or replace function public.staff_recharge(
  p_operator_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Ricarica',
  p_payment_method text default 'contanti'
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare op public.users; target public.users; new_bal numeric;
begin
  select * into op from public.users where id = p_operator_id and is_staff = true;
  if op.id is null then return json_build_object('error','not_staff'); end if;
  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','user_not_found'); end if;
  new_bal := target.balance + p_amount;
  update public.users set balance = new_bal, updated_at = now() where id = target.id;
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id, payment_method)
  values(target.id, 'recharge', p_amount, new_bal, p_description, p_operator_id, p_payment_method);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

-- Aggiorna admin_charge: stessa cosa
create or replace function public.admin_charge(
  p_admin_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Consumazione',
  p_category text default 'consumazione'
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare target public.users; new_bal numeric;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','user_not_found'); end if;
  if not target.active then return json_build_object('error','user_disabled'); end if;
  if target.balance < p_amount then return json_build_object('error','insufficient_balance'); end if;
  new_bal := target.balance - p_amount;
  update public.users set balance = new_bal, updated_at = now() where id = target.id;
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id, category)
  values(target.id, 'purchase', -p_amount, new_bal, p_description, p_admin_id, p_category);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

-- Aggiorna admin_recharge: stessa cosa
create or replace function public.admin_recharge(
  p_admin_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Ricarica',
  p_payment_method text default 'contanti'
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare target public.users; new_bal numeric;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','user_not_found'); end if;
  new_bal := target.balance + p_amount;
  update public.users set balance = new_bal, updated_at = now() where id = target.id;
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id, payment_method)
  values(target.id, 'recharge', p_amount, new_bal, p_description, p_admin_id, p_payment_method);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

-- Aggiorna staff_lookup: restituisce TUTTO del socio (transazioni con category/payment_method, 
-- iscrizioni eventi con stato pagamento, accompagnatori)
create or replace function public.staff_lookup(p_card_id text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users; tx_result json; ev_result json;
begin
  select * into u from public.users where card_id = upper(trim(p_card_id));
  if u.id is null then return json_build_object('error','not_found'); end if;
  
  -- Ultime 20 transazioni
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into tx_result
  from (select id, type, amount, balance_after, description, created_at, category, payment_method
        from public.transactions where user_id = u.id
        order by created_at desc limit 20) t;
  
  -- Iscrizioni eventi attive con dettagli
  select coalesce(json_agg(row_to_json(r)), '[]'::json) into ev_result
  from (
    select er.id as registration_id, er.status, er.payment_status, er.amount,
           er.party_size, er.party_notes, er.checked_in,
           e.title as event_title, e.event_date, e.price as event_price,
           (select coalesce(json_agg(json_build_object(
             'id', c.id, 'nome', c.nome, 'cognome', c.cognome,
             'checked_in', c.checked_in, 'payment_status', c.payment_status
           )), '[]'::json) from public.event_companions c where c.registration_id = er.id) as companions
    from public.event_registrations er
    join public.events e on e.id = er.event_id
    where er.user_id = u.id and er.status = 'confirmed'
    order by e.event_date desc
  ) r;
  
  return json_build_object('ok', true, 
    'id', u.id, 'card_id', u.card_id, 'display_name', u.display_name,
    'nome', u.nome, 'cognome', u.cognome, 'email', u.email, 'telefono', u.telefono,
    'balance', u.balance, 'active', u.active, 'is_staff', u.is_staff,
    'transactions', tx_result,
    'event_registrations', ev_result);
end $$;
