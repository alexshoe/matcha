-- ============================================================
-- Matcha – Supabase setup
-- Run these statements in order in the Supabase SQL editor.
-- ============================================================


-- ── 1. users table ──────────────────────────────────────────
-- Mirrors auth.users and stores the public-facing profile.

create table if not exists public.users (
  user_id      uuid        not null primary key references auth.users(id) on delete cascade,
  display_name text        not null unique,
  email        text        not null unique,
  avatar_num   smallint,
  created_at   timestamptz not null default now()
);

-- RLS
alter table public.users enable row level security;

-- Anyone can read display names (needed for uniqueness check during sign-up)
create policy "Public display name read"
  on public.users for select
  using (true);

-- Users can only update their own profile
create policy "Users update own profile"
  on public.users for update
  using (auth.uid() = user_id);


-- ── 2. notes table ──────────────────────────────────────────
-- If the table already exists, fix the broken UNIQUE on user_id
-- (one user should be able to own many notes).

create table if not exists public.notes (
  id         text   not null primary key,
  user_id    uuid   not null references public.users(user_id) on delete cascade,
  content    text   not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  list       text   not null default 'My Notes'
);

-- Drop the erroneous unique constraint if it was created that way
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass
      and contype = 'u'
      and conname = 'notes_user_id_key'
  ) then
    alter table public.notes drop constraint notes_user_id_key;
  end if;
end $$;

-- RLS
alter table public.notes enable row level security;

create policy "Users see own notes"
  on public.notes for select
  using (auth.uid() = user_id);

create policy "Users insert own notes"
  on public.notes for insert
  with check (auth.uid() = user_id);

create policy "Users update own notes"
  on public.notes for update
  using (auth.uid() = user_id);

create policy "Users delete own notes"
  on public.notes for delete
  using (auth.uid() = user_id);


-- ── 3. Trigger: create profile row on sign-up ───────────────
-- Fires after a new row is inserted into auth.users and
-- populates public.users with the display_name from metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (user_id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Drop and recreate so re-running this file is idempotent
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();


-- ── 4. Note images storage bucket ──────────────────────────

insert into storage.buckets (id, name, public)
  values ('images', 'images', true)
  on conflict (id) do nothing;

create policy "Note images are publicly accessible."
  on storage.objects for select
  using (bucket_id = 'images');

create policy "Users can upload note images."
  on storage.objects for insert
  with check (
    bucket_id = 'images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own note images."
  on storage.objects for delete
  using (
    bucket_id = 'images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );


-- ── 5. Note files storage bucket ───────────────────────────

insert into storage.buckets (id, name, public)
  values ('files', 'files', true)
  on conflict (id) do nothing;

create policy "Note files are publicly accessible."
  on storage.objects for select
  using (bucket_id = 'files');

create policy "Users can upload note files."
  on storage.objects for insert
  with check (
    bucket_id = 'files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own note files."
  on storage.objects for delete
  using (
    bucket_id = 'files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
