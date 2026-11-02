// The vercel.json crons not under /api/gmail/ (proxy.ts lets them through
// with no session; each checks the CRON_SECRET bearer itself). Add new ones
// here too — a test checks.
export const CRON_ROUTES = new Set([
  '/api/accounting/poll-payments',
  '/api/field/submission-watchdog',
  '/api/reports/index-embeddings',
  '/api/signing/reminders',
  '/api/learning/review',
  '/api/calendar/sync',
  '/api/jobs/review',
])
