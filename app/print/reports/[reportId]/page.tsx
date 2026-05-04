import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { PrintButton } from './PrintButton'
import { parsePropertyDetails } from '@/lib/types/property-details'

type Report = Database['public']['Tables']['reports']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Photo = Database['public']['Tables']['photos']['Row']

const DEFAULT_BAR_TEMPLATE = {
  // true = render structured property details table block
  // false = render section 1 as a narrative paragraph instead
  show_property_table: true,

  // Which fields to include in the property details table block.
  // Removing a key from this array removes that row from the rendered table.
  property_table_fields: [
    'building_age',
    'condition',
    'roof_type',
    'wall_type',
    'storeys',
    'foundation',
    'fence',
    'pool',
    'granny_flat',
  ] as const,

  // Additional insurer-specific key/value rows appended after the make safe block.
  // Empty on the default template. Each entry maps a display label to a key
  // in type_specific_fields JSONB.
  // Example for a future Allianz template:
  // { label: 'Hailstone size:', field: 'hailstone_size' }
  insurer_specific_rows: [] as Array<{ label: string; field: string }>,

  // Narrative sections to render, in order.
  // Removing an entry from this array removes that section from the document.
  narrative_sections: [
    'incident_description',
    'cause_of_damage',
    'how_damage_occurred',
    'resulting_damage',
    'conclusion',
    'pre_existing_conditions',
    'maintenance_notes',
  ] as const,
}

const LDR_TEMPLATE = {
  // Leak Detection Report specific fields
  leak_details_fields: [
    { label: 'Leak location:', field: 'leak_location' },
    { label: 'Leak source:', field: 'leak_source' },
    { label: 'Water type:', field: 'water_type' },
    { label: 'Duration of leak:', field: 'leak_duration' },
  ] as const,

  investigation_fields: [
    { label: 'Investigation and findings:', field: 'investigation_findings' },
  ] as const,

  damage_fields: [
    { label: 'Affected areas:', field: 'affected_areas' },
  ] as const,

  recommendation_fields: [
    { label: 'Repair recommendations:', field: 'repair_recommendations' },
    { label: 'Further investigation by plumber required:', field: 'further_investigation_plumber' },
  ] as const,

  pressure_test_fields: [
    { label: 'Shower Breach pressure test:', field: 'shower_breach_test' },
    { label: 'Cold Water line pressure test:', field: 'cold_water_test' },
    { label: 'Hot water line pressure test:', field: 'hot_water_test' },
    { label: 'Flood test to shower base:', field: 'shower_flood_test' },
    { label: 'Spray test to shower walls & screen:', field: 'shower_spray_test' },
    { label: 'Visual inspection to tiles, grout & silicone:', field: 'tiles_grout_test' },
    { label: 'Inspection to flexi-hose:', field: 'flexi_hose_test' },
    { label: 'Inspection to water pipe:', field: 'water_pipe_test' },
    { label: 'Inspection of toilet pan/cistern:', field: 'toilet_test' },
    { label: 'Thermal Imaging:', field: 'thermal_imaging_test' },
  ] as const,

  narrative_sections: [
    'conclusion',
    'pre_existing_conditions',
  ] as const,
}

function tsf(report: Report, key: string): string {
  const fields = report.type_specific_fields as Record<string, unknown> | null
  if (!fields) return '—'
  const val = fields[key]
  if (val === null || val === undefined || val === '') return '—'
  return String(val)
}

function pdText(pd: ReturnType<typeof parsePropertyDetails>, key: string): string {
  const val = (pd as Record<string, unknown>)[key]
  if (val === null || val === undefined || val === '') return '—'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  return String(val)
}

