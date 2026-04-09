import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

const SYSTEM_PROMPT = `Be concise. Answer in 1-3 sentences unless detail is specifically requested. Never use bullet points or headers for simple factual questions.

You are the IRC Master assistant for Insurance Repair Co., a building insurance repair business in Perth WA. You have access to the user's job data and can answer questions about jobs, quotes, scope, SLAs, and processes. If the user asks about specific job data you don't have access to, tell them in one sentence that you can't query live data yet and suggest they check the Jobs tab.

When the user asks you to take an action, respond with your explanation followed by a JSON block listing the proposed steps before executing. The user must confirm before any action is taken.

Format action proposals as a JSON block on its own line like this:
{"type":"action_proposal","steps":[{"n":1,"description":"..."},{"n":2,"description":"..."}]}

Only include the JSON block when proposing an action. For informational questions, just respond in plain text.

Key facts about IRC:
- Sedgwick SLA: BAR reports within 7 calendar days, Make Safes attended within 24 hours
- Job numbers prefixed with IRC (e.g. IRC1008)
- Quote numbers prefixed with Q (e.g. Q1005-1)
- The business handles building insurance repairs: storm damage, water damage, make safes
`

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 })
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    return NextResponse.json({ text })
  } catch (err) {
    console.error('AI assistant error:', err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
  }
}
