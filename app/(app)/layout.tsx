import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <div className="min-h-screen bg-slate-50"><AppSidebar email={user.email ?? "Signed in"} /><main className="px-4 py-8 md:ml-64 md:px-8 md:py-10">{children}</main></div>;
}
