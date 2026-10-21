// Date formatting for signing records. Safe to import from client code.

export const SIGNING_TIME_ZONE = 'Australia/Perth'

/** "21 Oct 2026" in Perth time — the date written beside a signature. */
export function formatSigningDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: SIGNING_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

/** "21 Oct 2026, 2:05:09 pm AWST" */
export function formatPerthDateTime(date: Date | string): string {
  const d = new Date(date)
  const text = new Intl.DateTimeFormat('en-AU', {
    timeZone: SIGNING_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d)
  // Perth has no daylight saving: always AWST (UTC+8)
  return `${text} AWST`
}

/** "2026-10-21 06:05:09 UTC" */
export function formatUtcDateTime(date: Date | string): string {
  return new Date(date).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

/** Short device description from a user agent, e.g. "Safari on iPhone (iOS 15.8)". */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  if (!ua) return 'Unknown device'

  let os = 'Unknown system'
  let m: RegExpMatchArray | null
  if ((m = ua.match(/iPhone OS (\d+)[_.](\d+)/))) os = `iPhone (iOS ${m[1]}.${m[2]})`
  else if ((m = ua.match(/iPad.*OS (\d+)[_.](\d+)/))) os = `iPad (iPadOS ${m[1]}.${m[2]})`
  else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) os = `Android ${m[1]}`
  else if (/Windows NT/.test(ua)) os = 'Windows'
  else if ((m = ua.match(/Mac OS X (\d+)[_.](\d+)/))) os = `Mac (macOS ${m[1]}.${m[2]})`
  else if (/Linux/.test(ua)) os = 'Linux'

  let browser = 'Unknown browser'
  if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet'
  else if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/(CriOS|Chrome)\//.test(ua)) browser = 'Chrome'
  else if (/(FxiOS|Firefox)\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  return `${browser} on ${os}`
}
