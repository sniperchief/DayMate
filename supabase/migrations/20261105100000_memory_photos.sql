-- DayMate redesign M5 — optional photo on a memory.
-- Stored in the existing private "photos" bucket under "<caregiver uid>/<elder id>/memory-…";
-- existing table grants, RLS and storage policies already cover it. The photo is NOT
-- written to Walrus and is not part of the Sui commitment.
alter table public.memories
  add column photo_path text check (char_length(photo_path) <= 300);
