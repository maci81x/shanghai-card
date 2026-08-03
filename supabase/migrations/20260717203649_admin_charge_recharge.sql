-- 20260717203649_admin_charge_recharge
-- ricostruita da supabase_migrations.schema_migrations


create or replace function public.admin_charge(
  p_admin_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Consumazione'
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
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id)
  values(target.id, 'purchase', -p_amount, new_bal, p_description, p_admin_id);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;

create or replace function public.admin_recharge(
  p_admin_id uuid, p_card_id text, p_amount numeric,
  p_description text default 'Ricarica'
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
  insert into public.transactions(user_id, type, amount, balance_after, description, operator_id)
  values(target.id, 'recharge', p_amount, new_bal, p_description, p_admin_id);
  return json_build_object('ok', true, 'new_balance', new_bal);
end $$;
