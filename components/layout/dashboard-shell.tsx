'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { FloatingAssistant } from '@/components/ai/floating-assistant'

interface User {
  name: string
  role: string
  initials: string
}

interface Props {
  user: User
  tenantId: string
  children: React.ReactNode
}

export function DashboardShell({ user, tenantId, children }: Props) {
  const [assistantVisible, setAssistantVisible] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('fai-visible')
      setAssistantVisible(saved !== null ? JSON.parse(saved) : true)
    } catch {
      setAssistantVisible(true)
    }
    setHydrated(true)
  }, [])

  // Global hotkey: Cmd+Shift+T (Mac) / Ctrl+Shift+T (Windows/Linux)
  useEffect(() => {
    function handleHotkey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setAssistantVisible(true)
        try { localStorage.setItem('fai-visible', 'true') } catch {}
        window.dispatchEvent(new CustomEvent('fai-open-teach'))
      }
    }
    document.addEventListener('keydown', handleHotkey)
    return () => document.removeEventListener('keydown', handleHotkey)
  }, [])

  function toggleAssistant() {
    setAssistantVisible((v) => {
      const next = !v
      try { localStorage.setItem('fai-visible', JSON.stringify(next)) } catch {}
      return next
    })
  }

  function hideAssistant() {
    setAssistantVisible(false)
    try { localStorage.setItem('fai-visible', 'false') } catch {}
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#f5f2ee',
        fontFamily: "'DM Sans', -apple-system, sans-serif",
      }}
    >
      <Sidebar
        user={user}
        tenantId={tenantId}
        assistantVisible={assistantVisible}
        onToggleAssistant={toggleAssistant}
      />
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        {children}
      </main>
      {hydrated && (
        <FloatingAssistant
          visible={assistantVisible}
          onClose={hideAssistant}
          tenantId={tenantId}
        />
      )}
    </div>
  )
}
