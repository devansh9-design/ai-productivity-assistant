import { AssistantChat } from "@/components/assistant-chat";

export default function AssistantPage() {
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">AI</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Assistant</h1>
      <p className="mt-2 text-slate-600">A conversational layer over your tasks, plans, goals, reflections, and calendar availability.</p>
      <AssistantChat />
    </section>
  );
}
