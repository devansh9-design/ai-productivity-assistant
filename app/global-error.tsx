"use client";

/**
 * Last-resort screen when the root layout itself fails. It replaces the whole
 * document, so it brings its own <html> and plain inline styles.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", margin: 0, padding: "48px 16px" }}>
        <div role="alert" style={{ maxWidth: 480, margin: "0 auto", background: "#fff", border: "1px solid #fecdd3", borderRadius: 16, padding: 24 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>The app couldn&apos;t load</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>Something went wrong. Your saved data is unaffected.</p>
          {error.digest && <p style={{ fontSize: 12, color: "#64748b" }}>Reference: <code>{error.digest}</code></p>}
          <button type="button" onClick={reset}
            style={{ background: "#4f46e5", color: "#fff", border: 0, borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
