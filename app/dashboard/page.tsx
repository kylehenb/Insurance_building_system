'use client'

import { useEffect, useRef, useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { useAIActionRefresh } from '@/lib/hooks/useAIActionRefresh'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ──────────────────────────────────────────────────────────────────

interface WeatherDay {
  label: string
  icon: string
  temp: number
  rain: number
  gust: number
  isToday: boolean
}

interface FlaggedJob {
  id: string
  job_id: string
  job_number: string
  property_address: string | null
  insured_name: string | null
  insurer: string | null
  override_stage: 'on_hold' | 'cancelled' | null
  current_stage: string | null
  action_count: number
}

interface ActionCard {
  id: string
  job_id: string
  job_number: string
  rule_key: string
  title: string
  description: string | null
  ai_draft: Record<string, unknown> | null
  status: string
  priority: number
  created_at: string
  type: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  actionProposal?: { steps: { n: number; description: string }[] } | null
  confirmed?: boolean
}

// ── WMO weather codes ────────────────────────────────────────────────────────
const WMO: Record<number, string> = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
  80: '🌦', 81: '🌧', 82: '🌧', 95: '⛈', 96: '⛈',
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStatusClass(status: string | null) {
  switch (status?.toLowerCase()) {
    case 'active': return 'sbadge s-active'
    case 'in review':
    case 'in_review': return 'sbadge s-review'
    case 'pending': return 'sbadge s-pending'
    default: return 'sbadge s-pending'
  }
}

function getStatusLabel(status: string | null) {
  if (!status) return 'Unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

function parseActionProposal(text: string) {
  try {
    const match = text.match(/\{[\s\S]*?"type"\s*:\s*"action_proposal"[\s\S]*?\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (parsed.type === 'action_proposal' && Array.isArray(parsed.steps)) {
      return parsed as { type: string; steps: { n: number; description: string }[] }
    }
  } catch {}
  return null
}

function stripActionJson(text: string) {
  return text.replace(/\{[\s\S]*?"type"\s*:\s*"action_proposal"[\s\S]*?\}/, '').trim()
}

function inferCardType(ruleKey: string): string {
  if (ruleKey.includes('email') || ruleKey.includes('comms') || ruleKey.includes('notify')) return 'comms'
  if (ruleKey.includes('quote') || ruleKey.includes('approval')) return 'quote'
  if (ruleKey.includes('status')) return 'status'
  if (ruleKey.includes('notify') || ruleKey.includes('alert')) return 'notification'
  return 'task'
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()

  // AI Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Email modal
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailCard, setEmailCard] = useState<ActionCard | null>(null)

  // Weather
  const [weather, setWeather] = useState<WeatherDay[]>([])
  const [weatherLoading, setWeatherLoading] = useState(true)

  // Flagged jobs
  const [flaggedJobs, setFlaggedJobs] = useState<FlaggedJob[]>([])
  const [removingFlags, setRemovingFlags] = useState<Set<string>>(new Set())

  // Action queue
  const [actionCards, setActionCards] = useState<ActionCard[]>([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [snoozedCards, setSnoozedCards] = useState<Set<string>>(new Set())
  const [removingCards, setRemovingCards] = useState<Set<string>>(new Set())
  const [expandedEdit, setExpandedEdit] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<string | null>(null)
  const [stepEdits, setStepEdits] = useState<Record<string, string>>({})
  const [savedSteps, setSavedSteps] = useState<Record<string, boolean>>({})

  // Auth
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      const { data: profile } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single()
      if (!profile) { router.push('/login'); return }
      setTenantId((profile as { tenant_id: string }).tenant_id)
    }
    init()
  }, [router])

  // ── Weather ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadWeather() {
      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=-31.9505&longitude=115.8605&daily=weathercode,temperature_2m_max,precipitation_sum,windgusts_10m_max&timezone=Australia%2FPerth&forecast_days=5'
        )
        const d = await res.json()
        const days: WeatherDay[] = []
        for (let i = 0; i < 5; i++) {
          const dt = new Date(d.daily.time[i] + 'T00:00:00')
          days.push({
            label: i === 0 ? 'Today' : DOW[dt.getDay()],
            icon: WMO[d.daily.weathercode[i]] ?? '🌤',
            temp: Math.round(d.daily.temperature_2m_max[i]),
            rain: d.daily.precipitation_sum[i],
            gust: Math.round(d.daily.windgusts_10m_max[i]),
            isToday: i === 0,
          })
        }
        setWeather(days)
      } catch {
        // silently fail — shows nothing
      } finally {
        setWeatherLoading(false)
      }
    }
    loadWeather()
  }, [])

  // ── Data fetching (after auth) ───────────────────────────────────────────────

  useEffect(() => {
    if (!userId || !tenantId) return
    fetchFlaggedJobs()
    fetchActionCards()
  }, [userId, tenantId])

  // Auto-refresh when AI actions complete
  useAIActionRefresh(async () => {
    if (!userId || !tenantId) return
    fetchFlaggedJobs()
    fetchActionCards()
  }, [userId, tenantId])

  async function fetchFlaggedJobs() {
    if (!userId || !tenantId) return
    const { data } = await supabase
      .from('job_flags')
      .select(`job_id, jobs (id, job_number, property_address, insured_name, insurer, override_stage, current_stage)`)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .limit(20)

    if (!data) return

    // For each job, count pending action_queue items
    const jobs = await Promise.all(
      data.map(async (row: any) => {
        const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
        if (!job) return null
        const { count } = await supabase
          .from('action_queue')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', row.job_id)
          .eq('status', 'pending')
        return {
          id: row.job_id,
          job_id: row.job_id,
          job_number: job.job_number,
          property_address: job.property_address,
          insured_name: job.insured_name,
          insurer: job.insurer,
          override_stage: job.override_stage ?? null,
          current_stage: job.current_stage ?? null,
          action_count: count ?? 0,
        } as FlaggedJob
      })
    )
    setFlaggedJobs(jobs.filter(Boolean) as FlaggedJob[])
  }

  async function fetchActionCards() {
    if (!tenantId) return
    const { data } = await supabase
      .from('action_queue')
      .select(`*, jobs (job_number, property_address, insured_name)`)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .limit(20)

    if (!data) return
    const cards: ActionCard[] = data.map((row: any) => ({
      id: row.id,
      job_id: row.job_id,
      job_number: row.jobs?.job_number ?? '',
      rule_key: row.rule_key,
      title: row.title,
      description: row.description,
      ai_draft: row.ai_draft,
      status: row.status,
      priority: row.priority,
      created_at: row.created_at,
      type: inferCardType(row.rule_key),
    }))
    setActionCards(cards)
  }

  // ── AI Chat ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    const val = aiInput.trim()
    if (!val || aiLoading) return

    const userMsg: ChatMessage = { role: 'user', content: val }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setAiInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setAiLoading(true)

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      const rawText: string = data.text ?? 'Sorry, I encountered an error.'
      const proposal = parseActionProposal(rawText)
      const displayText = proposal ? stripActionJson(rawText) : rawText
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: displayText,
        actionProposal: proposal ?? null,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setAiLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setAiInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  function confirmAiAction(msgIdx: number) {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIdx ? { ...m, confirmed: true } : m))
    )
  }

  // ── Flagged jobs ─────────────────────────────────────────────────────────────

  async function unflagJob(jobId: string) {
    if (!userId || !tenantId) return
    setRemovingFlags((s) => new Set(s).add(jobId))
    await supabase
      .from('job_flags')
      .delete()
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
    setTimeout(() => {
      setFlaggedJobs((prev) => prev.filter((j) => j.job_id !== jobId))
      setRemovingFlags((s) => { const n = new Set(s); n.delete(jobId); return n })
    }, 400)
  }

  // ── Action queue ─────────────────────────────────────────────────────────────

  async function confirmCard(id: string) {
    setRemovingCards((s) => new Set(s).add(id))
    try {
      await fetch('/api/ai/execute-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch {
      // optimistic — don't rollback for now
    }
    setTimeout(() => {
      setActionCards((prev) => prev.filter((c) => c.id !== id))
      setRemovingCards((s) => { const n = new Set(s); n.delete(id); return n })
    }, 600)
  }

  async function dismissCard(id: string) {
    setRemovingCards((s) => new Set(s).add(id))
    await supabase
      .from('action_queue')
      .update({ status: 'skipped' })
      .eq('id', id)
    setTimeout(() => {
      setActionCards((prev) => prev.filter((c) => c.id !== id))
      setRemovingCards((s) => { const n = new Set(s); n.delete(id); return n })
    }, 350)
  }

  async function snoozeCard(id: string) {
    const tomorrow9am = new Date()
    tomorrow9am.setDate(tomorrow9am.getDate() + 1)
    tomorrow9am.setHours(9, 0, 0, 0)
    setSnoozedCards((s) => new Set(s).add(id))
    await supabase
      .from('action_queue')
      .update({ status: 'snoozed', snoozed_until: tomorrow9am.toISOString() })
      .eq('id', id)
  }

  async function unsnoozeCard(id: string) {
    setSnoozedCards((s) => { const n = new Set(s); n.delete(id); return n })
    await supabase
      .from('action_queue')
      .update({ status: 'pending', snoozed_until: null })
      .eq('id', id)
  }

  const filteredCards = actionCards.filter(
    (c) => activeFilter === 'all' || c.type === activeFilter
  )

  const pendingCount = actionCards.filter((c) => !snoozedCards.has(c.id)).length

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .dash-main { padding: 32px 36px 48px; }
        .dash-main::-webkit-scrollbar { width: 5px; }
        .dash-main::-webkit-scrollbar-thumb { background: #e4dfd8; border-radius: 3px; }

        /* AI Chat */
        .ai-hero { background: #fff; border: 0.5px solid #e4dfd8; border-radius: 10px; overflow: hidden; margin-bottom: 28px; }
        .ai-hero-header { display: flex; align-items: center; gap: 8px; padding: 14px 20px 12px; border-bottom: 0.5px solid #f0ece6; background: #fdfdfc; }
        .ai-hero-pip { width: 6px; height: 6px; border-radius: 50%; background: #c8b89a; flex-shrink: 0; }
        .ai-hero-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #c8b89a; font-weight: 700; }
        .ai-messages-area { min-height: 160px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 20px 24px; background: #fff; }
        .ai-messages-area::-webkit-scrollbar { width: 3px; }
        .ai-messages-area::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }
        .ai-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; padding: 24px 0; min-height: 120px; }
        .ai-empty-icon { font-size: 26px; opacity: 0.2; }
        .ai-empty-text { font-size: 14px; color: #9a9088; font-weight: 400; text-align: center; }
        .ai-empty-sub { font-size: 12px; color: #c0b8b0; font-weight: 300; text-align: center; line-height: 1.5; }
        .ai-bubble { display: flex; gap: 10px; align-items: flex-start; max-width: 84%; }
        .ai-bubble.user { align-self: flex-end; flex-direction: row-reverse; }
        .ai-bubble.assistant { align-self: flex-start; }
        .ai-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; margin-top: 2px; }
        .ai-avatar.user { background: #2e2820; color: #c8b89a; border: 0.5px solid rgba(200,184,154,0.2); }
        .ai-avatar.assistant { background: #f5f0e8; color: #9a7a50; border: 0.5px solid #e8ddd0; font-size: 13px; }
        .ai-bubble-inner { display: flex; flex-direction: column; max-width: 100%; gap: 8px; }
        .ai-bubble-text { padding: 10px 15px; border-radius: 10px; font-size: 13px; line-height: 1.65; font-weight: 400; }
        .ai-bubble.user .ai-bubble-text { background: #1a1a1a; color: #e8e0d5; border-radius: 10px 10px 3px 10px; }
        .ai-bubble.assistant .ai-bubble-text { background: #f7f5f2; color: #2a2520; border-radius: 10px 10px 10px 3px; border: 0.5px solid #e8e3dc; }
        .ai-action-panel { background: #fdf9f4; border: 0.5px solid #e8ddd0; border-radius: 8px; padding: 14px 16px; }
        .ai-action-panel.confirmed { background: #f0fbf5; border-color: #b8e0c8; }
        .ai-action-title { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #c8b89a; font-weight: 700; margin-bottom: 10px; }
        .ai-action-step { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 0.5px solid #f0ece6; }
        .ai-action-step:last-of-type { border-bottom: none; }
        .ai-step-n { width: 16px; height: 16px; border-radius: 50%; background: #f0ece6; color: #9a8070; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .ai-step-text { font-size: 12px; color: #5a534a; line-height: 1.45; font-weight: 300; }
        .ai-action-btns { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
        .ai-btn { font-size: 11px; padding: 5px 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; line-height: 1.4; }
        .ai-btn-confirm { background: #2a6b50; color: #fff; border-color: #2a6b50; }
        .ai-btn-confirm:hover { background: #235a42; }
        .ai-btn-edit { background: transparent; color: #7a6a58; border-color: #d4cfc8; }
        .ai-btn-edit:hover { border-color: #9a7a50; color: #9a7a50; }
        .ai-btn-dismiss { background: transparent; border: none; color: #c8c0b8; font-size: 16px; padding: 3px 5px; cursor: pointer; line-height: 1; }
        .ai-btn-dismiss:hover { color: #a0524a; }
        .ai-input-wrap { padding: 14px 20px 16px; border-top: 0.5px solid #f0ece6; background: #fdfdfc; }
        .ai-input-row { display: flex; align-items: flex-end; gap: 0; background: #f7f5f2; border-radius: 12px; border: 0.5px solid #e4dfd8; transition: border-color 0.2s; overflow: hidden; }
        .ai-input-row:focus-within { border-color: #c8b89a; }
        .ai-textarea { flex: 1; background: transparent; border: none; padding: 13px 16px; color: #1a1a1a; font-size: 14px; font-family: inherit; font-weight: 400; outline: none; resize: none; line-height: 1.55; min-height: 50px; max-height: 160px; }
        .ai-textarea::placeholder { color: #b8b0a8; }
        .ai-send-btn { background: #1a1a1a; border: none; margin: 8px 10px 8px 0; width: 36px; height: 36px; border-radius: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s; align-self: flex-end; }
        .ai-send-btn:hover { background: #2a2a2a; }
        .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ai-hint { font-size: 10px; color: #c8c0b8; text-align: right; margin-top: 7px; font-weight: 300; }

        /* Two col */
        .two-col { display: grid; grid-template-columns: 3fr 1fr; gap: 24px; margin-bottom: 28px; }
        .sec-label { font-size: 14px; font-weight: 500; color: #1a1a1a; letter-spacing: 0.3px; margin-bottom: 12px; }

        /* Flagged table */
        .flag-wrap { border: 0.5px solid #e4dfd8; border-radius: 8px; overflow: hidden; background: #fff; }
        .flag-scroll { max-height: 256px; overflow-y: auto; }
        .flag-scroll::-webkit-scrollbar { width: 3px; }
        .flag-scroll::-webkit-scrollbar-thumb { background: #e8e3dc; border-radius: 2px; }
        .ft { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .ft th { font-size: 10px; color: #b8b0a8; text-align: left; padding: 10px 12px; border-bottom: 0.5px solid #f0ece6; font-weight: 500; letter-spacing: 0.8px; text-transform: uppercase; background: #fdfdfc; position: sticky; top: 0; z-index: 1; white-space: nowrap; overflow: hidden; }
        .ft td { padding: 9px 12px; border-bottom: 0.5px solid #f5f2ee; font-size: 13px; color: #3a3530; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ft tr:last-child td { border-bottom: none; }
        .ft tr:hover td { background: #faf9f7; cursor: pointer; }
        .jnum { font-family: 'DM Mono', monospace; font-size: 11px; color: #c8b89a; font-weight: 500; }
        .sbadge { font-size: 10px; padding: 2px 7px; border-radius: 20px; font-weight: 400; display: inline-block; white-space: nowrap; }
        .s-active { background: #eaf3f0; color: #2a6b50; }
        .s-pending { background: #fdf5e8; color: #8a6020; }
        .s-review { background: #f0eef8; color: #4a42a0; }
        .flag-btn { background: none; border: none; cursor: pointer; color: #c8b89a; font-size: 14px; padding: 0; line-height: 1; transition: opacity 0.2s; display: block; }
        .flag-btn:hover { opacity: 0.35; }
        .row-badge { display: inline-flex; align-items: center; justify-content: center; background: #e24b4a; color: #fff; font-size: 9px; font-weight: 700; width: 17px; height: 17px; border-radius: 50%; font-family: 'DM Mono', monospace; flex-shrink: 0; }
        .row-badge.amber { background: #ef9f27; }

        /* Weather */
        .weather-panel { background: #fff; border: 0.5px solid #e4dfd8; border-radius: 8px; overflow: hidden; }
        .weather-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 0.5px solid #f5f2ee; cursor: default; transition: background 0.15s; }
        .weather-row:last-child { border-bottom: none; }
        .weather-row:hover { background: #faf9f7; }
        .weather-row.today { background: #fdf9f4; }
        .wr-day { font-size: 11px; font-weight: 700; color: #1a1a1a; width: 38px; flex-shrink: 0; }
        .wr-icon { font-size: 16px; flex-shrink: 0; }
        .wr-temp { font-size: 13px; font-weight: 700; color: #1a1a1a; font-family: 'DM Mono', monospace; width: 34px; flex-shrink: 0; }
        .wr-sub { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .wr-stat { font-size: 10px; color: #9a9088; font-family: 'DM Mono', monospace; white-space: nowrap; }
        .wr-stat.rain { color: #4a80c0; }
        .weather-loading { font-size: 12px; color: #c0b8b0; padding: 16px; text-align: center; font-style: italic; }

        /* To Do */
        .todo-hdr { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
        .todo-title { font-size: 26px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1; }
        .todo-count { font-size: 11px; color: #c8b89a; font-weight: 600; background: #faf5ee; border: 0.5px solid #e8ddd0; padding: 2px 9px; border-radius: 20px; }
        .sort-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .sort-label { font-size: 11px; color: #b0a898; font-weight: 500; }
        .sort-btn { font-size: 11px; padding: 4px 12px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 0.5px solid #e0dbd4; background: transparent; color: #9a9088; transition: all 0.15s; white-space: nowrap; }
        .sort-btn:hover { border-color: #c8b89a; color: #7a6a58; }
        .sort-btn.active { background: #1a1a1a; color: #c8b89a; border-color: #1a1a1a; }
        .aq-list { display: flex; flex-direction: column; gap: 10px; }
        .aq-card { background: #fff; border: 0.5px solid #e4dfd8; border-radius: 8px; overflow: hidden; transition: border-color 0.2s, opacity 0.35s, max-height 0.5s; }
        .aq-card:hover { border-color: #d0cbc4; }
        .aq-card.snoozed { opacity: 0.45; }
        .aq-card.removing { opacity: 0; max-height: 0; }
        .aq-row { display: grid; grid-template-columns: minmax(0,1.1fr) 1px minmax(0,1fr); }
        .aq-div { background: #ede8e2; }
        .aq-left { padding: 15px 16px; display: flex; gap: 10px; }
        .aq-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 7px; }
        .dot-hi { background: #d4524a; } .dot-md { background: #d4924a; } .dot-lo { background: #5a9a52; }
        .aq-body { flex: 1; min-width: 0; }
        .aq-type { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #c8b89a; margin-bottom: 4px; font-weight: 400; }
        .aq-title { font-size: 13px; font-weight: 500; color: #1a1a1a; margin-bottom: 4px; line-height: 1.3; }
        .aq-desc { font-size: 12px; color: #7a7167; line-height: 1.55; font-weight: 300; }
        .aq-meta { display: flex; gap: 12px; margin-top: 8px; }
        .aq-job { font-family: 'DM Mono', monospace; font-size: 10px; color: #c8b89a; }
        .aq-age { font-size: 10px; color: #c8c0b8; font-weight: 300; }
        .aq-right { padding: 15px 16px; display: flex; flex-direction: column; gap: 10px; }
        .ai-lbl { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #c8b89a; display: flex; align-items: center; gap: 5px; }
        .ai-pip { width: 5px; height: 5px; border-radius: 50%; background: #c8b89a; flex-shrink: 0; }
        .ai-text { font-size: 12px; color: #3a3530; line-height: 1.55; font-weight: 300; flex: 1; }
        .btn-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .btn { font-size: 11px; padding: 5px 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; line-height: 1.4; }
        .btn-confirm { background: #2a6b50; color: #fff; border-color: #2a6b50; }
        .btn-confirm:hover { background: #235a42; }
        .btn-edit { background: transparent; color: #7a6a58; border-color: #d4cfc8; }
        .btn-edit:hover { border-color: #9a7a50; color: #9a7a50; }
        .btn-snooze { background: transparent; color: #9a9088; border-color: #e8e3dc; }
        .btn-snooze:hover { color: #5a534a; border-color: #c8c0b8; }
        .btn-dismiss { background: transparent; border: none; color: #c8c0b8; font-size: 16px; padding: 3px 5px; cursor: pointer; line-height: 1; }
        .btn-dismiss:hover { color: #a0524a; }
        .inline-edit { border-top: 0.5px solid #f0ece6; padding: 13px 16px; background: #fdfcfb; }
        .ie-lbl { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #b8b0a8; margin-bottom: 9px; font-weight: 500; }
        .ie-input { font-size: 12px; padding: 6px 11px; border: 0.5px solid #e4dfd8; border-radius: 6px; background: #fff; color: #1a1a1a; font-family: inherit; font-weight: 300; outline: none; transition: border-color 0.2s; }
        .ie-input:focus { border-color: #c8b89a; }
        .ie-actions { display: flex; gap: 6px; margin-top: 10px; }
        .steps-edit { border-top: 0.5px solid #f0ece6; padding: 13px 16px; background: #fdfcfb; }
        .step-row { display: flex; align-items: flex-start; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid #f5f2ee; }
        .step-row:last-of-type { border-bottom: none; }
        .step-txt { font-size: 12px; color: #3a3530; line-height: 1.45; flex: 1; font-weight: 300; }
        .step-n { width: 17px; height: 17px; border-radius: 50%; background: #f0ece6; color: #9a9088; font-size: 9px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .step-cb { width: 14px; height: 14px; accent-color: #c8b89a; flex-shrink: 0; margin-top: 2px; cursor: pointer; }
        .step-edit-icon { color: #c8b89a; font-size: 13px; cursor: pointer; padding: 0 3px; opacity: 0.6; transition: opacity 0.15s; background: none; border: none; }
        .step-edit-icon:hover { opacity: 1; }
        .step-inline-input { flex: 1; font-size: 11px; padding: 5px 8px; border: 0.5px solid #c8b89a; border-radius: 5px; background: #fff; color: #1a1a1a; font-family: inherit; outline: none; }
        .ai-recheck { font-size: 10px; color: #9a7a50; margin-top: 5px; font-style: italic; }
        .snooze-bar { font-size: 11px; color: #9a9088; background: #faf9f7; padding: 8px 16px; border-top: 0.5px solid #f0ece6; font-weight: 300; }
        .snooze-undo { cursor: pointer; color: #c8b89a; border-bottom: 0.5px solid #c8b89a; background: none; border-left: none; border-right: none; border-top: none; font-family: inherit; font-size: 11px; padding: 0; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(15,12,10,0.55); z-index: 200; display: flex; align-items: center; justify-content: center; }
        .email-modal { background: #fff; border-radius: 10px; width: 620px; max-width: 92vw; border: 0.5px solid #e4dfd8; overflow: hidden; display: flex; flex-direction: column; max-height: 80vh; }
        .em-header { padding: 16px 20px; border-bottom: 0.5px solid #f0ece6; display: flex; align-items: center; justify-content: space-between; background: #fdfdfc; flex-shrink: 0; }
        .em-title { font-size: 13px; font-weight: 500; color: #1a1a1a; }
        .em-close { background: none; border: none; cursor: pointer; color: #b0a898; font-size: 20px; line-height: 1; transition: color 0.15s; }
        .em-close:hover { color: #5a534a; }
        .em-field { display: flex; align-items: center; border-bottom: 0.5px solid #f5f2ee; flex-shrink: 0; }
        .em-field-lbl { font-size: 10px; color: #b0a898; font-weight: 500; padding: 9px 14px; min-width: 56px; letter-spacing: 0.5px; flex-shrink: 0; text-transform: uppercase; }
        .em-field-input { flex: 1; border: none; padding: 9px 10px 9px 0; font-size: 13px; color: #1a1a1a; font-family: inherit; outline: none; background: transparent; font-weight: 300; }
        .em-body-area { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
        .em-body-ta { width: 100%; border: none; padding: 16px 20px; font-size: 13px; color: #1a1a1a; font-family: inherit; font-weight: 300; resize: none; outline: none; line-height: 1.75; min-height: 200px; background: #fff; flex: 1; }
        .em-sig { border-top: 0.5px solid #f5f2ee; padding: 12px 20px; font-size: 11px; color: #b0a898; font-weight: 300; line-height: 1.7; flex-shrink: 0; }
        .em-footer { padding: 12px 20px; border-top: 0.5px solid #f0ece6; display: flex; gap: 8px; align-items: center; background: #fdfdfc; flex-shrink: 0; }
        .em-footer-note { font-size: 10px; color: #c8b89a; font-style: italic; margin-left: auto; }
        .aq-empty { padding: 32px; text-align: center; font-size: 13px; color: #b0a898; font-weight: 300; background: #fff; border: 0.5px solid #e4dfd8; border-radius: 8px; }
      `}</style>

      <div className="dash-main">

        {/* ── AI CHAT ── */}
        <div className="ai-hero">
          <div className="ai-hero-header">
            <div className="ai-hero-pip" />
            <span className="ai-hero-label">IRC Assistant</span>
          </div>

          <div className="ai-messages-area">
            {messages.length === 0 && (
              <div className="ai-empty">
                <div className="ai-empty-icon">⬡</div>
                <div className="ai-empty-text">What do you need help with today?</div>
                <div className="ai-empty-sub">Ask about jobs, quotes, scope — or ask me to take action on your behalf.</div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`ai-bubble ${msg.role}`}>
                <div className={`ai-avatar ${msg.role}`}>
                  {msg.role === 'user' ? 'KB' : '⬡'}
                </div>
                <div className="ai-bubble-inner">
                  {msg.content && (
                    <div className="ai-bubble-text">{msg.content}</div>
                  )}
                  {msg.actionProposal && !msg.confirmed && (
                    <div className="ai-action-panel">
                      <div className="ai-action-title">Proposed actions</div>
                      {msg.actionProposal.steps.map((step) => (
                        <div key={step.n} className="ai-action-step">
                          <div className="ai-step-n">{step.n}</div>
                          <div className="ai-step-text">{step.description}</div>
                        </div>
                      ))}
                      <div className="ai-action-btns">
                        <button className="ai-btn ai-btn-confirm" onClick={() => confirmAiAction(i)}>
                          Confirm &amp; execute
                        </button>
                        <button className="ai-btn ai-btn-edit">Edit steps</button>
                        <button
                          className="ai-btn ai-btn-dismiss"
                          onClick={() =>
                            setMessages((prev) =>
                              prev.map((m, idx) =>
                                idx === i ? { ...m, actionProposal: null } : m
                              )
                            )
                          }
                        >
                          &#x2715;
                        </button>
                      </div>
                    </div>
                  )}
                  {msg.actionProposal && msg.confirmed && (
                    <div className="ai-action-panel confirmed">
                      <div className="ai-action-title">Proposed actions</div>
                      {msg.actionProposal.steps.map((step) => (
                        <div key={step.n} className="ai-action-step">
                          <div className="ai-step-n">{step.n}</div>
                          <div className="ai-step-text">{step.description}</div>
                        </div>
                      ))}
                      <div className="ai-action-btns">
                        <span style={{ fontSize: 11, color: '#2a6b50', fontWeight: 600 }}>
                          ✓ Done — actions executed
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {aiLoading && (
              <div className="ai-bubble assistant">
                <div className="ai-avatar assistant">⬡</div>
                <div className="ai-bubble-inner">
                  <div className="ai-bubble-text" style={{ color: '#9a9088', fontStyle: 'italic' }}>
                    Thinking…
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-input-wrap">
            <div className="ai-input-row">
              <textarea
                ref={textareaRef}
                className="ai-textarea"
                placeholder="Ask anything or say what you'd like to do…"
                rows={1}
                value={aiInput}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
              />
              <button className="ai-send-btn" onClick={sendMessage} disabled={aiLoading}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#e8e0d5" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M2 14L14 8 2 2v4.5l7 1.5-7 1.5V14z" />
                </svg>
              </button>
            </div>
            <div className="ai-hint">Enter to send &nbsp;·&nbsp; Shift+Enter for new line</div>
          </div>
        </div>

        {/* ── TWO COL: flagged + weather ── */}
        <div className="two-col">

          {/* Flagged jobs */}
          <div>
            <div className="sec-label">My flagged jobs</div>
            <div className="flag-wrap">
              <div className="flag-scroll">
                <table className="ft">
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col style={{ width: 26 }} />
                    <col style={{ width: 68 }} />
                    <col style={{ width: 180 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 78 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th></th>
                      <th></th>
                      <th>Job</th>
                      <th>Address</th>
                      <th>Insured</th>
                      <th>Client</th>
                      <th>Job Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedJobs.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: '#b0a898', padding: 24, fontWeight: 300, fontSize: 13 }}>
                          No flagged jobs
                        </td>
                      </tr>
                    )}
                    {flaggedJobs.map((job) => (
                      <tr
                        key={job.job_id}
                        style={{
                          opacity: removingFlags.has(job.job_id) ? 0 : 1,
                          transition: 'opacity 0.4s',
                        }}
                        onClick={() => router.push(`/dashboard/jobs/${job.job_id}`)}
                      >
                        <td style={{ paddingLeft: 8 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            className="flag-btn"
                            title="Unflag"
                            onClick={() => unflagJob(job.job_id)}
                          >
                            ⚑
                          </button>
                        </td>
                        <td>
                          {job.action_count >= 2 && (
                            <span className="row-badge">{job.action_count}</span>
                          )}
                          {job.action_count === 1 && (
                            <span className="row-badge amber">{job.action_count}</span>
                          )}
                        </td>
                        <td><span className="jnum">{job.job_number}</span></td>
                        <td>{job.property_address ?? '—'}</td>
                        <td>{job.insured_name ?? '—'}</td>
                        <td>{job.insurer ?? '—'}</td>
                        <td>
                          {job.override_stage ? (
                            <span className="sbadge s-pending">
                              {job.override_stage === 'on_hold' ? 'On Hold' : 'Cancelled'}
                            </span>
                          ) : job.current_stage ? (
                            <span className="sbadge s-active">
                              {job.current_stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                          ) : (
                            <span style={{ color: '#c8c0b8', fontSize: 12 }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Weather */}
          <div>
            <div className="sec-label">Perth weather</div>
            <div className="weather-panel">
              {weatherLoading && (
                <div className="weather-loading">Loading…</div>
              )}
              {!weatherLoading && weather.length === 0 && (
                <div className="weather-loading">Unavailable</div>
              )}
              {weather.map((day, i) => (
                <div key={i} className={`weather-row${day.isToday ? ' today' : ''}`}>
                  <div className="wr-day">{day.label}</div>
                  <div className="wr-icon">{day.icon}</div>
                  <div className="wr-temp">{day.temp}°</div>
                  <div className="wr-sub">
                    <div className={`wr-stat${day.rain > 0 ? ' rain' : ''}`}>
                      {day.rain > 0 ? `${day.rain.toFixed(1)}mm` : '—'}
                    </div>
                    <div className="wr-stat">💨 {day.gust}km/h</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── TO DO ── */}
        <div>
          <div className="todo-hdr">
            <span className="todo-title">To do</span>
            {pendingCount > 0 && (
              <span className="todo-count">{pendingCount} pending</span>
            )}
          </div>

          <div className="sort-bar">
            <span className="sort-label">Filter:</span>
            {[
              { key: 'all', label: 'All' },
              { key: 'notification', label: 'Notifications' },
              { key: 'quote', label: 'Quotes' },
              { key: 'task', label: 'Tasks' },
              { key: 'comms', label: 'Comms' },
              { key: 'status', label: 'Status changes' },
            ].map((f) => (
              <button
                key={f.key}
                className={`sort-btn${activeFilter === f.key ? ' active' : ''}`}
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="aq-list">
            {filteredCards.length === 0 && (
              <div className="aq-empty">
                {actionCards.length === 0
                  ? 'No pending actions — all clear ✓'
                  : 'No items match this filter'}
              </div>
            )}

            {filteredCards.map((card) => {
              const isSnoozed = snoozedCards.has(card.id)
              const isRemoving = removingCards.has(card.id)
              const isEmailType = card.type === 'comms' || card.type === 'notification'
              const isMultiStep = card.ai_draft && Array.isArray((card.ai_draft as any).steps)
              const isTaskType = card.type === 'task'
              const steps: string[] = isMultiStep ? (card.ai_draft as any).steps : []
              const dotClass = card.priority <= 1 ? 'dot-hi' : card.priority <= 2 ? 'dot-md' : 'dot-lo'
              const isStepsOpen = expandedSteps === card.id
              const isEditOpen = expandedEdit === card.id

              return (
                <div
                  key={card.id}
                  className={`aq-card${isSnoozed ? ' snoozed' : ''}${isRemoving ? ' removing' : ''}`}
                >
                  <div className="aq-row">
                    {/* Left */}
                    <div className="aq-left">
                      <div className={`aq-dot ${dotClass}`} />
                      <div className="aq-body">
                        <div className="aq-type">{card.type}</div>
                        <div className="aq-title">{card.title}</div>
                        <div className="aq-desc">{card.description}</div>
                        <div className="aq-meta">
                          <span className="aq-job">{card.job_number}</span>
                          <span className="aq-age">{timeAgo(card.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="aq-div" />

                    {/* Right */}
                    <div className="aq-right">
                      <div>
                        <div className="ai-lbl">
                          <div className="ai-pip" />
                          {isMultiStep ? 'AI suggested steps' : 'AI suggested action'}
                        </div>
                        {isMultiStep ? (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {steps.map((s, i) => (
                              <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                                <div className="step-n">{i + 1}</div>
                                <div className="ai-text" style={{ margin: 0 }}>{s}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="ai-text" style={{ marginTop: 6 }}>
                            {(card.ai_draft as any)?.text ?? card.description ?? 'Review and confirm this action.'}
                          </div>
                        )}
                      </div>

                      <div className="btn-row">
                        <button
                          className="btn btn-confirm"
                          onClick={() => confirmCard(card.id)}
                        >
                          {isMultiStep ? 'Confirm all' : isEmailType ? 'Confirm & send' : 'Confirm'}
                        </button>

                        {isEmailType && (
                          <button
                            className="btn btn-edit"
                            onClick={() => { setEmailCard(card); setEmailModalOpen(true) }}
                          >
                            Edit draft
                          </button>
                        )}

                        {isMultiStep && (
                          <button
                            className="btn btn-edit"
                            onClick={() => setExpandedSteps(isStepsOpen ? null : card.id)}
                          >
                            Edit steps
                          </button>
                        )}

                        {isTaskType && (
                          <button
                            className="btn btn-edit"
                            onClick={() => setExpandedEdit(isEditOpen ? null : card.id)}
                          >
                            Change date
                          </button>
                        )}

                        {!isMultiStep && (
                          <button
                            className="btn btn-snooze"
                            onClick={() => isSnoozed ? unsnoozeCard(card.id) : snoozeCard(card.id)}
                          >
                            Snooze
                          </button>
                        )}

                        <button className="btn btn-dismiss" onClick={() => dismissCard(card.id)}>
                          &#x2715;
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Steps editor */}
                  {isMultiStep && isStepsOpen && (
                    <div className="steps-edit">
                      <div className="ie-lbl">Review, tick or edit steps</div>
                      {steps.map((s, i) => {
                        const stepKey = `${card.id}-${i}`
                        const isEditing = !!stepEdits[stepKey]
                        const isSaved = !!savedSteps[stepKey]
                        return (
                          <div key={i} className="step-row">
                            <input type="checkbox" className="step-cb" defaultChecked />
                            <div className="step-n">{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="step-txt">
                                {stepEdits[`${stepKey}-saved`] ?? s}
                              </div>
                              {isEditing && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  <input
                                    className="step-inline-input"
                                    defaultValue={stepEdits[`${stepKey}-saved`] ?? s}
                                    id={`sinput-${stepKey}`}
                                  />
                                  <button
                                    className="btn btn-confirm"
                                    style={{ fontSize: 10, padding: '4px 10px' }}
                                    onClick={() => {
                                      const el = document.getElementById(`sinput-${stepKey}`) as HTMLInputElement
                                      setStepEdits((prev) => ({
                                        ...prev,
                                        [`${stepKey}-saved`]: el.value,
                                      }))
                                      setSavedSteps((prev) => ({ ...prev, [stepKey]: true }))
                                      setStepEdits((prev) => { const n = { ...prev }; delete n[stepKey]; return n })
                                    }}
                                  >
                                    Save
                                  </button>
                                </div>
                              )}
                              {isSaved && !isEditing && (
                                <div className="ai-recheck">AI will re-verify this step before executing.</div>
                              )}
                            </div>
                            <button
                              className="step-edit-icon"
                              onClick={() =>
                                setStepEdits((prev) =>
                                  prev[stepKey]
                                    ? (({ [stepKey]: _, ...rest }) => rest)(prev)
                                    : { ...prev, [stepKey]: 'open' }
                                )
                              }
                            >
                              ✎
                            </button>
                          </div>
                        )
                      })}
                      <div className="ie-actions" style={{ marginTop: 12 }}>
                        <button className="btn btn-confirm" onClick={() => confirmCard(card.id)}>
                          Confirm selected
                        </button>
                        <button className="btn btn-edit" onClick={() => setExpandedSteps(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Date picker */}
                  {isTaskType && isEditOpen && (
                    <div className="inline-edit">
                      <div className="ie-lbl">Select inspection date</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        <input
                          className="ie-input"
                          type="date"
                          defaultValue={new Date().toISOString().split('T')[0]}
                          style={{ width: 155 }}
                        />
                        <select className="ie-input" style={{ width: 165 }}>
                          <option>Morning (8am – 12pm)</option>
                          <option>Afternoon (12pm – 5pm)</option>
                        </select>
                      </div>
                      <div className="ie-actions">
                        <button className="btn btn-confirm" onClick={() => confirmCard(card.id)}>
                          Confirm
                        </button>
                        <button className="btn btn-edit" onClick={() => setExpandedEdit(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Snooze bar */}
                  {isSnoozed && (
                    <div className="snooze-bar">
                      Snoozed until tomorrow 9:00 am &nbsp;·&nbsp;{' '}
                      <button className="snooze-undo" onClick={() => unsnoozeCard(card.id)}>
                        Undo
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── EMAIL MODAL ── */}
      {emailModalOpen && emailCard && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEmailModalOpen(false)
          }}
        >
          <div className="email-modal">
            <div className="em-header">
              <span className="em-title">Edit email draft — {emailCard.job_number}</span>
              <button className="em-close" onClick={() => setEmailModalOpen(false)}>&times;</button>
            </div>
            <div className="em-field">
              <span className="em-field-lbl">To</span>
              <input
                className="em-field-input"
                defaultValue={(emailCard.ai_draft as any)?.to ?? ''}
                placeholder="Recipient…"
              />
            </div>
            <div className="em-field">
              <span className="em-field-lbl">CC</span>
              <input className="em-field-input" placeholder="Add CC…" />
            </div>
            <div className="em-field">
              <span className="em-field-lbl">BCC</span>
              <input className="em-field-input" placeholder="Add BCC…" />
            </div>
            <div className="em-field">
              <span className="em-field-lbl">Subject</span>
              <input
                className="em-field-input"
                defaultValue={(emailCard.ai_draft as any)?.subject ?? `RE: ${emailCard.job_number}`}
              />
            </div>
            <div className="em-body-area">
              <textarea
                className="em-body-ta"
                rows={9}
                defaultValue={(emailCard.ai_draft as any)?.body ?? emailCard.description ?? ''}
              />
              <div className="em-sig">
                Kyle Bindon<br />
                Insurance Repair Co.<br />
                0400 000 000 &nbsp;·&nbsp; kyle@insurancerepair.com.au
              </div>
            </div>
            <div className="em-footer">
              <button
                className="btn btn-confirm"
                onClick={() => { setEmailModalOpen(false); confirmCard(emailCard.id) }}
              >
                Send email
              </button>
              <button className="btn btn-edit" onClick={() => setEmailModalOpen(false)}>
                Cancel
              </button>
              <span className="em-footer-note">AI-drafted &nbsp;·&nbsp; review before sending</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
