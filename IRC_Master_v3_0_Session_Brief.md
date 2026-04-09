# IRC Master v3.0 — Session Brief for Cursor / Windsurf
## Use this at the start of any session touching scheduling, trades, work orders, or calendar

---

## What changed in v3.0

The spec has been updated to v3.0. The following are **breaking changes** to the database schema and new additions. If you have already generated any migrations, TypeScript types, or API routes for the affected tables, **they must be updated before proceeding**.

---

## Tables with breaking changes

### `work_orders` — COLUMN REMOVED + NEW COLUMNS ADDED
- **REMOVED:** `scheduled_date DATE` — this column no longer exists. Scheduling now lives in `work_order_visits`.
- **ADDED:**
  - `blueprint_id UUID REFERENCES job_schedule_blueprints(id)`
  - `sequence_order INTEGER`
  - `is_concurrent BOOLEAN DEFAULT false`
  - `predecessor_work_order_id UUID REFERENCES work_orders(id)`
  - `estimated_hours NUMERIC`
  - `total_visits INTEGER DEFAULT 1`
  - `current_visit INTEGER DEFAULT 1`
  - `proximity_range TEXT` — `'standard'` | `'extended'`
  - `gary_state TEXT DEFAULT 'not_started'` — `'not_started'` | `'waiting_on_dependent'` | `'waiting_reply'` | `'booking_proposed'` | `'confirmed'` | `'return_visit_pending'` | `'complete'`

### `trades` — NEW COLUMNS ADDED
- **ADDED:**
  - `lat NUMERIC` — geocoded latitude
  - `lng NUMERIC` — geocoded longitude
  - `availability TEXT DEFAULT 'maintain_capacity'` — `'more_capacity'` | `'maintain_capacity'` | `'reduce_capacity'` | `'on_pause'`
  - `priority_rank INTEGER DEFAULT 50`
- Note: `address TEXT` already existed — confirm it exists in your migration.

### `scope_library` — NEW COLUMNS ADDED
- **ADDED:**
  - `estimated_hours NUMERIC` — labour hours per unit (formula: `scope_item.qty × estimated_hours = total hours for that line`)
  - `has_lag BOOLEAN DEFAULT false`
  - `lag_days INTEGER` — null if `has_lag = false`
  - `lag_description TEXT` — e.g. `"drying time"` — shown on work order PDF and trade portal

### `automation_config` — NEW DEFAULT KEY
- New seeded key: `trade_proximity_standard_km` with value `'40'`

### `prompts` — NEW PROMPT KEYS + NEW CATEGORY
- New category value: `'scheduling'`
- New prompt keys to seed:
  - `sms_inspection_booking_proposal`
  - `sms_inspection_reschedule`
  - `sms_inspection_cancellation`
  - `sms_trade_return_visit`
  - `schedule_blueprint_draft`

---

## New tables (create these if they don't exist)

### `work_order_visits`
One record per visit per work order. See spec Section 4.14a for full DDL.
Key columns: `work_order_id`, `visit_number`, `estimated_hours`, `scheduled_date`, `scheduled_end_date`, `confirmed_date`, `status`, `lag_days_after`, `lag_description`, `gary_triggered_at`, `gary_return_trigger_at`, `trade_confirmed_at`

### `job_schedule_blueprints`
One per job. Stores AI-drafted plan before work orders are created. See spec Section 4.14b for full DDL.
Key columns: `job_id`, `status` (`'draft'` | `'confirmed'` | `'superseded'`), `draft_data JSONB`, `confirmed_by`, `confirmed_at`

### `trade_type_sequence`
Reference table for AI blueprint draft default ordering. See spec Section 4.14c for full DDL.
Seed with IRC defaults on tenant creation (see spec 4.14c for default values).

---

## New indexes required (add to migration)
```sql
CREATE INDEX idx_work_order_visits_work_order ON work_order_visits(work_order_id);
CREATE INDEX idx_work_order_visits_job ON work_order_visits(job_id);
CREATE INDEX idx_work_order_visits_scheduled ON work_order_visits(tenant_id, scheduled_date);
CREATE INDEX idx_work_order_visits_gary_trigger ON work_order_visits(gary_return_trigger_at) WHERE gary_return_trigger_at IS NOT NULL;
CREATE INDEX idx_blueprints_job ON job_schedule_blueprints(job_id);
```

---

## New environment variable required
```
GOOGLE_MAPS_API_KEY=    # Google Maps Distance Matrix API — used for trade proximity calculation
```

---

## New routes and lib files added in v3.0

### API routes (create these):
- `/api/ai/draft-blueprint/route.ts` — calls Claude to generate `job_schedule_blueprints.draft_data`
- `/api/scheduling/sms-send/route.ts` — sends inspection scheduling SMS via Twilio
- `/api/scheduling/gary-return-visit/route.ts` — triggered by `gary_return_trigger_at`; sends return visit SMS

### Lib folder (create this):
- `/lib/scheduling/blueprint-generator.ts`
- `/lib/scheduling/proximity.ts`
- `/lib/scheduling/visit-splitter.ts`
- `/lib/scheduling/gary-triggers.ts`

