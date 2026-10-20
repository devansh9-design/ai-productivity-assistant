"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarCheck, ChartColumn, Flag, FolderKanban, ListTodo, LogOut, Menu, NotebookPen, Settings, Sparkles, Target, X,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeSwitch } from "@/components/theme-switch";

const navigation: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/ai", label: "AI Assistant", icon: Sparkles },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/milestones", label: "Milestones", icon: Flag },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/review", label: "Weekly review", icon: NotebookPen },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
        <CalendarCheck className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Personal</p>
        <p className="text-base font-bold text-slate-900">Assistant</p>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active
              ? "bg-indigo-50 text-indigo-700"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
            <Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  async function signOut() {
    setIsSigningOut(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return <button type="button" onClick={signOut} disabled={isSigningOut}
    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60">
    <LogOut aria-hidden="true" className="h-[18px] w-[18px] text-slate-400" />
    {isSigningOut ? "Signing out…" : "Sign out"}
  </button>;
}

function Account({ email }: { email: string }) {
  return (
    <div className="mt-auto border-t border-slate-200 pt-4">
      <div className="mb-3"><ThemeSwitch /></div>
      <p className="mb-2 truncate px-3 text-xs text-slate-500" title={email}>{email}</p>
      <SignOutButton />
    </div>
  );
}

export function AppSidebar({ email }: { email: string }) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <button type="button" className="btn-secondary px-3" aria-label="Open navigation"
          aria-expanded={isOpen} aria-controls="mobile-navigation" onClick={() => setIsOpen(true)}>
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>
      {isOpen && <div className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" aria-hidden="true" onClick={() => setIsOpen(false)} />}
      <aside id="mobile-navigation" aria-label="Mobile navigation" inert={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white p-5 shadow-xl transition-transform md:hidden ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between">
          <Brand />
          <button type="button" onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close navigation">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-8"><Navigation onNavigate={() => setIsOpen(false)} /></div>
        <Account email={email} />
      </aside>
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-5 md:flex">
        <Brand />
        <div className="mt-8"><Navigation /></div>
        <Account email={email} />
      </aside>
    </>
  );
}
