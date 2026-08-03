-- 20260717190457_staff_is_additional_role
-- ricostruita da supabase_migrations.schema_migrations


-- ========================================
-- Il campo is_staff è un FLAG aggiuntivo.
-- role resta 'user' per tutti i soci.
-- is_staff=true → il socio può anche operare come staff.
-- ========================================

alter table public.users add column if not exists is_staff boolean not null default false;

-- Migra gli utenti che ora hanno role='staff': riportali a 'user' + is_staff=true
update public.users set is_staff = true, role = 'user', updated_at = now()
where role = 'staff';

-- Aggiorna admin_promote: ora setta is_staff=true, NON cambia role
create or replace function public.admin_promote_to_staff(
  p_admin_id uuid, p_user_id uuid
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  select * into u from public.users where id = p_user_id;
  if u.id is null then return json_build_object('error','not_found'); end if;
  if u.role = 'admin' then return json_build_object('error','is_admin'); end if;
  if u.is_staff = true then return json_build_object('error','already_staff'); end if;
  update public.users set is_staff = true, updated_at = now() where id = p_user_id;
  return json_build_object('ok', true, 'card_id', u.card_id, 'display_name', u.display_name);
end $$;

-- Aggiorna admin_demote: toglie is_staff, NON tocca role/tessera/saldo
create or replace function public.admin_demote_to_user(
  p_admin_id uuid, p_user_id uuid
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  select * into u from public.users where id = p_user_id;
  if u.id is null then return json_build_object('error','not_found'); end if;
  if u.is_staff = false then return json_build_object('error','not_staff'); end if;
  update public.users set is_staff = false, updated_at = now() where id = p_user_id;
  return json_build_object('ok', true, 'card_id', u.card_id, 'display_name', u.display_name);
end $$;

-- Aggiorna login_user: restituisce ANCHE is_staff nel json di risposta
-- così il frontend sa se mostrare il toggle "Modalità Staff"
create or replace function public.login_user(p_card_id text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users;
begin
  select * into u from public.users
  where card_id = upper(trim(p_card_id)) and role = 'user';
  if u.id is null then
    return json_build_object('error', 'not_found');
  end if;
  if not u.active then
    return json_build_object('error', 'disabled');
  end if;
  if u.pin_hash is null or u.pin_hash = '' then
    return json_build_object('error', 'no_pin');
  end if;
  if u.pin_hash != crypt(p_pin, u.pin_hash) then
    return json_build_object('error', 'wrong_pin');
  end if;
  return json_build_object(
    'ok', true,
    'id', u.id,
    'card_id', u.card_id,
    'display_name', u.display_name,
    'balance', u.balance,
    'is_staff', u.is_staff,
    'role', u.role
  );
end $$;

-- Aggiorna login_staff: ora controlla is_staff=true invece di role='staff'
create or replace function public.login_staff(p_card_id text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users;
begin
  select * into u from public.users
  where card_id = upper(trim(p_card_id)) and is_staff = true;
  if u.id is null then
    return json_build_object('error', 'not_found');
  end if;
  if not u.active then
    return json_build_object('error', 'disabled');
  end if;
  if u.pin_hash != crypt(p_pin, u.pin_hash) then
    return json_build_object('error', 'wrong_pin');
  end if;
  return json_build_object(
    'ok', true,
    'id', u.id,
    'card_id', u.card_id,
    'display_name', u.display_name,
    'is_staff', true
  );
end $$;

-- Aggiorna tutte le funzioni staff_* per controllare is_staff invece di role
-- (le funzioni staff accettano p_operator_id e verificano che sia staff)
create or replace function public.staff_charge(
  p_operator_id uuid, p_card_id text, p_amount numeric, 
  p_description text default 'Consumazione'
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
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id)
  values(target.id, 'purchase', -p_amount, new_bal, p_description, p_operator_id);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

create or replace function public.staff_recharge(
  p_operator_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Ricarica'
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
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id)
  values(target.id, 'recharge', p_amount, new_bal, p_description, p_operator_id);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

create or replace function public.staff_lookup(p_card_id text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users; result json;
begin
  select * into u from public.users where card_id = upper(trim(p_card_id));
  if u.id is null then return json_build_object('error','not_found'); end if;
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into result
  from (select id, type, amount, balance_after, description, created_at
        from public.transactions where user_id = u.id
        order by created_at desc limit 10) t;
  return json_build_object('ok', true, 'id', u.id, 'card_id', u.card_id,
    'display_name', u.display_name, 'balance', u.balance, 'active', u.active,
    'transactions', result);
end $$;

create or replace function public.staff_preview_charge(
  p_operator_id uuid, p_card_id text, p_amount numeric
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare op public.users; target public.users;
begin
  select * into op from public.users where id = p_operator_id and is_staff = true;
  if op.id is null then return json_build_object('error','not_staff'); end if;
  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','user_not_found'); end if;
  return json_build_object('ok', true, 'card_id', target.card_id,
    'display_name', target.display_name, 'balance', target.balance,
    'sufficient', target.balance >= p_amount);
end $$;

-- admin_list_users: aggiungi is_staff nel risultato
create or replace function public.admin_list_users()
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare result json;
begin
  select coalesce(json_agg(row_to_json(x)), '[]'::json) into result from (
    select id, card_id, display_name, nome, cognome, codice_fiscale,
           email, telefono, role, is_staff, balance, active,
           gdpr_trattamento, gdpr_privacy_letta, gdpr_comunicazioni, gdpr_immagini,
           created_at, registered_at
    from public.users order by card_id
  ) x;
  return result;
end $$;
