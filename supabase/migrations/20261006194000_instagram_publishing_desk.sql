-- Instagram V1 Publishing Desk. Additive only; production application is a separate gate.

alter table public.content_drafts
  add column if not exists fact_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists revision integer not null default 1,
  add column if not exists instagram_url text,
  add column if not exists posted_at timestamptz,
  add column if not exists skipped_at timestamptz,
  add column if not exists idempotency_key text;

alter table public.content_drafts
  drop constraint if exists content_drafts_status_check,
  add constraint content_drafts_status_check check (channel <> 'instagram' or status in ('draft', 'ready', 'posted', 'skipped')),
  drop constraint if exists content_drafts_revision_check,
  add constraint content_drafts_revision_check check (revision > 0),
  drop constraint if exists content_drafts_posted_fields_check,
  add constraint content_drafts_posted_fields_check check (
    channel <> 'instagram' or
    (status = 'posted' and posted_at is not null and instagram_url is not null and skipped_at is null)
    or (status = 'skipped' and posted_at is null and instagram_url is null and skipped_at is not null)
    or (status in ('draft', 'ready') and posted_at is null and instagram_url is null and skipped_at is null)
  ),
  drop constraint if exists content_drafts_instagram_url_check,
  add constraint content_drafts_instagram_url_check check (
    channel <> 'instagram' or instagram_url is null or instagram_url ~ '^https://(www\.)?instagram\.com/'
  );

create unique index if not exists content_drafts_one_event_draft_idx
  on public.content_drafts (event_id, channel, format)
  where event_id is not null and channel = 'instagram' and format = 'feed_single';

create index if not exists content_drafts_status_updated_idx
  on public.content_drafts (status, updated_at desc);

create unique index if not exists content_drafts_idempotency_idx
  on public.content_drafts (idempotency_key)
  where idempotency_key is not null and channel = 'instagram';

