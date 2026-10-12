"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/", "Radar"],
  ["/alerts", "Alerts"],
  ["/artists", "Artists"],
  ["/whispers", "Whispers"],
  ["/health", "Health"],
  ["/components-map", "Map"],
  ["/settings", "Settings"],
] as const;

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/event") : path.startsWith(href));
  return (
    <nav className="flex gap-5 overflow-x-auto no-scrollbar text-[13.5px]">
      {NAV.map(([href, label]) => (
        <Link key={href} href={href} className={`whitespace-nowrap py-1 border-b-2 transition ${active(href) ? "border-[var(--ink)] text-[var(--text)] font-medium" : "border-transparent muted hover:text-[var(--text)]"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
