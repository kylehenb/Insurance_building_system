import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintButton } from './PrintButton'

export default async function TccPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>
  searchParams: Promise<{ date?: string; time?: string; completedBy?: string; method?: string }>
}) {
  const { quoteId } = await params
  const sp = await searchParams
  const dateContacted = sp.date || ''
  const timeContacted = sp.time || ''
  const completedBy = sp.completedBy || ''
  const contactMethod = sp.method || ''

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!userData) redirect('/login')

  const tenantId = userData.tenant_id

  const { data: quote } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (!quote) return <div>Quote not found</div>

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', quote.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (!job) return <div>Job not found</div>

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (!tenant) return <div>Tenant not found</div>

  const companyName = tenant.trading_name || tenant.name || 'Insurance Repair Co'
  const docNumber = `TCC-${job.job_number}`

  return (
    <div style={{ background: '#e8e4df', fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', display: 'flex', justifyContent: 'center', padding: '40px 16px', minHeight: '100vh' }}>
      <PrintButton jobNumber={job.job_number} />

      <div style={{ background: '#f5f2ee', width: '794px' }}>

        {/* Header band */}
        <div style={{ background: '#1a1a1a', padding: '22px 36px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {tenant.logo_storage_path ? (
              <img
                src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tenant-assets/${tenant.logo_storage_path}`}
                alt="Logo"
                style={{ width: '44px', height: '44px', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ width: '44px', height: '44px', border: '1.5px solid #c9a96e', borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                  <rect x="12" y="3" width="6" height="24" rx="1" fill="#c9a96e"/>
                  <rect x="3" y="12" width="24" height="6" rx="1" fill="#c9a96e"/>
                  <rect x="12" y="3" width="6" height="9" rx="1" fill="#1a1a1a"/>
                  <rect x="12" y="18" width="6" height="9" rx="1" fill="#1a1a1a"/>
                  <rect x="3" y="12" width="9" height="6" rx="1" fill="#1a1a1a"/>
                  <rect x="18" y="12" width="9" height="6" rx="1" fill="#1a1a1a"/>
                </svg>
              </div>
            )}
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.16em', color: '#fff', textTransform: 'uppercase', display: 'block' }}>
                {companyName}
              </span>
              <span style={{ fontSize: '8.5px', fontWeight: 400, letterSpacing: '0.12em', color: '#c9a96e', textTransform: 'uppercase', display: 'block', marginTop: '2px' }}>
                Building &amp; Restoration
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {tenant.address && <span style={{ display: 'block', fontSize: '9.5px', color: '#a09890' }}>{tenant.address}</span>}
            {tenant.contact_email && <span style={{ display: 'block', fontSize: '9.5px', color: '#ccc' }}>{tenant.contact_email}</span>}
            {tenant.contact_phone && <span style={{ display: 'block', fontSize: '9.5px', color: '#ccc' }}>{tenant.contact_phone}</span>}
          </div>
        </div>

        {/* Gold accent stripe */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, #c9a96e, #e8c98a, #c9a96e)' }} />

        {/* Doc type band */}
        <div style={{ background: '#fff', borderBottom: '1px solid #d9d3cb', padding: '16px 36px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a96e' }}>Completion Document</div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '3px 0 0', color: '#1a1a1a' }}>Telephone Clearance Certificate</h1>
          </div>
          <div>
            <span style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6560', display: 'block', textAlign: 'right' }}>Document No.</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '13px', fontWeight: 500 }}>{docNumber}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '28px 36px 36px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Reference table */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                { label: 'Claim No.', value: job.claim_number, mono: true },
                { label: 'IRC Job No.', value: job.job_number, mono: true },
                { label: 'Insurer', value: job.insurer, mono: false },
                { label: 'Property Address', value: job.property_address, mono: false },
                { label: 'Policy Holder', value: job.insured_name, mono: false },
                { label: 'Date Contacted', value: dateContacted, mono: false },
                { label: 'Time Contacted', value: timeContacted, mono: false },
                { label: 'Contact Method', value: contactMethod, mono: false },
                { label: 'Completed By', value: completedBy, mono: false },
              ].map((row, i, arr) => (
                <tr key={row.label}>
                  <td style={{ width: '160px', padding: '6px 16px 6px 0', borderBottom: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none', fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b6560', verticalAlign: 'top' }}>
                    {row.label}
                  </td>
                  <td style={{ padding: '6px 0', borderBottom: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none', fontSize: row.mono ? '12px' : '12.5px', fontWeight: 500, fontFamily: row.mono ? "'DM Mono', monospace" : undefined, verticalAlign: 'top' }}>
                    {row.value || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Statement */}
          <div style={{ borderLeft: '3px solid #c9a96e', background: '#fff', padding: '14px 18px', fontSize: '12.5px', lineHeight: 1.65 }}>
            The policyholder was contacted and confirmed the repairs relating to their insurance claim have been completed satisfactorily by {companyName} Pty Ltd.
          </div>

        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #d9d3cb', background: '#fff', padding: '13px 36px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{companyName} Pty Ltd</div>
            <div style={{ fontSize: '8.5px', color: '#6b6560', marginTop: '2px' }}>
              {tenant.abn && <>ABN {tenant.abn}</>}
              {tenant.abn && tenant.building_licence_number && ' · '}
              {tenant.building_licence_number && <>Builders Licence {tenant.building_licence_number}</>}
            </div>
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '9px', color: '#6b6560' }}>
            {docNumber} · Page 1 of 1
          </div>
        </div>

        {/* Bottom stripe */}
        <div style={{ height: '4px', background: '#1a1a1a' }} />

      </div>
    </div>
  )
}
