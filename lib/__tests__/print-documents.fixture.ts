import type { Database } from '../supabase/database.types'

type Tables = Database['public']['Tables']
type Quote = Tables['quotes']['Row']
type ScopeItem = Tables['scope_items']['Row']
type Report = Tables['reports']['Row']
type Photo = Tables['photos']['Row']
type Job = Tables['jobs']['Row']
type Tenant = Tables['tenants']['Row']

// Synthetic data for the quote / report / TCC / photo documents — no real
// customer data.

export const TENANT_ID = '00000000-0000-4000-8000-000000000001'
export const JOB_ID = '00000000-0000-4000-8000-000000000002'
export const QUOTE_ID = '00000000-0000-4000-8000-000000000004'

export function printTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT_ID,
    name: 'Insurance Repair Co',
    trading_name: 'Insurance Repair Co',
    abn: '12686067881',
    address: '2/14 Example Rd, Duncraig, WA 6023',
    contact_email: 'office@example.com.au',
    contact_phone: '0431132077',
    accounts_email: 'accounts@example.com.au',
    building_licence_number: 'BC105884',
    logo_storage_path: null,
    alternative_logo_storage_path: null,
    bank_name: 'Example Bank',
    bsb: '000-000',
    account_number: '12345678',
    account_name: 'Insurance Repair Co Pty Ltd',
    invoice_payment_terms: 14,
    excess_payment_terms: 0,
    job_prefix: 'IRC',
    job_sequence: 1234,
    plan: null,
    service_area_config: null,
    slug: 'irc',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Tenant
}

export function printJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    job_number: 'IRC1234',
    job_type: 'insurance',
    claim_number: 'CLM-555 <A&B>',
    insurer: 'Example Insurance',
    adjuster: null,
    adjuster_reference: null,
    property_address: '1 Example Street, Sampleton WA 6000',
    insured_name: 'Alex Example',
    insured_phone: '0400111222',
    insured_email: 'alex@example.com',
    client_id: null,
    order_sender_email: 'claims.officer@insurer.example',
    order_sender_name: 'Casey Officer',
    invoice_to: null,
    loss_type: 'Storm',
    date_of_loss: '2026-09-20',
    property_details: { building_age: '1990s', condition: 'Fair', roof_type: 'Tile', wall_type: 'Brick', storeys: '1', pool: true },
    contacts: [],
    created_at: '2026-09-21T01:00:00Z',
    ...overrides,
  } as unknown as Job
}

export function printQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: QUOTE_ID,
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    quote_ref: 'Q-IRC1234-1',
    status: 'ready',
    is_locked: true,
    markup_pct: 0.2,
    gst_pct: 0.1,
    notes: 'Price valid for 30 days.\nAccess via side gate.',
    room_order: ['Kitchen', 'Bathroom'],
    created_at: '2026-10-01T02:00:00Z',
    total_amount: null,
    approved_amount: null,
    ...overrides,
  } as unknown as Quote
}

function item(id: number, fields: Partial<ScopeItem>): ScopeItem {
  return {
    id: `00000000-0000-4000-8000-0000000001${String(id).padStart(2, '0')}`,
    tenant_id: TENANT_ID,
    quote_id: QUOTE_ID,
    sort_order: id,
    qty: 1,
    unit: 'item',
    rate_labour: 100,
    rate_materials: 50,
    line_total: 150,
    item_type: null,
    approval_status: null,
    room_length: null,
    room_width: null,
    room_height: null,
    ...fields,
  } as unknown as ScopeItem
}

export function printScopeItems(): ScopeItem[] {
  return [
    item(1, { room: 'Bathroom', trade: 'Tiler', item_description: 'Remove and replace damaged floor tiles <approx 4m²>', qty: 4, unit: 'm2', rate_labour: 80, rate_materials: 45, line_total: 500, room_length: 2.4, room_width: 1.8, room_height: 2.4 }),
    item(2, { room: 'Kitchen', trade: 'Plasterer', item_description: 'Patch and set ceiling where water damaged', qty: 1, unit: 'item', rate_labour: 380, rate_materials: 60, line_total: 440, room_length: 4.2, room_width: 3.6, room_height: 2.7 }),
    item(3, { room: 'Kitchen', trade: 'Painter', item_description: 'Seal, prime and paint ceiling (2 coats)', qty: 15.12, unit: 'm2', rate_labour: 18, rate_materials: 6, line_total: 362.88 }),
    item(4, { room: 'Kitchen', trade: 'Electrician', item_description: 'Supply and install downlight', qty: 2, unit: 'each', rate_labour: 60, rate_materials: 40, line_total: 200, item_type: 'provisional_sum' }),
    item(5, { room: 'Bathroom', trade: 'Plumber', item_description: 'Replace vanity tapware (owner to select)', qty: 1, unit: 'item', rate_labour: 150, rate_materials: 250, line_total: 400, item_type: 'prime_cost' }),
    item(6, { room: 'Bathroom', trade: 'Builder', item_description: 'Cash settle shower screen', qty: 1, unit: 'item', rate_labour: 0, rate_materials: 600, line_total: 600, item_type: 'cash_settlement' }),
  ]
}

