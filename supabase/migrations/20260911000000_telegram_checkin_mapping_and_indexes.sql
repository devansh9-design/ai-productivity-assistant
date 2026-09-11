-- Telegram webhooks authenticate with an application secret and use the
-- service-role client. Keep this mapping inaccessible to browser roles.
create table if not exists public.telegram_chat_mappings (
  chat_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telegram_chat_mappings enable row level security;
revoke all on table public.telegram_chat_mappings from anon, authenticated;

drop trigger if exists telegram_chat_mappings_set_updated_at on public.telegram_chat_mappings;
create trigger telegram_chat_mappings_set_updated_at
  before update on public.telegram_chat_mappings
  for each row execute procedure public.set_updated_at();

-- A primary key on a newly created mapping table already covers this lookup.
-- Existing deployments may have created the table before this migration, so
-- add the index only if no valid chat_id-leading index exists.
do $$
begin
  if not exists (
    select 1
    from pg_index index_definition
    join pg_attribute attribute
      on attribute.attrelid = index_definition.indrelid
      and attribute.attnum = index_definition.indkey[0]
    where index_definition.indrelid = 'public.telegram_chat_mappings'::regclass
      and index_definition.indisvalid
      and attribute.attname = 'chat_id'
  ) then
    create index telegram_chat_mappings_chat_id_idx
      on public.telegram_chat_mappings(chat_id);
  end if;
end;
$$;

-- checkins_unique_per_day_and_type (user_id, checkin_date, type) and
-- journal_entries_unique_per_day (user_id, entry_date) already create the
-- composite indexes used by the webhook upserts; do not duplicate them.
