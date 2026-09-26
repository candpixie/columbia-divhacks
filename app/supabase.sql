-- Group rooms for Rentdezvous. Run once in the Supabase SQL editor.

create table if not exists public.room_people (
  room text not null,
  id text not null,
  data jsonb not null,               -- one person's answers
  joined_at timestamptz not null default now(),
  primary key (room, id)
);

create table if not exists public.room_times (
  room text not null,
  key text not null,                 -- "lat,lng" of a place
  data text not null,                -- base64 transit minutes from every hex
  primary key (room, key)
);

-- No accounts: anyone with a room code can read and write that room.
alter table public.room_people enable row level security;
alter table public.room_times enable row level security;
create policy "open rooms" on public.room_people for all to anon using (true) with check (true);
create policy "open times" on public.room_times for all to anon using (true) with check (true);

-- Live updates
alter publication supabase_realtime add table public.room_people, public.room_times;
