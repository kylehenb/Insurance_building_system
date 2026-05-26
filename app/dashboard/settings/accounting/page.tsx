'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { ChartOfAccountsItem, IrcCategory } from '@/lib/accounting/types'

interface AccountMapping {
  accountId: string
  accountName: string
}

interface AccountMappingRow {
  irc_category: string
  accounting_account_id: string
  accounting_account_name: string
}

interface CredentialsRow {
  realm_id: string
  updated_at: string
}

interface FailedInvoiceRow {
  id: string
  invoice_ref: string
  accounting_sync_status: string
  accounting_sync_error: string | null
  accounting_last_synced_at: string | null
}

interface IrcCategoryMeta {
  category: IrcCategory
  label: string
  description: string
}

const IRC_CATEGORIES: IrcCategoryMeta[] = [
  {
    category: 'bar_report',
    label: 'BAR Report',
    description: 'Assessment report income',
  },
  {
    category: 'roof_report',
    label: 'Roof Report',
    description: 'Roof inspection income',
  },
  {
    category: 'make_safe',
    label: 'Make Safe',
    description: 'Emergency make safe income',
  },
  {
    category: 'repair_works',
    label: 'Repair Works',
    description: 'Building repair income',
  },
  {
    category: 'excess_recovery',
    label: 'Excess Recovery',
    description: 'Homeowner excess invoices',
  },
  {
    category: 'specialist_report',
    label: 'Specialist Report',
    description: 'Specialist report income',
  },
  {
    category: 'leak_detection_report',
    label: 'Leak Detection',
    description: 'Leak detection report income',
  },
  {
    category: 'trade_cost',
    label: 'Trade Cost (AP)',
    description: 'Trade bills / cost of sales',
  },
]

