'use client'

import { useCallback, useEffect, useState } from 'react'
import type { VoiceKeyView } from '@/lib/voice-keys/keys'

// Settings → Voice connector: personal keys for the Claude voice connector
// (claude.ai / Claude iOS). The connector acts as the key's owner, with their
// permissions. Saved through /api/settings/voice-keys.

interface KeysData { mine: VoiceKeyView[]; others: VoiceKeyView[]; canManage: boolean }
type Loaded = { data?: KeysData; error?: string }

async function fetchKeys(): Promise<Loaded> {
  const res = await fetch('/api/settings/voice-keys')
  const json = await res.json().catch(() => ({}))
  return res.ok ? { data: json as KeysData } : { error: json.error ?? 'Could not load keys' }
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never')

function KeyRow({ k, showOwner, busy, onRevoke }: { k: VoiceKeyView; showOwner: boolean; busy: boolean; onRevoke: () => void }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink">{showOwner && `${k.userName ?? 'Unknown'} — `}{k.label}</div>
        <div className="text-xs text-subtle">…{k.hint} · made {when(k.createdAt)} · last used {when(k.lastUsedAt)}</div>
      </div>
      <button onClick={onRevoke} disabled={busy} className="text-xs text-[#9f1239] hover:underline disabled:opacity-50">Revoke</button>
    </div>
  )
}

export default function VoiceConnectorPage() {
  const [data, setData] = useState<KeysData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')

  const apply = useCallback((result: Loaded) => {
    if (result.data) setData(result.data)
    setError(result.error ?? null)
  }, [])

  useEffect(() => {
    let live = true
    fetchKeys().then(result => {
      if (!live) return
      apply(result)
      setOrigin(window.location.origin)
    })
    return () => { live = false }
  }, [apply])

  async function create() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/settings/voice-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setNewKey(json.key)
      setLabel('')
    }
    const reloaded = await fetchKeys()
    apply(res.ok ? reloaded : { ...reloaded, error: json.error ?? 'Could not make the key' })
    setBusy(false)
  }

  async function revoke(k: VoiceKeyView) {
    if (!window.confirm(`Revoke "${k.label}"${k.userName ? ` (${k.userName})` : ''}? Claude stops working with it straight away.`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/voice-keys?id=${encodeURIComponent(k.id)}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    const reloaded = await fetchKeys()
    apply(res.ok ? reloaded : { ...reloaded, error: json.error ?? 'Could not revoke the key' })
    setBusy(false)
  }

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      setCopied(null)
    }
  }

  if (!data) return <div className="p-8 text-sm text-subtle">{error ?? 'Loading…'}</div>

  const url = `${origin}/api/mcp`
  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <a href="/dashboard/settings" className="text-xs text-subtle hover:text-ink">← Settings</a>
        <h1 className="text-2xl font-semibold text-ink mt-1">Voice connector</h1>
        <p className="text-sm text-subtle mt-1">
          Your own key for using IRC Master from Claude (the app or voice). Claude acts as you, with your permissions,
          and what it does is in Settings → Activity under your name. Keep a key private, like a password; revoke it if a phone is lost.
        </p>
        {error && <p className="text-sm text-[#9f1239] mt-2">{error}</p>}
      </div>

      {newKey && (
        <section className="mb-8 bg-[#f0f7f3] border border-[#b7d9c6] rounded-lg p-4">
          <div className="text-sm font-medium text-ink mb-2">Your new key — copy it now, it won&apos;t be shown again</div>
          <div className="flex gap-2 items-center mb-4">
            <code className="flex-1 text-xs bg-white border border-line-3 rounded px-2 py-1.5 break-all">{newKey}</code>
            <button onClick={() => copy('key', newKey)} className="text-xs text-tan hover:underline">{copied === 'key' ? 'Copied' : 'Copy'}</button>
          </div>
          <div className="text-xs text-subtle space-y-1">
            <div className="font-medium text-ink">Add it in claude.ai → Settings → Connectors → Add custom connector:</div>
            <div>1. URL: <code className="bg-white px-1">{url}</code> <button onClick={() => copy('url', url)} className="text-tan hover:underline">{copied === 'url' ? 'Copied' : 'Copy'}</button></div>
            <div>2. Authentication: No sign-in, with a request header <code className="bg-white px-1">Authorization</code> = <code className="bg-white px-1">Bearer {'<your key>'}</code>.</div>
            <div>3. If you already had the IRC Master connector, just replace the header value. It then shows up on your phone too.</div>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-subtle hover:text-ink mt-3">Done</button>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-xs text-subtle uppercase tracking-wider mb-3">Your keys</h2>
        <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3">
          {data.mine.length === 0 && <div className="px-4 py-3 text-sm text-subtle">No keys yet.</div>}
          {data.mine.map(k => <KeyRow key={k.id} k={k} showOwner={false} busy={busy} onRevoke={() => revoke(k)} />)}
          <div className="flex items-center gap-2 px-4 py-3">
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Name it, e.g. My iPhone"
              maxLength={60}
              className="flex-1 border border-line-3 rounded px-2 py-1 text-sm"
            />
            <button onClick={create} disabled={busy || !label.trim()} className="text-sm px-3 py-1 rounded bg-ink text-white disabled:opacity-50">Make a key</button>
          </div>
        </div>
      </section>

      {data.canManage && (
        <section className="mb-8">
          <h2 className="text-xs text-subtle uppercase tracking-wider mb-3">Everyone else&apos;s keys</h2>
          <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3">
            {data.others.length === 0 && <div className="px-4 py-3 text-sm text-subtle">Nobody else has a key.</div>}
            {data.others.map(k => <KeyRow key={k.id} k={k} showOwner busy={busy} onRevoke={() => revoke(k)} />)}
          </div>
        </section>
      )}
    </div>
  )
}
