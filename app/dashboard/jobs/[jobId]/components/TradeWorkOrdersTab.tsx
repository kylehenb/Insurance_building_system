'use client'

import React from 'react'
import { AccordionList } from './shared/AccordionList'

interface TradeWorkOrdersTabProps {
  jobId: string
}

export function TradeWorkOrdersTab({ jobId: _ }: TradeWorkOrdersTabProps) {
  return (
    <AccordionList title="Trade Work Orders">
      <div
        className="px-4 py-12 text-center"
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      >
        <p className="text-[13px] text-[#9e998f]">
          No work orders yet. Work orders are created once a quote is approved.
        </p>
      </div>
    </AccordionList>
  )
}
