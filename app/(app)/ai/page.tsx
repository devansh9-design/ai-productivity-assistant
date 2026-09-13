import Link from "next/link";
import { AIChat } from "@/components/ai-chat";

export default function AIPage() {
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <Link href="/today" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">← Back to Today</Link>
      <h1 id="page-title" className="mt-4 text-3xl font-bold tracking-tight text-slate-900">AI Assistant</h1>
      <p className="mt-2 text-slate-600">Turn natural-language planning requests into safe, reviewable proposals.</p>
      <AIChat />
    </section>
  );
}