const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const formatTime = (time: string | null) => {
  if (!time) return '—'
  // time is stored as HH:MM:SS — format to h:mm AM/PM
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

const PROPERTY_FIELD_LABELS: Record<string, string> = {
  building_age: 'Building age:',
  condition: 'Condition:',
  roof_type: 'Roof type:',
  wall_type: 'Wall type:',
  storeys: 'Storeys:',
  foundation: 'Foundation:',
  fence: 'Fence:',
  pool: 'Swimming pool:',
  detached_garage: 'Detached garage:',
  granny_flat: 'Granny flat / outbuilding:',
}

const NARRATIVE_SECTION_CONFIG: Record<
  string,
  {
    title: string
    getValue: (report: Report) => string | null
    leftBorder?: string
  }
> = {
  property_description: { title: 'Property description', getValue: (r) => r.property_description },
  incident_description: { title: 'Incident description', getValue: (r) => r.incident_description },
  cause_of_damage: { title: 'Cause of damage', getValue: (r) => r.cause_of_damage },
  how_damage_occurred: { title: 'How damage occurred', getValue: (r) => r.how_damage_occurred },
  resulting_damage: { title: 'Resulting damage', getValue: (r) => r.resulting_damage },
  conclusion: { title: 'Conclusion', getValue: (r) => r.conclusion },
  pre_existing_conditions: {
    title: 'Pre-existing conditions',
    getValue: (r) => r.pre_existing_conditions,
    leftBorder: '3px solid #c8b89a',
  },
  maintenance_notes: {
    title: 'Maintenance notes',
    getValue: (r) => r.maintenance_notes,
    leftBorder: '3px solid #e0dbd4',
  },
  additional_notes: {
    title: 'Additional notes',
    getValue: (r) => r.additional_notes,
  },
  investigation_findings: {
    title: 'Investigation and findings',
    getValue: (r) => tsf(r, 'investigation_findings'),
  },
}

const NARRATIVE_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: 'Property', keys: ['property_description'] },
  { label: 'Incident', keys: ['incident_description', 'cause_of_damage', 'how_damage_occurred'] },
  { label: 'Damage findings', keys: ['resulting_damage'] },
  { label: 'Assessment', keys: ['conclusion', 'pre_existing_conditions', 'maintenance_notes', 'additional_notes'] },
]

