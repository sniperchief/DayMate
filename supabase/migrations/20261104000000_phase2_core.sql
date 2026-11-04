-- DayMate Phase 2 — core schema, RLS and photo storage.
-- Apply once in the Supabase SQL editor (or `supabase db push`).
--
-- Access model: every row carries caregiver_id (= auth.uid() of the owner).
-- Composite foreign keys make it impossible to attach a row to another
-- caregiver's elder, or to link a memory to another elder's family member.
-- RLS limits every authenticated caregiver to their own rows.

create extension if not exists pgcrypto;

-- ── helpers ────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── caregivers (1:1 with auth.users) ──────────────────────────────────────
create table public.caregivers (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_caregiver()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.caregivers (id, display_name)
  values (new.id, left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 80))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_caregiver();

-- ── elders (one per caregiver in this MVP) ────────────────────────────────
create table public.elders (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 1 and 120),
  photo_path text check (char_length(photo_path) <= 300),
  date_of_birth date check (date_of_birth between date '1900-01-01' and current_date),
  description text not null default '' check (char_length(description) <= 1000),
  notes text not null default '' check (char_length(notes) <= 2000),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint elders_one_per_caregiver unique (caregiver_id),
  constraint elders_id_caregiver_key unique (id, caregiver_id)
);
create trigger elders_updated_at before update on public.elders
  for each row execute function public.set_updated_at();

-- ── family members ────────────────────────────────────────────────────────
create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null default auth.uid(),
  elder_id uuid not null,
  full_name text not null check (char_length(trim(full_name)) between 1 and 120),
  relationship text not null check (char_length(trim(relationship)) between 1 and 40),
  description text not null default '' check (char_length(description) <= 1000),
  photo_path text check (char_length(photo_path) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_members_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade,
  constraint family_members_id_elder_key unique (id, elder_id)
);
create index family_members_elder_idx on public.family_members (elder_id);
create trigger family_members_updated_at before update on public.family_members
  for each row execute function public.set_updated_at();

-- ── routines & planned activities ─────────────────────────────────────────
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null default auth.uid(),
  elder_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  recurrence text not null check (recurrence in ('none', 'daily', 'weekly')),
  activity_date date,          -- required for one-time ('none')
  weekday smallint check (weekday between 0 and 6), -- 0 = Sunday; required for 'weekly'
  time_of_day time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routines_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade,
  constraint routines_schedule_shape check (
    (recurrence = 'none'   and activity_date is not null and weekday is null) or
    (recurrence = 'daily'  and activity_date is null     and weekday is null) or
    (recurrence = 'weekly' and activity_date is null     and weekday is not null)
  )
);
create index routines_elder_idx on public.routines (elder_id);
create trigger routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();

-- ── personal memories & events ────────────────────────────────────────────
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null default auth.uid(),
  elder_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null check (char_length(trim(description)) between 1 and 2000),
  event_date date,
  related_person_id uuid,
  category text not null check (category in
    ('family', 'visit', 'celebration', 'conversation', 'preference', 'activity', 'milestone', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memories_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade,
  -- related person must belong to the same elder
  constraint memories_related_person_fk foreign key (related_person_id, elder_id)
    references public.family_members (id, elder_id) on delete set null (related_person_id)
);
create index memories_elder_created_idx on public.memories (elder_id, created_at desc);
create trigger memories_updated_at before update on public.memories
  for each row execute function public.set_updated_at();

-- ── Walrus sync state ─────────────────────────────────────────────────────
-- One row per synced source record. Written ONLY by the server (service role)
-- after the Walrus SDK reports a result; caregivers can read but not write,
-- so a client cannot mark its own record as "stored".
create table public.walrus_records (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null,
  elder_id uuid not null,
  kind text not null check (kind in ('profile', 'family_member', 'routine', 'memory')),
  family_member_id uuid references public.family_members (id) on delete cascade,
  routine_id uuid references public.routines (id) on delete cascade,
  memory_id uuid references public.memories (id) on delete cascade,
  namespace text not null,
  content_hash text not null,
  status text not null check (status in ('pending', 'stored', 'failed')),
  job_id text,
  blob_id text,
  -- blobs this record pointed at before later edits (still on Walrus, no longer current)
  previous_blob_ids text[] not null default '{}',
  error text check (char_length(error) <= 1000),
  attempts integer not null default 0,
  stored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walrus_records_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade,
  constraint walrus_records_source_shape check (
    (kind = 'profile'       and family_member_id is null     and routine_id is null     and memory_id is null) or
    (kind = 'family_member' and family_member_id is not null and routine_id is null     and memory_id is null) or
    (kind = 'routine'       and family_member_id is null     and routine_id is not null and memory_id is null) or
    (kind = 'memory'        and family_member_id is null     and routine_id is null     and memory_id is not null)
  ),
  constraint walrus_records_stored_has_blob check (status <> 'stored' or (blob_id is not null and stored_at is not null))
);
create unique index walrus_records_profile_uq on public.walrus_records (elder_id) where kind = 'profile';
create unique index walrus_records_family_uq on public.walrus_records (family_member_id) where family_member_id is not null;
create unique index walrus_records_routine_uq on public.walrus_records (routine_id) where routine_id is not null;
create unique index walrus_records_memory_uq on public.walrus_records (memory_id) where memory_id is not null;
create index walrus_records_elder_status_idx on public.walrus_records (elder_id, status);
create trigger walrus_records_updated_at before update on public.walrus_records
  for each row execute function public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.caregivers     enable row level security;
alter table public.elders         enable row level security;
alter table public.family_members enable row level security;
alter table public.routines       enable row level security;
alter table public.memories       enable row level security;
alter table public.walrus_records enable row level security;

create policy "caregiver reads own account" on public.caregivers
  for select to authenticated using (id = (select auth.uid()));
create policy "caregiver updates own account" on public.caregivers
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Owner-only CRUD on the four content tables.
do $$
declare t text;
begin
  foreach t in array array['elders', 'family_members', 'routines', 'memories'] loop
    execute format('create policy "owner select" on public.%I for select to authenticated using (caregiver_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (caregiver_id = (select auth.uid()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (caregiver_id = (select auth.uid())) with check (caregiver_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (caregiver_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Walrus sync state: read-only for caregivers; no insert/update/delete policy.
create policy "owner select" on public.walrus_records
  for select to authenticated using (caregiver_id = (select auth.uid()));

-- Explicit table privileges (RLS above still filters rows).
-- Nothing is readable anonymously; walrus_records is read-only for caregivers.
revoke all on public.caregivers, public.elders, public.family_members, public.routines,
  public.memories, public.walrus_records from anon, authenticated;
grant select, update on public.caregivers to authenticated;
grant select, insert, update, delete on public.elders, public.family_members, public.routines,
  public.memories to authenticated;
grant select on public.walrus_records to authenticated;
grant all on public.caregivers, public.elders, public.family_members, public.routines,
  public.memories, public.walrus_records to service_role;

-- ── Photo storage (private bucket, files under "<caregiver uid>/...") ─────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "caregiver reads own photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "caregiver uploads own photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "caregiver updates own photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "caregiver deletes own photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
