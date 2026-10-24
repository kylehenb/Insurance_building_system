import { MailApp } from '@/components/mail/MailApp'

// The dashboard is the office's one place to work from: action cards (what
// needs doing, from each email and its job file), the day at a glance, and
// the office mailbox. See components/mail/MailApp.tsx.
export default function DashboardPage() {
  return <MailApp />
}
