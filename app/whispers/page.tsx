import { getRepo } from "@/lib/db";
import { formatIst } from "@/lib/text/dates-ist";

export const dynamic = "force-dynamic";

export default async function WhispersPage() {
  const repo = getRepo();
  const [whispers, artists, settings] = await Promise.all([repo.listWhispers(100), repo.listArtists(), repo.getSettings()]);
  return (
    <div className="space-y-4">
      <div className="panel p-5">
        <h1 className="text-2xl font-extrabold">Whispers <span className="chip chip-warn align-middle">SIGNAL, not an announcement</span></h1>
        <p className="muted text-sm mt-1">
          Opt-in pre-announcement signals: nearby Asia/Middle-East dates, promoter teasers, &quot;India dates soon&quot;, &quot;notify me&quot; pages.
          Never urgent, never pushed. Precision first: only signals with confidence ≥ {settings.whisper_min_confidence} and a verbatim quote are kept.
          Feed is {settings.whispers_enabled ? "ON" : "OFF"}.
        </p>
      </div>
      {whispers.length === 0 && <p className="muted text-sm">No signals right now. Better nothing than crying wolf.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {whispers.map((w) => (
          <div key={w.id} className="panel p-4 unconfirmed">
            <div className="flex gap-2 mb-1"><span className="chip chip-warn">SIGNAL · {w.kind.replace("_", " ")}</span>{w.is_demo && <span className="chip chip-demo">SAMPLE</span>}<span className="chip">{Math.round(w.confidence * 100)}%</span></div>
            <div className="font-bold">{artists.find((a) => a.id === w.artist_id)?.name ?? "?"}</div>
            <div className="text-sm">{w.summary}{w.region ? ` (${w.region})` : ""}</div>
            <blockquote className="text-xs muted border-l-2 border-[var(--border)] pl-2 mt-2">“{w.snippet}”</blockquote>
            <div className="text-xs muted mt-2"><a className="underline break-all" href={w.url} target="_blank" rel="noreferrer">{w.url}</a> · {formatIst(w.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
