import { google } from 'googleapis'
import { gmail_v1 } from 'googleapis'

let cachedClient: gmail_v1.Gmail | null = null

export function getGmailClient(): gmail_v1.Gmail {
  if (cachedClient) return cachedClient

  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID!,
    process.env.GMAIL_CLIENT_SECRET!
  )

  auth.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
  })

  cachedClient = google.gmail({ version: 'v1', auth })
  return cachedClient
}
