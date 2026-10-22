-- Performance clean-up flagged by the Supabase performance advisor.
-- No change to who can see what: every remaining policy keeps its exact
-- condition, only evaluated more cheaply.
--
-- 1. Duplicate policies. Permissive policies are OR'ed together, so a second
--    copy of the same condition adds work and no access. Drop the copies.
-- 2. auth.uid() inside policies is re-evaluated per row; wrapping it as
--    (select auth.uid()) lets Postgres evaluate it once per query.
-- 3. Indexes on foreign keys the app filters or joins on (job_id, quote_id,
--    tenant_id, ...). Audit columns such as created_by are left unindexed.

-- ── 1. Duplicate policies ────────────────────────────────────────────────────

-- Identical copies of the table's tenant_isolation policy
drop policy if exists tenant_isolation_auto_job_lodger_config on public.auto_job_lodger_config;
drop policy if exists tenant_isolation_client_email_config    on public.client_email_config;
drop policy if exists tenant_isolation_email_keyword_rules    on public.email_keyword_rules;
drop policy if exists tenant_isolation_gmail_sync_state       on public.gmail_sync_state;

-- job_files: per-command copies of the tenant_isolation (ALL) condition
drop policy if exists users_can_read_job_files   on public.job_files;
drop policy if exists users_can_insert_job_files on public.job_files;
drop policy if exists users_can_update_job_files on public.job_files;
drop policy if exists users_can_delete_job_files on public.job_files;

-- prompts: per-command copies of the tenant_isolation (ALL) condition
drop policy if exists users_can_read_own_tenant_prompts   on public.prompts;
drop policy if exists users_can_update_own_tenant_prompts on public.prompts;

-- job_schedule_blueprints: these compare against a tenant_id JWT claim that
-- this project's tokens do not carry (no custom access token hook), so they
-- never match. tenant_isolation_job_schedule_blueprints grants the access.
drop policy if exists "Users can view blueprints for their tenant"   on public.job_schedule_blueprints;
drop policy if exists "Users can insert blueprints for their tenant" on public.job_schedule_blueprints;
drop policy if exists "Users can update blueprints for their tenant" on public.job_schedule_blueprints;
drop policy if exists "Users can delete blueprints for their tenant" on public.job_schedule_blueprints;

-- ── 2. Evaluate auth.uid() once per query ────────────────────────────────────

do $$
declare
  p record;
  wrapped text := '( SELECT auth.uid() AS uid)';
  sql text;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')
  loop
    sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if p.qual is not null then
      sql := sql || format(' using (%s)', replace(replace(p.qual, wrapped, 'auth.uid()'), 'auth.uid()', wrapped));
    end if;
    if p.with_check is not null then
      sql := sql || format(' with check (%s)', replace(replace(p.with_check, wrapped, 'auth.uid()'), 'auth.uid()', wrapped));
    end if;
    execute sql;
  end loop;
end $$;

-- ── 3. Foreign key indexes ───────────────────────────────────────────────────

-- by job
create index if not exists idx_action_queue_job_id      on public.action_queue (job_id);
create index if not exists idx_ai_audit_job_id          on public.ai_audit (job_id);
create index if not exists idx_invoices_job_id          on public.invoices (job_id);
create index if not exists idx_job_flags_job_id         on public.job_flags (job_id);
create index if not exists idx_playbook_runs_job_id     on public.playbook_runs (job_id);
create index if not exists idx_safety_records_job_id    on public.safety_records (job_id);
create index if not exists idx_signing_requests_job_id  on public.signing_requests (job_id);
create index if not exists idx_work_orders_job_id       on public.work_orders (job_id);

