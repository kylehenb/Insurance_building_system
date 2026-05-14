import { google } from 'googleapis'
import { calendar_v3 } from 'googleapis'

export function getCalendarClient(): calendar_v3.Calendar {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET
  const refreshToken = (process.env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? process.env.GMAIL_REFRESH_TOKEN ?? '').trim()

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar credentials not configured. Set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN in .env.local')
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })

  return google.calendar({ version: 'v3', auth })
}

export const CALENDAR_ID = (process.env.GOOGLE_CALENDAR_ID ?? 'primary').trim()
