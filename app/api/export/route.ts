import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { buildUserDataExport } from "@/lib/export/data";
import { errorFields, log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloads all of the signed-in user's data as one JSON file. */
export async function GET() {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await buildUserDataExport(auth.supabase, auth.user);
    const rowCount = Object.values(data.tables).reduce((total, rows) => total + rows.length, 0);
    log("info", "export.created", { userId: auth.user.id, rowCount });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="productivity-export-${data.exported_at.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log("error", "export.failed", { userId: auth.user.id, ...errorFields(error) });
    return NextResponse.json({ error: "Your data could not be exported. Please try again." }, { status: 500 });
  }
}
