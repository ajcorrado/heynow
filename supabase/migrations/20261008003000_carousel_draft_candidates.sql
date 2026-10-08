-- Let editors assemble carousel drafts before data review is complete.
-- Ready/posted transitions continue to require every selected event to be approved.

create or replace function private.carousel_event_snapshot(target_event_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'captured_at', now(), 'event_id', e.id, 'title', e.title,
    'start_at', e.start_at, 'end_at', e.end_at, 'timezone', e.timezone,
    'is_all_day', e.is_all_day, 'venue', v.name, 'locality', v.locality,
    'city', c.name, 'state_region', c.state_region, 'is_free', e.is_free,
    'price_min_cents', e.price_min_cents, 'price_max_cents', e.price_max_cents,
    'age_min', e.age_min, 'is_all_ages', e.is_all_ages,
    'official_url', e.official_url, 'ticket_url', e.ticket_url,
    'data_review_state', ed.data_review_state,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'url', es.source_url, 'discovered_at', es.discovered_at,
        'last_seen_at', es.last_seen_at, 'evidence', left(es.raw_text, 1000)
      ) order by es.discovered_at)
      from public.event_sources es
      join public.sources s on s.id = es.source_id
      where es.event_id = e.id
    ), '[]'::jsonb)
  )
  from public.events e
  join public.cities c on c.id = e.city_id
  left join public.venues v on v.id = e.venue_id
  left join public.event_editorial ed on ed.event_id = e.id
  where e.id = target_event_id and e.status = 'active';
$$;

drop function if exists public.list_instagram_carousel_candidates(uuid);
create function public.list_instagram_carousel_candidates(target_city_id uuid)
returns table(event_id uuid, title text, start_at timestamptz, venue text, locality text, data_review_state text)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform private.assert_publishing_admin();
  return query
  select e.id, e.title, e.start_at, v.name, coalesce(v.locality, c.name), coalesce(ed.data_review_state, 'pending')
  from public.events e
  join public.cities c on c.id = e.city_id
  left join public.venues v on v.id = e.venue_id
  left join public.event_editorial ed on ed.event_id = e.id
  where e.city_id = target_city_id
    and e.status = 'active'
    and e.start_at >= now() - interval '6 hours'
  order by e.start_at, e.title
  limit 300;
end;
$$;

create or replace function public.save_instagram_carousel(
  target_draft_id uuid,
  next_content jsonb,
  event_ids uuid[],
  expected_revision integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare current_row public.content_drafts%rowtype;
declare selected_count integer := coalesce(array_length(event_ids, 1), 0);
declare selected_id uuid;
declare selected_position integer;
declare selected_snapshot jsonb;
begin
  perform private.assert_publishing_admin();
  select * into current_row from public.content_drafts
  where id = target_draft_id and channel = 'instagram' and format = 'carousel' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Carousel not found'; end if;
  if current_row.revision <> expected_revision then raise exception using errcode = '40001', message = 'Carousel changed elsewhere; reload before saving'; end if;
  if current_row.status <> 'draft' then raise exception using errcode = '23514', message = 'Return the carousel to draft before editing'; end if;
  if jsonb_typeof(next_content) is distinct from 'object' then raise exception using errcode = '23514', message = 'Carousel content must be an object'; end if;
  if selected_count > 8 then raise exception using errcode = '23514', message = 'A carousel can contain no more than 8 events'; end if;
  if selected_count <> (select count(distinct value) from unnest(coalesce(event_ids, '{}'::uuid[])) value) then
    raise exception using errcode = '23514', message = 'A carousel cannot contain the same event twice';
  end if;
  if exists (
    select 1 from unnest(coalesce(event_ids, '{}'::uuid[])) selected(value)
    left join public.events e on e.id = selected.value
    where e.id is null or e.city_id <> current_row.city_id or e.status <> 'active'
  ) then
    raise exception using errcode = '23514', message = 'Every carousel event must be active and in the selected city';
  end if;

  delete from public.content_draft_events
  where draft_id = target_draft_id and event_id <> all(coalesce(event_ids, '{}'::uuid[]));

  for selected_id, selected_position in
    select value, ordinality::integer from unnest(coalesce(event_ids, '{}'::uuid[])) with ordinality selected(value, ordinality)
  loop
    update public.content_draft_events
      set position = selected_position, updated_at = now()
      where draft_id = target_draft_id and event_id = selected_id;
    if not found then
      selected_snapshot := private.carousel_event_snapshot(selected_id);
      if selected_snapshot is null then raise exception using errcode = '23514', message = 'An event is no longer eligible for this carousel'; end if;
      insert into public.content_draft_events (draft_id, event_id, position, content, fact_snapshot)
      values (
        target_draft_id, selected_id, selected_position,
        jsonb_build_object('headline', selected_snapshot->>'title', 'editorial_take', ''),
        selected_snapshot
      );
    end if;
  end loop;

  update public.content_drafts
  set content = next_content, revision = revision + 1, updated_at = now()
  where id = target_draft_id;
  insert into public.content_draft_changes (draft_id, actor_id, action, from_status, to_status, revision)
  values (target_draft_id, auth.uid(), 'saved', current_row.status, current_row.status, current_row.revision + 1);
  return current_row.revision + 1;
end;
$$;

revoke all on function private.carousel_event_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.list_instagram_carousel_candidates(uuid) from public, anon;
revoke all on function public.save_instagram_carousel(uuid, jsonb, uuid[], integer) from public, anon;
grant execute on function public.list_instagram_carousel_candidates(uuid) to authenticated;
grant execute on function public.save_instagram_carousel(uuid, jsonb, uuid[], integer) to authenticated;
