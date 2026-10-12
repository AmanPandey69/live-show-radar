import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Show Radar",
  description: "Never miss a show: concert and early-bird alerts for the artists you follow, Bengaluru first, all of India.",
};

const NAV = [
  ["/", "Radar"],
  ["/alerts", "Alerts"],
  ["/artists", "Artists"],
  ["/whispers", "Whispers"],
  ["/health", "Health"],
  ["/components-map", "Components Map"],
  ["/settings", "Settings"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--border)] sticky top-0 z-10 bg-[var(--bg)]/90 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-extrabold tracking-tight text-lg">
              <span className="text-[var(--accent)]">◉</span> Live Show Radar
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm muted">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-white">{label}</Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        <footer className="max-w-6xl mx-auto px-4 py-8 text-xs muted">
          Live Show Radar · Gemini Flash (Google models via OpenRouter, Google infrastructure only) · public read-only view. All times IST.
          Every ticket fact is quoted from a source, labelled inferred, or marked not stated.
        </footer>
      </body>
    </html>
  );
}
