'use client'

import React, { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAccordionContext } from './AccordionList'

interface AccordionRowProps {
  summary: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}

export function AccordionRow({ summary, children, defaultOpen }: AccordionRowProps) {
  const uid = useId()
  const { openId, setOpenId } = useAccordionContext()

  // If defaultOpen and nothing else is open yet, treat this row as open initially.
  // We do this lazily — the first render with defaultOpen=true opens this row.
  const isOpen = openId === uid || (openId === null && defaultOpen)

  function toggle() {
    setOpenId(isOpen ? null : uid)
  }

  return (
    <div>
      {/* Collapsed summary row */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[#faf9f7]"
        style={{
          backgroundColor: isOpen ? '#f7f5f1' : undefined,
          fontFamily: 'DM Sans, sans-serif',
        }}
      >
        <div className="flex-1 min-w-0">{summary}</div>
        <ChevronDown
          className="h-4 w-4 text-[#9e998f] flex-shrink-0 ml-3 transition-transform duration-200"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Expanded body */}
      {isOpen && (
        <div
          className="px-4 pb-4 pt-2"
          style={{ backgroundColor: '#f7f5f1', fontFamily: 'DM Sans, sans-serif' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
