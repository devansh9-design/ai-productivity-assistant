create table if not exists public.ai_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_assistant_messages_user_created_idx
  on public.ai_assistant_messages(user_id, created_at desc);

create table if not exists public.ai_assistant_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.ai_assistant_messages(id) on delete set null,
  proposal_type text not null check (
    proposal_type in (
      'get_today_context',
      'suggest_schedule',
      'propose_reschedule',
      'propose_task_draft',
      'summarize_day'
    )
  ),
  proposal jsonb not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists ai_assistant_proposals_user_created_idx
  on public.ai_assistant_proposals(user_id, created_at desc);

alter table public.ai_assistant_messages enable row level security;
alter table public.ai_assistant_proposals enable row level security;

drop policy if exists "ai messages own rows" on public.ai_assistant_messages;
create policy "ai messages own rows"
  on public.ai_assistant_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai proposals own rows" on public.ai_assistant_proposals;
create policy "ai proposals own rows"
  on public.ai_assistant_proposals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ai_assistant_messages to authenticated;
grant select, insert, update, delete on public.ai_assistant_proposals to authenticated;
