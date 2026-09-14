create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message text not null check (char_length(message) >= 1 and char_length(message) <= 4000),
  proposal jsonb not null,
  proposal_type text not null,
  validation_ok boolean not null default true,
  confirmed boolean not null default false,
  confirmed_plan_id uuid references public.daily_plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_conversations enable row level security;

drop policy if exists "Users can read own AI conversations" on public.ai_conversations;
create policy "Users can read own AI conversations" on public.ai_conversations for select using (user_id = auth.uid());

drop policy if exists "Users can insert own AI conversations" on public.ai_conversations;
create policy "Users can insert own AI conversations" on public.ai_conversations for insert with check (user_id = auth.uid());

drop policy if exists "Users can update own AI conversations" on public.ai_conversations;
create policy "Users can update own AI conversations" on public.ai_conversations for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists ai_conversations_user_created_idx on public.ai_conversations(user_id, created_at desc);

create or replace function public.set_ai_conversations_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists ai_conversations_updated_at on public.ai_conversations;
create trigger ai_conversations_updated_at before update on public.ai_conversations
for each row execute function public.set_ai_conversations_updated_at();