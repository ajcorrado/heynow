-- Keep human-approved event facts stable while ingestion continues to refresh evidence.
alter table public.event_change_proposals
  alter column sweep_run_id drop not null,
  add column if not exists source_run_id uuid references public.source_runs(id) on delete set null;

create index if not exists event_change_proposals_source_run_idx
  on public.event_change_proposals(source_run_id);

create index if not exists event_change_proposals_pending_event_idx
  on public.event_change_proposals(event_id, created_at desc)
  where status = 'pending';

create or replace function private.guard_approved_event_facts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('heynow.allow_approved_event_update', true) = 'on' then
    return new;
  end if;

  if exists (
    select 1
    from public.event_editorial ee
    where ee.event_id = old.id
      and ee.data_review_state = 'approved'
  ) and (
    new.city_id is distinct from old.city_id or
    new.venue_id is distinct from old.venue_id or
    new.title is distinct from old.title or
    new.normalized_title is distinct from old.normalized_title or
    new.factual_description is distinct from old.factual_description or
    new.start_at is distinct from old.start_at or
    new.end_at is distinct from old.end_at or
    new.doors_at is distinct from old.doors_at or
    new.timezone is distinct from old.timezone or
    new.status is distinct from old.status or
    new.price_min_cents is distinct from old.price_min_cents or
    new.price_max_cents is distinct from old.price_max_cents or
    new.currency is distinct from old.currency or
    new.is_free is distinct from old.is_free or
    new.age_min is distinct from old.age_min or
    new.is_all_ages is distinct from old.is_all_ages or
    new.official_url is distinct from old.official_url or
    new.ticket_url is distinct from old.ticket_url or
    new.hero_image_url is distinct from old.hero_image_url or
    new.is_all_day is distinct from old.is_all_day or
    new.event_url is distinct from old.event_url
  ) then
    raise exception 'approved_event_fact_change_requires_proposal'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_approved_event_facts on public.events;
create trigger guard_approved_event_facts
before update on public.events
for each row execute function private.guard_approved_event_facts();

create or replace function private.guard_approved_venue_facts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('heynow.allow_approved_event_update', true) = 'on' then
    return new;
  end if;

  if exists (
    select 1
    from public.events e
    join public.event_editorial ee on ee.event_id = e.id
    where e.venue_id = old.id
      and ee.data_review_state = 'approved'
  ) and (
    new.name is distinct from old.name or
    new.normalized_name is distinct from old.normalized_name or
    new.address_line_1 is distinct from old.address_line_1 or
    new.address_line_2 is distinct from old.address_line_2 or
    new.postal_code is distinct from old.postal_code or
    new.latitude is distinct from old.latitude or
    new.longitude is distinct from old.longitude or
    new.locality is distinct from old.locality or
    new.region is distinct from old.region
  ) then
    raise exception 'approved_venue_fact_change_requires_proposal'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_approved_venue_facts on public.venues;
create trigger guard_approved_venue_facts
before update on public.venues
for each row execute function private.guard_approved_venue_facts();

create or replace function public.review_event_change_proposal(
  proposal_id uuid,
  review_decision text,
  review_notes text default null
)
returns public.event_change_proposals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.event_change_proposals;
  canonical public.events;
  venue public.venues;
  current_value jsonb;
  reviewer uuid := auth.uid();
  previous_guard_setting text := current_setting('heynow.allow_approved_event_update', true);
