"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { href: "/today", label: "Today" },
  { href: "/assistant", label: "Assistant" },
  { href: "/tasks", label: "Tasks" },
  { href: "/goals", label: "Goals" },
  { href: "/projects", label: "Projects" },
  { href: "/milestones", label: "Milestones" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {navigation.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`block rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`}>
            {item.label}
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
  return <button type="button" onClick={signOut} disabled={isSigningOut} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">{isSigningOut ? "Signing out…" : "Sign out"}</button>;
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
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="font-bold text-slate-900">Personal Assistant</span>
        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" aria-label="Open navigation" aria-expanded={isOpen} aria-controls="mobile-navigation" onClick={() => setIsOpen(true)}>Menu</button>
      </header>
      {isOpen && <div className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" aria-hidden="true" onClick={() => setIsOpen(false)} />}
      <aside id="mobile-navigation" aria-label="Mobile navigation" className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-white p-5 shadow-xl transition-transform md:hidden ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between"><span className="font-bold">Personal Assistant</span><button type="button" onClick={() => setIsOpen(false)} className="rounded-lg px-2 py-1 text-sm font-medium hover:bg-slate-100" aria-label="Close navigation">Close</button></div>
        <div className="mt-8"><Navigation onNavigate={() => setIsOpen(false)} /></div>
        <div className="mt-auto border-t border-slate-200 pt-4"><p className="mb-3 truncate text-sm text-slate-600">{email}</p><SignOutButton /></div>
      </aside>
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-5 md:flex">
        <div><p className="text-sm font-semibold text-indigo-600">PERSONAL</p><p className="mt-1 text-lg font-bold text-slate-900">Assistant</p></div>
        <div className="mt-8"><Navigation /></div>
        <div className="mt-auto border-t border-slate-200 pt-4"><p className="mb-3 truncate text-sm text-slate-600">{email}</p><SignOutButton /></div>
      </aside>
    </>
  );
}
