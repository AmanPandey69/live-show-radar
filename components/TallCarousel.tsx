"use client";
import { useRef } from "react";

/** Horizontal scroll-snap carousel with arrow buttons; children are TallCard links. */
export function TallCarousel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const go = (d: number) => ref.current?.scrollBy({ left: d * 270, behavior: "smooth" });
  return (
    <div className="relative">
      <div ref={ref} className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory pb-2">{children}</div>
      <div className="hidden sm:flex gap-2 absolute -top-14 right-0">
        <button aria-label="Scroll left" onClick={() => go(-1)} className="btn !p-0 w-10 h-10">‹</button>
        <button aria-label="Scroll right" onClick={() => go(1)} className="btn !p-0 w-10 h-10">›</button>
      </div>
    </div>
  );
}
