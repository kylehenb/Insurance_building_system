# IRC Master — Spec Updates for v3.2
## Contacts & Email Routing Overhaul

These are drop-in replacements for the listed sections in `IRC_Master_Tech_Spec_v3_1.md`.
Apply each section by finding the matching heading and replacing the block in full.

---

## REPLACE: Section 4.3 clients (lines ~127–163)

### 4.3 clients
```sql
-- Insurers, adjuster firms, and other/private clients
-- This is the master reference for all external parties IRC works with
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  client_type TEXT NOT NULL,           -- 'insurer' | 'adjuster_firm' | 'other'
  parent_id UUID REFERENCES clients(id), -- links individual adjuster contacts to their firm
  name TEXT NOT NULL,                  -- e.g. "Allianz", "Sedgwick", "John Smith"
  trading_name TEXT,
  abn TEXT,
  submission_email TEXT,               -- Insurer Submission Email: generic lodgement inbox for this insurer
  adjuster_submission_email TEXT,      -- Adjuster Firm Submission Email: generic inbox for adjuster firm
                                       -- null for insurer records; populated for adjuster_firm records only
  contact_phone TEXT,
  address TEXT,
  -- Per-insurer KPI configuration
  kpi_contact_hours NUMERIC DEFAULT 2,
  kpi_booking_hours NUMERIC DEFAULT 24,
  kpi_visit_days NUMERIC DEFAULT 2,
  kpi_report_days NUMERIC DEFAULT 4,
  send_booking_confirmation BOOLEAN DEFAULT false,
  -- Per-insurer pricing and margin configuration
  bar_amount NUMERIC,                   -- Standard BAR (Building Assessment Report) fee for this insurer
  single_storey_roof_report_amount NUMERIC, -- Roof report fee for single-storey properties
  double_storey_roof_report_amount NUMERIC, -- Roof report fee for double-storey properties
  travel_allowance_outside_service_area NUMERIC, -- Travel allowance per km for work outside standard service area ($/km)
  builders_margin_pct NUMERIC,         -- Builder margin percentage (e.g. 20 for 20%)
  notes TEXT,
  status TEXT DEFAULT 'active',        -- 'active' | 'inactive'
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Migration (run in Supabase SQL editor):**
```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS adjuster_submission_email TEXT;
```

**Notes on clients table:**
- `submission_email` = **Insurer Submission Email** — the generic lodgement inbox used for this insurer; always CC'd on outbound sends when an insurer is linked to the job
- `adjuster_submission_email` = **Adjuster Firm Submission Email** — the adjuster firm's generic inbox (e.g. Sedgwick's central submissions address); only used when `client_type = 'adjuster_firm'`; always CC'd on outbound sends when an adjuster firm is linked to the job
- Individual adjuster contacts sit under their firm via `parent_id`
- Both submission emails are configured in client settings and are read-only on the job/order — they surface as reference fields labelled "From client config"
- KPI framework (general — varies by insurer, configured per insurer): Contact within 2hr / Booking within 24hr / Visit within 2 days / Report within 4 days. Clock starts when insurer order is received.

---

## REPLACE: Section 4.4 insurer_orders (lines ~165–196)

### 4.4 insurer_orders
```sql
CREATE TABLE insurer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID REFERENCES jobs(id),     -- null until linked to a job; many-to-one with jobs
  client_id UUID REFERENCES clients(id), -- links to clients table (insurer or adjuster firm)
  order_ref TEXT,                      -- insurer's reference number
  status TEXT DEFAULT 'pending',       -- 'pending' | 'approved' | 'linked' | 'rejected'
  claim_number TEXT NOT NULL,          -- universal job key — always present
  insurer TEXT,                        -- denormalised for speed/display
  adjuster TEXT,                       -- denormalised for speed/display (firm name)
  adjuster_reference TEXT,             -- adjuster firm's own reference/claim number (distinct from IRC job number and insurer claim number)
  wo_type TEXT,                        -- 'BAR' | 'make_safe' | 'roof_report' | 'specialist' | 'variation'
  is_make_safe BOOLEAN DEFAULT false,  -- explicit flag for fast-track routing
  property_address TEXT,
  insured_name TEXT,
  insured_phone TEXT,
  insured_email TEXT,
  contacts JSONB DEFAULT '[]',         -- structured contact array; see Contacts Model section
  -- Order sender fields (parsed from inbound email From: header or manually entered)
  order_sender_name TEXT,              -- Order Sender Name: individual who sent this work order (e.g. "James Hollis")
  order_sender_email TEXT,             -- Order Sender Email: their direct reply-to address; primary To: on outbound sends
  date_of_loss DATE,
  loss_type TEXT,
  claim_description TEXT,
  special_instructions TEXT,
  sum_insured_building NUMERIC,
  excess_building NUMERIC,
  raw_email_link TEXT,
  parse_status TEXT,                   -- 'auto_parsed' | 'manual_entry' | 'needs_review'
  entry_method TEXT DEFAULT 'email',   -- 'email' | 'phone' | 'manual'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Migration (run in Supabase SQL editor):**
