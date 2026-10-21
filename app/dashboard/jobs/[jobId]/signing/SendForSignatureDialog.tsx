'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { SIGNING_DOCUMENT_CATALOG, suggestDocumentType } from '@/lib/signing/documents/catalog'
import { BUILDING_CONTRACT_THRESHOLD, DEFAULT_EXPIRY_DAYS } from '@/lib/signing/config'
import type { SigningDocumentTypeKey } from '@/lib/signing/types'
import { createAndSend, fetchJobSigning, type SendDialogDefaults } from './api'

// Choose the document, the quotes it covers and the signer, then send.
// The document is generated from the job's approved quotes at send time.

const fmt = (v: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export function SendForSignatureDialog({
  jobId,
  defaults: initialDefaults,
  onClose,
  onSent,
}: {
  jobId: string
  /** Pass when already loaded; otherwise the dialog loads them */
  defaults?: SendDialogDefaults | null
  onClose: () => void
  onSent: (message: string) => void
}) {
  const [loaded, setLoaded] = useState<SendDialogDefaults | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const defaults = initialDefaults ?? loaded

  useEffect(() => {
    if (initialDefaults) return
    let cancelled = false
    fetchJobSigning(jobId)
      .then(data => { if (!cancelled) setLoaded(data.defaults) })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load the job') })
    return () => { cancelled = true }
  }, [jobId, initialDefaults])

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-signature-title"
        className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e8e4e0] px-6 py-4">
          <h2 id="send-signature-title" className="text-[16px] font-semibold text-[#1a1a1a]">Send for signature</h2>
          <button onClick={onClose} className="rounded p-1 text-[#9e998f] hover:bg-[#f5f2ee]" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {defaults ? (
          <SendForm jobId={jobId} defaults={defaults} onClose={onClose} onSent={onSent} />
        ) : (
          <div className="px-6 py-10 text-center text-[13px] text-[#9e998f]">{loadError ?? 'Loading…'}</div>
        )}
      </div>
    </div>
  )
}

