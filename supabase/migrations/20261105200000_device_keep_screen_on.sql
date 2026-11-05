-- DayMate redesign M6 — optional "keep the screen on" per paired device
-- (for a tablet used as an always-on kitchen or bedside display).
alter table public.elder_devices
  add column keep_screen_on boolean not null default false;

grant select (keep_screen_on) on public.elder_devices to authenticated;
