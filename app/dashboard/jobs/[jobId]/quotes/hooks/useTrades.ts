'use client'

import { useEffect, useState } from 'react'

export interface Trade {
  id: string
  primary_trade: string
  trade_code: string | null
}

export function useTrades(tenantId: string) {
  const [trades, setTrades] = useState<Trade[]>([])

  useEffect(() => {
    fetch(`/api/trades?tenantId=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then((data: Trade[]) => setTrades(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [tenantId])

  return trades
}