export default function AccountingSettingsPage() {
  const router = useRouter()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [userId, setUserId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [isConnected, setIsConnected] = useState(false)
  const [realmId, setRealmId] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<ChartOfAccountsItem[]>([])
  const [mappings, setMappings] = useState<Record<IrcCategory, AccountMapping>>(
    {} as Record<IrcCategory, AccountMapping>
  )
  const [savingMappings, setSavingMappings] = useState(false)
  const [mappingsSaved, setMappingsSaved] = useState(false)

  const [disconnecting, setDisconnecting] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)

  const [failedInvoices, setFailedInvoices] = useState<FailedInvoiceRow[]>([])
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Effect 1: get session
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }
      setUserId(session.user.id)
    }
    getSession()
  }, [router, supabase.auth])

  const fetchData = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    try {
      // Get tenant_id
      const { data: userRow } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', userId)
        .single()

      const tid = (userRow as { tenant_id: string } | null)?.tenant_id
      if (!tid) {
        setError('Could not determine tenant')
        setLoading(false)
        return
      }
      setTenantId(tid)

      // Check connection status
      const { data: creds } = await supabase
        .from('accounting_credentials')
        .select('realm_id, updated_at')
        .eq('tenant_id', tid)
        .eq('provider', 'quickbooks')
        .maybeSingle()

      if (creds) {
        const credsRow = creds as CredentialsRow
        setIsConnected(true)
        setRealmId(credsRow.realm_id)
        setLastSyncAt(credsRow.updated_at)

        // Fetch chart of accounts
        const accountsRes = await fetch('/api/accounting/accounts')
        if (accountsRes.ok) {
          const accountsData = (await accountsRes.json()) as { accounts: ChartOfAccountsItem[] }
          setAccounts(accountsData.accounts)
        }

        // Fetch existing mappings
        const mappingsRes = await fetch('/api/accounting/account-mappings')
        if (mappingsRes.ok) {
          const mappingsData = (await mappingsRes.json()) as { mappings: AccountMappingRow[] }
          const mapped = {} as Record<IrcCategory, AccountMapping>
          for (const m of mappingsData.mappings) {
            mapped[m.irc_category as IrcCategory] = {
              accountId: m.accounting_account_id,
              accountName: m.accounting_account_name,
            }
          }
          setMappings(mapped)
        }

        // Fetch failed invoices
        const { data: failedData } = await supabase
          .from('invoices')
          .select('id, invoice_ref, accounting_sync_status, accounting_sync_error, accounting_last_synced_at')
          .eq('tenant_id', tid)
          .eq('accounting_sync_status', 'failed')
          .order('accounting_last_synced_at', { ascending: false })
          .limit(20)

        setFailedInvoices((failedData ?? []) as FailedInvoiceRow[])
      } else {
        setIsConnected(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [userId, supabase])

  // Effect 2: fetch data once userId is set
  useEffect(() => {
    if (!userId) return
    fetchData()
  }, [userId, fetchData])

  // Handle ?connected=true redirect from OAuth callback
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      setSuccessMessage('QuickBooks connected successfully!')
      window.history.replaceState({}, '', '/dashboard/settings/accounting')
    }
    if (params.get('error')) {
      setError(`Connection failed: ${params.get('error')}`)
      window.history.replaceState({}, '', '/dashboard/settings/accounting')
    }
  }, [])

  async function handleConnect() {
    setConnectLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounting/auth')
      if (!res.ok) throw new Error('Failed to get auth URL')
      const data = (await res.json()) as { url: string }
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setConnectLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect QuickBooks? This will remove your credentials.')) return
    setDisconnecting(true)
    setError(null)
    try {
      const res = await fetch('/api/accounting/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to disconnect')
      setIsConnected(false)
      setRealmId(null)
      setAccounts([])
      setMappings({} as Record<IrcCategory, AccountMapping>)
      setSuccessMessage('QuickBooks disconnected.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  function handleMappingChange(category: IrcCategory, accountId: string) {
    const account = accounts.find((a) => a.id === accountId)
    if (!account) return
    setMappings((prev) => ({
      ...prev,
      [category]: { accountId: account.id, accountName: account.name },
    }))
  }

  async function handleSaveMappings() {
    setSavingMappings(true)
    setError(null)
    setMappingsSaved(false)
    try {
      const mappingsPayload = Object.entries(mappings)
        .filter(([, v]) => v.accountId)
        .map(([category, v]) => ({
          irc_category: category,
          accounting_account_id: v.accountId,
          accounting_account_name: v.accountName,
        }))

      const res = await fetch('/api/accounting/account-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: mappingsPayload }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to save')
      }

      setMappingsSaved(true)
      setTimeout(() => setMappingsSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mappings')
    } finally {
      setSavingMappings(false)
    }
  }

  async function handleRetrySync(invoiceId: string) {
    setRetryingId(invoiceId)
    setError(null)
    try {
      const res = await fetch('/api/accounting/sync-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Sync failed')
      }
      setSuccessMessage('Invoice synced successfully.')
      setFailedInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetryingId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-sm text-[#9e998f]">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Accounting & QuickBooks</h1>
        <p className="text-sm text-[#9e998f] mt-1">
          Connect QuickBooks Online, map your chart of accounts, and sync invoices and bills.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded px-4 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {/* Section 1: Connection Status */}
      <div className="bg-white rounded-lg border border-[#e8e4e0] p-6 mb-6">
        <h2 className="text-sm font-semibold text-[#1a1a1a] mb-4">Connection Status</h2>

        {isConnected ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-[#1a1a1a]">Connected to QuickBooks</span>
              </div>
              {realmId && (
                <p className="text-xs text-[#9e998f]">Company ID: {realmId}</p>
              )}
              {lastSyncAt && (
                <p className="text-xs text-[#9e998f] mt-0.5">
                  Last updated: {new Date(lastSyncAt).toLocaleString()}
                </p>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-sm text-red-600 hover:text-red-700 border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-[#9e998f]" />
                <span className="text-sm font-medium text-[#1a1a1a]">Not connected</span>
              </div>
              <p className="text-xs text-[#9e998f]">
                Connect QuickBooks Online to sync invoices and bills automatically.
              </p>
            </div>
            <button
              onClick={handleConnect}
              disabled={connectLoading}
              className="text-sm text-white bg-[#c9a96e] hover:bg-[#b8985f] rounded px-4 py-1.5 transition-colors disabled:opacity-50"
            >
              {connectLoading ? 'Redirecting...' : 'Connect to QuickBooks'}
            </button>
          </div>
        )}
      </div>

      {/* Section 2: Chart of Accounts Mapping */}
      {isConnected && (
        <div className="bg-white rounded-lg border border-[#e8e4e0] p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#1a1a1a]">Chart of Accounts Mapping</h2>
              <p className="text-xs text-[#9e998f] mt-0.5">
                Map each IRC invoice category to a QuickBooks account.
              </p>
            </div>
            <button
              onClick={handleSaveMappings}
              disabled={savingMappings}
              className="text-sm text-white bg-[#c9a96e] hover:bg-[#b8985f] rounded px-4 py-1.5 transition-colors disabled:opacity-50"
            >
              {savingMappings
                ? 'Saving...'
                : mappingsSaved
                ? 'Saved!'
                : 'Save Mappings'}
            </button>
          </div>

          {accounts.length === 0 ? (
            <p className="text-sm text-[#9e998f]">
              No accounts loaded. Ensure QuickBooks is connected and your chart of accounts has
              Income, Expense, or COGS accounts.
            </p>
          ) : (
            <div className="divide-y divide-[#e8e4e0]">
              {IRC_CATEGORIES.map(({ category, label, description }) => (
                <div
                  key={category}
                  className="py-3 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1a1a1a]">{label}</p>
                    <p className="text-xs text-[#9e998f]">{description}</p>
                  </div>
                  <div className="w-64">
                    <select
                      value={mappings[category]?.accountId ?? ''}
                      onChange={(e) => handleMappingChange(category, e.target.value)}
                      className="w-full border border-[#e8e4e0] rounded text-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c9a96e] text-[#1a1a1a]"
                    >
                      <option value="">— select account —</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                          {account.code ? ` (${account.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section 3: Last Sync Status / Failed Invoices */}
      {isConnected && (
        <div className="bg-white rounded-lg border border-[#e8e4e0] p-6">
          <h2 className="text-sm font-semibold text-[#1a1a1a] mb-4">Failed Syncs</h2>

          {failedInvoices.length === 0 ? (
            <p className="text-sm text-[#9e998f]">No failed syncs. All invoices are up to date.</p>
          ) : (
            <div className="divide-y divide-[#e8e4e0]">
              {failedInvoices.map((inv) => (
                <div key={inv.id} className="py-3 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1a1a1a]">
                      {inv.invoice_ref}
                    </p>
                    {inv.accounting_sync_error && (
                      <p className="text-xs text-red-600 mt-0.5">{inv.accounting_sync_error}</p>
                    )}
                    {inv.accounting_last_synced_at && (
                      <p className="text-xs text-[#9e998f] mt-0.5">
                        Last attempted: {new Date(inv.accounting_last_synced_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRetrySync(inv.id)}
                    disabled={retryingId === inv.id}
                    className="text-xs text-[#c9a96e] hover:text-[#b8985f] border border-[#c9a96e] rounded px-3 py-1 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {retryingId === inv.id ? 'Retrying...' : 'Retry'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tenant ID for debugging — hidden from UI, available as data attr if needed */}
      {tenantId && <div className="hidden" data-tenant-id={tenantId} />}
    </div>
  )
}
