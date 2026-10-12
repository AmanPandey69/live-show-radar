import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Syne } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { NotificationBell } from "@/components/NotificationBell";
import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const display = Syne({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Live Show Radar",
  description: "Never miss a show: concert and early-bird alerts for the artists you follow, Bengaluru first, all of India.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <div className="aurora"><span className="a1" /><span className="a2" /><span className="a3" /></div>
        <header className="sticky top-3 z-30 px-3">
          <div className="max-w-6xl mx-auto h-14 px-4 flex items-center gap-6 rounded-full glass shadow-[0_10px_40px_-20px_rgba(124,58,237,.8)]">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <Logo />
              <span className="display font-bold text-[18px] tracking-tight">Live Show <span className="grad-text">Radar</span></span>
            </Link>
            <div className="min-w-0 flex-1 flex justify-end items-center gap-2"><Nav /><NotificationBell /></div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 pt-8 pb-8">{children}</main>
        <footer className="border-t border-[var(--border)] mt-16">
          <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col sm:flex-row justify-between gap-4">
            <div>
              <div className="display text-2xl font-bold">Never learn about a show from <span className="grad-text">someone else&apos;s story.</span></div>
              <div className="text-sm muted mt-1">Bengaluru first · all of India · alerts within minutes</div>
            </div>
            <div className="text-xs dim leading-relaxed sm:text-right">
              Gemini Flash only (Google models via OpenRouter)<br />All times IST · every ticket fact quoted or marked “not stated”
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c3aed" /><stop offset=".6" stopColor="#c026d3" /><stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="10" fill="url(#lg)" />
      <circle cx="16" cy="17" r="9" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" />
      <circle cx="16" cy="17" r="5" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.2" />
      <path d="M16 17 L24 10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="17" r="2" fill="#fff" />
    </svg>
  );
}