begin
  if reviewer is null or not coalesce((select private.is_admin()), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if review_decision not in ('accepted', 'rejected') then
    raise exception 'invalid_review_decision' using errcode = '22023';
  end if;

  select * into proposal
  from public.event_change_proposals
  where id = proposal_id
  for update;

  if not found then
    raise exception 'proposal_not_found' using errcode = 'P0002';
  end if;

  if proposal.status <> 'pending' then
    raise exception 'proposal_already_reviewed' using errcode = 'P0001';
  end if;

  select * into canonical
  from public.events
  where id = proposal.event_id
  for update;

  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  case proposal.field_name
    when 'title' then current_value := coalesce(to_jsonb(canonical.title), 'null'::jsonb);
    when 'factual_description' then current_value := coalesce(to_jsonb(canonical.factual_description), 'null'::jsonb);
    when 'start_at' then current_value := coalesce(to_jsonb(canonical.start_at), 'null'::jsonb);
    when 'end_at' then current_value := coalesce(to_jsonb(canonical.end_at), 'null'::jsonb);
    when 'doors_at' then current_value := coalesce(to_jsonb(canonical.doors_at), 'null'::jsonb);
    when 'timezone' then current_value := coalesce(to_jsonb(canonical.timezone), 'null'::jsonb);
    when 'status' then current_value := coalesce(to_jsonb(canonical.status), 'null'::jsonb);
    when 'price_min_cents' then current_value := coalesce(to_jsonb(canonical.price_min_cents), 'null'::jsonb);
    when 'price_max_cents' then current_value := coalesce(to_jsonb(canonical.price_max_cents), 'null'::jsonb);
    when 'currency' then current_value := coalesce(to_jsonb(canonical.currency::text), 'null'::jsonb);
    when 'is_free' then current_value := coalesce(to_jsonb(canonical.is_free), 'null'::jsonb);
    when 'age_min' then current_value := coalesce(to_jsonb(canonical.age_min), 'null'::jsonb);
    when 'is_all_ages' then current_value := coalesce(to_jsonb(canonical.is_all_ages), 'null'::jsonb);
    when 'official_url' then current_value := coalesce(to_jsonb(canonical.official_url), 'null'::jsonb);
    when 'ticket_url' then current_value := coalesce(to_jsonb(canonical.ticket_url), 'null'::jsonb);
    when 'hero_image_url' then current_value := coalesce(to_jsonb(canonical.hero_image_url), 'null'::jsonb);
    when 'is_all_day' then current_value := coalesce(to_jsonb(canonical.is_all_day), 'null'::jsonb);
    when 'event_url' then current_value := coalesce(to_jsonb(canonical.event_url), 'null'::jsonb);
    when 'venue' then
      if canonical.venue_id is null then
        current_value := jsonb_build_object(
          'venue_id', null, 'name', null, 'address_line_1', null,
          'locality', null, 'region', null, 'postal_code', null,
          'latitude', null, 'longitude', null
        );
      else
        select * into venue from public.venues where id = canonical.venue_id;
        current_value := jsonb_build_object(
          'venue_id', venue.id, 'name', venue.name,
          'address_line_1', venue.address_line_1, 'locality', venue.locality,
          'region', venue.region, 'postal_code', venue.postal_code,
          'latitude', venue.latitude, 'longitude', venue.longitude
        );
      end if;
    else
      raise exception 'unsupported_proposal_field: %', proposal.field_name
        using errcode = '22023';
  end case;

  if current_value is distinct from proposal.old_value then
    raise exception 'proposal_stale' using errcode = 'P0001';
  end if;

  if review_decision = 'accepted' then
    perform set_config('heynow.allow_approved_event_update', 'on', true);

    case proposal.field_name
      when 'title' then
        update public.events
        set title = proposal.proposed_value #>> '{}',
            normalized_title = lower(trim(regexp_replace(
              regexp_replace(normalize(proposal.proposed_value #>> '{}', NFKD), '[^A-Za-z0-9[:space:]]', ' ', 'g'),
              '[[:space:]]+', ' ', 'g'
            ))),
            updated_at = now()
        where id = proposal.event_id;
      when 'factual_description' then update public.events set factual_description = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'start_at' then update public.events set start_at = (proposal.proposed_value #>> '{}')::timestamptz, updated_at = now() where id = proposal.event_id;
      when 'end_at' then update public.events set end_at = (proposal.proposed_value #>> '{}')::timestamptz, updated_at = now() where id = proposal.event_id;
      when 'doors_at' then update public.events set doors_at = (proposal.proposed_value #>> '{}')::timestamptz, updated_at = now() where id = proposal.event_id;
      when 'timezone' then update public.events set timezone = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'status' then update public.events set status = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'price_min_cents' then update public.events set price_min_cents = (proposal.proposed_value #>> '{}')::integer, updated_at = now() where id = proposal.event_id;
      when 'price_max_cents' then update public.events set price_max_cents = (proposal.proposed_value #>> '{}')::integer, updated_at = now() where id = proposal.event_id;
      when 'currency' then update public.events set currency = (proposal.proposed_value #>> '{}')::character(3), updated_at = now() where id = proposal.event_id;
      when 'is_free' then update public.events set is_free = (proposal.proposed_value #>> '{}')::boolean, updated_at = now() where id = proposal.event_id;
      when 'age_min' then update public.events set age_min = (proposal.proposed_value #>> '{}')::integer, updated_at = now() where id = proposal.event_id;
      when 'is_all_ages' then update public.events set is_all_ages = (proposal.proposed_value #>> '{}')::boolean, updated_at = now() where id = proposal.event_id;
      when 'official_url' then update public.events set official_url = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'ticket_url' then update public.events set ticket_url = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'hero_image_url' then update public.events set hero_image_url = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'is_all_day' then update public.events set is_all_day = (proposal.proposed_value #>> '{}')::boolean, updated_at = now() where id = proposal.event_id;
      when 'event_url' then update public.events set event_url = proposal.proposed_value #>> '{}', updated_at = now() where id = proposal.event_id;
      when 'venue' then update public.events set venue_id = nullif(proposal.proposed_value ->> 'venue_id', '')::uuid, updated_at = now() where id = proposal.event_id;
    end case;

    perform set_config('heynow.allow_approved_event_update', coalesce(previous_guard_setting, ''), true);
  end if;

  update public.event_change_proposals
  set status = review_decision,
      reviewed_by = reviewer,
      reviewed_at = now()
  where id = proposal.id
  returning * into proposal;

  insert into public.editorial_reviews (
    event_id, reviewer_id, review_stage, decision,
    previous_values, new_values, notes
  ) values (
    proposal.event_id, reviewer, 'data',
    case when review_decision = 'accepted' then 'change_accepted' else 'change_rejected' end,
    jsonb_build_object(proposal.field_name, proposal.old_value),
    jsonb_build_object(proposal.field_name, proposal.proposed_value),
    nullif(trim(review_notes), '')
  );

  return proposal;
end;
$$;

revoke all on function public.review_event_change_proposal(uuid, text, text) from public;
revoke all on function public.review_event_change_proposal(uuid, text, text) from anon;
grant execute on function public.review_event_change_proposal(uuid, text, text) to authenticated;

comment on function public.review_event_change_proposal(uuid, text, text) is
  'Atomically accepts or rejects a pending canonical event fact proposal for an authenticated HeyNow admin.';