### New pages (create these):
- `/app/dashboard/calendar/page.tsx` — global calendar (inspections + trades modes)
- `/app/settings/trade-sequence/page.tsx` — trade type sequence config (admin only)

### Updated pages (these need a new tab added):
- `/app/dashboard/jobs/[jobId]/page.tsx` — add **Calendar** tab to the tab bar

---

## TypeScript types to update

```typescript
// Updated
interface WorkOrder {
  // REMOVED: scheduled_date
  blueprint_id: string | null
  sequence_order: number | null
  is_concurrent: boolean
  predecessor_work_order_id: string | null
  estimated_hours: number | null
  total_visits: number
  current_visit: number
  proximity_range: 'standard' | 'extended' | null
  gary_state: 'not_started' | 'waiting_on_dependent' | 'waiting_reply' | 'booking_proposed' | 'confirmed' | 'return_visit_pending' | 'complete'
}

// Updated
interface Trade {
  lat: number | null
  lng: number | null
  availability: 'more_capacity' | 'maintain_capacity' | 'reduce_capacity' | 'on_pause'
  priority_rank: number
}

// Updated
interface ScopeLibraryItem {
  estimated_hours: number | null
  has_lag: boolean
  lag_days: number | null
  lag_description: string | null
}

// New
interface WorkOrderVisit {
  id: string
  tenant_id: string
  work_order_id: string
  job_id: string
  visit_number: number
  estimated_hours: number | null
  scheduled_date: string | null
  scheduled_end_date: string | null
  confirmed_date: string | null
  status: 'unscheduled' | 'gary_sent' | 'proposed' | 'confirmed' | 'complete'
  lag_days_after: number
  lag_description: string | null
  gary_triggered_at: string | null
  gary_return_trigger_at: string | null
  trade_confirmed_at: string | null
  notes: string | null
  created_at: string
}

// New
interface JobScheduleBlueprint {
  id: string
  tenant_id: string
  job_id: string
  status: 'draft' | 'confirmed' | 'superseded'
  draft_data: BlueprintDraftData | null
  confirmed_by: string | null
  confirmed_at: string | null
  notes: string | null
  created_at: string
}

// New
interface BlueprintDraftData {
  trades: BlueprintTrade[]
}

interface BlueprintTrade {
  trade_type: string
  trade_id: string
  trade_name: string
  proximity_range: 'standard' | 'extended'
  availability: string
  sequence_order: number
  is_concurrent: boolean
  predecessor_index: number | null
  estimated_hours: number
  visits: BlueprintVisit[]
}

interface BlueprintVisit {
  visit_number: number
  estimated_hours: number
  lag_days_after: number
  lag_description: string | null
}

// New
interface TradeTypeSequence {
  id: string
  tenant_id: string
  trade_type: string
  typical_sequence_order: number
  typical_visit_count: number
  notes: string | null
  updated_at: string
  created_at: string
}
```

---

## Automation rules to add in `/lib/automation/rules.ts`

Add `'scheduling'` to the `category` union type.
Add `'work_order_visit'` to the `trigger.entity` union type.
Add `'draft_blueprint'` to the `StepType` union type.

Add this rule to the `automationRules` array:

```typescript
{
  key: 'quote_approved_draft_blueprint',
  name: 'Quote approved — draft repair schedule',
  description: 'Quote approved. AI drafts trade allocation, sequence, and visit structure for review.',
  category: 'scheduling',
  active: true,
  priority: 15,
  trigger: { entity: 'quote', status: 'approved' },
  conditions: [
    { type: 'linked_entity_missing', entity: 'job_schedule_blueprint' },
    { type: 'no_pending_task', rule_key: 'quote_approved_draft_blueprint' }
  ],
  playbook: [
    {
      step: 1,
      type: 'draft_blueprint',
      label: 'AI drafts repair schedule blueprint',
      config: {
        input: 'approved_scope_items + available_trades + trade_type_sequence',
        output: 'job_schedule_blueprints.draft_data'
      }
    },
    {
      step: 2,
      type: 'notify_internal',
      label: 'Notify team — schedule ready for review',
      config: { message: 'Repair schedule drafted for {job_number} — review and confirm to activate Gary.' }
    }
  ],
  ai_prompt_context: 'Quote approved. A schedule blueprint has been drafted. Summarise the proposed trade sequence and highlight any extended-range trades or unusual lag periods the reviewer should check.'
}
```

---

## RLS policies required for new tables

```sql
ALTER TABLE work_order_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON work_order_visits
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

ALTER TABLE job_schedule_blueprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON job_schedule_blueprints
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

ALTER TABLE trade_type_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON trade_type_sequence
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

---

## Summary of what to do at session start

1. Check if Supabase migration for these changes has been run. If not, generate and run it now.
2. Update TypeScript types for `WorkOrder`, `Trade`, `ScopeLibraryItem`.
3. Add new TypeScript types: `WorkOrderVisit`, `JobScheduleBlueprint`, `BlueprintDraftData`, `TradeTypeSequence`.
4. Update `rules.ts` with new union type values and the `quote_approved_draft_blueprint` rule.
5. Then proceed with the feature you're building this session.

---

*Generated for IRC Master v3.0 — April 2026*
*Pair with: IRC_Master_Tech_Spec_v3_0.md*
