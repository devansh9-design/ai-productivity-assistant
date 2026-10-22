"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarCheck, CalendarDays, CalendarRange, LogOut, Menu, NotebookPen, Settings, Sparkles, Target,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeSwitch } from "@/components/theme-switch";
import { SIDEBAR_COLLAPSED_CLASS, SIDEBAR_STORAGE_KEY } from "@/lib/theme";

// Phase 2 order (student-planner-plan.md, Step 11). Tasks, Projects, Milestones
// and Analytics are no longer in the menu; their pages still open by address.
const navigation: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/week", label: "Week", icon: CalendarDays },
  { href: "/month", label: "Month", icon: CalendarRange },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/ai", label: "AI", icon: Sparkles },
  { href: "/review", label: "Review", icon: NotebookPen },
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

/** The three-line (☰) button that opens and closes the menu everywhere. */
function MenuButton({ label, expanded, controls, onClick, className = "" }: {
  label: string; expanded: boolean; controls: string; onClick: () => void; className?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-expanded={expanded} aria-controls={controls}
      className={`rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 ${className}`}>
      <Menu aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

// Desktop collapse lives on <html> (set before paint by THEME_INIT_SCRIPT) so
// the page layout in globals.css can follow it; this keeps React in step.
const SIDEBAR_EVENT = "sidebar-change";
const isCollapsed = () => document.documentElement.classList.contains(SIDEBAR_COLLAPSED_CLASS);
function subscribeSidebar(onChange: () => void) {
  window.addEventListener(SIDEBAR_EVENT, onChange);
  return () => window.removeEventListener(SIDEBAR_EVENT, onChange);
}
function setCollapsed(collapsed: boolean) {
  document.documentElement.classList.toggle(SIDEBAR_COLLAPSED_CLASS, collapsed);
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_STORAGE_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Storage unavailable: the choice still applies until the page is reloaded.
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

export function AppSidebar({ email }: { email: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, isCollapsed, () => false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <>
      {/* Phone: the header ☰ opens the drawer, and the ☰ inside it closes it again. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <MenuButton label="Open menu" expanded={isOpen} controls="mobile-navigation" onClick={() => setIsOpen(true)} className="border border-slate-300" />
      </header>
      {isOpen && <div className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" aria-hidden="true" onClick={() => setIsOpen(false)} />}
      <aside id="mobile-navigation" aria-label="Mobile navigation" inert={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white p-5 shadow-xl transition-transform md:hidden ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between">
          <Brand />
          <MenuButton label="Close menu" expanded={isOpen} controls="mobile-navigation" onClick={() => setIsOpen(false)} />
        </div>
        <div className="mt-8"><Navigation onNavigate={() => setIsOpen(false)} /></div>
        <Account email={email} />
      </aside>

      {/* Desktop: the ☰ in the sidebar hides it; the ☰ in the corner brings it back. */}
      <aside id="desktop-navigation" aria-label="Sidebar" inert={collapsed}
        className="app-sidebar fixed inset-y-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-5 md:flex">
        <div className="flex items-center justify-between">
          <Brand />
          <MenuButton label="Hide menu" expanded={!collapsed} controls="desktop-navigation" onClick={() => setCollapsed(true)} />
        </div>
        <div className="mt-8"><Navigation /></div>
        <Account email={email} />
      </aside>
      <MenuButton label="Show menu" expanded={!collapsed} controls="desktop-navigation" onClick={() => setCollapsed(false)}
        className="app-sidebar-reopen fixed left-4 top-4 z-30 hidden border border-slate-200 bg-white shadow-sm" />
    </>
  );
}
