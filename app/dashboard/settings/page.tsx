import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  Sparkles,
  Zap,
  Code,
  DollarSign,
  Mail,
  ArrowDownUp,
  CalendarClock,
  Building2,
  Users,
  BookOpen,
  ChevronRight,
} from 'lucide-react'

interface SettingsCard {
  name: string
  route: string | null
  description: string
  icon: React.ReactNode
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const aiAutomationCards: SettingsCard[] = [
    {
      name: 'AI Prompt Library',
      route: '/dashboard/settings/prompts',
      description: 'Edit the system prompts for all AI features — reports, scope parsing, Gary, Client Comms Bot',
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      name: 'Automation Config',
      route: '/dashboard/settings/automation',
      description: 'Configure Gary timing, make safe cascade, homeowner follow-up, trade proximity threshold',
      icon: <Zap className="w-4 h-4" />,
    },
    {
      name: 'Action Queue Rules',
      route: null,
      description: 'Defined in code (/lib/automation/rules.ts) — no UI',
      icon: <Code className="w-4 h-4" />,
    },
  ]

  const operationsCards: SettingsCard[] = [
    {
      name: 'Rate Config',
      route: '/dashboard/settings/rates',
      description: 'Set standard charge-out rates and margins for each report type',
      icon: <DollarSign className="w-4 h-4" />,
    },
    {
      name: 'Email Templates',
      route: '/dashboard/settings/email-templates',
      description: 'Manage email templates for inspection sends, work orders, invoices, and general use',
      icon: <Mail className="w-4 h-4" />,
    },
    {
      name: 'Trade Type Sequence',
      route: '/dashboard/settings/trade-sequence',
      description: 'Set default trade ordering and visit counts used by the AI schedule blueprint generator',
      icon: <ArrowDownUp className="w-4 h-4" />,
    },
    {
      name: 'Inspection Scheduling Rules',
      route: '/dashboard/settings/inspection-scheduling',
      description: 'Rules governing how inspections are auto-assigned, grouped, and routed (Phase 4+)',
      icon: <CalendarClock className="w-4 h-4" />,
    },
  ]

  const accountCards: SettingsCard[] = [
    {
      name: 'Tenant Settings',
      route: '/dashboard/settings/tenant',
      description: 'Business name, logo, job prefix, contact details',
      icon: <Building2 className="w-4 h-4" />,
    },
    {
      name: 'Users',
      route: '/dashboard/settings/users',
      description: 'Manage users, roles, and permission overrides',
      icon: <Users className="w-4 h-4" />,
    },
    {
      name: 'Scope Library',
      route: '/dashboard/settings/scope-library',
      description: 'View and edit the scope item library used for AI quote generation',
      icon: <BookOpen className="w-4 h-4" />,
    },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Settings</h1>
        <p className="text-sm text-[#9e998f] mt-1">
          Manage AI configuration, automation rules, and operational defaults.
        </p>
      </div>

      {/* Section 1 — AI & Automation */}
      <div className="mb-8">
        <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-3">
          AI & Automation
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {aiAutomationCards.map((card) => (
            <SettingsCard key={card.name} card={card} />
          ))}
        </div>
      </div>

      {/* Section 2 — Operations */}
      <div className="mb-8">
        <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-3">
          Operations
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {operationsCards.map((card) => (
            <SettingsCard key={card.name} card={card} />
          ))}
        </div>
      </div>

      {/* Section 3 — Account & Tenancy */}
      <div className="mb-8">
        <h2 className="text-xs text-[#9e998f] uppercase tracking-wider mb-3">
          Account & Tenancy
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accountCards.map((card) => (
            <SettingsCard key={card.name} card={card} />
          ))}
        </div>
      </div>
    </div>
  )
}

function SettingsCard({ card }: { card: SettingsCard }) {
  if (!card.route) {
    return (
      <div className="bg-white rounded-lg border border-[#e8e4e0] p-4 opacity-60">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#f5f2ee] flex items-center justify-center flex-shrink-0">
            {card.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-[#1a1a1a] text-sm mb-1">
              {card.name}
            </h3>
            <p className="text-xs text-[#9e998f]">{card.description}</p>
          </div>
          <div className="flex-shrink-0">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-[#e8e4e0] text-[#9e998f]">
              CODE ONLY
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <a
      href={card.route}
      className="block bg-white rounded-lg border border-[#e8e4e0] p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[#f5f2ee] flex items-center justify-center flex-shrink-0">
          {card.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[#1a1a1a] text-sm mb-1">
            {card.name}
          </h3>
          <p className="text-xs text-[#9e998f]">{card.description}</p>
        </div>
        <div className="flex-shrink-0">
          <ChevronRight className="w-4 h-4 text-[#c8b89a]" />
        </div>
      </div>
    </a>
  )
}
