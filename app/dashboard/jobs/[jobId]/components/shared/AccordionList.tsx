'use client'

import React, { createContext, useContext, useState } from 'react'

// — Context for one-at-a-time open behaviour ———————————————————————
interface AccordionContextValue {
  openId: string | null
  setOpenId: (id: string | null) => void
}

export const AccordionContext = createContext<AccordionContextValue>({
  openId: null,
  setOpenId: () => {},
})

export function useAccordionContext() {
  return useContext(AccordionContext)
}

// — AccordionList ——————————————————————————————————————————————————
interface AccordionListProps {
  title: string
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}

export function AccordionList({ title, action, children }: AccordionListProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <AccordionContext.Provider value={{ openId, setOpenId }}>
      <div className="bg-white rounded-lg border border-[#e0dbd4] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0dbd4]">
          <span
            style={{ fontFamily: 'DM Sans, sans-serif' }}
            className="text-[11px] uppercase tracking-[0.07em] text-[#9e998f] font-medium"
          >
            {title}
          </span>
          {action && (
            <button
              onClick={action.onClick}
              style={{ fontFamily: 'DM Sans, sans-serif' }}
              className="text-[11px] text-[#c8b89a] hover:text-[#b0a88a] transition-colors"
            >
              {action.label}
            </button>
          )}
        </div>

        {/* Rows */}
        <div className="divide-y divide-[#f0ece6]">{children}</div>
      </div>
    </AccordionContext.Provider>
  )
}
