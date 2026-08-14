/**
 * Dry-run re-parse endpoint for testing the order parser against a specific Gmail message.
 *
 * GET /api/gmail/reparse?messageId=<id>
 *   Fetches message, extracts parts (including PDF attachment bytes), runs parseInsurerOrder.
 *   Returns full parse result including rawGeminiOutput and raw Gemini text. Does NOT write to DB.
 *
 * GET /api/gmail/reparse?threadId=<id>
 *   Same but finds the first message in the thread.
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI, Part } from '@google/generative-ai'
import { getUser } from '@/lib/supabase/get-user'
import { getGmailClient } from '@/lib/gmail/client'
import { getFullMessage, extractMessageParts } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  const params = req.nextUrl.searchParams
  let messageId = params.get('messageId')
  const threadId = params.get('threadId')

  if (!messageId && !threadId) {
    return NextResponse.json({ error: 'Provide messageId or threadId query param' }, { status: 400 })
  }

  const gmail = getGmailClient()

  if (!messageId && threadId) {
    const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'minimal' })
    const firstMsg = threadRes.data.messages?.[0]
    if (!firstMsg?.id) {
      return NextResponse.json({ error: 'Thread not found or has no messages' }, { status: 404 })
    }
    messageId = firstMsg.id
  }

  const raw = await getFullMessage(messageId!)
  const msg = await extractMessageParts(raw)

  const attachmentSummary = msg.attachments.map(a => ({
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    dataLength: a.data.length,
    hasData: a.data.length > 0,
  }))

  // Call Gemini directly to expose raw response text for debugging
  let geminiRawText: string | null = null
  let geminiError: string | null = null
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

      const parts: Part[] = [
        { text: 'Extract claim data as JSON. Return only valid JSON.' },
        { text: `Subject: ${msg.subject}\nFrom: ${msg.from}\n\n${msg.bodyText}` },
      ]

      const pdf = msg.attachments.find(a => a.mimeType === 'application/pdf' && a.data.length > 0)
      if (pdf) {
        parts.push({ inlineData: { mimeType: 'application/pdf', data: pdf.data } })
      }

      const result = await model.generateContent(parts)
      geminiRawText = result.response.text()
    }
  } catch (err) {
    geminiError = String(err)
  }

  const parsed = await parseInsurerOrder(msg, null, tenantId)

  return NextResponse.json({
    messageId,
    threadId: msg.threadId,
    subject: msg.subject,
    from: msg.from,
    bodyTextLength: msg.bodyText.length,
    attachments: attachmentSummary,
    geminiRawText,
    geminiError,
    confidence: parsed.confidence,
    parseStatus: parsed.parseStatus,
    missingFields: parsed.missingFields,
    insurerDetected: parsed.insurerDetected,
    parsedData: parsed.data,
    rawGeminiOutput: parsed.rawGeminiOutput,
  })
}
