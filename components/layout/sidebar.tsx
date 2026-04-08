"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  ClipboardCheck,
  FileText,
  Quote,
  Inbox,
  MessageSquare,
  Wrench,
  Users,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";

interface SidebarProps {
  user: {
    name: string;
    role: string;
  };
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Jobs", href: "/dashboard/jobs", icon: Briefcase },
  { name: "Inspections", href: "/dashboard/inspections", icon: ClipboardCheck },
  { name: "Reports", href: "/dashboard/reports", icon: FileText },
  { name: "Quotes", href: "/dashboard/quotes", icon: Quote },
  { name: "Insurer Orders", href: "/dashboard/insurer-orders", icon: Inbox },
  { name: "Communications", href: "/dashboard/communications", icon: MessageSquare },
  { name: "Trades", href: "/dashboard/trades", icon: Wrench },
  { name: "Work Orders", href: "/dashboard/work-orders", icon: Briefcase },
  { name: "Clients", href: "/dashboard/clients", icon: Users },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-[#1a1a1a] px-4 py-3 flex items-center justify-between">
        <span className="text-[#f5f0e8] font-semibold">IRC Master</span>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-[#f5f0e8] p-1"
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-40 h-screen w-64
          bg-[#1a1a1a] text-[#f5f0e8]
          transform transition-transform duration-200 ease-in-out
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          flex flex-col
        `}
      >
        {/* Logo / Brand */}
        <div className="border-b border-[#f5f0e8]/10 p-6">
          <h1 className="text-xl font-bold tracking-tight">IRC Master</h1>
          <p className="mt-1 text-xs text-[#f5f0e8]/60">Job Management System</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              const Icon = item.icon;

              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                      transition-colors
                      ${
                        isActive
                          ? "bg-[#f5f0e8] text-[#1a1a1a]"
                          : "text-[#f5f0e8]/70 hover:bg-[#f5f0e8]/10 hover:text-[#f5f0e8]"
                      }
                    `}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User info */}
        <div className="border-t border-[#f5f0e8]/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f0e8]/10">
              <span className="text-sm font-medium">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-[#f5f0e8]/60 capitalize truncate">{user.role}</p>
            </div>
          </div>
          <form action="/api/auth/signout" method="post" className="mt-3">
            <button
              type="submit"
              className="w-full text-left text-xs text-[#f5f0e8]/50 hover:text-[#f5f0e8] transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Spacer for mobile header */}
      <div className="lg:hidden h-12" />
    </>
  );
}
