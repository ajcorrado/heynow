-- Instagram V1 carousel publishing. Additive: legacy feed_single drafts remain intact.

create table if not exists public.content_draft_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  position smallint not null check (position between 1 and 8),
  content jsonb not null default '{}'::jsonb,
  fact_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_draft_events_one_event unique (draft_id, event_id),
  constraint content_draft_events_one_position unique (draft_id, position) deferrable initially deferred
);

create index if not exists content_draft_events_draft_position_idx
  on public.content_draft_events (draft_id, position);

alter table public.content_draft_events enable row level security;

drop policy if exists content_draft_events_admin_select on public.content_draft_events;
create policy content_draft_events_admin_select
  on public.content_draft_events for select to authenticated
  using ((select private.is_admin()));

revoke all on public.content_draft_events from anon, authenticated;
grant select on public.content_draft_events to authenticated;

create or replace function private.guard_content_draft_event_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.fact_snapshot is distinct from old.fact_snapshot or new.event_id is distinct from old.event_id then
    raise exception using errcode = '23514', message = 'Carousel event snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_content_draft_event_snapshot on public.content_draft_events;
create trigger guard_content_draft_event_snapshot
  before update on public.content_draft_events
  for each row execute function private.guard_content_draft_event_snapshot();

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
  join public.event_editorial ed on ed.event_id = e.id
  where e.id = target_event_id and e.status = 'active' and ed.data_review_state = 'approved';
$$;

create or replace function public.create_instagram_carousel(target_city_id uuid, request_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare created_id uuid;
begin
  perform private.assert_publishing_admin();
  if nullif(btrim(request_id), '') is null then
    raise exception using errcode = '23514', message = 'A carousel request ID is required';
  end if;
  select id into created_id from public.content_drafts
  where idempotency_key = request_id and channel = 'instagram' and format = 'carousel';
  if created_id is not null then return created_id; end if;
  if not exists (select 1 from public.cities where id = target_city_id and active) then
    raise exception using errcode = '23514', message = 'Choose an active city';
  end if;
  insert into public.content_drafts (city_id, channel, format, content, fact_snapshot, status, idempotency_key)
  values (
    target_city_id, 'instagram', 'carousel',
    jsonb_build_object('schema_version', 2, 'title', '', 'cover_kicker', '', 'caption', '', 'instagram_handle', '@heynowelpaso'),
    jsonb_build_object('captured_at', now(), 'source', 'curated_event_collection'),
    'draft', request_id
  ) returning id into created_id;
  insert into public.content_draft_changes (draft_id, actor_id, action, to_status, revision)
  values (created_id, auth.uid(), 'created', 'draft', 1);
  return created_id;
end;
$$;

create or replace function public.list_instagram_carousel_candidates(target_city_id uuid)
returns table(event_id uuid, title text, start_at timestamptz, venue text, locality text)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform private.assert_publishing_admin();
  return query
  select e.id, e.title, e.start_at, v.name, coalesce(v.locality, c.name)
  from public.events e
  join public.cities c on c.id = e.city_id
  left join public.venues v on v.id = e.venue_id
  join public.event_editorial ed on ed.event_id = e.id
  where e.city_id = target_city_id
    and e.status = 'active'
    and ed.data_review_state = 'approved'
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
    left join public.event_editorial ed on ed.event_id = e.id
    where e.id is null or e.city_id <> current_row.city_id or e.status <> 'active' or ed.data_review_state is distinct from 'approved'
  ) then
    raise exception using errcode = '23514', message = 'Every carousel event must be active, data-approved, and in the selected city';
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

