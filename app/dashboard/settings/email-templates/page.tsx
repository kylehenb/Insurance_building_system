'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import {
  BUILT_IN_TEMPLATES,
  EMAIL_SEND_TYPES,
  REQUIRED_TOKENS,
  TEMPLATE_TOKENS,
  documentTemplateVars,
  renderTemplate,
  signingTemplateVars,
  workOrderTemplateVars,
  type EmailSendType,
} from '@/lib/email/templates'
import { toRichHtml } from '@/lib/email/rich-text'
import { renderTemplatePreviewHtml } from '@/lib/email/preview'
import { RichTextEditor, type RichTextEditorHandle } from '@/components/email/RichTextEditor'
import { SignatureSettings } from './SignatureSettings'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type TemplateRow = Database['public']['Tables']['email_templates']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type ClientOption = { id: string; name: string }

// Documents emailed from a job (lib/documents/send) and the attachment each sends
const DOCUMENT_ATTACHMENTS: Partial<Record<EmailSendType, string>> = {
  quote: 'Quote PDF attached',
  report: 'Report PDF attached',
  invoice: 'Invoice PDF attached',
  excess_invoice: 'Excess invoice PDF attached',
  tcc: 'Telephone clearance certificate PDF attached',
  photos: 'Photos PDF attached',
}

interface Selection {
  sendType: EmailSendType
  /** null = the standard version used for every client */
  clientId: string | null
}

interface Preview {
  vars: Record<string, string | null>
  /** e.g. "WO-1042 · 12 Example St" — null when using example details */
  source: string | null
}

function findRow(rows: TemplateRow[], sel: Selection): TemplateRow | null {
  return rows.find(r => r.send_type === sel.sendType && (r.client_id ?? null) === sel.clientId) ?? null
}

// The text a version starts from: its saved row, else (for a client version)
// the standard version, else the built-in default. The body as rich text
// (templates saved before rich text are plain text).
function baselineFrom(rows: TemplateRow[], sel: Selection) {
  const builtIn = BUILT_IN_TEMPLATES[sel.sendType]
  const row = findRow(rows, sel) ?? (sel.clientId ? findRow(rows, { ...sel, clientId: null }) : null)
  return { subject: row?.subject_template ?? builtIn.subject, body: toRichHtml(row?.body_template ?? builtIn.body) }
}