// Function to preserve text formatting (newlines, bullet points, paragraphs)
function formatTextWithPreservedFormatting(text: string | null): React.ReactNode {
  if (!text) return <span style={{ color: '#9e998f' }}>—</span>
  
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    
    // Check if line is a bullet point (starts with •, -, *, or digits followed by . or ))
    const isBullet = /^[•\-\*]\s/.test(trimmed) || /^\d+[\.)]\s/.test(trimmed)
    
    if (isBullet) {
      nodes.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '4px' }}>
          <span style={{ marginRight: '8px', color: '#3a3530' }}>{trimmed[0]}</span>
          <span style={{ flex: 1 }}>{trimmed.substring(1).trim()}</span>
        </div>
      )
    } else if (trimmed === '') {
      // Empty line - add paragraph break
      nodes.push(<div key={i} style={{ height: '8px' }} />)
    } else {
      // Regular text line
      nodes.push(<div key={i} style={{ marginBottom: '2px' }}>{line}</div>)
    }
  }
  
  return <>{nodes}</>
}

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params

  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Get user's tenant_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    redirect('/login')
  }

  const tenantId = userData.tenant_id

  // Fetch report
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .eq('tenant_id', tenantId)
    .single()

  if (reportError || !report) {
    return <div>Report not found</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', report.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return <div>Job not found</div>
  }

  // Fetch tenant details
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    return <div>Tenant not found</div>
  }

  // Fetch photos for this report
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('*')
    .eq('report_id', reportId)
    .eq('tenant_id', tenantId)
    .order('sequence_number', { ascending: true })

  const pd = parsePropertyDetails(job.property_details)

  // Build property table rows from template config
  const propertyFields = DEFAULT_BAR_TEMPLATE.property_table_fields as readonly string[]
  const propertyRows: Array<[string, string] | null> = []
  for (let i = 0; i < propertyFields.length; i += 2) {
    const left = propertyFields[i]
    const right = propertyFields[i + 1]
    propertyRows.push([left, right ?? null] as [string, string] | null)
  }

  // Build narrative sections list based on report type
  const activeSections = (report.report_type === 'LDR' 
    ? LDR_TEMPLATE.narrative_sections 
    : DEFAULT_BAR_TEMPLATE.narrative_sections) as readonly string[]

  // If show_property_table is false, prepend property_description as section 1
  const allSections: Array<{ key: string; groupKey?: string }> = []
  if (!DEFAULT_BAR_TEMPLATE.show_property_table) {
    allSections.push({ key: 'property_description', groupKey: 'property' })
  }
  for (const key of activeSections) {
    allSections.push({ key })
  }

  // Assign sequential section numbers
  let sectionCounter = 0

  // TD cell base style (3-column layout with label + value in same cell)
  const tdBase: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid #f0ece6',
    verticalAlign: 'top',
    width: '33.33%',
  }
  const tdCell: React.CSSProperties = {
    ...tdBase,
  }
  const tdCellLast: React.CSSProperties = { ...tdCell, borderBottom: 'none' }
  const cellContentStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
  }
  const labelStyle: React.CSSProperties = {
    color: '#6a6460',
    fontSize: '9px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    marginRight: '6px',
  }
  const valueStyle: React.CSSProperties = {
    color: '#1a1a1a',
    fontSize: '11px',
    fontWeight: '500',
  }

  const dividerRow = (label: string) => (
    <tr>
      <td
        colSpan={3}
        style={{
          backgroundColor: '#f5f2ee',
          padding: '4px 10px',
          fontSize: '8px',
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: '#6a6460',
          fontWeight: '800',
          borderBottom: '1px solid #e0dbd4',
        }}
      >
        {label}
      </td>
    </tr>
  )

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Document container */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0" style={{ fontFamily: 'var(--font-dm-sans), sans-serif' }}>
        <PrintButton reportRef={report.report_ref} jobNumber={job.job_number} />

        {/* Header - 3-column flex (matching invoice layout) */}
        <div style={{ display: 'flex', alignItems: 'stretch', backgroundColor: 'white' }}>
          {/* Column 1: Logo (148px fixed) */}
          <div style={{ width: '148px', minWidth: '148px', padding: '14px 8px 14px 20px', borderRight: '1px solid #e0dbd4' }}>
            <img src="/logo-alt.png" alt="IRC Logo" style={{ width: '100%', height: 'auto', display: 'block', marginBottom: '5px' }} />
            <div style={{ fontSize: '6.5px', letterSpacing: '1.8px', textTransform: 'uppercase', color: '#9e998f', fontWeight: '700', whiteSpace: 'nowrap' }}>INSURANCE REPAIR CO</div>
          </div>

          {/* Column 2: Report & Job details (flex: 1) */}
          <div style={{ flex: 1, padding: '14px 10px', borderRight: '1px solid #e0dbd4' }}>
            {/* Report Details */}
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '7px' }}>REPORT DETAILS</div>
            <div style={{ display: 'flex', gap: '24px', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#9e998f' }}>Report Reference: </span>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{report.report_ref || '—'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: '12px', marginTop: '6px' }}>
              {[
                { label: 'Report date', value: formatDate(new Date().toISOString()) },
              ].filter(f => f.value).map((field, i, arr) => (
                <span key={field.label} style={{ paddingRight: '8px', marginRight: '8px', borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none' }}>
                  <span style={{ color: '#b0a89e' }}>{field.label}: </span>
                  <span style={{ color: '#3a3530' }}>{field.value || '—'}</span>
                </span>
              ))}
            </div>

            {/* Job Details */}
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginTop: '12px', marginBottom: '7px' }}>JOB DETAILS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: '12px' }}>
              {[
                { label: 'Insurer', value: job.insurer },
                { label: 'Property Address', value: job.property_address },
                { label: 'Insured', value: job.insured_name },
                { label: 'Claim #', value: job.claim_number },
                { label: 'Job #', value: job.job_number },
              ].filter(f => f.value).map((field, i, arr) => (
                <span key={field.label} style={{ paddingRight: '8px', marginRight: '8px', borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none' }}>
                  <span style={{ color: '#b0a89e' }}>{field.label}: </span>
                  <span style={{ color: '#3a3530' }}>{field.value || '—'}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Column 3: Contact (184px fixed) */}
          <div style={{ width: '184px', minWidth: '184px', padding: '14px 26px 14px 10px' }}>
            <div style={{ fontSize: '9.5px', letterSpacing: '1.3px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '7px' }}>INSURANCE REPAIR CO</div>
            <div style={{ fontSize: '10px', color: '#3a3530', marginBottom: '3px' }}>{tenant.address || '—'}</div>
            <div style={{ fontSize: '10px', color: '#3a3530', marginBottom: '3px' }}>{tenant.contact_email || '—'}</div>
            <div style={{ fontSize: '10px', color: '#3a3530' }}>{tenant.contact_phone || '—'}</div>
          </div>
        </div>

        {/* Form band */}
        <div style={{ borderTop: '1px solid #e0dbd4', borderBottom: '1px solid #e0dbd4', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: '14px' }}>
          <span style={{ fontSize: '28px', fontWeight: '700', color: '#9e998f', textTransform: 'uppercase', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
            {report.report_type === 'LDR' ? 'Leak Detection Report' : 'Building Assessment Report'}
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '0 20px' }}>

          {/* Metadata table - 3-column layout */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: '1px solid #e0dbd4', borderRadius: '6px', overflow: 'hidden', fontSize: '11px' }}>
            <tbody>
              {/* Block 1 — Attendance */}
              {dividerRow('Attendance')}
              <tr>
                <td style={tdCell}>
                  <div style={cellContentStyle}>
                    <span style={labelStyle}>Date attended:</span>
                    <span style={valueStyle}>{formatDate(report.attendance_date)}</span>
                  </div>
                </td>
                <td style={tdCell}>
                  <div style={cellContentStyle}>
                    <span style={labelStyle}>Time arrived:</span>
                    <span style={valueStyle}>{formatTime(report.attendance_time)}</span>
                  </div>
                </td>
                <td style={tdCell}>
                  <div style={cellContentStyle}>
                    <span style={labelStyle}>Person met:</span>
                    <span style={valueStyle}>{report.person_met || '—'}</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td style={tdCell}>
                  <div style={cellContentStyle}>
                    <span style={labelStyle}>{report.report_type === 'LDR' ? 'Conducted by:' : 'Assessor:'}</span>
                    <span style={valueStyle}>{report.assessor_name || '—'}</span>
                  </div>
                </td>
                <td style={tdCell}>
                  <div style={cellContentStyle}>
                    <span style={labelStyle}>Email:</span>
                    <span style={valueStyle}>{tenant.contact_email || '—'}</span>
                  </div>
                </td>
                <td style={tdCell}>
                  <div style={cellContentStyle}>
                    <span style={labelStyle}>Phone:</span>
                    <span style={valueStyle}>{tenant.contact_phone || '—'}</span>
                  </div>
                </td>
              </tr>

              {/* Block 2 — Property details (conditional, BAR only) */}
              {DEFAULT_BAR_TEMPLATE.show_property_table && report.report_type !== 'LDR' && (
                <>
                  {dividerRow('Property details')}
                  {(() => {
                    const fields = propertyFields
                    const rows: React.ReactNode[] = []
                    // Process fields in groups of 3 for 3-column layout
                    for (let i = 0; i < fields.length; i += 3) {
                      const key1 = fields[i]
                      const key2 = fields[i + 1]
                      const key3 = fields[i + 2]
                      const isLast = i + 3 >= fields.length
                      
                      rows.push(
                        <tr key={key1}>
                          <td style={isLast ? tdCellLast : tdCell}>
                            <div style={cellContentStyle}>
                              <span style={labelStyle}>{PROPERTY_FIELD_LABELS[key1] ?? key1}</span>
                              <span style={valueStyle}>{pdText(pd, key1)}</span>
                            </div>
                          </td>
                          {key2 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{PROPERTY_FIELD_LABELS[key2] ?? key2}</span>
                                <span style={valueStyle}>{pdText(pd, key2)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                          {key3 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{PROPERTY_FIELD_LABELS[key3] ?? key3}</span>
                                <span style={valueStyle}>{pdText(pd, key3)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 2 — Pressure Tests (LDR only) */}
              {report.report_type === 'LDR' && (
                <>
                  {dividerRow('Pressure tests & inspections')}
                  {(() => {
                    const fields = LDR_TEMPLATE.pressure_test_fields
                    const rows: React.ReactNode[] = []
                    for (let i = 0; i < fields.length; i += 3) {
                      const item1 = fields[i]
                      const item2 = fields[i + 1]
                      const item3 = fields[i + 2]
                      const isLast = i + 3 >= fields.length
                      
                      rows.push(
                        <tr key={item1.field}>
                          <td style={isLast ? tdCellLast : tdCell}>
                            <div style={cellContentStyle}>
                              <span style={labelStyle}>{item1.label}</span>
                              <span style={valueStyle}>{tsf(report, item1.field)}</span>
                            </div>
                          </td>
                          {item2 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item2.label}</span>
                                <span style={valueStyle}>{tsf(report, item2.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                          {item3 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item3.label}</span>
                                <span style={valueStyle}>{tsf(report, item3.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 3 — Make safe & specialist (BAR only) */}
              {report.report_type !== 'LDR' && (
                <>
                  {dividerRow('Make safe & specialist')}
                  <tr>
                    <td style={tdCellLast}>
                      <div style={cellContentStyle}>
                        <span style={labelStyle}>Make safe conducted:</span>
                        <span style={valueStyle}>{tsf(report, 'make_safe_conducted')}</span>
                      </div>
                    </td>
                    <td style={tdCellLast}>
                      <div style={cellContentStyle}>
                        <span style={labelStyle}>Specialist report obtained:</span>
                        <span style={valueStyle}>{tsf(report, 'specialist_report_obtained')}</span>
                      </div>
                    </td>
                    <td style={tdCellLast}></td>
                  </tr>
                </>
              )}

              {/* Block 3 — Leak Details (LDR only) */}
              {report.report_type === 'LDR' && (
                <>
                  {dividerRow('Leak details')}
                  {(() => {
                    const fields = LDR_TEMPLATE.leak_details_fields
                    const rows: React.ReactNode[] = []
                    for (let i = 0; i < fields.length; i += 3) {
                      const item1 = fields[i]
                      const item2 = fields[i + 1]
                      const item3 = fields[i + 2]
                      const isLast = i + 3 >= fields.length
                      
                      rows.push(
                        <tr key={item1.field}>
                          <td style={isLast ? tdCellLast : tdCell}>
                            <div style={cellContentStyle}>
                              <span style={labelStyle}>{item1.label}</span>
                              <span style={valueStyle}>{tsf(report, item1.field)}</span>
                            </div>
                          </td>
                          {item2 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item2.label}</span>
                                <span style={valueStyle}>{tsf(report, item2.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                          {item3 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item3.label}</span>
                                <span style={valueStyle}>{tsf(report, item3.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 4 — Investigation & Findings (LDR only) */}
              {report.report_type === 'LDR' && (
                <>
                  {dividerRow('Investigation and findings')}
                  {(() => {
                    const fields = LDR_TEMPLATE.investigation_fields
                    const rows: React.ReactNode[] = []
                    for (let i = 0; i < fields.length; i += 3) {
                      const item1 = fields[i]
                      const item2 = fields[i + 1]
                      const item3 = fields[i + 2]
                      const isLast = i + 3 >= fields.length
                      
                      rows.push(
                        <tr key={item1.field}>
                          <td style={isLast ? tdCellLast : tdCell} colSpan={3}>
                            <div style={cellContentStyle}>
                              <span style={labelStyle}>{item1.label}</span>
                              <span style={valueStyle}>{tsf(report, item1.field)}</span>
                            </div>
                          </td>
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 5 — Damage Assessment (LDR only) */}
              {report.report_type === 'LDR' && (
                <>
                  {dividerRow('Damage assessment')}
                  {(() => {
                    const fields = LDR_TEMPLATE.damage_fields
                    const rows: React.ReactNode[] = []
                    for (let i = 0; i < fields.length; i += 3) {
                      const item1 = fields[i]
                      const item2 = fields[i + 1]
                      const item3 = fields[i + 2]
                      const isLast = i + 3 >= fields.length
                      
                      rows.push(
                        <tr key={item1.field}>
                          <td style={isLast ? tdCellLast : tdCell}>
                            <div style={cellContentStyle}>
                              <span style={labelStyle}>{item1.label}</span>
                              <span style={valueStyle}>{tsf(report, item1.field)}</span>
                            </div>
                          </td>
                          {item2 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item2.label}</span>
                                <span style={valueStyle}>{tsf(report, item2.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                          {item3 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item3.label}</span>
                                <span style={valueStyle}>{tsf(report, item3.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 6 — Recommendations (LDR only) */}
              {report.report_type === 'LDR' && (
                <>
                  {dividerRow('Recommendations')}
                  {(() => {
                    const fields = LDR_TEMPLATE.recommendation_fields
                    const rows: React.ReactNode[] = []
                    for (let i = 0; i < fields.length; i += 3) {
                      const item1 = fields[i]
                      const item2 = fields[i + 1]
                      const item3 = fields[i + 2]
                      const isLast = i + 3 >= fields.length
                      
                      rows.push(
                        <tr key={item1.field}>
                          <td style={isLast ? tdCellLast : tdCell}>
                            <div style={cellContentStyle}>
                              <span style={labelStyle}>{item1.label}</span>
                              <span style={valueStyle}>{tsf(report, item1.field)}</span>
                            </div>
                          </td>
                          {item2 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item2.label}</span>
                                <span style={valueStyle}>{tsf(report, item2.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                          {item3 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={cellContentStyle}>
                                <span style={labelStyle}>{item3.label}</span>
                                <span style={valueStyle}>{tsf(report, item3.field)}</span>
                              </div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 4 — Insurer-specific rows (conditional) */}
              {DEFAULT_BAR_TEMPLATE.insurer_specific_rows.length > 0 && (
                <>
                  {dividerRow('Additional details')}
                  {(() => {
                    const rows: React.ReactNode[] = []
                    const specific = DEFAULT_BAR_TEMPLATE.insurer_specific_rows
                    for (let i = 0; i < specific.length; i += 3) {
                      const item1 = specific[i]
                      const item2 = specific[i + 1]
                      const item3 = specific[i + 2]
                      const isLast = i + 3 >= specific.length
                      
                      rows.push(
                        <tr key={item1.field}>
                          <td style={isLast ? tdCellLast : tdCell}>
                            <div style={labelStyle}>{item1.label}</div>
                            <div style={valueStyle}>{tsf(report, item1.field)}</div>
                          </td>
                          {item2 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={labelStyle}>{item2.label}</div>
                              <div style={valueStyle}>{tsf(report, item2.field)}</div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                          {item3 ? (
                            <td style={isLast ? tdCellLast : tdCell}>
                              <div style={labelStyle}>{item3.label}</div>
                              <div style={valueStyle}>{tsf(report, item3.field)}</div>
                            </td>
                          ) : (
                            <td style={isLast ? tdCellLast : tdCell}></td>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}
            </tbody>
          </table>

          {/* Narrative sections */}
          {(() => {
            const nodes: React.ReactNode[] = []

            // Render narrative groups
            for (const group of NARRATIVE_GROUPS) {
              const visibleKeys = group.keys.filter(k => {
                // Only show property_description if show_property_table is false
                if (k === 'property_description' && DEFAULT_BAR_TEMPLATE.show_property_table) {
                  return false
                }
                return activeSections.includes(k)
              })
              if (visibleKeys.length === 0) continue

              nodes.push(
                <div key={`group-${group.label}`}>
                  <div style={{ fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#6a6460', fontWeight: '800', paddingTop: '10px', paddingBottom: '4px', borderBottom: '1px solid #e8e4e0', marginBottom: '10px' }}>
                    {group.label}
                  </div>
                  {visibleKeys.map(key => {
                    sectionCounter++
                    const num = sectionCounter
                    const config = NARRATIVE_SECTION_CONFIG[key]
                    const value = config.getValue(report)
                    return (
                      <div key={key} style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
                          <div style={{ width: '18px', height: '18px', border: '1.5px solid #1a1a1a', color: '#1a1a1a', fontSize: '9px', fontWeight: '700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {num}
                          </div>
                          <div style={{ fontSize: '9px', letterSpacing: '1.3px', textTransform: 'uppercase', color: '#6a6460', fontWeight: '800' }}>
                            {config.title}
                          </div>
                        </div>
                        <div style={{ background: '#fafaf8', border: '1px solid #e8e4e0', borderRadius: '5px', padding: '9px 11px', fontSize: '11.5px', color: '#3a3530', lineHeight: '1.65', ...(config.leftBorder ? { borderLeft: config.leftBorder } : {}) }}>
                          {formatTextWithPreservedFormatting(value)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            }

            return nodes
          })()}
        </div>

        {/* Bottom padding */}
        <div style={{ paddingBottom: '60px' }} />

        {/* Quote Section (BAR only) */}
        {report.report_type !== 'LDR' && (
          <div style={{ marginTop: '24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#6a6460', fontWeight: '800', marginBottom: '8px' }}>
              QUOTE
            </div>
            <div style={{ background: '#fafaf8', border: '1px solid #e8e4e0', borderRadius: '5px', padding: '9px 11px', fontSize: '11.5px', color: '#3a3530', lineHeight: '1.65' }}>
              Refer to the separately attached quote for information relating to the proposed repair scope and costs.
            </div>
          </div>
        )}

        {/* Photos Section */}
        {photos && photos.length > 0 && (
          <>
            <div style={{ marginTop: '24px', marginBottom: '16px' }}>
              <div style={{ fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#6a6460', fontWeight: '800', marginBottom: '8px' }}>
                PHOTOGRAPHS
              </div>
            </div>
            
            {/* Photo grid - 6 per page (2x3 layout) */}
            {(() => {
              const photoPages: Photo[][] = []
              for (let i = 0; i < photos.length; i += 6) {
                photoPages.push(photos.slice(i, i + 6))
              }
              
              return photoPages.map((pagePhotos, pageIndex) => (
                <div key={pageIndex} style={{ marginBottom: pageIndex < photoPages.length - 1 ? '32px' : '0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                    {pagePhotos.map((photo, photoIndex) => {
                      const globalSequence = pageIndex * 6 + photoIndex + 1
                      return (
                        <div key={photo.id} style={{ breakInside: 'avoid' }}>
                          <div style={{ 
                            aspectRatio: '4/3', 
                            background: '#f5f2ee', 
                            borderRadius: '6px', 
                            overflow: 'hidden',
                            border: '1px solid #e0dbd4',
                            marginBottom: '8px'
                          }}>
                            <img 
                              src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${photo.storage_path}?width=800&height=600`}
                              alt={photo.label || photo.file_name || 'Photo'}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </div>
                          {photo.label && (
                            <div style={{ fontSize: '10px', color: '#3a3530', fontWeight: '500', textAlign: 'center' }}>
                              {globalSequence}. {photo.label}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {pageIndex < photoPages.length - 1 && (
                    <div style={{ height: '32px' }} />
                  )}
                </div>
              ))
            })()}
          </>
        )}

        {/* Footer - matching invoice footer */}
        <div style={{ paddingTop: '32px' }}>
          <div style={{ background: '#1a1a1a', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {tenant.logo_storage_path ? (
              <img 
                src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${tenant.logo_storage_path}`} 
                alt="Tenant Logo" 
                style={{ width: '26px', height: '26px', objectFit: 'contain', flexShrink: 0 }} 
              />
            ) : (
              <div style={{ width: '26px', height: '26px', border: '1.5px solid #c8b89a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '9px', fontWeight: '800', color: '#c8b89a', fontStyle: 'italic' }}>
                IRC.
              </div>
            )}
            <div>
              <div style={{ fontSize: '7.5px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#f5f2ee' }}>
                {tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD'}
              </div>
              <div style={{ fontSize: '10px', color: '#c8b89a' }}>Building &amp; Restoration</div>
            </div>
            <div style={{ width: '1px', height: '22px', background: '#c8b89a', margin: '0 4px', flexShrink: 0 }}></div>
            <span style={{ fontSize: '12px', color: '#c8b89a' }}>
              {(tenant.trading_name || tenant.name || 'INSURANCE REPAIR CO PTY LTD').toUpperCase()} • ABN {tenant.abn || '—'} • BUILDERS LIC. {tenant.building_licence_number || '—'}
            </span>
            <div style={{ flex: 1 }}></div>
          </div>
        </div>
      </div>
    </div>
  )
}
