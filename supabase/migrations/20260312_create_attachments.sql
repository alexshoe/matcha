-- Track uploaded files so they can be reliably cleaned up when a note or
-- attachment is deleted.  ON DELETE CASCADE ensures rows are removed
-- automatically when the parent note is deleted from the notes table.

create table if not exists attachments (
  id            uuid        primary key default gen_random_uuid(),
  note_id       text        not null references notes(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  storage_bucket text       not null,   -- 'images' or 'files'
  storage_path  text        not null,
  url           text        not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_attachments_note_id on attachments(note_id);
create index if not exists idx_attachments_user_id on attachments(user_id);

-- RLS: users can only see / manage their own attachments
alter table attachments enable row level security;

create policy "Users can view own attachments"
  on attachments for select
  using (auth.uid() = user_id);

create policy "Users can insert own attachments"
  on attachments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own attachments"
  on attachments for delete
  using (auth.uid() = user_id);
