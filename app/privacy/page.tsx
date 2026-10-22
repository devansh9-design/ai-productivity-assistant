import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = { title: "Privacy · Personal Assistant" };

const UPDATED = "23 October 2026";

/** Public, plain-language privacy page; readable signed in or out. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-sm font-semibold text-indigo-600">Personal Assistant</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Privacy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-6 text-slate-700">
        <Section title="What we store">
          <p>Only what you enter or what the app works out from it:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>your email, name, college year and timezone</li>
            <li>your timetable, free time and planning preferences</li>
            <li>your goals, roadmaps, routines, tasks and daily plans</li>
            <li>your morning check-ins, evening logs, numbers you track and weekly reviews</li>
            <li>your AI chat history and the AI&apos;s feedback</li>
          </ul>
          <p className="mt-2">We don&apos;t use ads or trackers, and we never sell or share your data.</p>
        </Section>

        <Section title="Where it lives">
          <p>
            Your data is stored in a Supabase database in Mumbai, India, and the app runs on Vercel. Each account can only ever read its own data; the database enforces this for every table.
          </p>
        </Section>

        <Section title="AI features">
          <p>
            When you use an AI feature (building a roadmap, the AI chat, daily feedback or the weekly review), the parts of your data that feature needs are sent to Google&apos;s Gemini API to write the answer. The app uses Gemini&apos;s free tier, where Google may use what is sent to improve its products and people at Google may review it. So don&apos;t put anything in a goal, task or log that you wouldn&apos;t want anyone else to read. Everything else in the app works without AI.
          </p>
        </Section>

        <Section title="Google Calendar (optional)">
          <p>
            Connecting Google Calendar lets the app read your events so plans avoid them, and add your planned blocks to your calendar. Access tokens are kept on the server and are never shown in the app or included in exports. You can disconnect in Settings at any time, which also revokes the app&apos;s access at Google.
          </p>
        </Section>

        <Section title="Your choices">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Download:</strong> Settings → Your data saves everything as one file.</li>
            <li><strong>Delete:</strong> Settings → Delete account removes your account and all of its data straight away. It can&apos;t be undone.</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-indigo-700 hover:text-indigo-900">{CONTACT_EMAIL}</a>.
          </p>
        </Section>
      </div>

      <p className="mt-10 text-sm">
        <Link href="/today" className="font-medium text-indigo-700 hover:text-indigo-900">← Back to the app</Link>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
