import { google } from 'googleapis'
import { calendar_v3 } from 'googleapis'

let cachedClient: calendar_v3.Calendar | null = null

export function getCalendarClient(): calendar_v3.Calendar {
  if (cachedClient) return cachedClient

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar credentials not configured. Set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN (or GMAIL_* equivalents) in .env.local')
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })

  cachedClient = google.calendar({ version: 'v3', auth })
  return cachedClient
}

export const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? 'primary'
