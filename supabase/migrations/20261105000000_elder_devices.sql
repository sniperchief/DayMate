-- DayMate redesign M1 — paired elder devices.
-- Apply after the Phase 2 and Phase 3B migrations.
--
-- elder_devices          one row per paired tablet/phone. Caregivers may READ their own
--                        devices' status columns; only the server (service role) writes.
--                        token_hash is the SHA-256 of the device's secret cookie value and is
--                        never readable by caregivers.
-- elder_pairing_codes    short-lived, single-use codes (hashed). SERVER-ONLY.

create table public.elder_devices (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null,
  elder_id uuid not null,
  name text not null default 'Elder''s device' check (char_length(trim(name)) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  voice_enabled boolean not null default false,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint elder_devices_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade
);
create index elder_devices_elder_idx on public.elder_devices (elder_id);
create trigger elder_devices_updated_at before update on public.elder_devices
  for each row execute function public.set_updated_at();

create table public.elder_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null,
  elder_id uuid not null,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  voice_enabled boolean not null default false,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint elder_pairing_codes_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade
);
create index elder_pairing_codes_elder_idx on public.elder_pairing_codes (elder_id);

-- Atomically redeem a valid code and create the device (service role only).
-- Returns the new device id, or null if the code is unknown, used or expired.
create or replace function public.redeem_pairing_code(p_code_hash text, p_token_hash text, p_name text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_code public.elder_pairing_codes; v_id uuid;
begin
  update public.elder_pairing_codes
     set used_at = now()
   where code_hash = p_code_hash and used_at is null and expires_at > now()
  returning * into v_code;
  if not found then
    return null;
  end if;
  insert into public.elder_devices (caregiver_id, elder_id, name, token_hash, voice_enabled)
  values (v_code.caregiver_id, v_code.elder_id, coalesce(nullif(trim(p_name), ''), 'Elder''s device'), p_token_hash, v_code.voice_enabled)
  returning id into v_id;
  return v_id;
end $$;

-- ── Row Level Security & privileges ──────────────────────────────────────
alter table public.elder_devices enable row level security;
alter table public.elder_pairing_codes enable row level security;

create policy "owner select" on public.elder_devices
  for select to authenticated using (caregiver_id = (select auth.uid()));
-- elder_pairing_codes: intentionally NO policies.

revoke all on public.elder_devices, public.elder_pairing_codes from anon, authenticated;
grant select (id, caregiver_id, elder_id, name, voice_enabled, paired_at, last_seen_at, revoked_at, created_at, updated_at)
  on public.elder_devices to authenticated;
grant all on public.elder_devices, public.elder_pairing_codes to service_role;

revoke all on function public.redeem_pairing_code(text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_pairing_code(text, text, text) to service_role;