```sql
ALTER TABLE insurer_orders
  DROP COLUMN IF EXISTS additional_contacts,
  ADD COLUMN contacts JSONB DEFAULT '[]',
  ADD COLUMN adjuster_reference TEXT,
  ADD COLUMN order_sender_name TEXT,
  ADD COLUMN order_sender_email TEXT;
```

---

## REPLACE: Section 4.5 jobs — contact and sender fields only
### Replace the contact fields block within the jobs CREATE TABLE statement

Replace:
```sql
  insured_name TEXT,
  insured_phone TEXT,
  insured_email TEXT,
  additional_contacts TEXT,
```

With:
```sql
  insured_name TEXT,
  insured_phone TEXT,
  insured_email TEXT,
  contacts JSONB DEFAULT '[]',         -- structured contact array; see Contacts Model section
  -- Order sender fields (copied from insurer_order on job creation; editable on job)
  adjuster_reference TEXT,             -- adjuster firm's own reference/claim number
  order_sender_name TEXT,              -- Order Sender Name: individual who originally sent the work order
  order_sender_email TEXT,             -- Order Sender Email: their direct reply-to address; primary To: on outbound sends
```

**Migration (run in Supabase SQL editor):**
```sql
ALTER TABLE jobs
  DROP COLUMN IF EXISTS additional_contacts,
  ADD COLUMN contacts JSONB DEFAULT '[]',
  ADD COLUMN adjuster_reference TEXT,
  ADD COLUMN order_sender_name TEXT,
  ADD COLUMN order_sender_email TEXT;
```

---

## ADD: New section after 4.5 jobs — insert as Section 4.5a

### 4.5a Contacts Model

The `contacts` JSONB column on both `insurer_orders` and `jobs` stores up to 3 contacts: one fixed insured slot and up to 2 additional slots. This replaces the former `additional_contacts TEXT` column.

#### Contact object structure
```typescript
interface JobContact {
  slot: 'insured' | 'additional_1' | 'additional_2';
  type?: 'tenant' | 'real_estate' | 'property_manager' | 'broker' | 'owner' | 'other';
  // type is only used on additional slots; undefined on insured slot
  name: string;
  phone: string;
  email: string;
  roles: ContactRole[];
}

type ContactRole =
  | 'insured'       // The named insured on the policy — always locked to the insured slot
  | 'auth'          // Receives: building contracts, scope of works, homeowner sign-off requests
  | 'primary_site'  // Receives: inspection booking, site access, day-of-visit SMS, trade access
  | 'secondary_site'// Backup site contact for access and scheduling
  | 'broker'        // Receives broker-specific comms (future)
  | 'real_estate';  // Receives property manager comms (future)
```

#### Example contacts array
```json
[
  {
    "slot": "insured",
    "name": "John Smith",
    "phone": "0412 345 678",
    "email": "john@email.com",
    "roles": ["insured", "auth", "primary_site"]
  },
  {
    "slot": "additional_1",
    "type": "tenant",
    "name": "Sarah Jones",
    "phone": "0411 222 333",
    "email": "sarah@email.com",
    "roles": ["primary_site"]
  }
]
```

#### Role assignment defaults
- **Single contact (insured only):** Insured is automatically assigned `insured + auth + primary_site`. No UI interaction required. This covers ~80% of jobs.
- **Two or more contacts:** Auto-assignment is cleared when a second contact is added. `auth` defaults to insured; `primary_site` goes unassigned with an inline prompt: *"Confirm who is the primary site contact."*
- `insured` role is permanently locked to the insured slot — cannot be moved or unassigned.
- `auth` and `primary_site` are exclusive — only one contact can hold each at a time. Assigning to a new contact auto-removes it from the previous holder.

#### Comms routing table
The system resolves the correct recipient for each outbound action using this static mapping (defined in `/lib/contacts/defaults.ts`):

| Action | Routes to role |
|---|---|
| Building contract | `auth` |
| Scope of works (sign-off) | `auth` |
| Homeowner sign-off | `auth` |
| Inspection booking confirmation | `primary_site` |
| Site access coordination | `primary_site` |
| Day-of-visit SMS | `primary_site` |
| Trade access follow-up | `primary_site` |
| General job updates | `insured` |
| Excess / financial comms | `insured` |
| Secondary access fallback | `secondary_site` |

This mapping is hardcoded in `/lib/contacts/defaults.ts` — not a DB config. Per-job edge cases go in `jobs.automation_overrides`.

#### Validation rules
- At least one contact must hold `auth` (required before building contract can be sent)
- At least one contact must hold `primary_site` (required for Gary scheduling)
- Validation surfaces as a warning badge on the contacts section, not a blocking error at save time

