import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const serif = Instrument_Serif({ subsets: ["latin"], variable: "--font-serif", weight: "400", style: ["normal", "italic"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Live Show Radar",
  description: "Never miss a show: concert and early-bird alerts for the artists you follow, Bengaluru first, all of India.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="sticky top-3 z-20 px-3">
          <div className="max-w-6xl mx-auto h-14 px-4 flex items-center gap-6 rounded-full bg-white/90 backdrop-blur-xl border border-[var(--border)] shadow-[0_8px_30px_-18px_rgba(40,30,10,.35)]">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <Logo />
              <span className="serif text-[21px] leading-none">Live Show <i>Radar</i></span>
              <span className="mono text-[9.5px] tracking-[.18em] uppercase dim hidden md:inline">Bengaluru</span>
            </Link>
            <div className="min-w-0 flex-1 flex justify-end"><Nav /></div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 pt-10 pb-8">{children}</main>
        <footer className="border-t border-[var(--border)] mt-10">
          <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row justify-between gap-3">
            <div className="serif italic text-xl">Never learn about a show from someone else&apos;s story.</div>
            <div className="mono text-[10.5px] tracking-[.08em] uppercase dim leading-relaxed sm:text-right">
              Gemini Flash only · Google models via OpenRouter<br />All times IST · every ticket fact quoted or marked “not stated”
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#17140f" />
      <circle cx="16" cy="17" r="9" fill="none" stroke="#f4f0e8" strokeOpacity=".35" strokeWidth="1.2" />
      <circle cx="16" cy="17" r="5" fill="none" stroke="#f4f0e8" strokeOpacity=".6" strokeWidth="1.2" />
      <path d="M16 17 L24 10" stroke="#d1452b" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="17" r="2" fill="#d1452b" />
    </svg>
  );
}
