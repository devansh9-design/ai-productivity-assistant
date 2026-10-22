"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Tells the user when the browser goes offline, because saves and AI
 * requests will fail until it reconnects. On reconnecting it refreshes the
 * page's server data, which may have changed elsewhere, and briefly says so.
 */
export function ConnectionStatus() {
  const router = useRouter();
  const [state, setState] = useState<"online" | "offline" | "reconnected">("online");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!navigator.onLine) setState("offline");
    const goOffline = () => { clearTimeout(timer); setState("offline"); };
    const goOnline = () => {
      setState("reconnected");
      router.refresh();
      timer = setTimeout(() => setState("online"), 4000);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [router]);

  if (state === "online") return null;
  return (
    <div role="status" aria-live="polite"
      className={`fixed inset-x-0 bottom-0 z-50 px-4 py-3 text-center text-sm font-medium app-beside-sidebar md:left-64 ${state === "offline" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
      {state === "offline"
        ? "You're offline. Changes and AI requests won't go through until your connection is back."
        : "Back online. The page has been refreshed."}
    </div>
  );
}
