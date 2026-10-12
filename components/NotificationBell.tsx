"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Item { id: string; type: string; event_id: string | null; is_demo: boolean; created_at: string; title: string; detail: string }

const ICON: Record<string, string> = {
  NEW_SHOW: "🎤", EARLY_BIRD_OPEN: "🔥", EARLY_BIRD_IMMINENT: "⏰", EARLY_BIRD_CLOSING: "⌛", PRESALE: "💳",
  CHANGED: "✏️", CANCELLED: "❌", POSTPONED: "⏸️", SOLD_OUT: "⛔", UPDATE: "ℹ️", REMINDER: "🔔", DIGEST: "📋",
};
const LABEL: Record<string, string> = {
  NEW_SHOW: "New show", EARLY_BIRD_OPEN: "Early-bird open", EARLY_BIRD_IMMINENT: "Early-bird soon", EARLY_BIRD_CLOSING: "Early-bird closing",
  PRESALE: "Presale", CHANGED: "Changed", CANCELLED: "Cancelled", POSTPONED: "Postponed", SOLD_OUT: "Sold out", UPDATE: "Update",
  REMINDER: "Reminder", DIGEST: "Daily check",
};

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** In-app notifications: every update that isn't worth an email (new shows are emailed). */
export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setSeen(localStorage.getItem("lsr_seen") ?? ""); } catch { /* storage blocked */ }
    const load = () => fetch("/api/notifications").then((r) => r.json()).then((j) => setItems(j.items ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => { clearInterval(t); document.removeEventListener("mousedown", close); };
  }, []);

  const unread = items.filter((i) => !seen || i.created_at > seen).length;
  const toggle = () => {
    setOpen((o) => !o);
    if (items[0]) {
      try { localStorage.setItem("lsr_seen", items[0].created_at); } catch { /* ignore */ }
      setTimeout(() => setSeen(items[0].created_at), 1500);
    }
  };

  return (
    <div ref={box} className="relative">
      <button onClick={toggle} aria-label="Notifications" className="relative w-10 h-10 grid place-items-center rounded-full hover:bg-white/10 transition">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center text-white" style={{ background: "linear-gradient(110deg,#a855f7,#ec4899)" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-3 w-[360px] max-w-[92vw] rounded-2xl border border-white/12 bg-[#120b24]/95 backdrop-blur-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] overflow-hidden z-50 reveal">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="font-semibold">Notifications</div>
            <div className="text-[11px] muted">New shows are also emailed</div>
          </div>
          <div className="max-h-[420px] overflow-y-auto no-scrollbar divide-y divide-white/5">
            {items.length === 0 && <div className="p-6 text-sm muted text-center">No updates yet.</div>}
            {items.map((i) => {
              const body = (
                <div className="flex gap-3 px-4 py-3 hover:bg-white/5 transition">
                  <div className="text-lg leading-none mt-0.5">{ICON[i.type] ?? "•"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-semibold text-[#e9d5ff]">{LABEL[i.type] ?? i.type}</span>
                      {i.is_demo && <span className="chip chip-demo !py-0 !text-[9px]">Sample</span>}
                      <span className="dim ml-auto">{ago(i.created_at)}</span>
                    </div>
                    <div className="text-sm font-medium truncate mt-0.5">{i.title}</div>
                    {i.detail && <div className="text-xs muted line-clamp-2 mt-0.5">{i.detail}</div>}
                  </div>
                </div>
              );
              return i.event_id ? <Link key={i.id} href={`/event/${i.event_id}`} onClick={() => setOpen(false)}>{body}</Link> : <div key={i.id}>{body}</div>;
            })}
          </div>
          <Link href="/alerts" onClick={() => setOpen(false)} className="block text-center text-xs py-2.5 border-t border-white/10 muted hover:text-white">View full history</Link>
        </div>
      )}
    </div>
  );
}
