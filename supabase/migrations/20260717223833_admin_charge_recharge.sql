-- =====================================================================
-- Shanghai Card — admin_charge / admin_recharge (17/07/2026)
-- =====================================================================
-- Le RPC staff_charge / staff_recharge ora controllano is_staff=true.
-- L'admin ha is_staff=false: servono due varianti admin_* che
-- controllano role='admin' e fanno la stessa cosa.
-- Applica via SQL Editor Supabase.
-- =====================================================================

create or replace function public.admin_charge(
  p_admin_id uuid,
  p_card_id  text,
  p_amount   numeric,
  p_description text default null
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare target public.users; new_balance numeric; tx_id uuid;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  if p_amount is null or p_amount <= 0 then
    return json_build_object('error','invalid_amount');
  end if;

  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','not_found'); end if;
  if coalesce(target.active, true) = false then return json_build_object('error','inactive'); end if;
  if target.balance < p_amount then
    return json_build_object('error','insufficient_balance','balance',target.balance,'needed',p_amount);
  end if;

  new_balance := target.balance - p_amount;
  update public.users set balance = new_balance, updated_at = now()
    where id = target.id;

  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id)
    values (target.id, 'purchase', -p_amount, new_balance, coalesce(p_description, 'Addebito admin'), p_admin_id)
    returning id into tx_id;

  return json_build_object('ok', true, 'amount', p_amount, 'new_balance', new_balance, 'transaction_id', tx_id);
end $$;

create or replace function public.admin_recharge(
  p_admin_id uuid,
  p_card_id  text,
  p_amount   numeric,
  p_description text default null
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare target public.users; new_balance numeric; tx_id uuid;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  if p_amount is null or p_amount <= 0 then
    return json_build_object('error','invalid_amount');
  end if;

  select * into target from public.users where card_id = upper(trim(p_card_id));
  if target.id is null then return json_build_object('error','not_found'); end if;
  if coalesce(target.active, true) = false then return json_build_object('error','inactive'); end if;

  new_balance := target.balance + p_amount;
  update public.users set balance = new_balance, updated_at = now()
    where id = target.id;

  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id)
    values (target.id, 'recharge', p_amount, new_balance, coalesce(p_description, 'Ricarica admin'), p_admin_id)
    returning id into tx_id;

  return json_build_object('ok', true, 'amount', p_amount, 'new_balance', new_balance, 'transaction_id', tx_id);
end $$;
