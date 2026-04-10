'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { AccordionList } from './shared/AccordionList'
import { AccordionRow } from './shared/AccordionRow'
import { CreateModal } from './shared/CreateModal'

// — Types ——————————————————————————————————————————————————————————
interface Quote {
  id: string
  tenant_id: string
  job_id: string
  quote_ref: string | null
  notes: string | null
  total_amount: number | null
  status: string
  created_at: string
}

interface QuotesTabProps {
  jobId: string
  tenantId: string
}

// — Status pill ————————————————————————————————————————————————————
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:     { bg: '#fff8e1', text: '#b45309' },
  submitted: { bg: '#e8f0fe', text: '#1a73e8' },
  approved:  { bg: '#e8f5e9', text: '#2e7d32' },
  declined:  { bg: '#f5f2ee', text: '#9e998f' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status.toLowerCase()] ?? STATUS_STYLES.draft
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize"
      style={{ background: s.bg, color: s.text }}
    >
      {status}
    </span>
  )
}

function formatCurrency(v: number | null) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: '#9e998f',
  display: 'block',
  marginBottom: 5,
}

// — QuotesTab ——————————————————————————————————————————————————————
export function QuotesTab({ jobId, tenantId }: QuotesTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from('quotes')
        .select('id,tenant_id,job_id,quote_ref,notes,total_amount,status,created_at')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      setQuotes((data ?? []) as Quote[])
      setLoading(false)
    }
    fetch()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(data: Record<string, string>) {
    const { data: inserted, error } = await supabase
      .from('quotes')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        status: 'draft',
        notes: data['Description'] || null,
      })
      .select('id,tenant_id,job_id,quote_ref,notes,total_amount,status,created_at')
      .single()
    if (error) throw error
    setQuotes(prev => [...prev, inserted as Quote])
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this quote?')) return
    await supabase.from('quotes').delete().eq('id', id).eq('tenant_id', tenantId)
    setQuotes(prev => prev.filter(q => q.id !== id))
  }

  return (
    <>
      {loading ? (
        <div className="py-12 text-center text-[13px] text-[#9e998f]">Loading…</div>
      ) : (
        <AccordionList
          title="Quotes"
          action={{ label: '+ New quote', onClick: () => setShowCreate(true) }}
        >
          {quotes.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[#9e998f]">
              No quotes yet
            </div>
          ) : (
            quotes.map(q => (
              <AccordionRow
                key={q.id}
                summary={
                  <div className="flex items-center gap-3 flex-wrap">
                    <span
                      className="text-[13px] font-medium"
                      style={{ fontFamily: 'DM Mono, monospace', color: '#c8b89a' }}
                    >
                      {q.quote_ref ?? '—'}
                    </span>
                    {q.notes && (
                      <span className="text-[13px] text-[#3a3530] truncate max-w-[200px]">
                        {q.notes}
                      </span>
                    )}
                    <span className="text-[13px] text-[#3a3530]">{formatCurrency(q.total_amount)}</span>
                    <StatusPill status={q.status} />
                  </div>
                }
              >
                <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
                  <p className="text-[13px] text-[#9e998f] mb-4">
                    Quote line items and scope editor coming soon.
                  </p>
                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => handleDelete(q.id)}
                      className="text-[12px] text-red-500 hover:text-red-700 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </AccordionRow>
            ))
          )}
        </AccordionList>
      )}

      <CreateModal
        isOpen={showCreate}
        title="New Quote"
        fields={[
          { name: 'Description', label: 'Description', type: 'text' },
        ]}
        onSubmit={handleCreate}
        onClose={() => setShowCreate(false)}
      />
    </>
  )
}
