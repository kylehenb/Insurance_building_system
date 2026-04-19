-- Phase 2 quotes enhancements

-- 1. Add item_type to scope_items (Provisional Sum / Prime Cost / Cash Settlement)
alter table scope_items
  add column if not exists item_type text
  check (item_type in ('provisional_sum', 'prime_cost', 'cash_settlement'));

-- 2. Add permit_block_dismissed to quotes (suppress 20k permit alert)
alter table quotes
  add column if not exists permit_block_dismissed boolean not null default false;

-- 3. Add 'ready' to quotes status check constraint
-- Drop and re-create constraint to include 'ready'
alter table quotes
  drop constraint if exists quotes_status_check;

alter table quotes
  add constraint quotes_status_check
  check (status in ('draft', 'sent', 'approved', 'partially_approved', 'rejected', 'ready'));

-- 4. quote_note_templates table
create table if not exists quote_note_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  title       text not null,
  content     text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists quote_note_templates_tenant_idx
  on quote_note_templates(tenant_id, sort_order);

-- RLS
alter table quote_note_templates enable row level security;

drop policy if exists "Tenant members can read note templates" on quote_note_templates;
create policy "Tenant members can read note templates"
  on quote_note_templates for select
  using (
    tenant_id in (
      select tenant_id from users where id = auth.uid()
    )
  );

-- 5. Seed placeholder templates for tenant 7da695eb-63ef-476b-81dd-c81094e80f89
insert into quote_note_templates (tenant_id, title, content, sort_order)
values
  (
    '7da695eb-63ef-476b-81dd-c81094e80f89',
    'Standard scope note',
    'All works to be carried out in accordance with Australian Standards and manufacturer specifications. All materials to match existing as closely as possible.',
    0
  ),
  (
    '7da695eb-63ef-476b-81dd-c81094e80f89',
    'Storm damage',
    'Works are directly attributable to the storm event. All damaged materials to be removed and replaced on a like-for-like basis.',
    1
  ),
  (
    '7da695eb-63ef-476b-81dd-c81094e80f89',
    'Mould remediation',
    'Mould remediation works to be carried out in accordance with AS/NZS 8000:2014. Area to be contained prior to works commencing.',
    2
  )
on conflict do nothing;