-- by quote / report / inspection / work order
create index if not exists idx_inspections_quote_id        on public.inspections (quote_id);
create index if not exists idx_inspections_report_id       on public.inspections (report_id);
create index if not exists idx_invoice_line_items_quote_id on public.invoice_line_items (quote_id);
create index if not exists idx_invoices_report_id          on public.invoices (report_id);
create index if not exists idx_invoices_work_order_id      on public.invoices (work_order_id);
create index if not exists idx_quotes_report_id            on public.quotes (report_id);
create index if not exists idx_quotes_parent_quote_id      on public.quotes (parent_quote_id);
create index if not exists idx_reports_quote_id            on public.reports (quote_id);
create index if not exists idx_reports_parent_report_id    on public.reports (parent_report_id);
create index if not exists idx_safety_records_inspection_id on public.safety_records (inspection_id);
create index if not exists idx_work_orders_quote_id        on public.work_orders (quote_id);
create index if not exists idx_work_orders_report_id       on public.work_orders (report_id);
create index if not exists idx_work_orders_trade_id        on public.work_orders (trade_id);
create index if not exists idx_work_orders_blueprint_id    on public.work_orders (blueprint_id);
create index if not exists idx_work_orders_parent_work_order_id      on public.work_orders (parent_work_order_id);
create index if not exists idx_work_orders_predecessor_work_order_id on public.work_orders (predecessor_work_order_id);
create index if not exists idx_communications_work_order_id    on public.communications (work_order_id);
create index if not exists idx_communications_inspection_id    on public.communications (inspection_id);
create index if not exists idx_communications_insurer_order_id on public.communications (insurer_order_id);
create index if not exists idx_communications_action_queue_id  on public.communications (action_queue_id);
create index if not exists idx_invoices_trade_id               on public.invoices (trade_id);
create index if not exists idx_signing_requests_excess_invoice_id on public.signing_requests (excess_invoice_id);

-- by client / library
create index if not exists idx_jobs_client_id                  on public.jobs (client_id);
create index if not exists idx_jobs_assigned_to                on public.jobs (assigned_to);
create index if not exists idx_insurer_orders_client_id        on public.insurer_orders (client_id);
create index if not exists idx_client_email_config_client_id   on public.client_email_config (client_id);
create index if not exists idx_email_templates_client_id       on public.email_templates (client_id);
create index if not exists idx_clients_parent_id               on public.clients (parent_id);
create index if not exists idx_scope_items_scope_library_id    on public.scope_items (scope_library_id);
create index if not exists idx_scope_library_overrides_scope_library_id on public.scope_library_overrides (scope_library_id);
create index if not exists idx_scope_library_overrides_insurer_id       on public.scope_library_overrides (insurer_id);
create index if not exists idx_scope_library_history_scope_library_id   on public.scope_library_history (scope_library_id);
create index if not exists idx_playbook_runs_playbook_id       on public.playbook_runs (playbook_id);

-- by tenant (every policy filters on tenant_id)
create index if not exists idx_users_tenant_id                 on public.users (tenant_id);
create index if not exists idx_invoices_tenant_id              on public.invoices (tenant_id);
create index if not exists idx_quotes_tenant_id                on public.quotes (tenant_id);
create index if not exists idx_clients_tenant_id               on public.clients (tenant_id);
create index if not exists idx_trades_tenant_id                on public.trades (tenant_id);
create index if not exists idx_photos_tenant_id                on public.photos (tenant_id);
create index if not exists idx_job_notes_tenant_id             on public.job_notes (tenant_id);
create index if not exists idx_scope_items_tenant_id           on public.scope_items (tenant_id);
create index if not exists idx_scope_library_tenant_id         on public.scope_library (tenant_id);
create index if not exists idx_safety_records_tenant_id        on public.safety_records (tenant_id);
create index if not exists idx_email_templates_tenant_id       on public.email_templates (tenant_id);
create index if not exists idx_rate_config_tenant_id           on public.rate_config (tenant_id);
create index if not exists idx_job_schedule_blueprints_tenant_id on public.job_schedule_blueprints (tenant_id);
create index if not exists idx_signing_events_tenant_id        on public.signing_events (tenant_id);
