'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface SearchResult {
  id: string
  job_number: string
  property_address: string | null
  insured_name: string | null
}

interface User {
  name: string
  role: string
  initials: string
}

interface SidebarProps {
  user: User
  tenantId: string
  assistantVisible?: boolean
  onToggleAssistant?: () => void
}

type MenuKey = 'util' | 'user' | null

// All icons share a 16×16 viewBox; stroke and size come from the .rail-icon class.
const ICONS = {
  assistant: (
    <>
      <path d="M7 2.5l1.2 3.3 3.3 1.2-3.3 1.2L7 11.5 5.8 8.2 2.5 7l3.3-1.2z" />
      <path d="M12 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  home: (
    <>
      <path d="M2 7.5L8 2.5l6 5" />
      <path d="M3.5 6.5V13.5h3.5v-3.5h2v3.5h3.5V6.5" />
    </>
  ),
  jobs: (
    <>
      <rect x="3" y="2.5" width="10" height="11.5" rx="1.5" />
      <path d="M6 2.5V1.8h4v.7M5.5 6.5l.8.8 1.4-1.6M9 7h1.5M5.5 10l.8.8 1.4-1.6M9 10.5h1.5" />
    </>
  ),
  orders: (
    <>
      <path d="M2 9l1.8-5.2a1 1 0 01.9-.8h6.6a1 1 0 01.9.8L14 9v3.5a1 1 0 01-1 1H3a1 1 0 01-1-1V9z" />
      <path d="M2 9h3.5l1 1.5h3l1-1.5H14" />
    </>
  ),
  calendar: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M5 1.8V4.2M11 1.8V4.2M2 6.5h12" />
      <circle cx="5.5" cy="9" r=".6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="9" r=".6" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="9" r=".6" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="11.5" r=".6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="11.5" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  toolbox: (
    <>
      <rect x="2" y="5.5" width="12" height="8" rx="1" />
      <path d="M6 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5M2 9h12M6.5 8v2M9.5 8v2" />
    </>
  ),
  clients: (
    <>
      <circle cx="6" cy="5.5" r="2.3" />
      <path d="M1.8 13.5c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2" />
      <path d="M10.5 3.4a2.3 2.3 0 010 4.3M12 9.6c1.3.6 2.2 2 2.2 3.9" />
    </>
  ),
  scope: (
    <>
      <path d="M8 4.2C6.8 3.2 5 2.8 2.5 3v9.5c2.5-.2 4.3.2 5.5 1.2 1.2-1 3-1.4 5.5-1.2V3c-2.5-.2-4.3.2-5.5 1.2z" />
      <path d="M8 4.2v9.5" />
    </>
  ),
  trades: (
    <path d="M10.5 2.5a3 3 0 00-2.8 4.1L2.8 11.5a1.2 1.2 0 001.7 1.7l4.9-4.9a3 3 0 004.1-2.8l-1.8 1.8-1.9-.4-.4-1.9z" />
  ),
  finance: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M10 5.8c-.4-.5-1.1-.8-2-.8-1.2 0-2 .6-2 1.5S6.8 7.8 8 8s2 .6 2 1.5-.8 1.5-2 1.5c-.9 0-1.6-.3-2-.8M8 4v1M8 11v1" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="4.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  signout: <path d="M10 3h3v10h-3M7 11l4-3-4-3M11 8H3" />,
}

