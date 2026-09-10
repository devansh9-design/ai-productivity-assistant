create table if not exists public.telegram_chat_mappings (
  chat_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_chat_mappings_chat_id_nonempty check (length(trim(chat_id)) > 0),
  constraint telegram_chat_mappings_one_chat_per_user unique (user_id)
);

alter table public.telegram_chat_mappings enable row level security;

create policy "telegram_chat_mappings_select_own"
  on public.telegram_chat_mappings for select
  using (auth.uid() = user_id);

create policy "telegram_chat_mappings_insert_own"
  on public.telegram_chat_mappings for insert
  with check (auth.uid() = user_id);

create policy "telegram_chat_mappings_update_own"
  on public.telegram_chat_mappings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "telegram_chat_mappings_delete_own"
  on public.telegram_chat_mappings for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.telegram_chat_mappings to service_role;

create or replace function public.set_telegram_chat_mappings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists telegram_chat_mappings_updated_at on public.telegram_chat_mappings;
create trigger telegram_chat_mappings_updated_at
before update on public.telegram_chat_mappings
for each row execute function public.set_telegram_chat_mappings_updated_at();