export function printReport(overrides: Partial<Report> = {}): Report {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    report_ref: 'R-IRC1234-BAR',
    report_type: 'BAR',
    status: 'complete',
    is_locked: false,
    version: 1,
    attendance_date: '2026-09-25',
    attendance_time: '09:30:00',
    person_met: 'Alex Example',
    assessor_name: 'Jordan Assessor',
    property_description: 'Single storey brick and tile home.',
    incident_description: 'Severe storm with hail on 20 September.',
    cause_of_damage: 'Wind-driven rain entered through displaced roof tiles.',
    how_damage_occurred: '- Tiles displaced at the ridge\n- Water tracked into the kitchen ceiling\n\nStaining visible across 3 sheets.',
    resulting_damage: 'Kitchen ceiling water damage; bathroom floor tiles lifted.',
    conclusion: 'Damage is consistent with the reported storm event.',
    pre_existing_conditions: 'Minor cracking to the laundry wall (not claim related).',
    maintenance_notes: 'Gutters require cleaning.',
    additional_notes: null,
    type_specific_fields: {
      roof_type: 'Concrete tile', roof_general_condition: 'Fair', pitch_degrees: '22', number_of_penetrations: '3', number_of_storeys: '1',
      ridge_hip_condition: 'Several capping tiles displaced', gutter_condition: 'Blocked', gutter_overflows: 'Yes', roof_insulation: 'Batts',
      specific_cause_of_damage: 'Wind uplift', internal_damage: 'Kitchen ceiling', roof_damage: 'Ridge capping',
      leak_location: 'Ensuite shower', leak_source: 'Failed waterproofing', water_type: 'Clean', leak_duration: 'Months',
      investigation_findings: 'Moisture readings elevated along the shower hob.', affected_areas: 'Ensuite, bedroom 1 wall',
      repair_recommendations: 'Strip and re-waterproof shower', further_investigation_plumber: 'No',
      shower_breach_test: 'Fail', cold_water_test: 'Pass', hot_water_test: 'Pass', thermal_imaging_test: 'Moisture detected',
      works_carried_out: 'Tarped roof and isolated power to kitchen lights.', further_works_required: 'Roof repairs', safe_to_occupy: 'Yes',
      scope_of_report: 'Roof cover and claim-related damage',
    },
    created_at: '2026-09-25T04:00:00Z',
    ...overrides,
  } as unknown as Report
}

export function printPhotos(count: number, baseUrlPath = 'fixtures'): Photo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`,
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    report_id: '00000000-0000-4000-8000-000000000201',
    inspection_id: null,
    storage_path: `${baseUrlPath}/photo-${(i % 3) + 1}.jpg`,
    label: i % 4 === 3 ? null : `Kitchen ceiling ${i + 1}`,
    file_name: `photo-${i + 1}.jpg`,
    mime_type: 'image/jpeg',
    sequence_number: i + 1,
    crop_x: 0,
    crop_y: 0,
    crop_scale: 1,
    report_code: null,
    size_bytes: 1000,
    uploaded_at: `2026-09-25T04:${String(i).padStart(2, '0')}:00Z`,
  })) as unknown as Photo[]
}

type Invoice = Tables['invoices']['Row']
type InvoiceLineItem = Tables['invoice_line_items']['Row']
type InvoiceDeduction = Tables['invoice_deductions']['Row']

export const INVOICE_ID = '00000000-0000-4000-8000-000000000401'

export function printInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE_ID,
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    invoice_ref: 'INV-IRC1234-1',
    invoice_type: 'quoted_amounts',
    direction: 'outbound',
    status: 'draft',
    gst_treatment: 'exclusive',
    markup_pct: 0,
    amount_ex_gst: 2000,
    gst: 200,
    amount_inc_gst: 2200,
    issued_date: '2026-10-20',
    notes: 'Thank you for your business.',
    created_at: '2026-10-20T01:00:00Z',
    ...overrides,
  } as unknown as Invoice
}

export function printInvoiceLines(): InvoiceLineItem[] {
  return [
    { id: '00000000-0000-4000-8000-000000000411', description: 'Kitchen ceiling repairs <as quoted>', quantity: 1, line_total: 1200, quote_ref: 'Q-IRC1234-1', sort_order: 1 },
    { id: '00000000-0000-4000-8000-000000000412', description: 'Bathroom floor tiling', quantity: 1, line_total: 800, quote_ref: 'Q-IRC1234-1', sort_order: 2 },
  ].map(li => ({ tenant_id: TENANT_ID, invoice_id: INVOICE_ID, ...li })) as unknown as InvoiceLineItem[]
}

export function printInvoiceDeductions(): InvoiceDeduction[] {
  return [
    { id: '00000000-0000-4000-8000-000000000421', tenant_id: TENANT_ID, invoice_id: INVOICE_ID, description: 'Policy excess paid by insured', amount_inc_gst: 500, sort_order: 1 },
  ] as unknown as InvoiceDeduction[]
}