// One template per email type, plus optional per-client versions. The send
// code picks the client's version when the job's client has one, else the
// standard version, else the built-in default from lib/email/templates.ts.
export default function EmailTemplatesSettingsPage() {
  const router = useRouter()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [editingSignature, setEditingSignature] = useState(false)
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selection, setSelection] = useState<Selection>({ sendType: 'work_order', clientId: null })
  // Client versions added in this session but not saved yet
  const [pendingClientIds, setPendingClientIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<RichTextEditorHandle>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
      if (!profile) { setError('Could not load your account.'); setLoading(false); return }
      setTenantId(profile.tenant_id)

      const [templatesRes, clientsRes, tenantRes] = await Promise.all([
        supabase.from('email_templates').select('*').eq('tenant_id', profile.tenant_id),
        supabase.from('clients').select('id, name, trading_name').eq('tenant_id', profile.tenant_id).order('name'),
        supabase.from('tenants').select('*').eq('id', profile.tenant_id).maybeSingle(),
      ])
      setTenant(tenantRes.data ?? null)
      if (templatesRes.error) {
        console.error('Error loading email templates:', templatesRes.error)
        setError('Failed to load email templates. Please refresh.')
      }
      const loaded = templatesRes.data ?? []
      setRows(loaded)
      const initial = baselineFrom(loaded, { sendType: 'work_order', clientId: null })
      setSubject(initial.subject)
      setBody(initial.body)
      setClients((clientsRes.data ?? []).map(c => ({ id: c.id, name: c.trading_name || c.name })))
      setLoading(false)
    }
    load()
  }, [router])

  const currentRow = findRow(rows, selection)
  const baseline = baselineFrom(rows, selection)
  const dirty = !currentRow || subject !== baseline.subject || body !== baseline.body
  const hasChanges = subject !== baseline.subject || body !== baseline.body

  // Switch the editor to a version, loading its text
  const openVersion = (sel: Selection, fromRows: TemplateRow[] = rows) => {
    const b = baselineFrom(fromRows, sel)
    setSelection(sel)
    setSubject(b.subject)
    setBody(b.body)
    setSaveError(null)
    setSaved(false)
  }

  // Fill the preview from the most recent work order (for this client, when
  // editing a client version), falling back to example details.
  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    const examples = Object.fromEntries(TEMPLATE_TOKENS[selection.sendType].map(t => [t.key, t.example]))

    // Signing emails: filled from the most recent job (for this client, when
    // editing a client version), with example link/dates.
    const loadSigning = async () => {
      let q = supabase.from('jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1)
      if (selection.clientId) q = q.eq('client_id', selection.clientId)
      const [{ data: job }, { data: tenant }] = await Promise.all([
        q.maybeSingle(),
        supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
      ])
      if (!job || !tenant) return null
      const vars = {
        ...examples,
        ...signingTemplateVars({
          signerName: job.insured_name || examples.signer_name || '',
          documentName: examples.document_name ?? 'Scope of Works Authorisation',
          job,
          tenant,
        }),
      }
      return { vars, source: [job.job_number, job.property_address].filter(Boolean).join(' · ') }
    }

    // Document emails: the most recent job's details, example document values
    const loadDocument = async () => {
      let q = supabase.from('jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1)
      if (selection.clientId) q = q.eq('client_id', selection.clientId)
      const [{ data: job }, { data: tenant }] = await Promise.all([
        q.maybeSingle(),
        supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
      ])
      if (!job || !tenant) return null
      const contactName = job.order_sender_name?.trim().split(/\s+/)[0] || null
      const insuredFirst = job.insured_name?.trim().split(/\s+/)[0] || null
      const vars = {
        ...examples,
        ...documentTemplateVars({ job, tenant, contactName }),
        ...(insuredFirst ? { insured_first_name: insuredFirst } : {}),
        ...(tenant.accounts_email || tenant.contact_email ? { accounts_email: tenant.accounts_email || tenant.contact_email } : {}),
      }
      return { vars, source: [job.job_number, job.property_address].filter(Boolean).join(' · ') }
    }

    const load = async () => {
      if (selection.sendType in DOCUMENT_ATTACHMENTS) return loadDocument()
      if (selection.sendType !== 'work_order') return loadSigning()
      let jobIds: string[] | null = null
      if (selection.clientId) {
        const { data } = await supabase.from('jobs').select('id').eq('tenant_id', tenantId)
          .eq('client_id', selection.clientId).order('created_at', { ascending: false }).limit(50)
        jobIds = (data ?? []).map(j => j.id)
        if (jobIds.length === 0) return null
      }
      let q = supabase.from('work_orders').select('*').eq('tenant_id', tenantId)
        .not('trade_id', 'is', null).order('created_at', { ascending: false }).limit(1)
      if (jobIds) q = q.in('job_id', jobIds)
      const { data: wo } = await q.maybeSingle()
      if (!wo) return null

      const [jobRes, tradeRes, tenantRes] = await Promise.all([
        supabase.from('jobs').select('*').eq('id', wo.job_id).maybeSingle(),
        supabase.from('trades').select('*').eq('id', wo.trade_id!).maybeSingle(),
        supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
      ])
      if (!jobRes.data || !tenantRes.data) return null
      const trade = tradeRes.data
      const tradeLabel = wo.trade_name ?? trade?.primary_trade ?? (wo.work_type === 'make_safe' ? 'Make Safe' : '')
      const vars = workOrderTemplateVars({ workOrder: wo, job: jobRes.data, tenant: tenantRes.data, trade, tradeLabel })
      return { vars, source: [vars.work_order_ref, jobRes.data.property_address].filter(Boolean).join(' · ') }
    }

    load()
      .catch(err => { console.error('Error loading preview data:', err); return null })
      .then(result => { if (!cancelled) setPreview(result ?? { vars: examples, source: null }) })
    return () => { cancelled = true }
  }, [tenantId, selection.sendType, selection.clientId])

  const tokens = TEMPLATE_TOKENS[selection.sendType]
  const missingTokens = (REQUIRED_TOKENS[selection.sendType] ?? []).filter(k => !`${subject}\n${body}`.includes(`{${k}}`))
  const unknownTokens = useMemo(() => {
    const known = new Set(tokens.map(t => t.key))
    const found = [...`${subject}\n${body}`.matchAll(/\{(\w+)\}/g)].map(m => m[1])
    return [...new Set(found.filter(k => !known.has(k)))]
  }, [subject, body, tokens])

  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? 'Unknown client'
  const savedClientIds = rows.filter(r => r.send_type === selection.sendType && r.client_id).map(r => r.client_id!)
  const versionClientIds = [...new Set([...savedClientIds, ...pendingClientIds])]
    .sort((a, b) => clientName(a).localeCompare(clientName(b)))
  const addableClients = clients.filter(c => !versionClientIds.includes(c.id))

  const select = (next: Selection) => {
    if (editingSignature) { setEditingSignature(false); openVersion(next); return }
    if (next.sendType === selection.sendType && next.clientId === selection.clientId) return
    if (hasChanges && !confirm('Discard your unsaved changes to this template?')) return
    openVersion(next)
  }

  const openSignature = () => {
    if (editingSignature) return
    if (hasChanges && !confirm('Discard your unsaved changes to this template?')) return
    openVersion(selection)
    setEditingSignature(true)
  }

  const addClientVersion = (clientId: string) => {
    if (!clientId) return
    if (hasChanges && !confirm('Discard your unsaved changes to this template?')) return
    setPendingClientIds(prev => [...prev, clientId])
    openVersion({ sendType: selection.sendType, clientId })
  }

  const insertToken = (key: string) => {
    const token = `{${key}}`
    if (lastFocused.current === 'body') { bodyRef.current?.insertText(token); return }
    const el = subjectRef.current
    const start = el?.selectionStart ?? subject.length
    const end = el?.selectionEnd ?? subject.length
    setSubject(subject.slice(0, start) + token + subject.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const handleSave = async () => {
    if (!tenantId) return
    setSaving(true)
    setSaveError(null)
    const typeLabel = EMAIL_SEND_TYPES.find(t => t.sendType === selection.sendType)?.label ?? selection.sendType
    const name = selection.clientId ? `${typeLabel} — ${clientName(selection.clientId)}` : `${typeLabel} — standard`
    const fields = { subject_template: subject, body_template: body, name, updated_at: new Date().toISOString() }

    const res = currentRow
      ? await supabase.from('email_templates').update(fields).eq('id', currentRow.id).eq('tenant_id', tenantId).select().single()
      : await supabase.from('email_templates').insert({
          ...fields,
          tenant_id: tenantId,
          send_type: selection.sendType,
          client_id: selection.clientId,
          is_default: true,
        }).select().single()

    setSaving(false)
    if (res.error || !res.data) {
      console.error('Error saving email template:', res.error)
      setSaveError('Save failed — please try again.')
      return
    }
    const savedRow = res.data
    setRows(prev => [...prev.filter(r => r.id !== savedRow.id), savedRow])
    setPendingClientIds(prev => prev.filter(id => id !== selection.clientId))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Standard version: back to the built-in wording. Client version: removed,
  // so that client's emails use the standard version again.
  const handleRemove = async () => {
    const isClient = selection.clientId !== null
    const msg = isClient
      ? `Delete the ${clientName(selection.clientId!)} version? Emails for this client will use the standard template.`
      : 'Reset to the built-in wording? Your saved standard template will be deleted.'
    if (!confirm(msg)) return

    let remaining = rows
    if (currentRow) {
      const { error: delErr } = await supabase.from('email_templates').delete().eq('id', currentRow.id).eq('tenant_id', tenantId!)
      if (delErr) {
        console.error('Error deleting email template:', delErr)
        setSaveError('Delete failed — please try again.')
        return
      }
      remaining = rows.filter(r => r.id !== currentRow.id)
      setRows(remaining)
    }
    if (isClient) setPendingClientIds(prev => prev.filter(id => id !== selection.clientId))
    openVersion({ sendType: selection.sendType, clientId: null }, remaining)
  }

  const discard = () => {
    if (!currentRow && selection.clientId) { handleRemove(); return }
    setSubject(baseline.subject)
    setBody(baseline.body)
    setSaveError(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface p-8">
        <div className="max-w-6xl mx-auto">
          <div className="h-8 bg-line-3 rounded w-48 mb-2"></div>
          <div className="h-4 bg-line-3 rounded w-96 mb-8"></div>
          <div className="h-96 bg-white border border-line-3 rounded-lg"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface p-8">
        <div className="max-w-6xl mx-auto text-subtle">{error}</div>
      </div>
    )
  }

  const usingBuiltIn = !currentRow && selection.clientId === null
  const isUnsavedClientVersion = !currentRow && selection.clientId !== null
  const rendered = preview && tenant
    ? {
        subject: renderTemplate(subject, preview.vars),
        html: renderTemplatePreviewHtml({ sendType: selection.sendType, body, vars: preview.vars, tenant }),
      }
    : null
  const labelCls = 'block text-[10px] uppercase tracking-wider text-subtle font-semibold mb-2'
  const versionBtn = (active: boolean) =>
    `w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${active ? 'bg-surface text-ink font-medium' : 'text-body-soft hover:bg-surface-5'}`

  return (
    <div className="min-h-screen bg-surface p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-ink">Email Templates</h1>
          <p className="text-sm text-subtle mt-1">
            The standard wording for emails the system sends. Auto send uses it as-is; Customise send starts from it so you can edit a single email without changing the template.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
          {/* ── Email types and versions ─────────────────────────────────── */}
          <aside className="space-y-4">
            <button
              onClick={openSignature}
              className={`w-full text-left bg-white border rounded-lg p-3 ${editingSignature ? 'border-gold' : 'border-line-3'}`}
            >
              <div className="font-semibold text-sm text-ink px-1">Signature</div>
              <div className="text-xs text-subtle mt-0.5 leading-snug px-1">
                Your name, details and logo, added to every email below.{' '}
                {tenant && !tenant.email_signature && !tenant.email_signature_image_path ? 'Not set up yet.' : ''}
              </div>
            </button>
            {EMAIL_SEND_TYPES.map(type => {
              const active = !editingSignature && type.sendType === selection.sendType
              return (
                <div key={type.sendType} className="bg-white border border-line-3 rounded-lg p-3">
                  <button
                    onClick={() => select({ sendType: type.sendType, clientId: null })}
                    className="w-full text-left px-1 mb-2"
                  >
                    <div className="font-semibold text-sm text-ink">{type.label}</div>
                    <div className="text-xs text-subtle mt-0.5 leading-snug">{type.description}</div>
                  </button>
                  {active && (
                    <div className="space-y-0.5 border-t border-line-3 pt-2">
                      <button onClick={() => select({ sendType: type.sendType, clientId: null })} className={versionBtn(selection.clientId === null)}>
                        Standard
                        <span className="block text-[11px] text-subtle font-normal">All clients</span>
                      </button>
                      {versionClientIds.map(id => (
                        <button key={id} onClick={() => select({ sendType: type.sendType, clientId: id })} className={versionBtn(selection.clientId === id)}>
                          {clientName(id)}
                          {!savedClientIds.includes(id) && <span className="block text-[11px] text-warning font-normal">Not saved</span>}
                        </button>
                      ))}
                      {addableClients.length > 0 && (
                        <select
                          value=""
                          onChange={e => addClientVersion(e.target.value)}
                          className="w-full mt-2 px-2 py-1.5 text-xs border border-line-3 rounded-md bg-surface-5 text-body-soft focus:outline-none focus:border-gold"
                        >
                          <option value="">+ Version for a client…</option>
                          {addableClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <p className="text-xs text-subtle px-1 leading-relaxed">
              Quotes, invoices and other emails will appear here as their send buttons are connected.
            </p>
          </aside>

          {/* ── Editor and preview ───────────────────────────────────────── */}
          {editingSignature && tenant ? (
            <SignatureSettings supabase={supabase} tenant={tenant} onSaved={setTenant} />
          ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-w-0">
            <section className="bg-white border border-line-3 rounded-lg p-5 min-w-0">
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="font-semibold text-ink">
                  {selection.clientId ? clientName(selection.clientId) : 'Standard'}
                </span>
                {usingBuiltIn && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-surface text-subtle">Built-in default — not yet customised</span>
                )}
                {isUnsavedClientVersion && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-warning-bg text-warning-dark">Copied from standard — save to use it</span>
                )}
              </div>

              <div className="mb-4">
                <label className={labelCls}>Subject</label>
                <input
                  ref={subjectRef}
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  onFocus={() => { lastFocused.current = 'subject' }}
                  className="w-full p-2.5 border border-line-3 rounded-md bg-surface-5 text-sm text-ink focus:outline-none focus:border-gold"
                />
              </div>

              <div className="mb-3">
                <label className={labelCls}>Message</label>
                <RichTextEditor
                  ref={bodyRef}
                  value={body}
                  onChange={setBody}
                  onFocus={() => { lastFocused.current = 'body' }}
                  minHeight={300}
                />
              </div>

              <div className="mb-4">
                <div className="text-xs text-subtle mb-1.5">Insert a placeholder at the cursor:</div>
                <div className="flex flex-wrap gap-1.5">
                  {tokens.map(t => (
                    <button
                      key={t.key}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => insertToken(t.key)}
                      title={`{${t.key}}`}
                      className="text-xs px-2 py-1 rounded border border-line-3 bg-white text-body-soft hover:border-gold hover:text-ink transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {missingTokens.length > 0 && (
                  <p className="text-xs text-warning mt-2">
                    This email needs {missingTokens.map(k => `{${k}}`).join(', ')}. If it’s missing, the link is added at the end automatically.
                  </p>
                )}
                {unknownTokens.length > 0 && (
                  <p className="text-xs text-warning mt-2">
                    Not a recognised placeholder, so it will be sent exactly as typed: {unknownTokens.map(k => `{${k}}`).join(', ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {(currentRow || selection.clientId) && (
                  <button onClick={handleRemove} className="text-xs text-danger-dark hover:underline">
                    {selection.clientId ? 'Delete this version' : 'Reset to built-in'}
                  </button>
                )}
                <div className="ml-auto flex items-center gap-3">
                  {saveError && <span className="text-xs text-red-600">{saveError}</span>}
                  {saved && <span className="text-xs text-green-600">Saved</span>}
                  {hasChanges && (
                    <button onClick={discard} className="px-3 py-1.5 text-xs border border-line-3 rounded text-body-soft hover:bg-surface-5">
                      Discard changes
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!dirty || saving || !subject.trim()}
                    className="px-4 py-1.5 text-xs bg-gold text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#b8985e] transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </section>

            <section className="bg-white border border-line-3 rounded-lg p-5 min-w-0">
              <div className={labelCls}>Preview</div>
              <p className="text-xs text-subtle mb-4">
                {preview?.source ? <>Filled in from {preview.source}</> : <>Filled in with example details</>}
              </p>
              {rendered ? (
                <div className="border border-line-3 rounded-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-line-3 bg-surface-5">
                    <div className="text-[11px] text-subtle">Subject</div>
                    <div className="text-sm font-medium text-ink break-words">{rendered.subject || '—'}</div>
                  </div>
                  <iframe title="Email preview" srcDoc={rendered.html} sandbox="" className="block w-full h-[640px] bg-white" />
                  {selection.sendType === 'work_order' && (
                    <div className="px-4 py-2 border-t border-line-3 text-xs text-subtle flex items-center gap-1.5"><Paperclip className="w-3 h-3" /> Work order PDF and the job's photos PDF attached</div>
                  )}
                  {selection.sendType === 'signing_request' && (
                    <div className="px-4 py-2 border-t border-line-3 text-xs text-subtle flex items-center gap-1.5"><Paperclip className="w-3 h-3" /> The document PDF ({'{document_name}'}) attached · the {'{signing_link}'} line shows as a large “Review and sign” button</div>
                  )}
                  {selection.sendType === 'signing_request_excess' && (
                    <div className="px-4 py-2 border-t border-line-3 text-xs text-subtle flex items-center gap-1.5"><Paperclip className="w-3 h-3" /> The document PDF and the excess invoice PDF attached · the {'{signing_link}'} line shows as a large “Review and sign” button</div>
                  )}
                  {DOCUMENT_ATTACHMENTS[selection.sendType] && (
                    <div className="px-4 py-2 border-t border-line-3 text-xs text-subtle flex items-center gap-1.5"><Paperclip className="w-3 h-3" /> {DOCUMENT_ATTACHMENTS[selection.sendType]}</div>
                  )}
                  {selection.sendType === 'signing_completed' && (
                    <div className="px-4 py-2 border-t border-line-3 text-xs text-subtle flex items-center gap-1.5"><Paperclip className="w-3 h-3" /> Signed PDF (with Signature Certificate) attached</div>
                  )}
                </div>
              ) : (
                <div className="h-40 bg-surface-5 border border-line-3 rounded-md" />
              )}
            </section>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
