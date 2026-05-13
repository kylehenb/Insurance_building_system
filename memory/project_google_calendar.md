---
name: Google Calendar Setup
description: Google Calendar integration wired for inspection propose flow; OAuth credentials needed in .env.local
type: project
---

Google Calendar integration added to the inspection propose workflow (lib/calendar/client.ts). The client falls back to GMAIL_* credentials if GOOGLE_CALENDAR_* aren't set.

**Required .env.local additions:**
```
GOOGLE_CALENDAR_CLIENT_ID=...       # or reuse GMAIL_CLIENT_ID if same OAuth app
GOOGLE_CALENDAR_CLIENT_SECRET=...   # or reuse GMAIL_CLIENT_SECRET
GOOGLE_CALENDAR_REFRESH_TOKEN=...   # refresh token with calendar.events scope
GOOGLE_CALENDAR_ID=primary          # or specific calendar ID (e.g. kylehenb@gmail.com)
NEXT_PUBLIC_APP_URL=https://...     # base URL used in calendar event links to field app
```

**Why:** The OAuth refresh token must include `https://www.googleapis.com/auth/calendar.events` scope. If the same client/secret was used for Gmail, generating a new refresh token with both scopes is the easiest path.

**How to apply:** When the user asks about calendar events not being created, or wants to wire up the actual calendar, point them to these env vars.
