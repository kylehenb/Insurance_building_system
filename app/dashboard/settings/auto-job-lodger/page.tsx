'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { Switch } from '@/components/ui/switch'
import type { Database } from '@/lib/supabase/database.types'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type AutoJobLodgerConfig = {
  id: string
  notification_enabled: boolean
  notification_email: string
  notify_on_success: boolean
  notify_on_needs_review: boolean
  notify_outside_business_hours: boolean
  notification_subject_success: string
  notification_subject_review: string
  notification_body_template: string
}

type GmailSyncState = {
  id: string
  tenant_id: string
  email_address: string
  last_history_id: string | null
  last_synced_at: string | null
  last_poll_timestamp: string | null
  polling_enabled: boolean
  polling_interval_minutes: number
}

type EmailKeywordRule = {
  id: string
  keyword: string
  active: boolean
}

type RecentOrder = {
  id: string
  created_at: string | null
  insurer: string | null
  claim_number: string | null
  insured_name: string | null
  parse_status: string | null
  entry_method: string | null
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ParseStatusBadge({ status }: { status: string | null }) {
  if (status === 'auto_parsed') {
    return (
      <span className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full">
        auto_parsed
      </span>
    )
  }
  if (status === 'needs_review') {
    return (
      <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full">
        needs_review
      </span>
    )
  }
  if (status === 'manual_entry') {
    return (
      <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
        manual_entry
      </span>
    )
  }
  return (
    <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
      {status ?? '—'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────

export default function AutoJobLodgerPage() {
  const router = useRouter()

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [tenantId, setTenantId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<AutoJobLodgerConfig | null>(null)
  const [keywords, setKeywords] = useState<EmailKeywordRule[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])
  const [gmailSyncState, setGmailSyncState] = useState<GmailSyncState | null>(null)

  // Notification save state
  const [saving, setSaving] = useState(false)

  // Polling save state
  const [savingPolling, setSavingPolling] = useState(false)

  // Keyword add form state
  const [newKeyword, setNewKeyword] = useState('')
  const [addingKeyword, setAddingKeyword] = useState(false)

  // Orders refresh state
  const [ordersLoading, setOrdersLoading] = useState(false)

  // ── Effect 1: bootstrap auth ───────────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const { data: profile } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (!profile) {
        router.push('/login')
        return
      }
      setTenantId(profile.tenant_id)
    }
    bootstrap()
  }, [router, supabase])

  // ── loadData ───────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/settings/auto-job-lodger')
    if (res.ok) {
      const json = await res.json()
      setConfig(json.config)
      setKeywords(json.keywords ?? [])
    }
    setLoading(false)
  }, [])

  // ── loadOrders ─────────────────────────────────────────────────
  const loadOrders = useCallback(async (tid: string) => {
    setOrdersLoading(true)
    const { data } = await supabase
      .from('insurer_orders')
      .select('id, created_at, insurer, claim_number, insured_name, parse_status, entry_method')
      .eq('tenant_id', tid)
      .eq('entry_method', 'email')
      .order('created_at', { ascending: false })
      .limit(20)
    setRecentOrders(data ?? [])
    setOrdersLoading(false)
  }, [supabase])

  // ── loadGmailSyncState ────────────────────────────────────────
  const loadGmailSyncState = useCallback(async (tid: string) => {
    const { data } = await supabase
      .from('gmail_sync_state')
      .select('*')
      .eq('tenant_id', tid)
      .single()
    setGmailSyncState(data as GmailSyncState | null)
  }, [supabase])

  // ── Effect 2: load data once tenantId is set ───────────────────
  useEffect(() => {
    if (!tenantId) return
    loadData()
    loadOrders(tenantId)
    loadGmailSyncState(tenantId)
  }, [tenantId, loadData, loadOrders, loadGmailSyncState])

  // ── Save notification settings ─────────────────────────────────
  const handleSaveNotifications = async () => {
    if (!config) return
    setSaving(true)
    try {
      await fetch('/api/settings/auto-job-lodger', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_enabled: config.notification_enabled,
          notification_email: config.notification_email,
          notify_on_success: config.notify_on_success,
          notify_on_needs_review: config.notify_on_needs_review,
          notify_outside_business_hours: config.notify_outside_business_hours,
          notification_subject_success: config.notification_subject_success,
          notification_subject_review: config.notification_subject_review,
          notification_body_template: config.notification_body_template,
        }),
      })
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle keyword active ──────────────────────────────────────
  const handleToggleKeyword = async (id: string, active: boolean) => {
    await fetch('/api/settings/auto-job-lodger/keywords', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    })
    await loadData()
  }

  // ── Delete keyword ─────────────────────────────────────────────
  const handleDeleteKeyword = async (id: string) => {
    if (!window.confirm('Delete this keyword rule?')) return
    await fetch(`/api/settings/auto-job-lodger/keywords?id=${id}`, {
      method: 'DELETE',
    })
    await loadData()
  }

  // ── Add keyword ────────────────────────────────────────────────
  const handleAddKeyword = async () => {
    const trimmed = newKeyword.trim()
    if (!trimmed) return
    setAddingKeyword(true)
    try {
      await fetch('/api/settings/auto-job-lodger/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: trimmed }),
      })
      setNewKeyword('')
      await loadData()
    } finally {
      setAddingKeyword(false)
    }
  }

  // ── Toggle polling enabled ─────────────────────────────────────
  const handleTogglePolling = async (enabled: boolean) => {
    if (!gmailSyncState || !tenantId) return
    setSavingPolling(true)
    try {
      await supabase
        .from('gmail_sync_state')
        .update({ polling_enabled: enabled } as never)
        .eq('tenant_id', tenantId)
        .eq('email_address', 'office@insurancerepairco.com.au')
      await loadGmailSyncState(tenantId)
    } finally {
      setSavingPolling(false)
    }
  }

  // ── Loading state ──────────────────────────────────────────────
  if (loading || config === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f5f2ee]">
        <div className="text-[#9e998f] text-sm">Loading...</div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f5f2ee] pb-20">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/dashboard/settings"
            className="text-xs text-[#9e998f] hover:text-[#1a1a1a] transition-colors"
          >
            ← Settings
          </Link>
        </div>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">Auto Job Lodger</h1>
          <p className="text-sm text-[#9e998f] mt-1">
            Configure automated email order intake and notification settings.
          </p>
        </div>

        <div className="space-y-6">

          {/* ══════════════════════════════════════════════════════
              SECTION 0 — GMAIL POLLING STATUS
          ══════════════════════════════════════════════════════ */}
          <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
            <div className="mb-6">
              <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-1">
                Gmail Polling
              </h2>
              <p className="text-sm text-[#1a1a1a] font-medium">
                Poll Gmail for new insurer emails every 2 minutes (replaces Gmail Watch).
              </p>
            </div>

            <div className="space-y-5">
              {/* Polling enabled toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-0.5">
                    Enable polling
                  </label>
                  <p className="text-xs text-[#9e998f] mt-1">
                    When enabled, Gmail is polled every 2 minutes for new emails
                  </p>
                </div>
                <Switch
                  checked={gmailSyncState?.polling_enabled ?? false}
                  onCheckedChange={handleTogglePolling}
                  disabled={savingPolling}
                />
              </div>

              {/* Polling status */}
              {gmailSyncState && (
                <div className="bg-[#f5f2ee] rounded p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#9e998f]">Status</span>
                    <span className={`text-xs font-medium ${
                      gmailSyncState.polling_enabled ? 'text-green-700' : 'text-gray-600'
                    }`}>
                      {gmailSyncState.polling_enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  {gmailSyncState.last_poll_timestamp && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#9e998f]">Last poll</span>
                      <span className="text-xs text-[#1a1a1a]">
                        {timeAgo(gmailSyncState.last_poll_timestamp)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#9e998f]">Interval</span>
                    <span className="text-xs text-[#1a1a1a]">
                      {gmailSyncState.polling_interval_minutes ?? 2} minutes
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              SECTION 1 — NOTIFICATION SETTINGS
          ══════════════════════════════════════════════════════ */}
          <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
            <div className="mb-6">
              <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-1">
                Notification Settings
              </h2>
              <p className="text-sm text-[#1a1a1a] font-medium">
                Configure how Auto Job Lodger notifies you when orders are parsed.
              </p>
            </div>

            <div className="space-y-5">

              {/* Master toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-0.5">
                    Enable notification emails
                  </label>
                </div>
                <Switch
                  checked={config.notification_enabled}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => prev ? { ...prev, notification_enabled: checked } : null)
                  }
                />
              </div>

              {/* Notification email */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                  Send notifications to
                </label>
                <input
                  type="email"
                  value={config.notification_email}
                  onChange={(e) =>
                    setConfig((prev) => prev ? { ...prev, notification_email: e.target.value } : null)
                  }
                  className="border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] w-full"
                />
              </div>

              {/* Notify on success */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-0.5">
                    Notify on successful parse
                  </label>
                  <p className="text-xs text-[#9e998f] mt-1">
                    When off, only failed or needs-review orders trigger a notification
                  </p>
                </div>
                <Switch
                  checked={config.notify_on_success}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => prev ? { ...prev, notify_on_success: checked } : null)
                  }
                />
              </div>

              {/* Notify on needs review */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-0.5">
                    Notify on needs review
                  </label>
                </div>
                <Switch
                  checked={config.notify_on_needs_review}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => prev ? { ...prev, notify_on_needs_review: checked } : null)
                  }
                />
              </div>

              {/* Outside business hours */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-0.5">
                    Send notifications outside business hours
                  </label>
                </div>
                <Switch
                  checked={config.notify_outside_business_hours}
                  onCheckedChange={(checked) =>
                    setConfig((prev) =>
                      prev ? { ...prev, notify_outside_business_hours: checked } : null
                    )
                  }
                />
              </div>

              {/* Success email subject */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                  Success email subject
                </label>
                <input
                  type="text"
                  value={config.notification_subject_success}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, notification_subject_success: e.target.value } : null
                    )
                  }
                  className="border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] w-full"
                />
                <p className="text-xs text-[#9e998f] mt-1">
                  Available tokens: {'{claim_number}'} {'{insured_name}'}
                </p>
              </div>

              {/* Review email subject */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                  Review email subject
                </label>
                <input
                  type="text"
                  value={config.notification_subject_review}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, notification_subject_review: e.target.value } : null
                    )
                  }
                  className="border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] w-full"
                />
                <p className="text-xs text-[#9e998f] mt-1">
                  Available tokens: {'{original_subject}'}
                </p>
              </div>

              {/* Notification body template */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1">
                  Notification email body
                </label>
                <textarea
                  rows={8}
                  value={config.notification_body_template}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, notification_body_template: e.target.value } : null
                    )
                  }
                  className="border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] w-full resize-none"
                />
                <p className="text-xs text-[#9e998f] mt-1">
                  Available tokens: {'{insurer}'} {'{claim_number}'} {'{insured_name}'}{' '}
                  {'{property_address}'} {'{work_order_type}'} {'{confidence}'} {'{parse_status}'}{' '}
                  {'{missing_fields}'}
                </p>
              </div>

              {/* Save button */}
              <div className="pt-2 flex justify-end border-t border-[#e8e4e0]">
                <button
                  onClick={handleSaveNotifications}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-[#f5f0e8] bg-[#1a1a1a] rounded hover:bg-[#1a1a1a]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              SECTION 2 — FALLBACK KEYWORD RULES
          ══════════════════════════════════════════════════════ */}
          <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
            <div className="mb-6">
              <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-1">
                Fallback Keyword Rules
              </h2>
              <p className="text-sm text-[#1a1a1a] font-medium">
                These keywords are checked against the email subject when no client sender match is
                found. Case-insensitive.
              </p>
            </div>

            {/* Existing keywords */}
            {keywords.length === 0 ? (
              <p className="text-sm text-[#9e998f] mb-4">No keyword rules yet.</p>
            ) : (
              <div className="space-y-2 mb-5">
                {keywords.map((kw) => (
                  <div
                    key={kw.id}
                    className="flex items-center justify-between gap-3 py-2 border-b border-[#f5f2ee] last:border-0"
                  >
                    <span className="text-sm text-[#1a1a1a] font-mono flex-1">{kw.keyword}</span>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={kw.active}
                        onCheckedChange={(checked) => handleToggleKeyword(kw.id, checked)}
                      />
                      <button
                        onClick={() => handleDeleteKeyword(kw.id)}
                        className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add keyword form */}
            <div className="flex gap-2 pt-2 border-t border-[#e8e4e0]">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddKeyword()
                }}
                placeholder="Enter keyword…"
                className="border border-[#e8e4e0] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#c9a96e] flex-1"
              />
              <button
                onClick={handleAddKeyword}
                disabled={addingKeyword || !newKeyword.trim()}
                className="px-4 py-2 text-sm font-medium text-[#f5f0e8] bg-[#1a1a1a] rounded hover:bg-[#1a1a1a]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingKeyword ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════
              SECTION 3 — RECENT INTAKE LOG
          ══════════════════════════════════════════════════════ */}
          <div className="bg-white border border-[#e8e4e0] rounded-lg p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-1">
                  Recent Intake Log
                </h2>
                <p className="text-sm text-[#1a1a1a] font-medium">
                  Last 20 orders received via email.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => tenantId && loadOrders(tenantId)}
                  disabled={ordersLoading}
                  className="px-3 py-1.5 text-xs font-medium text-[#1a1a1a] border border-[#e8e4e0] rounded hover:bg-[#f5f2ee] transition-colors disabled:opacity-50"
                >
                  {ordersLoading ? 'Refreshing…' : 'Refresh'}
                </button>
                <Link
                  href="/dashboard/insurer-orders"
                  className="text-xs text-[#c9a96e] hover:text-[#b8965e] font-medium transition-colors"
                >
                  View all →
                </Link>
              </div>
            </div>

            {recentOrders.length === 0 ? (
              <p className="text-sm text-[#9e998f]">No email orders found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e8e4e0]">
                      <th className="text-left text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold pb-2 pr-4">
                        Received
                      </th>
                      <th className="text-left text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold pb-2 pr-4">
                        Insurer
                      </th>
                      <th className="text-left text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold pb-2 pr-4">
                        Claim Number
                      </th>
                      <th className="text-left text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold pb-2 pr-4">
                        Insured Name
                      </th>
                      <th className="text-left text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold pb-2 pr-4">
                        Parse Status
                      </th>
                      <th className="text-left text-[10px] uppercase tracking-wider text-[#9e998f] font-semibold pb-2 pr-4">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-[#f5f2ee] last:border-0 hover:bg-[#f5f2ee]/50 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-xs text-[#9e998f] whitespace-nowrap">
                          {order.created_at ? timeAgo(order.created_at) : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-[#1a1a1a]">
                          {order.insurer ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-[#1a1a1a] font-mono">
                          {order.claim_number ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-[#1a1a1a]">
                          {order.insured_name ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4">
                          <ParseStatusBadge status={order.parse_status} />
                        </td>
                        <td className="py-2.5 pr-4">
                          <Link
                            href="/dashboard/insurer-orders"
                            className="text-xs text-[#c9a96e] hover:text-[#b8965e] font-medium transition-colors"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