create or replace function public.transition_instagram_carousel(
  target_draft_id uuid,
  target_status text,
  transition_metadata jsonb,
  expected_revision integer,
  next_content jsonb default null,
  event_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare current_row public.content_drafts%rowtype;
declare next_url text := nullif(btrim(coalesce(transition_metadata->>'instagram_url', '')), '');
declare candidate_content jsonb;
declare item_count integer;
declare saved_revision integer;
begin
  perform private.assert_publishing_admin();
  if next_content is not null then
    saved_revision := public.save_instagram_carousel(target_draft_id, next_content, coalesce(event_ids, '{}'::uuid[]), expected_revision);
    expected_revision := saved_revision;
  end if;
  select * into current_row from public.content_drafts
  where id = target_draft_id and channel = 'instagram' and format = 'carousel' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Carousel not found'; end if;
  if current_row.revision <> expected_revision then raise exception using errcode = '40001', message = 'Carousel changed elsewhere; reload before changing status'; end if;
  if not ((current_row.status = 'draft' and target_status in ('ready','skipped'))
    or (current_row.status = 'ready' and target_status in ('draft','posted','skipped'))
    or (current_row.status = 'skipped' and target_status = 'draft')) then
    raise exception using errcode = '23514', message = 'Invalid publishing status transition';
  end if;
  candidate_content := current_row.content;
  if target_status in ('ready', 'posted') then
    if nullif(btrim(coalesce(candidate_content->>'title', '')), '') is null
      or nullif(btrim(coalesce(candidate_content->>'caption', '')), '') is null then
      raise exception using errcode = '23514', message = 'Complete the carousel title and caption before marking ready';
    end if;
    if length(candidate_content->>'title') > 90 or length(candidate_content->>'caption') > 2200 then
      raise exception using errcode = '23514', message = 'Carousel title or caption exceeds its length limit';
    end if;
    select count(*) into item_count from public.content_draft_events where draft_id = target_draft_id;
    if item_count < 3 or item_count > 8 then
      raise exception using errcode = '23514', message = 'Choose 3 to 8 events before marking ready';
    end if;
    if exists (
      select 1 from public.content_draft_events item
      left join public.events e on e.id = item.event_id
      left join public.event_editorial ed on ed.event_id = e.id
      where item.draft_id = target_draft_id
        and (e.id is null or e.status <> 'active' or ed.data_review_state is distinct from 'approved')
    ) then
      raise exception using errcode = '23514', message = 'Every linked event must still be active and data-approved';
    end if;
  end if;
  if target_status = 'posted' and (next_url is null or next_url !~ '^https://(www\.)?instagram\.com/') then
    raise exception using errcode = '23514', message = 'A valid HTTPS Instagram URL is required';
  end if;
  update public.content_drafts set
    status = target_status,
    instagram_url = case when target_status = 'posted' then next_url else instagram_url end,
    posted_at = case when target_status = 'posted' then now() else null end,
    skipped_at = case when target_status = 'skipped' then now() when target_status = 'draft' then null else skipped_at end,
    approved_by = case when target_status = 'ready' then auth.uid() when target_status = 'draft' then null else approved_by end,
    approved_at = case when target_status = 'ready' then now() when target_status = 'draft' then null else approved_at end,
    revision = revision + 1,
    updated_at = now()
  where id = target_draft_id;
  insert into public.content_draft_changes (draft_id, actor_id, action, from_status, to_status, revision)
  values (target_draft_id, auth.uid(), 'transitioned', current_row.status, target_status, current_row.revision + 1);
  return current_row.revision + 1;
end;
$$;

revoke all on function private.guard_content_draft_event_snapshot() from public, anon, authenticated;
revoke all on function private.carousel_event_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.create_instagram_carousel(uuid, text) from public, anon;
revoke all on function public.list_instagram_carousel_candidates(uuid) from public, anon;
revoke all on function public.save_instagram_carousel(uuid, jsonb, uuid[], integer) from public, anon;
revoke all on function public.transition_instagram_carousel(uuid, text, jsonb, integer, jsonb, uuid[]) from public, anon;
grant execute on function public.create_instagram_carousel(uuid, text) to authenticated;
grant execute on function public.list_instagram_carousel_candidates(uuid) to authenticated;
grant execute on function public.save_instagram_carousel(uuid, jsonb, uuid[], integer) to authenticated;
grant execute on function public.transition_instagram_carousel(uuid, text, jsonb, integer, jsonb, uuid[]) to authenticated;
