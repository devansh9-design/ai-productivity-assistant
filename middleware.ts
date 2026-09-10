import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login (auth page)
     * - auth/callback (auth callback route)
     * - api/telegram/checkin (server-to-server Telegram webhook)
     */
    "/((?!_next/static|_next/image|favicon.ico|login|auth/callback|api/telegram/checkin).*)",
  ],
};