create table if not exists public.content_draft_changes (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.content_drafts(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created', 'saved', 'transitioned')),
  from_status text,
  to_status text,
  revision integer not null,
  changed_at timestamptz not null default now()
);

create unique index if not exists content_draft_changes_revision_idx
  on public.content_draft_changes (draft_id, revision);

alter table public.content_draft_changes enable row level security;

drop policy if exists content_draft_changes_admin_select on public.content_draft_changes;
create policy content_draft_changes_admin_select
  on public.content_draft_changes for select to authenticated
  using ((select private.is_admin()));

revoke all on public.content_drafts from anon, authenticated;
grant select on public.content_drafts to authenticated;
revoke all on public.content_draft_changes from anon, authenticated;
grant select on public.content_draft_changes to authenticated;

create or replace function private.guard_content_draft_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (old.channel = 'instagram' or new.channel = 'instagram') and new.fact_snapshot is distinct from old.fact_snapshot then
    raise exception using errcode = '23514', message = 'Fact snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_content_draft_snapshot on public.content_drafts;
create trigger guard_content_draft_snapshot
  before update on public.content_drafts
  for each row execute function private.guard_content_draft_snapshot();

create or replace function private.assert_publishing_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Publishing access requires an authorized admin';
  end if;
end;
$$;

create or replace function public.create_content_draft_from_event(target_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  created_id uuid;
  event_row record;
  snapshot jsonb;
  initial_content jsonb;
begin
  perform private.assert_publishing_admin();

  select d.id into existing_id
  from public.content_drafts d
  where d.event_id = target_event_id and d.channel = 'instagram' and d.format = 'feed_single';
  if existing_id is not null then return existing_id; end if;

  select e.*, c.id as selected_city_id, c.name as city_name, c.state_region,
         v.name as venue_name, v.locality as venue_locality,
         ed.data_review_state
  into event_row
  from public.events e
  join public.cities c on c.id = e.city_id
  left join public.venues v on v.id = e.venue_id
  left join public.event_editorial ed on ed.event_id = e.id
  where e.id = target_event_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Event not found';
  end if;
  if event_row.data_review_state is distinct from 'approved' then
    raise exception using errcode = '23514', message = 'Event facts must be data-approved before draft creation';
  end if;

  snapshot := jsonb_build_object(
    'captured_at', now(), 'event_id', event_row.id, 'title', event_row.title,
    'start_at', event_row.start_at, 'end_at', event_row.end_at,
    'timezone', event_row.timezone, 'is_all_day', event_row.is_all_day,
    'venue', event_row.venue_name, 'locality', event_row.venue_locality,
    'city', event_row.city_name, 'state_region', event_row.state_region,
    'is_free', event_row.is_free, 'price_min_cents', event_row.price_min_cents,
    'price_max_cents', event_row.price_max_cents, 'age_min', event_row.age_min,
    'is_all_ages', event_row.is_all_ages, 'official_url', event_row.official_url,
    'ticket_url', event_row.ticket_url, 'data_review_state', event_row.data_review_state,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'url', es.source_url, 'discovered_at', es.discovered_at,
        'last_seen_at', es.last_seen_at, 'evidence', left(es.raw_text, 1000)
      ) order by es.discovered_at)
      from public.event_sources es
      join public.sources s on s.id = es.source_id
      where es.event_id = event_row.id
    ), '[]'::jsonb)
  );

  initial_content := jsonb_build_object(
    'schema_version', 1, 'headline', event_row.title, 'editorial_take', '', 'caption', '',
    'display_facts', jsonb_build_object(
      'date', to_char(event_row.start_at at time zone coalesce(event_row.timezone, 'America/Denver'), 'Mon FMDD, YYYY'),
      'time', case when event_row.is_all_day then 'All day' else to_char(event_row.start_at at time zone coalesce(event_row.timezone, 'America/Denver'), 'FMHH12:MI AM') end,
      'venue', coalesce(event_row.venue_name, ''),
      'locality', coalesce(event_row.venue_locality, event_row.city_name, ''),
      'price', case
        when event_row.is_free then 'Free'
        when event_row.price_min_cents is null and event_row.price_max_cents is null then 'Price not listed'
        when event_row.price_min_cents is not null and event_row.price_max_cents is not null and event_row.price_min_cents <> event_row.price_max_cents
          then coalesce(nullif(event_row.currency, ''), 'USD') || ' ' || trim(to_char(event_row.price_min_cents / 100.0, 'FM999999990.00')) || '–' || trim(to_char(event_row.price_max_cents / 100.0, 'FM999999990.00'))
        else coalesce(nullif(event_row.currency, ''), 'USD') || ' ' || trim(to_char(coalesce(event_row.price_min_cents, event_row.price_max_cents) / 100.0, 'FM999999990.00'))
      end,
      'age', case when event_row.is_all_ages then 'All ages' when event_row.age_min is not null then event_row.age_min::text || '+' else 'Age restriction not listed' end
    )
  );

  begin
    insert into public.content_drafts (event_id, city_id, channel, format, content, fact_snapshot, status)
    values (event_row.id, event_row.selected_city_id, 'instagram', 'feed_single', initial_content, snapshot, 'draft')
    returning id into created_id;
  exception when unique_violation then
    select d.id into created_id from public.content_drafts d
    where d.event_id = target_event_id and d.channel = 'instagram' and d.format = 'feed_single';
  end;

  insert into public.content_draft_changes (draft_id, actor_id, action, to_status, revision)
  values (created_id, auth.uid(), 'created', 'draft', 1)
  on conflict do nothing;
  return created_id;
end;
$$;

