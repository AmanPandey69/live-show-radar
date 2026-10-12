import Link from "next/link";
import { Poster } from "./Poster";

export interface RingItem { id: string; image: string | null; artist: string; city: string; date: string }

/** 3D revolving ring of posters (pure CSS, pauses on hover). */
export function PosterRing({ items }: { items: RingItem[] }) {
  const list = items.slice(0, 12);
  if (list.length < 3) return null;
  const n = list.length;
  const radius = Math.round(115 / Math.tan(Math.PI / n)) + 30;
  return (
    <div className="ring-stage">
      <div className="ring">
        {list.map((it, k) => (
          <Link
            key={it.id}
            href={`/event/${it.id}`}
            className="ring-item"
            style={{ transform: `rotateY(${(360 / n) * k}deg) translateZ(${radius}px)` }}
          >
            <Poster src={it.image} name={it.artist} className="w-full h-full object-cover" fontSize={26} />
            <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
              <div className="display font-bold text-[15px] leading-tight truncate">{it.artist}</div>
              <div className="text-[11px] text-white/70">{it.city} · {it.date}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
