import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { PrintButton } from './PrintButton'
import { parsePropertyDetails } from '@/lib/types/property-details'

type Report = Database['public']['Tables']['reports']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

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
    'detached_garage',
    'granny_flat',
  ] as const,

  // Additional insurer-specific key/value rows appended after the make safe block.
  // Empty on the default template. Each entry maps a display label to a key
  // in type_specific_fields JSONB.
  // Example for a future Allianz template:
  // { label: 'Hailstone size', field: 'hailstone_size' }
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
  building_age: 'Building age',
  condition: 'Condition',
  roof_type: 'Roof type',
  wall_type: 'Wall type',
  storeys: 'Storeys',
  foundation: 'Foundation',
  fence: 'Fence',
  pool: 'Swimming pool',
  detached_garage: 'Detached garage',
  granny_flat: 'Granny flat / outbuilding',
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
}

const NARRATIVE_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: 'Property', keys: ['property_description'] },
  { label: 'Incident', keys: ['incident_description', 'cause_of_damage', 'how_damage_occurred'] },
  { label: 'Damage findings', keys: ['resulting_damage'] },
  { label: 'Assessment', keys: ['conclusion', 'pre_existing_conditions', 'maintenance_notes'] },
]

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

  const pd = parsePropertyDetails(job.property_details)

  // Build property table rows from template config
  const propertyFields = DEFAULT_BAR_TEMPLATE.property_table_fields as readonly string[]
  const propertyRows: Array<[string, string] | null> = []
  for (let i = 0; i < propertyFields.length; i += 2) {
    const left = propertyFields[i]
    const right = propertyFields[i + 1]
    propertyRows.push([left, right ?? null] as [string, string] | null)
  }

  // Build narrative sections list
  const activeSections = DEFAULT_BAR_TEMPLATE.narrative_sections as readonly string[]

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

  // TD cell base style
  const tdBase: React.CSSProperties = {
    padding: '5px 10px',
    borderBottom: '1px solid #f0ece6',
    verticalAlign: 'top',
  }
  const tdLabel: React.CSSProperties = {
    ...tdBase,
    color: '#b0a89e',
    fontSize: '10px',
    fontWeight: '600',
    width: '28%',
    whiteSpace: 'nowrap',
  }
  const tdValue: React.CSSProperties = {
    ...tdBase,
    color: '#3a3530',
  }
  const tdLabelLast: React.CSSProperties = { ...tdLabel, borderBottom: 'none' }
  const tdValueLast: React.CSSProperties = { ...tdValue, borderBottom: 'none' }

  const dividerRow = (label: string) => (
    <tr>
      <td
        colSpan={4}
        style={{
          backgroundColor: '#f5f2ee',
          padding: '4px 10px',
          fontSize: '7.5px',
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: '#b0a89e',
          fontWeight: '700',
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
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0">
        <PrintButton reportRef={report.report_ref} jobNumber={job.job_number} />

        {/* Header - 3-column flex */}
        <div style={{ display: 'flex', alignItems: 'stretch', backgroundColor: 'white' }}>
          {/* Column 1: Logo (148px fixed) */}
          <div style={{ width: '148px', minWidth: '148px', padding: '14px 8px 14px 20px', borderRight: '1px solid #e0dbd4' }}>
            <img src="/logo-alt.png" alt="IRC Logo" style={{ width: '100%', height: 'auto', display: 'block', marginBottom: '5px' }} />
            <div style={{ fontSize: '6.5px', letterSpacing: '1.8px', textTransform: 'uppercase', color: '#9e998f', fontWeight: '700', whiteSpace: 'nowrap' }}>INSURANCE REPAIR CO</div>
          </div>

          {/* Column 2: Job details (flex: 1) */}
          <div style={{ flex: 1, padding: '14px 16px', borderRight: '1px solid #e0dbd4' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '7px' }}>JOB DETAILS</div>
            {job.insured_name && (
              <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a', marginBottom: '2px' }}>{job.insured_name}</div>
            )}
            {job.property_address && (
              <div style={{ fontSize: '13px', color: '#9e998f', marginBottom: '10px' }}>{job.property_address}</div>
            )}
            {/* Field strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: '12px' }}>
              {[
                { label: 'Insurer',           value: job.insurer },
                { label: 'Claim #',           value: job.claim_number },
                { label: 'Adjuster',          value: job.adjuster },
                { label: 'Inspection date',   value: formatDate(report.attendance_date) },
              ].map((field, i, arr) => (
                <span key={field.label} style={{ paddingRight: '8px', marginRight: '8px', borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none' }}>
                  <span style={{ color: '#b0a89e' }}>{field.label}: </span>
                  <span style={{ color: '#3a3530' }}>{field.value || '—'}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Column 3: Contact (184px fixed) */}
          <div style={{ width: '184px', minWidth: '184px', padding: '14px 20px 14px 16px' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '7px' }}>CONTACT</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>{tenant.name || 'Kyle Bindon'}</div>
            <div style={{ fontSize: '12px', color: '#9e998f', marginBottom: '2px' }}>kyle@insurancerepairco.com.au</div>
            <div style={{ fontSize: '12px', color: '#9e998f', marginBottom: '2px' }}>0431 132 077</div>
            {/* Badge row */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              {['BC105884', 'IICRC Certified'].map(badge => (
                <span key={badge} style={{ fontSize: '9.5px', background: '#f5f2ee', color: '#6a6460', border: '1px solid #e0dbd4', borderRadius: '3px', padding: '2px 6px', fontWeight: '700' }}>{badge}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Form band */}
        <div style={{ borderTop: '1px solid #e0dbd4', borderBottom: '1px solid #e0dbd4', padding: '4px 20px', display: 'flex', alignItems: 'baseline', position: 'relative' }}>
          <span style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a1a', fontFamily: 'DM Mono, monospace', letterSpacing: '-0.5px' }}>
            {report.report_ref}
          </span>
          <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: '16px', fontWeight: '700', color: '#9e998f', textTransform: 'uppercase', letterSpacing: '2px', whiteSpace: 'nowrap' }}>
            Building Assessment Report
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px 0' }}>

          {/* Metadata table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: '1px solid #e0dbd4', borderRadius: '6px', overflow: 'hidden', fontSize: '11px' }}>
            <tbody>
              {/* Block 1 — Attendance */}
              {dividerRow('Attendance')}
              <tr>
                <td style={tdLabel}>Date attended</td>
                <td style={tdValue}>{formatDate(report.attendance_date)}</td>
                <td style={tdLabel}>Time arrived</td>
                <td style={tdValue}>{formatTime(report.attendance_time)}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Person met</td>
                <td style={tdValue}>{report.person_met || '—'}</td>
                <td style={tdLabel}>Assessor</td>
                <td style={tdValue}>{report.assessor_name || '—'}</td>
              </tr>

              {/* Block 2 — Property details (conditional) */}
              {DEFAULT_BAR_TEMPLATE.show_property_table && (
                <>
                  {dividerRow('Property details')}
                  {(() => {
                    const fields = propertyFields
                    const rows: React.ReactNode[] = []
                    for (let i = 0; i < fields.length; i += 2) {
                      const leftKey = fields[i]
                      const rightKey = fields[i + 1]
                      const isLast = i + 2 >= fields.length
                      rows.push(
                        <tr key={leftKey}>
                          <td style={isLast && !rightKey ? tdLabelLast : tdLabel}>{PROPERTY_FIELD_LABELS[leftKey] ?? leftKey}</td>
                          <td style={isLast && !rightKey ? tdValueLast : tdValue}>{pdText(pd, leftKey)}</td>
                          {rightKey ? (
                            <>
                              <td style={isLast ? tdLabelLast : tdLabel}>{PROPERTY_FIELD_LABELS[rightKey] ?? rightKey}</td>
                              <td style={isLast ? tdValueLast : tdValue}>{pdText(pd, rightKey)}</td>
                            </>
                          ) : (
                            <>
                              <td style={tdLabelLast}></td>
                              <td style={tdValueLast}></td>
                            </>
                          )}
                        </tr>
                      )
                    }
                    return rows
                  })()}
                </>
              )}

              {/* Block 3 — Make safe & specialist */}
              {dividerRow('Make safe & specialist')}
              <tr>
                <td style={tdLabel}>Make safe conducted</td>
                <td style={tdValue}>{tsf(report, 'make_safe_conducted')}</td>
                <td style={tdLabel}>Specialist report obtained</td>
                <td style={tdValue}>{tsf(report, 'specialist_report_obtained')}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Drone utilised</td>
                <td style={tdValue}>{tsf(report, 'drone_utilised')}</td>
                <td style={tdLabel}>Tarp required</td>
                <td style={tdValue}>{tsf(report, 'tarp_required')}</td>
              </tr>

              {/* Block 4 — Insurer-specific rows (conditional) */}
              {DEFAULT_BAR_TEMPLATE.insurer_specific_rows.length > 0 && (
                <>
                  {dividerRow('Additional details')}
                  {(() => {
                    const rows: React.ReactNode[] = []
                    const specific = DEFAULT_BAR_TEMPLATE.insurer_specific_rows
                    for (let i = 0; i < specific.length; i += 2) {
                      const left = specific[i]
                      const right = specific[i + 1]
                      const isLast = i + 2 >= specific.length
                      rows.push(
                        <tr key={left.field}>
                          <td style={isLast && !right ? tdLabelLast : tdLabel}>{left.label}</td>
                          <td style={isLast && !right ? tdValueLast : tdValue}>{tsf(report, left.field)}</td>
                          {right ? (
                            <>
                              <td style={isLast ? tdLabelLast : tdLabel}>{right.label}</td>
                              <td style={isLast ? tdValueLast : tdValue}>{tsf(report, right.field)}</td>
                            </>
                          ) : (
                            <>
                              <td style={tdLabelLast}></td>
                              <td style={tdValueLast}></td>
                            </>
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
                  <div style={{ fontSize: '8px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#c8b89a', fontWeight: '700', paddingTop: '10px', paddingBottom: '4px', borderBottom: '1px solid #e8e4e0', marginBottom: '10px' }}>
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
                          <div style={{ width: '18px', height: '18px', background: '#1a1a1a', color: '#f5f2ee', fontSize: '9px', fontWeight: '700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {num}
                          </div>
                          <div style={{ fontSize: '8.5px', letterSpacing: '1.3px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700' }}>
                            {config.title}
                          </div>
                        </div>
                        <div style={{ background: '#fafaf8', border: '1px solid #e8e4e0', borderRadius: '5px', padding: '9px 11px', fontSize: '11.5px', color: '#3a3530', lineHeight: '1.65', ...(config.leftBorder ? { borderLeft: config.leftBorder } : {}) }}>
                          {value ? value : <span style={{ color: '#9e998f' }}>—</span>}
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

        {/* Footer */}
        <div style={{ background: '#1a1a1a', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '26px', height: '26px', border: '1.5px solid #c8b89a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <img src="/logo.png?v=1" alt="IRC" style={{ height: '16px' }} />
          </div>
          <div>
            <div style={{ fontSize: '7.5px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#f5f2ee', textAlign: 'center' }}>INSURANCE REPAIR CO PTY LTD</div>
            <div style={{ fontSize: '10px', color: '#c8b89a', textAlign: 'center' }}>Building &amp; Restoration</div>
          </div>
          <div style={{ width: '1px', height: '22px', background: '#c8b89a', margin: '0 4px', flexShrink: 0 }}></div>
          <span style={{ fontSize: '12px', color: '#c8b89a' }}>BC105884 · IICRC Certified</span>
          <div style={{ flex: 1 }}></div>
        </div>
      </div>
    </div>
  )
}
