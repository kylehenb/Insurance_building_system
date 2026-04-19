-- assistant_templates: per-user prompt templates for the IRC AI assistant widget

create table if not exists assistant_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Index for fast per-user lookups
create index if not exists assistant_templates_user_id_idx on assistant_templates(user_id);

-- RLS: users can only read and write their own rows
alter table assistant_templates enable row level security;

drop policy if exists "Users can read own templates" on assistant_templates;
create policy "Users can read own templates"
  on assistant_templates for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own templates" on assistant_templates;
create policy "Users can insert own templates"
  on assistant_templates for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own templates" on assistant_templates;
create policy "Users can update own templates"
  on assistant_templates for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own templates" on assistant_templates;
create policy "Users can delete own templates"
  on assistant_templates for delete
  using (auth.uid() = user_id);
