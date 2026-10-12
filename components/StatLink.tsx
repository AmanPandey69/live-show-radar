"use client";
import Link from "next/link";
import { CountUp } from "./CountUp";

/** Clickable hero stat: jumps to the show browser with the right city/tab, or links to a page. */
export function StatLink({ v, l, city, tab, href }: { v: number; l: string; city?: string; tab?: "all" | "act"; href?: string }) {
  const inner = (
    <>
      <div className="v !text-[32px] flex items-baseline justify-between gap-2">
        <CountUp to={v} />
        <span className="text-base text-white/40 group-hover:text-white group-hover:translate-x-1 transition">→</span>
      </div>
      <div className="l">{l}</div>
    </>
  );
  const cls = "stat !py-3.5 group block text-left cursor-pointer transition hover:border-[#c084fc]/60 hover:bg-white/[.09] hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-18px_rgba(168,85,247,.9)]";
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        window.dispatchEvent(new CustomEvent("lsr:filter", { detail: { city, tab } }));
        document.getElementById("shows")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {inner}
    </button>
  );
}
