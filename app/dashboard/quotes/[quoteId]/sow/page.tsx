import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { SowPrintButton } from './SowPrintButton'
import { SendForSignatureButton } from './SendForSignatureButton'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

export default async function SowPrintPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = await params

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

  // Fetch quote
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (quoteError || !quote) {
    return <div>Quote not found</div>
  }

  // Fetch scope items
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return <div>Error fetching scope items</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', quote.job_id)
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

  const formatDate = (date: string | null) => {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '$0.00'
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
  }

  const items = (scopeItems || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  // Group items by room
  const groupedByRoom = items.reduce((acc, item) => {
    const room = item.room || 'Unassigned'
    if (!acc[room]) {
      acc[room] = []
    }
    acc[room].push(item)
    return acc
  }, {} as Record<string, ScopeItem[]>)

  // Sort rooms based on room_order from quote if available
  const sortedRooms = (() => {
    const roomNames = Object.keys(groupedByRoom)
    if (quote.room_order && quote.room_order.length > 0) {
      const orderMap = new Map(quote.room_order.map((r, i) => [r, i]))
      return roomNames.sort((a, b) => {
        const aIdx = orderMap.get(a) ?? 999
        const bIdx = orderMap.get(b) ?? 999
        return aIdx - bIdx
      })
    }
    return roomNames.sort((a, b) => a.localeCompare(b))
  })()

  const excessValue = job.excess != null && job.excess !== 0 ? fmt(job.excess) : 'N/A'

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Document container */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0">
        <SowPrintButton jobNumber={job.job_number} />
        <SendForSignatureButton quoteId={quoteId} insuredEmail={job.insured_email ?? null} />

        {/* Header - 3-column grid */}
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
                { label: 'Insurer',  value: job.insurer },
                { label: 'Claim #', value: job.claim_number },
                { label: 'Adjuster', value: job.adjuster },
                { label: 'Date',     value: formatDate(quote.created_at) },
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
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Kyle Bindon</div>
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
        <div style={{ borderTop: '1px solid #e0dbd4', borderBottom: '1px solid #e0dbd4', padding: '4px 20px', display: 'flex', alignItems: 'baseline', gap: '16px' }}>
          <span style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a1a', fontFamily: 'DM Mono, monospace', letterSpacing: '-0.5px' }}>
            {quote.quote_ref}-SOW
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '16px', fontWeight: '700', color: '#9e998f', textTransform: 'uppercase', letterSpacing: '2px' }}>
            Scope of Works &amp; Works Authority
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 20px 0' }}>

          {/* 1. Agreement section */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '6px' }}>
              AGREEMENT
            </div>
            <p style={{ fontSize: '11px', color: '#3a3530', lineHeight: '1.7', marginBottom: '12px' }}>
              Insurance Repair Co Pty Ltd (ACN 686 067 881, Builder Licence BC105884, hereinafter referred to as{' '}
              <span style={{ fontWeight: '600', color: '#1a1a1a' }}>&quot;IRC&quot;</span>
              {' '}agrees to carry out the repair works described below at the property listed above. These works have been approved by your insurer in relation to the claim referenced above. This document constitutes your authority for works to proceed and must be signed prior to commencement.
            </p>
          </div>

          {/* 2. Key details box */}
          <div style={{ background: '#f5f2ee', borderRadius: '6px', padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
            {/* Left cell */}
            <div>
              <div style={{ fontSize: '9px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '2px' }}>
                WORKS COMMENCEMENT &amp; ESTIMATED DURATION
              </div>
              <div style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: '600' }}>Subject to scheduling</div>
            </div>
            {/* Right cell */}
            <div>
              <div style={{ fontSize: '9px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '2px' }}>
                EXCESS PAYABLE TO IRC
              </div>
              <div style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: '600' }}>{excessValue}</div>
            </div>
          </div>

          {/* 3. Scope of works table */}
          <div style={{ marginBottom: '0' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '6px' }}>
              APPROVED SCOPE OF WORKS
            </div>

            {/* Table header */}
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#fafaf8', borderBottom: '1px solid #e8e4e0' }}>
                  <th style={{ width: '28px', textAlign: 'center', padding: '6px 4px', fontSize: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', color: '#b0a89e' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', color: '#b0a89e' }}>Description of works</th>
                  <th style={{ width: '44px', textAlign: 'center', padding: '6px 4px', fontSize: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', color: '#b0a89e' }}>Qty</th>
                  <th style={{ width: '44px', textAlign: 'center', padding: '6px 4px', fontSize: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', color: '#b0a89e' }}>Unit</th>
                  <th style={{ width: '80px', textAlign: 'left', padding: '6px 8px', fontSize: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px', color: '#b0a89e' }}>Trade</th>
                </tr>
              </thead>
            </table>

            {/* Rooms and items */}
            {(() => {
              let globalCounter = 0
              return sortedRooms.map((room) => {
                const roomItems = groupedByRoom[room]
                const itemWithDimensions = roomItems.find(
                  item => item.room_length != null || item.room_width != null || item.room_height != null
                )
                const roomLength = itemWithDimensions?.room_length
                const roomWidth = itemWithDimensions?.room_width
                const roomHeight = itemWithDimensions?.room_height
                const hasDimensions = roomLength != null || roomWidth != null || roomHeight != null
                const roomSizeStr = hasDimensions
                  ? `${roomLength != null ? roomLength : '—'} × ${roomWidth != null ? roomWidth : '—'} × ${roomHeight != null ? roomHeight : '—'} m`
                  : ''

                return (
                  <div key={room} style={{ marginBottom: '8px' }}>
                    {/* Room header */}
                    <div style={{ padding: '4px 12px', borderBottom: '1px solid #e0dbd4', backgroundColor: '#f5f2ee' }}>
                      <span style={{ fontWeight: '700', color: '#3a3530', fontSize: '12px', textTransform: 'uppercase', fontFamily: 'var(--font-dm-sans)' }}>
                        {room}
                      </span>
                      {hasDimensions && (
                        <span style={{ fontSize: '12px', color: '#9e998f', fontFamily: 'var(--font-dm-mono)', marginLeft: '8px' }}>{roomSizeStr}</span>
                      )}
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <tbody>
                        {roomItems.map((item) => {
                          globalCounter++
                          return (
                            <tr key={item.id} style={{ borderBottom: '1px solid #f0ece6' }}>
                              <td style={{ width: '28px', padding: '6px 4px', textAlign: 'center', fontFamily: 'var(--font-dm-mono)', fontSize: '10px', color: '#3a3530' }}>{globalCounter}</td>
                              <td style={{ padding: '6px 8px', fontSize: '10px', color: '#3a3530', lineHeight: '1.5' }}>{item.item_description || '-'}</td>
                              <td style={{ width: '44px', padding: '6px 4px', textAlign: 'center', fontSize: '10px', color: '#3a3530' }}>{item.qty || '-'}</td>
                              <td style={{ width: '44px', padding: '6px 4px', textAlign: 'center', fontSize: '10px', color: '#3a3530' }}>{item.unit || '-'}</td>
                              <td style={{ width: '80px', padding: '6px 8px', fontSize: '10px', color: '#3a3530' }}>{item.trade || '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })
            })()}
          </div>

          {/* 4. Conditions of works */}
          <div style={{ marginTop: '14px', marginBottom: '14px' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '6px' }}>
              CONDITIONS OF WORKS
            </div>
            <div style={{ background: '#f5f2ee', borderRadius: '6px', padding: '12px 14px' }}>
              {[
                'Works will be carried out by tradespeople engaged by IRC. All works are covered by a workmanship warranty from date of completion as stipulated by general consumer laws and the Building Services (Complaint Resolution and Administration) Act.',
                'The scope above reflects works approved by your insurer. Any additional works identified on site will be referred back to your insurer for approval before proceeding.',
                'Access to the property must be provided at agreed times. To avoid rescheduling delays, please ensure access can be obtained at those agreed times.',
                'Your policy excess (if applicable) is payable directly to IRC upon completion of works. IRC will issue a tax invoice for this amount.',
                'Matching of existing materials (tiles, paint, flooring) is not guaranteed. IRC will make every reasonable effort to match existing finishes.',
              ].map((text, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', fontSize: '10px', color: '#3a3530', lineHeight: '1.65', marginBottom: idx < 4 ? '6px' : '0' }}>
                  <span style={{ color: '#b0a89e', fontFamily: 'var(--font-dm-mono)', flexShrink: 0 }}>{idx + 1}.</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Declaration */}
          <div style={{ border: '1px solid #e0dbd4', borderRadius: '6px', borderLeft: '3px solid #c8b89a', padding: '10px 14px', marginBottom: '14px' }}>
            <p style={{ fontSize: '10px', color: '#6a6460', lineHeight: '1.7', margin: 0 }}>
              By signing below, the owner/occupant confirms they have read and understood the scope of works and conditions above, authorise IRC to proceed with the approved works, and acknowledge that they have had the opportunity to seek independent advice prior to signing.
            </p>
          </div>

          {/* 6. Signing section */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '10px' }}>
              AUTHORISATION &amp; SIGNATURES
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              {/* LEFT — Owner/Insured */}
              <div style={{ border: '1px solid #e0dbd4', borderRadius: '6px', padding: '12px 14px' }}>
                <div style={{ fontSize: '9px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '3px' }}>
                  OWNER / INSURED
                </div>
                <div style={{ fontSize: '11px', color: '#6a6460', marginBottom: '12px' }}>{job.insured_name || '—'}</div>

                {/* Signature box */}
                <div style={{ borderBottom: '1px solid #c8b89a', height: '52px', marginBottom: '10px', position: 'relative' }}>
                  <span style={{ fontSize: '8px', color: '#b0a89e', position: 'absolute', bottom: '4px', left: '0' }}>Signature</span>
                </div>

                {/* Sub-row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ borderBottom: '1px solid #e0dbd4', paddingBottom: '14px' }}>
                    <div style={{ fontSize: '8px', color: '#b0a89e' }}>Full name (print)</div>
                  </div>
                  <div style={{ borderBottom: '1px solid #e0dbd4', paddingBottom: '14px' }}>
                    <div style={{ fontSize: '8px', color: '#b0a89e' }}>Date</div>
                  </div>
                </div>
              </div>

              {/* RIGHT — Builder */}
              <div style={{ border: '1px solid #e0dbd4', borderRadius: '6px', padding: '12px 14px' }}>
                <div style={{ fontSize: '9px', letterSpacing: '1.2px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '3px' }}>
                  BUILDER — INSURANCE REPAIR CO PTY LTD
                </div>
                <div style={{ fontSize: '11px', color: '#6a6460', marginBottom: '12px' }}>ACN 686 067 881 · Builder Licence BC105884</div>

                {/* Signature box */}
                <div style={{ borderBottom: '1px solid #e0dbd4', height: '52px', marginBottom: '10px', position: 'relative' }}>
                  <span style={{ fontSize: '8px', color: '#b0a89e', position: 'absolute', bottom: '4px', left: '0' }}>Signature</span>
                  <span style={{ fontSize: '8px', color: '#c8b89a', fontStyle: 'italic', position: 'absolute', top: '0', left: '0' }}>
                    Signed on behalf of IRC — authorised signatory
                  </span>
                  {/* TODO: Add /signature.png once the file is created */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/signature.png"
                    alt="Kyle Bindon signature"
                    style={{ position: 'absolute', top: '4px', left: '60px', height: '36px', opacity: 0.85 }}
                  />
                </div>

                {/* Sub-row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ borderBottom: '1px solid #f0ece6', paddingBottom: '14px' }}>
                    <div style={{ fontSize: '8px', color: '#b0a89e', marginBottom: '2px' }}>Full name (print)</div>
                    <div style={{ fontSize: '9px', color: '#3a3530' }}>Kyle Bindon</div>
                  </div>
                  <div style={{ borderBottom: '1px solid #f0ece6', paddingBottom: '14px' }}>
                    <div style={{ fontSize: '8px', color: '#b0a89e', marginBottom: '2px' }}>Date</div>
                    <div style={{ fontSize: '9px', color: '#3a3530' }}>{formatDate(new Date().toISOString())}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>{/* end body */}
      </div>{/* end document container */}

      {/* Footer */}
      <div style={{ background: '#1a1a1a', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Small logo circle */}
        <div style={{ width: '26px', height: '26px', border: '1.5px solid #c8b89a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <img src="/logo.png?v=1" alt="IRC" style={{ height: '16px' }} />
        </div>
        {/* Company name block */}
        <div>
          <div style={{ fontSize: '7.5px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#f5f2ee', textAlign: 'center' }}>INSURANCE REPAIR CO PTY LTD</div>
          <div style={{ fontSize: '10px', color: '#c8b89a', textAlign: 'center' }}>Building &amp; Restoration</div>
        </div>
        {/* Vertical divider */}
        <div style={{ width: '1px', height: '22px', background: '#c8b89a', margin: '0 4px', flexShrink: 0 }}></div>
        {/* License text */}
        <span style={{ fontSize: '12px', color: '#c8b89a' }}>BC105884 · IICRC Certified</span>
        {/* Spacer */}
        <div style={{ flex: 1 }}></div>
        {/* Right side reserved */}
      </div>
    </div>
  )
}
