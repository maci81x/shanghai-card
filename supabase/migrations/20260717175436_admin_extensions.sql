-- 20260717175436_admin_extensions
-- ricostruita da supabase_migrations.schema_migrations


-- ========================================
-- A. Aggiungi image_url a events e promos
-- ========================================
alter table public.events add column if not exists image_url text;
alter table public.promos add column if not exists image_url text;

-- ========================================
-- B. Sistema RLS sulle tabelle esposte
-- ========================================
alter table public.event_companions enable row level security;
alter table public.gadget_reservations enable row level security;

-- ========================================
-- C. RPC admin: users (update + delete)
-- ========================================
create or replace function public.admin_update_user(
  p_admin_id uuid, p_user_id uuid,
  p_display_name text default null,
  p_nome text default null, p_cognome text default null,
  p_email text default null, p_telefono text default null,
  p_role text default null, p_active boolean default null
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u_updated public.users;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  update public.users set
    display_name = coalesce(p_display_name, display_name),
    nome         = coalesce(p_nome, nome),
    cognome      = coalesce(p_cognome, cognome),
    email        = coalesce(p_email, email),
    telefono     = coalesce(p_telefono, telefono),
    role         = coalesce(p_role, role),
    active       = coalesce(p_active, active),
    updated_at   = now()
  where id = p_user_id
  returning * into u_updated;
  if not found then return json_build_object('error','not_found'); end if;
  return json_build_object('ok', true, 'id', u_updated.id);
end $$;

create or replace function public.admin_delete_user(p_admin_id uuid, p_user_id uuid)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users; tx_count int; reg_count int;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  select * into u from public.users where id = p_user_id;
  if u.id is null then return json_build_object('error','not_found'); end if;
  if u.role = 'admin' then return json_build_object('error','cannot_delete_admin'); end if;
  select count(*) into tx_count from public.transactions where user_id = p_user_id;
  if tx_count > 0 then
    return json_build_object('error','has_transactions','count',tx_count,
      'hint','disattiva l''utente invece di eliminarlo');
  end if;
  update public.transactions set operator_id = null where operator_id = p_user_id;
  select count(*) into reg_count from public.event_registrations where user_id = p_user_id;
  if reg_count > 0 then
    return json_build_object('error','has_event_registrations','count',reg_count);
  end if;
  delete from public.users where id = p_user_id;
  return json_build_object('ok', true);
end $$;

-- ========================================
-- D. RPC admin: events (update)
-- ========================================
create or replace function public.admin_update_event(
  p_admin_id uuid, p_event_id uuid,
  p_title text default null, p_description text default null,
  p_event_date timestamptz default null, p_location text default null,
  p_max_participants int default null, p_price numeric default null,
  p_sumup_link text default null, p_slug text default null,
  p_public_registration boolean default null,
  p_visible boolean default null, p_image_url text default null
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare e_updated public.events;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  update public.events set
    title              = coalesce(p_title, title),
    description        = coalesce(p_description, description),
    event_date         = coalesce(p_event_date, event_date),
    location           = coalesce(p_location, location),
    max_participants   = coalesce(p_max_participants, max_participants),
    price              = coalesce(p_price, price),
    sumup_link         = coalesce(p_sumup_link, sumup_link),
    slug               = coalesce(p_slug, slug),
    public_registration= coalesce(p_public_registration, public_registration),
    visible            = coalesce(p_visible, visible),
    image_url          = coalesce(p_image_url, image_url)
  where id = p_event_id
  returning * into e_updated;
  if not found then return json_build_object('error','not_found'); end if;
  return json_build_object('ok', true, 'id', e_updated.id);
end $$;

-- ========================================
-- E. RPC admin: transazioni (storno + modifica descrizione)
-- ========================================
create or replace function public.admin_void_transaction(
  p_admin_id uuid, p_transaction_id uuid, p_reason text default 'Storno admin'
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare t public.transactions; u public.users; new_balance numeric;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  select * into t from public.transactions where id = p_transaction_id;
  if t.id is null then return json_build_object('error','not_found'); end if;
  if t.type = 'refund' then
    return json_build_object('error','already_refund');
  end if;
  select * into u from public.users where id = t.user_id;
  new_balance := u.balance - t.amount;
  update public.users set balance = new_balance, updated_at = now()
    where id = t.user_id;
  insert into public.transactions(user_id, type, amount, balance_after,
    description, ref_id, operator_id)
    values(t.user_id, 'refund', -t.amount, new_balance,
      'STORNO: ' || coalesce(p_reason, 'Storno admin'), t.id, p_admin_id);
  return json_build_object('ok', true, 'new_balance', new_balance);
end $$;

create or replace function public.admin_update_transaction_description(
  p_admin_id uuid, p_transaction_id uuid, p_description text
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error','not_admin');
  end if;
  update public.transactions set description = p_description
    where id = p_transaction_id;
  if not found then return json_build_object('error','not_found'); end if;
  return json_build_object('ok', true);
end $$;

-- ========================================
-- F. Notifiche eventi (popup)
-- ========================================
create table if not exists public.event_views (
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(user_id, event_id)
);
alter table public.event_views enable row level security;

create or replace function public.user_unseen_events(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users; result json;
begin
  select * into u from public.users where id = p_user_id;
  if u.id is null then return json_build_object('error','not_found'); end if;
  select coalesce(json_agg(row_to_json(x)), '[]'::json) into result from (
    select e.id, e.title, e.description, e.event_date, e.location,
           e.price, e.image_url, e.slug
    from public.events e
    where e.visible = true and e.active = true
      and e.created_at > coalesce(u.registered_at, u.created_at)
      and not exists (
        select 1 from public.event_views v
        where v.user_id = p_user_id and v.event_id = e.id
      )
    order by e.created_at desc
    limit 3
  ) x;
  return result;
end $$;

create or replace function public.user_mark_event_seen(p_user_id uuid, p_event_id uuid)
returns json language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.event_views(user_id, event_id) values(p_user_id, p_event_id)
    on conflict do nothing;
  return json_build_object('ok', true);
end $$;

-- ========================================
-- G. Bucket Storage per immagini
-- ========================================
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

create policy "Allow public read images" on storage.objects
  for select using (bucket_id = 'images');

create policy "Allow anon upload images" on storage.objects
  for insert with check (bucket_id = 'images');

create policy "Allow anon update images" on storage.objects
  for update using (bucket_id = 'images');

create policy "Allow anon delete images" on storage.objects
  for delete using (bucket_id = 'images');
