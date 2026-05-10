---
name: Invoice module build (outbound AR)
description: Context on the outbound invoice module built in May 2026, including what exists and what was deferred
type: project
---

Outbound (AR) invoice module was built in full in May 2026. All routes and pages pass `npm run build`.

**What was built:**
- SQL migrations: `20260510_invoice_module_columns.sql` (gst_treatment, library_item_id, unit) and `20260510_invoice_line_item_library.sql`
- `lib/invoices/generators.ts` — pure generator functions per invoice type
- `lib/invoices/ref.ts` — invoice ref generator (`INV-{job_number}-{seq}`)
- `app/api/invoices/generate/route.ts` — POST endpoint calling generators; handles assessment/excess/balance/make_safe types
- `app/api/invoices/[invoiceId]/route.ts` — GET/PATCH/DELETE (DELETE soft-voids)
- `app/api/invoices/[invoiceId]/line-items/route.ts` — GET/POST with auto-recalc
- `app/api/invoice-library/route.ts` + `[itemId]/route.ts` — library CRUD
- `app/dashboard/invoices/page.tsx` — invoice list with status/type/date filters
- `app/dashboard/invoices/[invoiceId]/page.tsx` — invoice detail, inline-editable line items, library popover
- `app/dashboard/settings/invoice-library/page.tsx` — manage line item library grouped by type, auto-seeds IRC defaults
- `InvoicesTab.tsx` + `InvoicesList.tsx` updated on job detail page: outbound-only filter, detail-page links, running totals, modal-based create with generate endpoint

**Why:** Spec delivered 2026-05-10 for AR invoicing module. Inbound (AP) trade invoice flow was not touched.

**How to apply:** When working on invoices, be aware the existing `app/api/invoices/route.ts` (GET + POST using invoice_templates) is still live alongside the new `generate` route. The old POST path uses the `invoice_templates` table; the new generate path uses `rate_config` for assessments.
