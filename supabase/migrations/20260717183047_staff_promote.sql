-- 20260717183047_staff_promote
-- ricostruita da supabase_migrations.schema_migrations


-- Promuove un socio esistente a ruolo staff
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
  if u.role = 'staff' then return json_build_object('error','already_staff'); end if;
  update public.users set role = 'staff', updated_at = now() where id = p_user_id;
  return json_build_object('ok', true, 'card_id', u.card_id, 'display_name', u.display_name);
end $$;

-- Riporta uno staff a ruolo utente
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
  if u.role != 'staff' then return json_build_object('error','not_staff'); end if;
  update public.users set role = 'user', updated_at = now() where id = p_user_id;
  return json_build_object('ok', true, 'card_id', u.card_id, 'display_name', u.display_name);
end $$;
