import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PrintButton } from './PrintButton'

export default async function PhotosPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { jobId } = await params
  const sp = await searchParams
  const idsParam = typeof sp.ids === 'string' ? sp.ids : ''

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

  const { data: job } = await supabase
    .from('jobs')
    .select('job_number, insured_name, property_address, claim_number')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (!job) return <div>Job not found</div>

  const selectedIds = idsParam ? idsParam.split(',').filter(Boolean) : []

  let query = supabase
    .from('photos')
    .select('id, storage_path, label, file_name, crop_x, crop_y, crop_scale, uploaded_at')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: true })

  if (selectedIds.length > 0) {
    query = query.in('id', selectedIds)
  }

  const { data: photos } = await query
  const allPhotos = photos ?? []

  const orderedPhotos = selectedIds.length > 0
    ? selectedIds.map(id => allPhotos.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => p != null)
    : allPhotos

  const pages: (typeof orderedPhotos)[] = []
  for (let i = 0; i < orderedPhotos.length; i += 6) {
    pages.push(orderedPhotos.slice(i, i + 6))
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  const headerFields = [
    { label: 'Job #', value: job.job_number },
    { label: 'Address', value: job.property_address },
    { label: 'Claim #', value: job.claim_number },
    { label: 'Insured', value: job.insured_name },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value))

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif', background: '#f5f2ee', minHeight: '100vh' }}>
      <style>{`
        @media print {
          body { margin: 0; background: white !important; }
          .no-print { display: none !important; }
          .print-page { break-after: page; box-shadow: none !important; margin: 0 !important; }
          .print-page:last-child { break-after: auto; }
        }
      `}</style>

      <PrintButton jobNumber={job.job_number} insuredName={job.insured_name} />

      {pages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px', color: '#9e998f', fontSize: '14px' }}>
          No photos to display
        </div>
      ) : (
        pages.map((pagePhotos, pageIndex) => (
          <div
            key={pageIndex}
            className="print-page"
            style={{
              background: 'white',
              maxWidth: '900px',
              margin: '0 auto',
              marginBottom: pageIndex < pages.length - 1 ? '24px' : 0,
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
          >
            {/* Per-page header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '7px 16px',
              borderBottom: '1px solid #e0dbd4',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-alt.png"
                alt="IRC"
                style={{ height: '22px', width: 'auto', flexShrink: 0 }}
              />
              <div style={{ width: '1px', height: '16px', background: '#e0dbd4', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px', lineHeight: '1.3', gap: '0' }}>
                {headerFields.map((f, i) => (
                  <span
                    key={f.label}
                    style={{
                      paddingRight: i < headerFields.length - 1 ? '10px' : 0,
                      marginRight: i < headerFields.length - 1 ? '10px' : 0,
                      borderRight: i < headerFields.length - 1 ? '1px solid #e0dbd4' : 'none',
                    }}
                  >
                    <span style={{ color: '#9e998f' }}>{f.label}: </span>
                    <span style={{ color: '#1a1a1a', fontWeight: '500' }}>{f.value}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* 2 × 3 photo grid */}
            <div style={{
              padding: '14px 16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px 12px',
            }}>
              {pagePhotos.map((photo) => (
                <div key={photo.id}>
                  <div style={{
                    position: 'relative',
                    aspectRatio: '4 / 3',
                    border: '1px solid #e0dbd4',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    background: '#f5f2ee',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${supabaseUrl}/storage/v1/object/public/photos/${photo.storage_path}`}
                      alt={photo.label || photo.file_name || 'Photo'}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        transformOrigin: 'center center',
                        transform: `translate(${photo.crop_x ?? 0}%, ${photo.crop_y ?? 0}%) scale(${photo.crop_scale ?? 1})`,
                      }}
                    />
                  </div>
                  {photo.label && (
                    <p style={{
                      fontSize: '10px',
                      color: '#3a3530',
                      textAlign: 'center',
                      margin: '4px 0 0',
                      lineHeight: '1.3',
                    }}>
                      {photo.label}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