function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg className="rail-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function Sidebar({ user, tenantId, assistantVisible = false, onToggleAssistant }: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [menu, setMenu] = useState<MenuKey>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [searchedFor, setSearchedFor] = useState('')
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number>(0)
  const [unscheduledInspectionsCount, setUnscheduledInspectionsCount] = useState<number>(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLElement>(null)

  // Fetch pending insurer orders count on mount
  useEffect(() => {
    async function fetchPendingCount() {
      const { count } = await supabase
        .from('insurer_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
      setPendingOrdersCount(count ?? 0)
    }
    fetchPendingCount()
  }, [tenantId])

  // Fetch unscheduled inspections count on mount
  useEffect(() => {
    async function fetchUnscheduledCount() {
      const { count } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'unscheduled')
      setUnscheduledInspectionsCount(count ?? 0)
    }
    fetchUnscheduledCount()
  }, [tenantId])

  // Close pop-out menus on a click outside the rail
  useEffect(() => {
    if (!menu) return
    function handleDown(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [menu])

  const openSearch = useCallback(() => {
    setMenu(null)
    setQuery('')
    setResults([])
    setSelected(0)
    setSearchOpen(true)
  }, [])

  function closeSearch() {
    setSearchOpen(false)
    setQuery('')
    setResults([])
  }

  // Ctrl/Cmd+K or "/" opens search; Escape closes search and menus
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
      } else if (e.key === '/' && !typing) {
        e.preventDefault()
        openSearch()
      } else if (e.key === 'Escape') {
        setMenu(null)
        setSearchOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [openSearch])

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  // Debounced fuzzy search
  const handleSearch = useCallback(
    (val: string) => {
      setQuery(val)
      setSelected(0)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!val.trim()) {
        setResults([])
        return
      }
      debounceRef.current = setTimeout(async () => {
        const { data } = await supabase
          .from('jobs')
          .select('id, job_number, property_address, insured_name')
          .eq('tenant_id', tenantId)
          .or(
            `job_number.ilike.%${val}%,claim_number.ilike.%${val}%,insured_name.ilike.%${val}%,property_address.ilike.%${val}%,insurer.ilike.%${val}%`
          )
          .order('created_at', { ascending: false })
          .limit(6)
        setResults(data ?? [])
        setSearchedFor(val)
      }, 300)
    },
    [tenantId]
  )

  function selectResult(id: string) {
    closeSearch()
    router.push(`/dashboard/jobs/${id}`)
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => (s + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (s - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectResult(results[selected].id)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems: { label: string; href: string; icon: keyof typeof ICONS; badge?: number | null; badgeText?: string }[] = [
    { label: 'Dashboard', href: '/dashboard', icon: 'home' },
    { label: 'Jobs', href: '/dashboard/jobs', icon: 'jobs' },
    {
      label: 'Insurer Orders',
      href: '/dashboard/insurer-orders',
      icon: 'orders',
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : null,
      badgeText: 'pending',
    },
    {
      label: 'Calendar',
      href: '/dashboard/calendar',
      icon: 'calendar',
      badge: unscheduledInspectionsCount > 0 ? unscheduledInspectionsCount : null,
      badgeText: 'unscheduled',
    },
  ]

  const utilItems: { label: string; href: string; icon: keyof typeof ICONS }[] = [
    { label: 'Clients', href: '/dashboard/clients', icon: 'clients' },
    { label: 'Scope Library', href: '/dashboard/scope-library', icon: 'scope' },
    { label: 'Trades', href: '/dashboard/trades', icon: 'trades' },
    { label: 'Finance', href: '/dashboard/finance', icon: 'finance' },
    { label: 'Settings', href: '/dashboard/settings', icon: 'settings' },
  ]

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  const utilActive = utilItems.some((item) => isActive(item.href))

  return (
    <>
      <style>{`
        .rail { width: 60px; min-width: 60px; background: var(--ink); display: flex; flex-direction: column; align-items: center; height: 100vh; flex-shrink: 0; padding: 0 0 12px; gap: 4px; position: relative; z-index: 40; }
        .rail-brand { width: 100%; display: flex; justify-content: center; padding: 16px 0 14px; margin-bottom: 6px; border-bottom: 0.5px solid var(--ink-hover); }
        .rail-logo { display: block; width: 44px; height: 48px; object-fit: contain; }
        .rail-icon { flex-shrink: 0; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
        .rail-btn { width: 40px; height: 40px; border-radius: 9px; border: none; background: none; color: #888; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; transition: background 0.15s, color 0.15s; text-decoration: none; font-family: inherit; padding: 0; }
        .rail-btn:hover { background: var(--ink-hover); color: #bbb0a8; }
        .rail-btn.active { background: #2b2620; color: var(--line-tan-3); }
        .rail-btn.active::before { content: ''; position: absolute; left: -10px; top: 50%; transform: translateY(-50%); width: 3px; height: 20px; background: var(--tan); border-radius: 0 2px 2px 0; }
        .rail-btn.on { color: var(--line-tan-3); }
        .rail-btn:focus-visible { outline: 2px solid var(--tan); outline-offset: 1px; }
        .rail-badge { position: absolute; top: 3px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 10px; background: var(--tan); color: var(--ink); font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px var(--ink); }
        .rail-ai-dot { position: absolute; bottom: 7px; right: 7px; width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--ink); transition: background 0.2s; }
        .rail-sep { width: 24px; border-top: 0.5px solid #2c2c2c; margin: 6px 0; flex-shrink: 0; }
        .rail-spacer { flex: 1; }
        .rail-wrap { position: relative; }
        .rail-tip { position: absolute; left: calc(100% + 12px); top: 50%; transform: translate(-4px, -50%); background: var(--ink); color: var(--cream); border: 0.5px solid #333; padding: 6px 10px; border-radius: 6px; font-size: 12.5px; font-weight: 600; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.12s, transform 0.12s; z-index: 50; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); }
        .rail-tip small { font-weight: 500; color: var(--tan); font-size: 11px; }
        .rail-tip kbd { font: 500 10.5px 'DM Mono', monospace; color: #9e998f; border: 0.5px solid #3a3a3a; border-radius: 4px; padding: 0 4px; }
        .rail-btn:hover .rail-tip, .rail-btn:focus-visible .rail-tip { opacity: 1; transform: translate(0, -50%); transition-delay: 0.08s; }
        .rail-btn.menu-open .rail-tip { display: none; }
        .rail-av { width: 32px; height: 32px; border-radius: 50%; background: #242018; border: 0.5px solid rgba(200,184,154,0.267); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--tan); flex-shrink: 0; }
        .rail-fly { position: absolute; left: calc(100% + 10px); background: var(--ink); border: 0.5px solid #303030; border-radius: 10px; padding: 6px; min-width: 200px; z-index: 60; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
        .rail-fly-h { font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase; color: #6a6460; font-weight: 700; padding: 8px 10px 6px; }
        .rail-fly-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: none; background: none; color: #888; font-size: 13.5px; font-weight: 700; border-radius: 7px; cursor: pointer; text-align: left; text-decoration: none; font-family: inherit; }
        .rail-fly-item:hover { background: var(--ink-hover); color: #bbb0a8; }
        .rail-fly-item.active { color: var(--line-tan-3); background: #2b2620; }
        .rail-fly-user { display: flex; gap: 10px; align-items: center; padding: 8px 10px 10px; border-bottom: 0.5px solid #2a2a2a; margin-bottom: 4px; }
        .rail-user-name { font-size: 13px; color: var(--line-tan-3); font-weight: 700; }
        .rail-user-role { font-size: 10px; color: #6a6460; margin-top: 1px; font-weight: 500; }
        .rail-search-back { position: fixed; inset: 0; background: rgba(26,26,26,0.35); z-index: 100; display: flex; justify-content: center; align-items: flex-start; padding: 12vh 16px 16px; }
        .rail-search { width: 560px; max-width: 100%; background: var(--paper); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden; border: 1px solid var(--line); }
        .rail-search-in { display: flex; align-items: center; gap: 10px; padding: 14px 16px; color: #9e998f; }
        .rail-search-in input { flex: 1; border: none; outline: none; font-family: inherit; font-size: 15px; font-weight: 500; color: var(--ink); background: none; min-width: 0; }
        .rail-search-in input::placeholder { color: #b0a898; }
        .rail-search-in kbd { font: 500 10.5px 'DM Mono', monospace; color: #9e998f; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
        .rail-search-list { border-top: 1px solid var(--line); max-height: 340px; overflow-y: auto; padding: 6px; }
        .rail-search-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 7px; cursor: pointer; font-size: 13.5px; }
        .rail-search-item.sel { background: var(--surface); }
        .rail-search-job { font: 500 12.5px 'DM Mono', monospace; color: #8a7656; min-width: 72px; }
        .rail-search-addr { color: #5a5650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rail-search-name { margin-left: auto; color: #9e998f; font-size: 12px; white-space: nowrap; }
        .rail-search-empty { border-top: 1px solid var(--line); padding: 14px 16px; color: #9e998f; font-size: 13px; }
        @media (prefers-reduced-motion: reduce) { .rail-btn, .rail-tip { transition: none; } }
      `}</style>

      <aside className="rail" ref={railRef}>
        {/* Brand */}
        <Link href="/dashboard" className="rail-brand" aria-label="Insurance Repair Co. — Dashboard">
          <img src="/logo.png" alt="Insurance Repair Co." className="rail-logo" />
        </Link>

        {/* AI Assistant toggle */}
        <button
          className={`rail-btn${assistantVisible ? ' on' : ''}`}
          onClick={onToggleAssistant}
          aria-label={assistantVisible ? 'Hide IRC Assistant' : 'Show IRC Assistant'}
          aria-pressed={assistantVisible}
        >
          <Icon name="assistant" />
          <span className="rail-ai-dot" style={{ background: assistantVisible ? 'var(--tan)' : '#383838' }} />
          <span className="rail-tip" role="tooltip">
            IRC Assistant <small>{assistantVisible ? 'On' : 'Off'}</small>
          </span>
        </button>

        {/* Search */}
        <button className="rail-btn" onClick={openSearch} aria-label="Search jobs">
          <Icon name="search" />
          <span className="rail-tip" role="tooltip">
            Search jobs <kbd>Ctrl K</kbd>
          </span>
        </button>

        <div className="rail-sep" />

        {/* Nav */}
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rail-btn${isActive(item.href) ? ' active' : ''}`}
            aria-label={item.badge != null ? `${item.label}, ${item.badge} ${item.badgeText}` : item.label}
          >
            <Icon name={item.icon} />
            {item.badge != null && <span className="rail-badge">{item.badge}</span>}
            <span className="rail-tip" role="tooltip">
              {item.label}
              {item.badge != null && <small>{item.badge} {item.badgeText}</small>}
            </span>
          </Link>
        ))}

        <div className="rail-sep" />

        {/* Utilities & Settings */}
        <div className="rail-wrap">
          <button
            className={`rail-btn${utilActive ? ' active' : ''}${menu === 'util' ? ' menu-open' : ''}`}
            onClick={() => setMenu((m) => (m === 'util' ? null : 'util'))}
            aria-label="Utilities & Settings"
            aria-expanded={menu === 'util'}
          >
            <Icon name="toolbox" />
            <span className="rail-tip" role="tooltip">Utilities &amp; Settings</span>
          </button>
          {menu === 'util' && (
            <div className="rail-fly" style={{ top: -8 }}>
              <div className="rail-fly-h">Utilities &amp; Settings</div>
              {utilItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rail-fly-item${isActive(item.href) ? ' active' : ''}`}
                  onClick={() => setMenu(null)}
                >
                  <Icon name={item.icon} size={15} />
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rail-spacer" />

        {/* User */}
        <div className="rail-wrap">
          <button
            className={`rail-btn${menu === 'user' ? ' menu-open' : ''}`}
            style={{ borderRadius: '50%' }}
            onClick={() => setMenu((m) => (m === 'user' ? null : 'user'))}
            aria-label={`${user.name}, account menu`}
            aria-expanded={menu === 'user'}
          >
            <span className="rail-av">{user.initials}</span>
            <span className="rail-tip" role="tooltip">
              {user.name} <small>{user.role}</small>
            </span>
          </button>
          {menu === 'user' && (
            <div className="rail-fly" style={{ bottom: 0 }}>
              <div className="rail-fly-user">
                <div className="rail-av">{user.initials}</div>
                <div>
                  <div className="rail-user-name">{user.name}</div>
                  <div className="rail-user-role">{user.role}</div>
                </div>
              </div>
              <Link href="/dashboard/settings" className="rail-fly-item" onClick={() => setMenu(null)}>
                <Icon name="settings" size={15} />
                Settings
              </Link>
              <button className="rail-fly-item" onClick={handleSignOut}>
                <Icon name="signout" size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Search (opened from the rail, Ctrl/Cmd+K or "/") */}
      {searchOpen && (
        <div
          className="rail-search-back"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSearch()
          }}
        >
          <div className="rail-search" role="dialog" aria-label="Search jobs">
            <div className="rail-search-in">
              <Icon name="search" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search jobs, claim numbers, names, addresses…"
                autoComplete="off"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={handleSearchKey}
              />
              <kbd>Esc</kbd>
            </div>
            {results.length > 0 && (
              <div className="rail-search-list">
                {results.map((r, i) => (
                  <div
                    key={r.id}
                    className={`rail-search-item${i === selected ? ' sel' : ''}`}
                    onMouseEnter={() => setSelected(i)}
                    onMouseDown={() => selectResult(r.id)}
                  >
                    <span className="rail-search-job">{r.job_number}</span>
                    <span className="rail-search-addr">{r.property_address ?? '—'}</span>
                    {r.insured_name && <span className="rail-search-name">{r.insured_name}</span>}
                  </div>
                ))}
              </div>
            )}
            {query.trim() && searchedFor === query && results.length === 0 && (
              <div className="rail-search-empty">No jobs match. Try a job number, claim number or street name.</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
