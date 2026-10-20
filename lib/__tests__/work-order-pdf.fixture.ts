import type { Database } from '../supabase/database.types'
import type { WorkOrderPdfData } from '../documents/work-order-pdf-html'

type Tables = Database['public']['Tables']

// Synthetic data for the Work Order PDF template — no real customer data.
export function workOrderPdfFixture(overrides: Partial<WorkOrderPdfData> = {}): WorkOrderPdfData {
  const tenantId = '00000000-0000-4000-8000-000000000001'
  const jobId = '00000000-0000-4000-8000-000000000002'

  const workOrder: Tables['work_orders']['Row'] = {
    id: '00000000-0000-4000-8000-000000000003',
    tenant_id: tenantId,
    job_id: jobId,
    quote_id: '00000000-0000-4000-8000-000000000004',
    trade_id: '00000000-0000-4000-8000-000000000005',
    report_id: null,
    work_type: 'repair',
    status: 'engaged',
    scheduled_date: null,
    scope_summary: '3 items',
    trade_cost: 1111.11,
    charge_out_amount: 9999.99,
    agreed_amount: null,
    notes: JSON.stringify({ item_overrides: {}, added_items: [] }),
    created_at: '2026-10-01T00:00:00Z',
    blueprint_id: null,
    sequence_order: 2,
    predecessor_work_order_id: null,
    estimated_hours: 6,
    total_visits: 2,
    current_visit: 1,
    proximity_range: 'standard',
    gary_state: 'waiting_reply',
    parent_work_order_id: null,
    scheduling_offset_days: null,
    work_order_ref: 'WO-IRC1234-002',
    dependency_type: null,
    trade_name: 'Plasterer',
  }

  const job = {
    id: jobId,
    tenant_id: tenantId,
    job_number: 'IRC1234',
    claim_number: 'CLM-555',
    insurer: 'Example Insurance',
    property_address: '1 Example Street, Sampleton WA 6000',
    insured_name: 'Alex Example',
    insured_phone: '0400111222',
    insured_email: 'alex@example.com',
    special_instructions: 'Dog on site <keep gate shut>. Key in lockbox, code from office.',
    contacts: [
      { slot: 'insured', name: 'Alex Example', phone: '0400111222', email: 'alex@example.com', roles: ['insured', 'auth'] },
      { slot: 'additional_1', type: 'tenant', name: 'Sam Tenant', phone: '0400333444', email: '', roles: ['primary_site'] },
    ],
  } as unknown as Tables['jobs']['Row']

  const tenant = {
    id: tenantId,
    name: 'Insurance Repair Co Pty Ltd',
    trading_name: 'Insurance Repair Co',
    abn: '12686067881',
    building_licence_number: 'BC105884',
    address: 'Duncraig, WA',
    contact_email: 'office@insurancerepairco.com.au',
    contact_phone: '0431132077',
  } as unknown as Tables['tenants']['Row']

  const trade = {
    id: workOrder.trade_id,
    tenant_id: tenantId,
    business_name: 'Smooth Walls Plastering',
    primary_trade: 'Plasterer',
    abn: '98765432109',
    primary_contact: 'Jordan',
    contact_mobile: '0400555666',
    contact_office: null,
    contact_email: 'jobs@smoothwalls.example',
  } as unknown as Tables['trades']['Row']

  const visit = (n: number, date: string | null, lag: number, desc: string | null) => ({
    id: `00000000-0000-4000-8000-00000000010${n}`,
    tenant_id: tenantId,
    work_order_id: workOrder.id,
    job_id: jobId,
    visit_number: n,
    estimated_hours: 3,
    scheduled_date: date,
    scheduled_end_date: null,
    confirmed_date: null,
    status: 'unscheduled',
    lag_days_after: lag,
    lag_description: desc,
    gary_triggered_at: null,
    gary_return_trigger_at: null,
    trade_confirmed_at: null,
    notes: null,
    created_at: null,
    sequence_order: n,
  }) as Tables['work_order_visits']['Row']

  return {
    workOrder,
    job,
    tenant,
    trade,
    tradeLabel: 'Plasterer',
    visits: [visit(1, '2026-11-03', 2, 'drying time'), visit(2, null, 0, null)],
    scopeItems: [
      { description: 'Remove and dispose of water damaged ceiling sheet', qty: 12.5, unit: 'm2', room: 'Kitchen' },
      { description: 'Supply and install 10mm plasterboard ceiling', qty: 12.5, unit: 'm2', room: 'Kitchen' },
      { description: 'Patch wall <behind> fridge', qty: 1, unit: 'item', room: 'Laundry' },
    ],
    otherTradeItems: [
      { description: 'Paint ceiling 2 coats', qty: 12.5, unit: 'm2', room: 'Kitchen', tradeLabel: 'Painter', contractorName: 'Bright Painting' },
    ],
    roomDimensions: { Kitchen: { length: 4.2, width: 3, height: 2.7 } },
    workOrderAmount: 1840.5,
    isSent: true,
    logoDataUri: null,
    generatedAt: new Date('2026-10-20T02:30:00Z'),
    ...overrides,
  }
}
