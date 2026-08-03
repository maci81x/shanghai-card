-- 20260717202247_fix_event_rpcs_image_url
-- ricostruita da supabase_migrations.schema_migrations


create or replace function public.get_public_event(p_slug text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
DECLARE
  v_event public.events%ROWTYPE;
  v_registered INTEGER;
BEGIN
  SELECT * INTO v_event FROM public.events
    WHERE slug = lower(trim(p_slug)) AND active = true AND public_registration = true;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Evento non trovato');
  END IF;
  SELECT count(*) INTO v_registered FROM (
    SELECT user_id FROM public.event_registrations WHERE event_id = v_event.id AND status = 'confirmed'
    UNION ALL
    SELECT id FROM public.event_guests WHERE event_id = v_event.id
  ) sub;
  RETURN json_build_object('ok', true,
    'event', json_build_object(
      'id', v_event.id, 'title', v_event.title, 'description', v_event.description,
      'event_date', v_event.event_date, 'location', v_event.location,
      'price', v_event.price, 'max_participants', v_event.max_participants,
      'spots_left', CASE WHEN v_event.max_participants IS NOT NULL
                         THEN v_event.max_participants - v_registered ELSE NULL END,
      'sumup_link', v_event.sumup_link,
      'image_url', v_event.image_url
    ));
END;
$$;

create or replace function public.admin_list_events()
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare result json;
begin
  select coalesce(json_agg(row_to_json(x)), '[]'::json) into result from (
    select e.id, e.title, e.description, e.event_date, e.location,
           e.max_participants, e.price, e.active, e.visible, e.slug,
           e.sumup_link, e.public_registration, e.image_url, e.created_at,
           (select count(*) from public.event_registrations r 
            where r.event_id = e.id and r.status = 'confirmed') as registered_count
    from public.events e order by e.event_date desc
  ) x;
  return result;
end;
$$;