function SendForm({
  jobId,
  defaults,
  onClose,
  onSent,
}: {
  jobId: string
  defaults: SendDialogDefaults
  onClose: () => void
  onSent: (message: string) => void
}) {
  const [quoteIds, setQuoteIds] = useState<string[]>(defaults.suggestedQuoteIds)
  // null = follow the threshold suggestion until the user picks a type
  const [chosenDocType, setChosenDocType] = useState<SigningDocumentTypeKey | null>(null)
  const [name, setName] = useState(defaults.signer.name)
  const [email, setEmail] = useState(defaults.signer.email)
  const [phone, setPhone] = useState(defaults.signer.phone)
  const [moveStage, setMoveStage] = useState(defaults.jobStage === 'approved_awaiting_signoff')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(
    () => defaults.quotes.filter(q => quoteIds.includes(q.id)).reduce((s, q) => s + q.totalInclGst, 0),
    [defaults, quoteIds],
  )
  const suggested = suggestDocumentType(total)
  const docType = chosenDocType ?? suggested

  const signableQuotes = defaults.quotes.filter(q => q.signable)
  const emailOk = EMAIL_RE.test(email.trim())
  const canSend = !sending && quoteIds.length > 0 && name.trim().length > 1 && emailOk

  const toggleQuote = (id: string) =>
    setQuoteIds(prev => (prev.includes(id) ? prev.filter(q => q !== id) : [...prev, id]))

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const result = await createAndSend(jobId, {
        documentType: docType,
        quoteIds,
        signer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
        moveJobToAwaitingStage: moveStage,
      })
      onSent(
        `${SIGNING_DOCUMENT_CATALOG[docType].label} emailed to ${result.request.signerEmail}.`
        + (result.stageMoved ? ' Job moved to Awaiting Signed Document.' : ''),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sending failed')
      setSending(false)
    }
  }

  const label = 'block text-[11px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5'
  const input = 'w-full px-3 py-2 text-[13px] border border-[#e0dbd4] rounded-md bg-white focus:outline-none focus:border-[#c8b89a]'

  return (
    <>
      <div className="space-y-5 px-6 py-5">
        <section>
          <div className={label}>Approved quotes to include</div>
          {signableQuotes.length === 0 ? (
            <p className="text-[13px] text-[#b45309]">This job has no approved quotes yet. Approve a quote first.</p>
          ) : (
            <div className="space-y-1.5">
              {signableQuotes.map(q => (
                <label key={q.id} className="flex items-center gap-2 rounded-md border border-[#e8e4e0] px-3 py-2 text-[13px] hover:bg-[#fafaf9]">
                  <input type="checkbox" checked={quoteIds.includes(q.id)} onChange={() => toggleQuote(q.id)} />
                  <span className="font-medium text-[#1a1a1a]">{q.ref ?? 'Quote'}</span>
                  <span className="text-[#9e998f]">{q.status === 'partially_approved' ? 'Partially approved' : 'Approved'}</span>
                  <span className="ml-auto font-mono text-[12px] text-[#3a3530]">{fmt(q.totalInclGst)}</span>
                </label>
              ))}
              <div className="flex justify-between px-1 pt-1 text-[12px] text-[#5a5650]">
                <span>Total incl GST (items declined by the insurer are left out)</span>
                <span className="font-mono font-semibold">{fmt(total)}</span>
              </div>
            </div>
          )}
        </section>

        <section>
          <div className={label}>Document</div>
          <div className="space-y-1.5">
            {Object.values(SIGNING_DOCUMENT_CATALOG).map(entry => (
              <label key={entry.key} className={`flex gap-2 rounded-md border px-3 py-2 text-[13px] ${docType === entry.key ? 'border-[#c9a96e] bg-[#fdfaf4]' : 'border-[#e8e4e0]'}`}>
                <input
                  type="radio"
                  name="signing-doc-type"
                  checked={docType === entry.key}
                  onChange={() => setChosenDocType(entry.key)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-[#1a1a1a]">{entry.label}</span>
                  {entry.key === suggested && <span className="ml-2 rounded-full bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-semibold text-[#1b5e20]">Suggested</span>}
                  <span className="block text-[12px] text-[#9e998f]">{entry.description}</span>
                </span>
              </label>
            ))}
          </div>
          {docType !== suggested && quoteIds.length > 0 && (
            <p className="mt-2 text-[12px] text-[#b45309]">
              The selected total is {fmt(total)}. Work over {fmt(BUILDING_CONTRACT_THRESHOLD)} normally needs a Building Contract.
            </p>
          )}
        </section>

        <section>
          <div className={label}>Signer</div>
          {defaults.signerSource && (
            <p className="mb-2 text-[12px] text-[#9e998f]">Filled in from the job’s {defaults.signerSource}.</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <input className={input} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} aria-label="Signer name" />
            </div>
            <input className={input} placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} aria-label="Signer email" />
            <input className={input} placeholder="Mobile (optional, for the record)" value={phone} onChange={e => setPhone(e.target.value)} aria-label="Signer mobile" />
          </div>
          {email && !emailOk && <p className="mt-1 text-[12px] text-red-600">That email address doesn’t look right.</p>}
          <p className="mt-2 text-[12px] text-[#9e998f]">
            Sent by email from the office address. The link works for {DEFAULT_EXPIRY_DAYS} days and can only be used to sign once.
          </p>
        </section>

        {defaults.jobStage === 'approved_awaiting_signoff' && (
          <label className="flex items-start gap-2 text-[13px] text-[#3a3530]">
            <input type="checkbox" checked={moveStage} onChange={e => setMoveStage(e.target.checked)} className="mt-0.5" />
            <span>Move the job to <strong>Awaiting Signed Document</strong> once sent</span>
          </label>
        )}

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[#e8e4e0] px-6 py-4">
        <button onClick={onClose} className="rounded-md border border-[#d8d0c8] bg-[#f5f2ee] px-4 py-2 text-[13px] font-medium text-[#3a3530]">Cancel</button>
        <button
          onClick={send}
          disabled={!canSend}
          className="rounded-md bg-[#1a1a1a] px-4 py-2 text-[13px] font-semibold text-[#c9a96e] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Generating and sending…' : 'Send for signature'}
        </button>
      </div>
    </>
  )
}
