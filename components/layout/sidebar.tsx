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
}

export function Sidebar({ user, tenantId }: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [dropOpen, setDropOpen] = useState(false)
  const [utilOpen, setUtilOpen] = useState(false)
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number>(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Debounced fuzzy search
  const handleSearch = useCallback(
    (val: string) => {
      setQuery(val)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!val.trim()) {
        setResults([])
        setDropOpen(false)
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
          .limit(5)
        setResults(data ?? [])
        setDropOpen(true)
      }, 300)
    },
    [tenantId]
  )

  function handleBlur() {
    setTimeout(() => setDropOpen(false), 150)
  }

  function selectResult(id: string) {
    setDropOpen(false)
    setQuery('')
    router.push(`/dashboard/jobs/${id}`)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems = [
    {
      label: 'Dashboard',
      href: '/dashboard',
      icon: (
        <svg className="nav-icon" viewBox="0 0 16 16" strokeWidth="1.6" stroke="currentColor" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      ),
    },
    {
      label: 'Jobs',
      href: '/dashboard/jobs',
      icon: (
        <svg className="nav-icon" viewBox="0 0 16 16" strokeWidth="1.6" stroke="currentColor" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M5 3V2M11 3V2M2 7h12" />
        </svg>
      ),
    },
    {
      label: 'Insurer Orders',
      href: '/dashboard/insurer-orders',
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : null,
      icon: (
        <svg className="nav-icon" viewBox="0 0 16 16" strokeWidth="1.6" stroke="currentColor" fill="none">
          <path d="M2 13V7l6-5 6 5v6H2z" />
        </svg>
      ),
    },
    {
      label: 'Calendar',
      href: '/dashboard/calendar',
      icon: (
        <svg className="nav-icon" viewBox="0 0 16 16" strokeWidth="1.6" stroke="currentColor" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M5 3V2M11 3V2M2 7h12" />
        </svg>
      ),
    },
  ]

  const utilItems = [
    {
      label: 'Clients',
      href: '/dashboard/clients',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="6" r="3" />
          <path d="M2 13c0-3 2.7-5 6-5s6 2 6 5" />
        </svg>
      ),
    },
    {
      label: 'Scope Library',
      href: '/dashboard/scope-library',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4h10M3 8h7M3 12h5" />
        </svg>
      ),
    },
    {
      label: 'Trades',
      href: '/dashboard/trades',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2l1.5 3 3.5.5-2.5 2.5.5 3.5L8 10l-3 1.5.5-3.5L3 5.5 6.5 5z" />
        </svg>
      ),
    },
    {
      label: 'Finance',
      href: '/dashboard/finance',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="4" width="12" height="9" rx="1" />
          <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
        </svg>
      ),
    },
    {
      label: 'Settings',
      href: '/dashboard/settings',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
        </svg>
      ),
    },
  ]

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <>
      <style>{`
        .sidebar { width: 220px; min-width: 220px; background: #1a1a1a; display: flex; flex-direction: column; overflow: hidden; height: 100vh; flex-shrink: 0; }
        .sb-brand { padding: 22px 16px 18px; border-bottom: 0.5px solid #2a2a2a; flex-shrink: 0; }
        .sb-logo { display: block; width: 80px; height: 80px; margin: 0 auto 13px; }
        .sb-wordmark { font-size: 10px; color: #6a6460; letter-spacing: 2.5px; text-transform: uppercase; font-weight: 700; text-align: center; }
        .sb-search { padding: 14px 14px 12px; flex-shrink: 0; border-bottom: 0.5px solid #2a2a2a; position: relative; }
        .sb-input { width: 100%; background: transparent; border: none; border-bottom: 0.5px solid #383838; padding: 7px 0; color: #e8e0d5; font-size: 13px; font-family: inherit; font-weight: 500; outline: none; transition: border-color 0.2s; }
        .sb-input::placeholder { color: #4a4540; }
        .sb-input:focus { border-bottom-color: #c8b89a; }
        .search-drop { background: #1e1e1e; border: 0.5px solid #2e2e2e; border-radius: 6px; margin-top: 6px; display: none; overflow: hidden; position: absolute; left: 14px; right: 14px; z-index: 20; }
        .search-drop.open { display: block; }
        .sd-item { padding: 9px 11px; cursor: pointer; border-bottom: 0.5px solid #262626; transition: background 0.15s; }
        .sd-item:last-child { border-bottom: none; }
        .sd-item:hover { background: #252525; }
        .sd-job { font-size: 12px; font-weight: 600; color: #c8b89a; font-family: 'DM Mono', monospace; }
        .sd-addr { font-size: 12px; color: #888; margin-top: 2px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sb-nav { flex: 1; overflow-y: auto; padding: 10px 0; }
        .sb-nav::-webkit-scrollbar { width: 2px; }
        .nav-item { display: flex; align-items: center; gap: 10px; padding: 11px 16px; cursor: pointer; color: #888; font-size: 14px; font-weight: 700; letter-spacing: 0.1px; transition: color 0.15s; position: relative; user-select: none; text-decoration: none; }
        .nav-item::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2.5px; height: 0; background: #c8b89a; border-radius: 0 2px 2px 0; transition: height 0.2s; }
        .nav-item:hover { color: #bbb0a8; }
        .nav-item:hover::before { height: 16px; }
        .nav-item.active { color: #e8e0d5; }
        .nav-item.active::before { height: 22px; }
        .nav-icon { width: 15px; height: 15px; flex-shrink: 0; }
        .nav-badge { margin-left: auto; background: #c8b89a; color: #1a1a1a; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 20px; min-width: 20px; text-align: center; }
        .sb-divider { border-top: 0.5px solid #272727; margin: 8px 16px; }
        .util-trigger { display: flex; align-items: center; gap: 10px; padding: 11px 16px; cursor: pointer; color: #888; font-size: 14px; font-weight: 700; transition: color 0.2s; user-select: none; }
        .util-trigger:hover { color: #bbb0a8; }
        .util-chev { width: 9px; height: 9px; margin-left: auto; flex-shrink: 0; stroke: currentColor; fill: none; transition: transform 0.25s; }
        .util-chev.open { transform: rotate(90deg); }
        .util-children { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
        .util-children.open { max-height: 260px; }
        .util-child { display: flex; align-items: center; gap: 9px; padding: 9px 16px 9px 32px; cursor: pointer; color: #888; font-size: 14px; font-weight: 700; transition: color 0.2s; user-select: none; text-decoration: none; }
        .util-child:hover { color: #bbb0a8; }
        .util-child.active { color: #e8e0d5; }
        .sb-user { border-top: 0.5px solid #252525; padding: 13px 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .user-av { width: 32px; height: 32px; border-radius: 50%; background: #242018; border: 0.5px solid rgba(200,184,154,0.267); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #c8b89a; flex-shrink: 0; }
        .user-name { font-size: 13px; color: #888; font-weight: 700; }
        .user-role { font-size: 10px; color: #4a4540; margin-top: 1px; font-weight: 500; }
        .signout-btn { margin-left: auto; cursor: pointer; padding: 3px; color: #444; transition: color 0.2s; background: none; border: none; display: flex; align-items: center; }
        .signout-btn:hover { color: #888; }
      `}</style>

      <aside className="sidebar">
        {/* Brand */}
        <div className="sb-brand">
          <img src="/logo.png" alt="Insurance Repair Co." className="sb-logo" />
          <div className="sb-wordmark">Insurance Repair Co.</div>
        </div>

        {/* Search */}
        <div className="sb-search">
          <input
            ref={inputRef}
            className="sb-input"
            type="text"
            placeholder="Search jobs, addresses…"
            autoComplete="off"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onBlur={handleBlur}
          />
          <div className={`search-drop${dropOpen && results.length > 0 ? ' open' : ''}`}>
            {results.map((r) => (
              <div key={r.id} className="sd-item" onMouseDown={() => selectResult(r.id)}>
                <div className="sd-job">{r.job_number}</div>
                <div className="sd-addr">{r.property_address ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Nav */}
        <nav className="sb-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive(item.href) ? ' active' : ''}`}
            >
              {item.icon}
              {item.label}
              {item.badge != null && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </Link>
          ))}

          <div className="sb-divider" />

          <div className="util-trigger" onClick={() => setUtilOpen((v) => !v)}>
            <svg className="nav-icon" viewBox="0 0 16 16" strokeWidth="1.5" stroke="currentColor" fill="none">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" />
            </svg>
            Utilities &amp; Settings
            <svg className={`util-chev${utilOpen ? ' open' : ''}`} viewBox="0 0 10 10" strokeWidth="1.8">
              <path d="M3 2l4 3-4 3" />
            </svg>
          </div>

          <div className={`util-children${utilOpen ? ' open' : ''}`}>
            {utilItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`util-child${isActive(item.href) ? ' active' : ''}`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        {/* User block */}
        <div className="sb-user">
          <div className="user-av">{user.initials}</div>
          <div>
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.role}</div>
          </div>
          <button className="signout-btn" onClick={handleSignOut} title="Sign out">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3h3v10h-3M7 11l4-3-4-3M11 8H3" />
            </svg>
          </button>
        </div>
      </aside>
    </>
  )
}
