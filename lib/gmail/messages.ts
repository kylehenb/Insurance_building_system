import { getGmailClient } from './client'
import { gmail_v1 } from 'googleapis'

export type GmailMessage = gmail_v1.Schema$Message

export type MessageAttachment = {
  filename: string
  mimeType: string
  data: string
  size: number
}

export type ExtractedMessage = {
  subject: string
  from: string
  fromEmail: string
  fromName: string
  to: string
  bodyText: string
  bodyHtml: string
  attachments: MessageAttachment[]
  threadId: string
  messageId: string
  receivedAt: string
}

export async function getFullMessage(messageId: string): Promise<GmailMessage> {
  const gmail = getGmailClient()
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  })
  return res.data
}

function decodeBase64(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

function getHeader(message: GmailMessage, name: string): string {
  const header = message.payload?.headers?.find(
    h => h.name?.toLowerCase() === name.toLowerCase()
  )
  return header?.value ?? ''
}

function parseFromHeader(from: string): { email: string; name: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/)
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, ''),
      email: match[2].trim(),
    }
  }
  const emailOnly = from.trim()
  return { name: '', email: emailOnly }
}

function extractParts(
  part: gmail_v1.Schema$MessagePart,
  result: { bodyText: string; bodyHtml: string; attachments: MessageAttachment[] }
): void {
  const mimeType = part.mimeType ?? ''

  if (mimeType === 'text/plain' && part.body?.data) {
    result.bodyText += decodeBase64(part.body.data)
    return
  }

  if (mimeType === 'text/html' && part.body?.data) {
    result.bodyHtml += decodeBase64(part.body.data)
    return
  }

  if (
    part.filename &&
    part.filename.length > 0 &&
    part.body?.attachmentId
  ) {
    result.attachments.push({
      filename: part.filename,
      mimeType: mimeType,
      data: part.body.data ?? '',
      size: part.body.size ?? 0,
    })
    return
  }

  if (part.parts) {
    for (const child of part.parts) {
      extractParts(child, result)
    }
  }
}

export function extractMessageParts(message: GmailMessage): ExtractedMessage {
  const from = getHeader(message, 'From')
  const { email: fromEmail, name: fromName } = parseFromHeader(from)
  const to = getHeader(message, 'To')
  const subject = getHeader(message, 'Subject')

  const internalDate = message.internalDate
    ? new Date(parseInt(message.internalDate, 10)).toISOString()
    : new Date().toISOString()

  const parts = { bodyText: '', bodyHtml: '', attachments: [] as MessageAttachment[] }

  if (message.payload) {
    if (message.payload.mimeType === 'text/plain' && message.payload.body?.data) {
      parts.bodyText = decodeBase64(message.payload.body.data)
    } else if (message.payload.mimeType === 'text/html' && message.payload.body?.data) {
      parts.bodyHtml = decodeBase64(message.payload.body.data)
    } else if (message.payload.parts) {
      for (const part of message.payload.parts) {
        extractParts(part, parts)
      }
    }
  }

  return {
    subject,
    from,
    fromEmail,
    fromName,
    to,
    bodyText: parts.bodyText,
    bodyHtml: parts.bodyHtml,
    attachments: parts.attachments,
    threadId: message.threadId ?? '',
    messageId: message.id ?? '',
    receivedAt: internalDate,
  }
}