#### UI pattern (ContactsEditor component)
- Insured card: always visible, never removable
- Additional cards: hidden by default; revealed via "+ Add Contact" button
- Each card: Contact Type dropdown (additional slots only), Name, Phone, Email, role pills
- Role pills are togglable; exclusive roles auto-shift on reassignment
- When a second contact is added and insured had auto-assigned `primary_site`: clears it and shows inline notice

---

## ADD: New section after 4.5a — insert as Section 4.5b

### 4.5b Outbound Email Routing (Insurer / Adjuster)

Applies to all outbound sends to insurers and adjusters (BAR, quote, reports, invoices). The Gmail compose window is pre-populated using this priority chain.

#### Field labels (UI)
| Field | Label in UI | Source | Editable |
|---|---|---|---|
| `order_sender_name` | Order Sender Name | Parsed from email `From:` header, or manual entry | Yes |
| `order_sender_email` | Order Sender Email | Parsed from email `From:` header, or manual entry | Yes |
| `adjuster_reference` | Adjuster Reference | Manual entry | Yes |
| `clients.adjuster_submission_email` | Adjuster Firm Submission Email | Client config | Read-only on job (edit in client settings) |
| `clients.submission_email` | Insurer Submission Email | Client config | Read-only on job (edit in client settings) |

Read-only fields display a sub-label: *"From client config"* so the user knows where to change them.

#### Routing priority (To / CC resolution)
```
To:   order_sender_email           → if present, use as primary To:
      adjuster_submission_email    → fallback if no order_sender_email
      insurer submission_email     → final fallback

CC:   adjuster_submission_email    → always CC if present and not already in To:
      insurer submission_email     → always CC if present and not already in To:
```

**Key rule:** The order sender (the individual who sent the work order) always gets the reply directly. Both submission inboxes are always CC'd so the generic inboxes receive a copy regardless of who sent the order. If the sender's email matches a submission inbox, it is not duplicated.

#### Implementation
- Logic lives in `/lib/contacts/email-routing.ts` → `resolveInsurerEmailRecipients()`
- Called by the send flow to pre-populate the Gmail compose window
- User can always edit To/CC before sending — routing is a starting point, never locked

#### Email parser integration
- Gemini Flash receives the raw email `From:` header as a separate structured input (not from the body)
- Parser extracts `order_sender_name` and `order_sender_email` from the `From:` header
- If a second contact (agent, property manager, tenant) is mentioned in the email body, parser extracts: `{ slot: 'additional_1', type: null, name, phone, email: null, roles: [] }`
- Roles are never assigned by the parser — role assignment is always human-confirmed on the order review screen

---

## REPLACE: WF-5 Email routing logic subsection (lines ~1795–1798)

#### Email routing logic
- **Primary To:** `order_sender_email` on the job (the individual who sent the original work order) — parsed from email `From:` header at intake and stored on the job
- **Fallback To:** if no `order_sender_email`, use adjuster firm's `adjuster_submission_email` from clients table; if no adjuster, use insurer's `submission_email` from clients table
- **CC:** always include both `adjuster_submission_email` (if present) and insurer `submission_email` (if present), unless either duplicates the To: address
- **Never goes to the insured** — contacts JSONB is for homeowner/site comms only; insurer email routing uses the sender/submission fields exclusively
- Resolved via `resolveInsurerEmailRecipients()` in `/lib/contacts/email-routing.ts`; compose window pre-populated but always user-editable before send

---

## UPDATE: Notes on clients table (lines ~157–163)
### Replace the existing notes block with:

**Notes on clients table:**
- `submission_email` = **Insurer Submission Email** — the generic lodgement inbox for this insurer; always CC'd on outbound sends
- `adjuster_submission_email` = **Adjuster Firm Submission Email** — the adjuster firm's generic inbox; only populated for `client_type = 'adjuster_firm'`; always CC'd when an adjuster firm is on the job
- Individual adjuster contacts sit under their firm via `parent_id`
- Both submission email fields are configured in client settings and surface as read-only reference fields on insurer orders and jobs
- Outbound email routing uses `order_sender_email` (per-job, from email parser) as primary To:, with both submission emails as permanent CC — see Section 4.5b
- KPI framework (general — varies by insurer, configured per insurer): Contact within 2hr / Booking within 24hr / Visit within 2 days / Report within 4 days. Clock starts when insurer order is received.

---

## File rename
Rename `IRC_Master_Tech_Spec_v3_1.md` → `IRC_Master_Tech_Spec_v3_2.md` and update the title line:

```
# IRC Master — Full Technical Specification v3.2
```

Change log line to add after the title block:
```
**v3.2 changes:** Contacts & Email Routing overhaul — replaced `additional_contacts TEXT` with structured `contacts JSONB` on insurer_orders and jobs; added order sender fields (order_sender_name, order_sender_email, adjuster_reference); added adjuster_submission_email to clients; added Section 4.5a (Contacts Model) and 4.5b (Outbound Email Routing); updated WF-5 email routing logic; updated clients table notes.
```
