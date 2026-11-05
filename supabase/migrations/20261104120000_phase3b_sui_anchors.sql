-- DayMate Phase 3B — Sui Mainnet anchoring of memory commitments.
-- Apply after 20261104000000_phase2_core.sql.
--
-- memory_anchors         one row per anchored memory version (memory + Walrus blob).
--                        Caregivers may READ their own rows (status, digest); only the
--                        server (service role) writes them.
--                        The signed transaction (tx_bytes, tx_signature) and the lease
--                        are stored here too, but are NOT in the caregiver column grant.
-- memory_anchor_secrets  salt, canonical payload and commitment.
--                        SERVER-ONLY: RLS on, no policies, no grants to anon/authenticated.
--
-- Deleting a memory deletes its anchor rows and salts. The on-chain event is
-- immutable and remains; without the salt it can no longer be linked to the memory.

create table public.memory_anchors (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null,
  elder_id uuid not null,
  memory_id uuid not null references public.memories (id) on delete cascade,
  version integer not null check (version >= 1),
  walrus_blob_id text not null check (char_length(walrus_blob_id) between 1 and 128),
  schema_version smallint not null check (schema_version >= 1),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'verified', 'failed')),
  tx_digest text check (char_length(tx_digest) between 32 and 64),
  -- signed transaction, saved with its digest in ONE row update before submission (server-only columns)
  tx_bytes text,
  tx_signature text,
  submitted_at timestamptz,
  verified_at timestamptz,
  verification_provider text check (char_length(verification_provider) <= 40),
  error text check (char_length(error) <= 500),
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_anchors_elder_fk foreign key (elder_id, caregiver_id)
    references public.elders (id, caregiver_id) on delete cascade,
  -- idempotency: one anchor per memory version, one version number per memory
  constraint memory_anchors_blob_uq unique (memory_id, walrus_blob_id),
  constraint memory_anchors_version_uq unique (memory_id, version),
  constraint memory_anchors_verified_shape check (
    status <> 'verified' or (tx_digest is not null and verified_at is not null and verification_provider is not null)
  ),
  constraint memory_anchors_submitted_shape check (status <> 'submitted' or tx_digest is not null)
);
create unique index memory_anchors_digest_uq on public.memory_anchors (tx_digest) where tx_digest is not null;
create index memory_anchors_elder_idx on public.memory_anchors (elder_id);
create trigger memory_anchors_updated_at before update on public.memory_anchors
  for each row execute function public.set_updated_at();

create table public.memory_anchor_secrets (
  anchor_id uuid primary key references public.memory_anchors (id) on delete cascade,
  commitment text not null unique check (commitment ~ '^[0-9a-f]{64}$'),
  salt text not null check (salt ~ '^[0-9a-f]{64}$'),
  canonical_payload text not null check (char_length(canonical_payload) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger memory_anchor_secrets_updated_at before update on public.memory_anchor_secrets
  for each row execute function public.set_updated_at();

-- Atomic insert of an anchor and its secret (service role only).
create or replace function public.create_memory_anchor(
  p_caregiver_id uuid, p_elder_id uuid, p_memory_id uuid, p_version integer,
  p_walrus_blob_id text, p_schema_version smallint,
  p_commitment text, p_salt text, p_canonical_payload text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  -- the memory must belong to this caregiver and elder
  if not exists (select 1 from public.memories m
                 where m.id = p_memory_id and m.caregiver_id = p_caregiver_id and m.elder_id = p_elder_id) then
    raise exception 'memory not found for caregiver' using errcode = 'P0002';
  end if;
  insert into public.memory_anchors (caregiver_id, elder_id, memory_id, version, walrus_blob_id, schema_version)
  values (p_caregiver_id, p_elder_id, p_memory_id, p_version, p_walrus_blob_id, p_schema_version)
  returning id into v_id;
  insert into public.memory_anchor_secrets (anchor_id, commitment, salt, canonical_payload)
  values (v_id, p_commitment, p_salt, p_canonical_payload);
  return v_id;
end $$;

-- ── Row Level Security & privileges ──────────────────────────────────────
alter table public.memory_anchors enable row level security;
alter table public.memory_anchor_secrets enable row level security;

create policy "owner select" on public.memory_anchors
  for select to authenticated using (caregiver_id = (select auth.uid()));
-- memory_anchor_secrets: intentionally NO policies.

revoke all on public.memory_anchors, public.memory_anchor_secrets from anon, authenticated;
-- caregivers read status columns only (tx_bytes, tx_signature, locked_until are internal)
grant select (id, caregiver_id, elder_id, memory_id, version, walrus_blob_id, schema_version, status,
  tx_digest, submitted_at, verified_at, verification_provider, error, attempts, created_at, updated_at)
  on public.memory_anchors to authenticated;
grant all on public.memory_anchors, public.memory_anchor_secrets to service_role;

revoke all on function public.create_memory_anchor(uuid, uuid, uuid, integer, text, smallint, text, text, text) from public, anon, authenticated;
grant execute on function public.create_memory_anchor(uuid, uuid, uuid, integer, text, smallint, text, text, text) to service_role;
