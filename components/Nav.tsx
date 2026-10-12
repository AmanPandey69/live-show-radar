"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/", "Radar"],
  ["/alerts", "Alerts"],
  ["/artists", "Artists"],
  ["/whispers", "Whispers"],
] as const;

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/event") : path.startsWith(href));
  return (
    <nav className="flex gap-1 overflow-x-auto no-scrollbar text-[13.5px]">
      {NAV.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className={`whitespace-nowrap px-3.5 py-1.5 rounded-full transition ${active(href) ? "bg-white/12 text-white font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,.15)]" : "muted hover:text-white hover:bg-white/5"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
