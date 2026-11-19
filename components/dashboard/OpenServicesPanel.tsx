'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ServiceStage } from '@/lib/jobs/service-stage'

// Every requested service still open across the jobs (make safes, roof
// reports, leak detections, specialist reports — lib/jobs/services.ts), make
// safes nobody's doing first. Each links to its job, where it's arranged.
// Nothing shows when there's nothing open.

interface OpenService {
  label: string
  stage: ServiceStage
  service: { id: string; status: string }
  job: { id: string; job_number: string; property_address: string | null; insurer: string | null }
}

export function OpenServicesPanel() {
  const [services, setServices] = useState<OpenService[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/services')
      .then(r => (r.ok ? r.json() : { services: [] }))
      .then(d => { if (!cancelled) setServices(d.services ?? []) })
      .catch(() => { if (!cancelled) setServices([]) })
    return () => { cancelled = true }
  }, [])

  if (!services?.length) return null
  const unarranged = services.filter(s => s.service.status === 'unassigned').length

  return (
    <div style={{ marginBottom: 24, fontFamily: 'DM Sans, sans-serif' }}>
      <div className="sec-label">
        Requested services · {services.length} open{unarranged ? ` · ${unarranged} not yet arranged` : ''}
      </div>
      <div style={{ border: '1px solid #e8dfc8', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        {services.slice(0, 12).map(s => (
          <Link
            key={s.service.id}
            href={`/dashboard/jobs/${s.job.id}`}
            style={{
              display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 12px', textDecoration: 'none', color: 'inherit',
              borderBottom: '1px solid #f1ece2', borderLeft: s.stage.urgent ? '3px solid #ef4444' : '3px solid transparent',
            }}
          >
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#a07840', minWidth: 64 }}>{s.job.job_number}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: s.stage.urgent ? '#7f1d1d' : '#1a1a1a', minWidth: 110 }}>{s.label}</span>
            <span style={{ fontSize: 12, color: '#5a5040', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.stage.text}
            </span>
            <span style={{ fontSize: 11, color: '#9e8060', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
              {s.job.property_address ?? ''}
            </span>
          </Link>
        ))}
        {services.length > 12 && (
          <div style={{ padding: '6px 12px', fontSize: 11, color: '#9e8060' }}>+ {services.length - 12} more</div>
        )}
      </div>
    </div>
  )
}
