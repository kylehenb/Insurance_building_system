'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'
import { useAIActionRefresh } from '@/lib/hooks/useAIActionRefresh'
import { useCurrentUser } from '@/components/layout/current-user'
import { ApprovalsPanel } from '@/components/approvals/approvals-panel'

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

// ── Main component ───────────────────────────────────────────────────────────

/** The old dashboard (AI chat, flagged jobs, weather, approvals) — the "Today" view on the dashboard */
export function TodayView() {
  const router = useRouter()

  // AI Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // The full conversation (tool calls included) the server hands back each turn
  const aiHistoryRef = useRef<unknown[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Weather
  const [weather, setWeather] = useState<WeatherDay[]>([])
  const [weatherLoading, setWeatherLoading] = useState(true)

  // Flagged jobs
  const [flaggedJobs, setFlaggedJobs] = useState<FlaggedJob[]>([])
  const [removingFlags, setRemovingFlags] = useState<Set<string>>(new Set())


  // Auth
  const { tenantId, userId } = useCurrentUser()

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
  }, [userId, tenantId])

  // Auto-refresh when AI actions complete
  useAIActionRefresh(async () => {
    if (!userId || !tenantId) return
    fetchFlaggedJobs()
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

    // Pending action_queue items for all flagged jobs, counted per job
    const jobIds = data.map((row) => row.job_id)
    const { data: pending } = jobIds.length
      ? await supabase
          .from('action_queue')
          .select('job_id')
          .in('job_id', jobIds)
          .eq('status', 'pending')
      : { data: [] }
    const pendingByJob = new Map<string, number>()
    for (const { job_id } of (pending ?? []) as { job_id: string }[]) {
      pendingByJob.set(job_id, (pendingByJob.get(job_id) ?? 0) + 1)
    }

    const jobs = data.map((row: any) => {
      const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
      if (!job) return null
      const count = pendingByJob.get(row.job_id) ?? 0
      return {
        id: row.job_id,
        job_id: row.job_id,
        job_number: job.job_number,
        property_address: job.property_address,
        insured_name: job.insured_name,
        insurer: job.insurer,
        override_stage: job.override_stage ?? null,
        current_stage: job.current_stage ?? null,
        action_count: count,
      } as FlaggedJob
    })
    setFlaggedJobs(jobs.filter(Boolean) as FlaggedJob[])
  }

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
          history: aiHistoryRef.current,
          pageContext: '/dashboard',
        }),
      })
      const data = await res.json()
      if (Array.isArray(data.history)) aiHistoryRef.current = data.history
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

  return (
    <>
      <style>{`
        .dash-main { padding: 32px 36px 48px; }
        .dash-main::-webkit-scrollbar { width: 5px; }
        .dash-main::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 3px; }

        /* AI Chat */
        .ai-hero { background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 10px; overflow: hidden; margin-bottom: 28px; }
        .ai-hero-header { display: flex; align-items: center; gap: 8px; padding: 14px 20px 12px; border-bottom: 0.5px solid var(--line-faint); background: var(--surface-6); }
        .ai-hero-pip { width: 6px; height: 6px; border-radius: 50%; background: var(--tan); flex-shrink: 0; }
        .ai-hero-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--tan); font-weight: 700; }
        .ai-messages-area { min-height: 160px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 20px 24px; background: var(--paper); }
        .ai-messages-area::-webkit-scrollbar { width: 3px; }
        .ai-messages-area::-webkit-scrollbar-thumb { background: var(--line-5); border-radius: 2px; }
        .ai-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; padding: 24px 0; min-height: 120px; }
        .ai-empty-icon { font-size: 26px; opacity: 0.2; }
        .ai-empty-text { font-size: 14px; color: var(--subtle-3); font-weight: 400; text-align: center; }
        .ai-empty-sub { font-size: 12px; color: #c0b8b0; font-weight: 300; text-align: center; line-height: 1.5; }
        .ai-bubble { display: flex; gap: 10px; align-items: flex-start; max-width: 84%; }
        .ai-bubble.user { align-self: flex-end; flex-direction: row-reverse; }
        .ai-bubble.assistant { align-self: flex-start; }
        .ai-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; margin-top: 2px; }
        .ai-avatar.user { background: #2e2820; color: var(--tan); border: 0.5px solid rgba(200,184,154,0.2); }
        .ai-avatar.assistant { background: var(--cream); color: var(--bronze); border: 0.5px solid var(--line-tan-5); font-size: 13px; }
        .ai-bubble-inner { display: flex; flex-direction: column; max-width: 100%; gap: 8px; }
        .ai-bubble-text { padding: 10px 15px; border-radius: 10px; font-size: 13px; line-height: 1.65; font-weight: 400; white-space: pre-wrap; word-break: break-word; }
        .ai-bubble.user .ai-bubble-text { background: var(--ink); color: var(--line-tan-3); border-radius: 10px 10px 3px 10px; }
        .ai-bubble.assistant .ai-bubble-text { background: #f7f5f2; color: var(--ink-brown); border-radius: 10px 10px 10px 3px; border: 0.5px solid var(--line-5); }
        .ai-action-panel { background: var(--surface-9); border: 0.5px solid var(--line-tan-5); border-radius: 8px; padding: 14px 16px; }
        .ai-action-panel.confirmed { background: #f0fbf5; border-color: #b8e0c8; }
        .ai-action-title { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--tan); font-weight: 700; margin-bottom: 10px; }
        .ai-action-step { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 0.5px solid var(--line-faint); }
        .ai-action-step:last-of-type { border-bottom: none; }
        .ai-step-n { width: 16px; height: 16px; border-radius: 50%; background: var(--line-faint); color: #9a8070; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .ai-step-text { font-size: 12px; color: #5a534a; line-height: 1.45; font-weight: 300; }
        .ai-action-btns { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
        .ai-btn { font-size: 11px; padding: 5px 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; line-height: 1.4; }
        .ai-btn-confirm { background: var(--teal); color: var(--paper); border-color: var(--teal); }
        .ai-btn-confirm:hover { background: #235a42; }
        .ai-btn-edit { background: transparent; color: var(--brown-500); border-color: var(--line-strong-3); }
        .ai-btn-edit:hover { border-color: var(--bronze); color: var(--bronze); }
        .ai-btn-dismiss { background: transparent; border: none; color: var(--faint-5); font-size: 16px; padding: 3px 5px; cursor: pointer; line-height: 1; }
        .ai-btn-dismiss:hover { color: var(--rust); }
        .ai-input-wrap { padding: 14px 20px 16px; border-top: 0.5px solid var(--line-faint); background: var(--surface-6); }
        .ai-input-row { display: flex; align-items: flex-end; gap: 0; background: #f7f5f2; border-radius: 12px; border: 0.5px solid var(--line-2); transition: border-color 0.2s; overflow: hidden; }
        .ai-input-row:focus-within { border-color: var(--tan); }
        .ai-textarea { flex: 1; background: transparent; border: none; padding: 13px 16px; color: var(--ink); font-size: 14px; font-family: inherit; font-weight: 400; outline: none; resize: none; line-height: 1.55; min-height: 50px; max-height: 160px; }
        .ai-textarea::placeholder { color: var(--faint-3); }
        .ai-send-btn { background: var(--ink); border: none; margin: 8px 10px 8px 0; width: 36px; height: 36px; border-radius: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s; align-self: flex-end; }
        .ai-send-btn:hover { background: var(--ink-hover); }
        .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ai-hint { font-size: 10px; color: var(--faint-5); text-align: right; margin-top: 7px; font-weight: 300; }

        /* Two col */
        .two-col { display: grid; grid-template-columns: 3fr 1fr; gap: 24px; margin-bottom: 28px; }
        .sec-label { font-size: 14px; font-weight: 500; color: var(--ink); letter-spacing: 0.3px; margin-bottom: 12px; }

        /* Flagged table */
        .flag-wrap { border: 0.5px solid var(--line-2); border-radius: 8px; overflow: hidden; background: var(--paper); }
        .flag-scroll { max-height: 256px; overflow-y: auto; }
        .flag-scroll::-webkit-scrollbar { width: 3px; }
        .flag-scroll::-webkit-scrollbar-thumb { background: var(--line-5); border-radius: 2px; }
        .ft { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .ft th { font-size: 10px; color: var(--faint-3); text-align: left; padding: 10px 12px; border-bottom: 0.5px solid var(--line-faint); font-weight: 500; letter-spacing: 0.8px; text-transform: uppercase; background: var(--surface-6); position: sticky; top: 0; z-index: 1; white-space: nowrap; overflow: hidden; }
        .ft td { padding: 9px 12px; border-bottom: 0.5px solid var(--surface); font-size: 13px; color: var(--body); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ft tr:last-child td { border-bottom: none; }
        .ft tr:hover td { background: var(--surface-3); cursor: pointer; }
        .jnum { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--tan); font-weight: 500; }
        .sbadge { font-size: 10px; padding: 2px 7px; border-radius: 20px; font-weight: 400; display: inline-block; white-space: nowrap; }
        .s-active { background: #eaf3f0; color: var(--teal); }
        .s-pending { background: #fdf5e8; color: #8a6020; }
        .flag-btn { background: none; border: none; cursor: pointer; color: var(--tan); font-size: 14px; padding: 0; line-height: 1; transition: opacity 0.2s; display: block; }
        .flag-btn:hover { opacity: 0.35; }
        .row-badge { display: inline-flex; align-items: center; justify-content: center; background: #e24b4a; color: var(--paper); font-size: 9px; font-weight: 700; width: 17px; height: 17px; border-radius: 50%; font-family: 'DM Mono', monospace; flex-shrink: 0; }
        .row-badge.amber { background: #ef9f27; }

        /* Weather */
        .weather-panel { background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 8px; overflow: hidden; }
        .weather-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 0.5px solid var(--surface); cursor: default; transition: background 0.15s; }
        .weather-row:last-child { border-bottom: none; }
        .weather-row:hover { background: var(--surface-3); }
        .weather-row.today { background: var(--surface-9); }
        .wr-day { font-size: 11px; font-weight: 700; color: var(--ink); width: 38px; flex-shrink: 0; }
        .wr-icon { font-size: 16px; flex-shrink: 0; }
        .wr-temp { font-size: 13px; font-weight: 700; color: var(--ink); font-family: 'DM Mono', monospace; width: 34px; flex-shrink: 0; }
        .wr-sub { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .wr-stat { font-size: 10px; color: var(--subtle-3); font-family: 'DM Mono', monospace; white-space: nowrap; }
        .wr-stat.rain { color: #4a80c0; }
        .weather-loading { font-size: 12px; color: #c0b8b0; padding: 16px; text-align: center; font-style: italic; }

        /* To Do */
        .btn { font-size: 11px; padding: 5px 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 600; border: 1px solid transparent; transition: all 0.15s; white-space: nowrap; line-height: 1.4; }
        .btn-confirm { background: var(--teal); color: var(--paper); border-color: var(--teal); }
        .btn-confirm:hover { background: #235a42; }
        .btn-edit { background: transparent; color: var(--brown-500); border-color: var(--line-strong-3); }
        .btn-edit:hover { border-color: var(--bronze); color: var(--bronze); }
        .btn-dismiss { background: transparent; border: none; color: var(--faint-5); font-size: 16px; padding: 3px 5px; cursor: pointer; line-height: 1; }
        .btn-dismiss:hover { color: var(--rust); }
        .step-row { display: flex; align-items: flex-start; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid var(--surface); }
        .step-row:last-of-type { border-bottom: none; }
        .step-n { width: 17px; height: 17px; border-radius: 50%; background: var(--line-faint); color: var(--subtle-3); font-size: 9px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .step-edit-icon { color: var(--tan); font-size: 13px; cursor: pointer; padding: 0 3px; opacity: 0.6; transition: opacity 0.15s; background: none; border: none; }
        .step-edit-icon:hover { opacity: 1; }

        /* Unlinked inbox */

        /* Modal */
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
                        <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 600 }}>
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
                  <div className="ai-bubble-text" style={{ color: 'var(--subtle-3)', fontStyle: 'italic' }}>
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

        <ApprovalsPanel />

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
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24, fontWeight: 300, fontSize: 13 }}>
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
                            <span style={{ color: 'var(--faint-5)', fontSize: 12 }}>—</span>
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


      </div>

    </>
  )
}