create or replace function public.create_manual_content_draft(target_city_id uuid, request_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare created_id uuid;
begin
  perform private.assert_publishing_admin();
  if nullif(btrim(request_id), '') is null then
    raise exception using errcode = '23514', message = 'A manual draft request ID is required';
  end if;
  select id into created_id from public.content_drafts
  where idempotency_key = request_id and channel = 'instagram' and format = 'feed_single';
  if created_id is not null then return created_id; end if;
  if not exists (select 1 from public.cities where id = target_city_id and active) then
    raise exception using errcode = '23514', message = 'Choose an active city';
  end if;
  insert into public.content_drafts (city_id, channel, format, content, fact_snapshot, status, idempotency_key)
  values (
    target_city_id, 'instagram', 'feed_single',
    jsonb_build_object('schema_version', 1, 'headline', '', 'editorial_take', '', 'caption', '',
      'display_facts', jsonb_build_object('date', '', 'time', 'Time TBA', 'venue', '', 'locality', '', 'price', 'Price not listed', 'age', 'Age restriction not listed')),
    jsonb_build_object('captured_at', now(), 'source', 'manual', 'warning', 'Manual draft: facts require editorial verification'),
    'draft', request_id
  ) returning id into created_id;
  insert into public.content_draft_changes (draft_id, actor_id, action, to_status, revision)
  values (created_id, auth.uid(), 'created', 'draft', 1);
  return created_id;
end;
$$;

create or replace function public.save_content_draft(target_draft_id uuid, next_content jsonb, expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare current_row public.content_drafts%rowtype;
begin
  perform private.assert_publishing_admin();
  select * into current_row from public.content_drafts
  where id = target_draft_id and channel = 'instagram' and format = 'feed_single' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Draft not found'; end if;
  if current_row.revision <> expected_revision then raise exception using errcode = '40001', message = 'Draft changed elsewhere; reload before saving'; end if;
  if current_row.status <> 'draft' then raise exception using errcode = '23514', message = 'Return the item to draft before editing'; end if;
  if jsonb_typeof(next_content) is distinct from 'object' then raise exception using errcode = '23514', message = 'Draft content must be an object'; end if;
  update public.content_drafts set content = next_content, revision = revision + 1, updated_at = now() where id = target_draft_id;
  insert into public.content_draft_changes (draft_id, actor_id, action, from_status, to_status, revision)
  values (target_draft_id, auth.uid(), 'saved', current_row.status, current_row.status, current_row.revision + 1);
  return current_row.revision + 1;
end;
$$;

create or replace function public.transition_content_draft(target_draft_id uuid, target_status text, transition_metadata jsonb, expected_revision integer, next_content jsonb default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare current_row public.content_drafts%rowtype;
declare next_url text := nullif(btrim(coalesce(transition_metadata->>'instagram_url', '')), '');
declare missing_ready_field boolean;
declare candidate_content jsonb;
begin
  perform private.assert_publishing_admin();
  select * into current_row from public.content_drafts
  where id = target_draft_id and channel = 'instagram' and format = 'feed_single' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Draft not found'; end if;
  if current_row.revision <> expected_revision then raise exception using errcode = '40001', message = 'Draft changed elsewhere; reload before changing status'; end if;
  if not ((current_row.status = 'draft' and target_status in ('ready','skipped'))
    or (current_row.status = 'ready' and target_status in ('draft','posted','skipped'))
    or (current_row.status = 'skipped' and target_status = 'draft')) then
    raise exception using errcode = '23514', message = 'Invalid publishing status transition';
  end if;
  if next_content is not null and current_row.status <> 'draft' then
    raise exception using errcode = '23514', message = 'Return the item to draft before editing';
  end if;
  if next_content is not null and jsonb_typeof(next_content) is distinct from 'object' then
    raise exception using errcode = '23514', message = 'Draft content must be an object';
  end if;
  candidate_content := coalesce(next_content, current_row.content);
  if target_status in ('ready', 'posted') then
    missing_ready_field := exists (
      select 1 from unnest(array['headline','editorial_take','caption']) key where nullif(btrim(coalesce(candidate_content->>key, '')), '') is null
    ) or exists (
      select 1 from unnest(array['date','venue','locality']) key where nullif(btrim(coalesce(candidate_content->'display_facts'->>key, '')), '') is null
    );
    if missing_ready_field then raise exception using errcode = '23514', message = 'Complete headline, take, caption, date, venue, and locality before marking ready'; end if;
    if length(candidate_content->>'headline') > 90 or length(candidate_content->>'editorial_take') > 500 or length(candidate_content->>'caption') > 2200 then
      raise exception using errcode = '23514', message = 'One or more editorial fields exceeds its length limit';
    end if;
  end if;
  if target_status in ('ready', 'posted') and current_row.event_id is not null and not exists (
    select 1 from public.events e
    join public.event_editorial ed on ed.event_id = e.id
    where e.id = current_row.event_id and e.status = 'active' and ed.data_review_state = 'approved'
  ) then
    raise exception using errcode = '23514', message = 'Linked event must still be active and data-approved';
  end if;
  if target_status = 'posted' and (next_url is null or next_url !~ '^https://(www\.)?instagram\.com/') then
    raise exception using errcode = '23514', message = 'A valid HTTPS Instagram URL is required';
  end if;
  update public.content_drafts set
    content = candidate_content,
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

revoke all on function private.guard_content_draft_snapshot() from public, anon, authenticated;
revoke all on function private.assert_publishing_admin() from public, anon, authenticated;
revoke all on function public.create_content_draft_from_event(uuid) from public, anon;
revoke all on function public.create_manual_content_draft(uuid, text) from public, anon;
revoke all on function public.save_content_draft(uuid, jsonb, integer) from public, anon;
revoke all on function public.transition_content_draft(uuid, text, jsonb, integer, jsonb) from public, anon;
grant execute on function public.create_content_draft_from_event(uuid) to authenticated;
grant execute on function public.create_manual_content_draft(uuid, text) to authenticated;
grant execute on function public.save_content_draft(uuid, jsonb, integer) to authenticated;
grant execute on function public.transition_content_draft(uuid, text, jsonb, integer, jsonb) to authenticated;
