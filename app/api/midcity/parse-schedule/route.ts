import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getUser } from '@/lib/supabase/get-user'

export const dynamic = 'force-dynamic'

type ParsedJob = {
  job_number: string
  property_address: string
  start_time: string
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const mimeType = file.type.toLowerCase()
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'Unsupported file type. Use JPEG, PNG, or WEBP.' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: base64,
            },
          },
          {
            type: 'text',
            text: `This is a screenshot of a work schedule from a portal. Extract every job or inspection listed.

For each job, extract:
1. job_number — the job/order/reference number (e.g. "12345", "MC1001", "WO-456")
2. property_address — the full street address (e.g. "123 Main St, Sydney NSW 2000")
3. start_time — the scheduled time (e.g. "9:00am", "14:30") — use empty string if not shown

Return ONLY a valid JSON array with no markdown fences and no explanation:
[{"job_number":"...","property_address":"...","start_time":"..."}]

If no jobs are found, return an empty array: []`,
          },
        ],
      }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected AI response format' }, { status: 500 })
    }

    let jobs: ParsedJob[]
    try {
      const jsonMatch = content.text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON array in response')
      jobs = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', details: content.text }, { status: 500 })
    }

    return NextResponse.json({ jobs })
  } catch (err) {
    console.error('[midcity/parse-schedule] error:', err)
    return NextResponse.json({ error: 'Failed to parse schedule', details: String(err) }, { status: 500 })
  }
}
