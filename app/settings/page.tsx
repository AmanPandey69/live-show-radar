import { isAdmin } from "@/lib/auth/admin";
import { env, hasDb, hasEmail, hasGemini, hasSpotify, hasTelegram } from "@/lib/config/env";
import { getRepo } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const admin = await isAdmin();
  if (!admin) {
    return (
      <div className="panel p-8 max-w-md mx-auto mt-6">
        <h1 className="text-5xl mb-3">Welcome <i>back.</i></h1>
        <p className="text-sm muted mb-4">Settings, Scan now and Simulate are owner-only. The radar itself is public and read-only.</p>
        <form action="/api/admin/login" method="post" className="flex gap-2">
          <input type="password" name="password" placeholder="ADMIN_PASSWORD" required className="flex-1" />
          <button className="btn btn-primary">Log in</button>
        </form>
        {sp.err && <p className="text-sm text-[var(--bad)] mt-2">Wrong password.</p>}
      </div>
    );
  }
  const repo = getRepo();
  const [s, artists, tokens] = await Promise.all([repo.getSettings(), repo.listArtists(), repo.getSpotifyTokens()]);
  const e = env();
  const base = e.APP_BASE_URL.replace(/\/$/, "");
  const Flag = ({ ok, label }: { ok: boolean; label: string }) => <span className={`chip ${ok ? "chip-ok" : "chip-warn"}`}>{ok ? "✓" : "✗"} {label}</span>;

  return (
    <div className="space-y-4">
      {sp.msg && <div className="panel p-3 text-sm">{sp.msg}</div>}
      <div className="panel p-5">
        <div className="flex justify-between items-start">
          <h1 className="text-5xl">Settings</h1>
          <form action="/api/admin/logout" method="post"><button className="btn">Log out</button></form>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Flag ok={hasDb()} label="Neon DB" /><Flag ok={hasGemini()} label={`AI (${e.GEMINI_MODEL})`} /><Flag ok={hasTelegram()} label="Telegram" />
          <Flag ok={hasEmail()} label="Email (Resend)" /><Flag ok={hasSpotify()} label="Spotify app" /><Flag ok={!!tokens} label="Spotify connected" />
        </div>
      </div>

      <div className="panel p-5 space-y-3">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <form action="/api/admin/scan" method="post"><input type="hidden" name="lane" value="fast" /><button className="btn btn-primary">Scan now (listings + news)</button></form>
          <form action="/api/admin/scan" method="post"><input type="hidden" name="lane" value="deep" /><button className="btn">Deep scan (Gemini grounded scout)</button></form>
          <form action="/api/admin/simulate" method="post" className="flex gap-2">
            <select name="artist">{artists.map((a) => <option key={a.id}>{a.name}</option>)}</select>
            <button className="btn">Simulate announcement [DEMO]</button>
          </form>
          <form action="/api/admin/seed" method="post"><button className="btn">Re-seed artists + demo</button></form>
          <form action="/api/admin/telegram" method="post"><button className="btn">Connect Telegram webhook + test</button></form>
          <a className="btn" href="/api/spotify/login">Connect Spotify (owner)</a>
        </div>
        <p className="text-xs muted">Simulate injects a clearly-labelled demo event (Bengaluru, early-bird open) and runs the real pipeline end to end; the message is labelled [DEMO].</p>
      </div>

      <div className="panel p-5">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase mb-3">Alerts & rules</h2>
        <form action="/api/admin/settings" method="post" className="grid sm:grid-cols-2 gap-3 text-sm">
          <label className="flex gap-2 items-center"><input type="checkbox" name="ch_telegram" defaultChecked={s.channels.telegram} /> Telegram (primary)</label>
          <label className="flex gap-2 items-center"><input type="checkbox" name="ch_email" defaultChecked={s.channels.email} /> Email (secondary / fallback)</label>
          <label className="flex gap-2 items-center"><input type="checkbox" name="quiet_enabled" defaultChecked={s.quiet_hours.enabled} /> Quiet hours for P2 (P0/P1 always send)</label>
          <div className="flex gap-2 items-center">from <input name="quiet_start" defaultValue={s.quiet_hours.start} className="w-20" /> to <input name="quiet_end" defaultValue={s.quiet_hours.end} className="w-20" /> IST</div>
          <label className="flex gap-2 items-center"><input type="checkbox" name="whispers" defaultChecked={s.whispers_enabled} /> Whispers feed (opt-in signals)</label>
          <div className="flex gap-2 items-center">Coverage: must-see every <input name="cov_must" defaultValue={s.coverage_hours.must_see} className="w-14" />h, others <input name="cov_default" defaultValue={s.coverage_hours.default} className="w-14" />h</div>
          <div className="muted">Home city: <b>{e.HOME_CITY}</b> (env HOME_CITY). Priority: P0 = home city AND (early-bird open/imminent OR must-see); P1 = other-city early-bird or any home-city show; P2 = rest.</div>
          <div className="muted">Confidence threshold (feedback-tuned): {s.confirm_threshold}</div>
          <div><button className="btn btn-primary">Save</button></div>
        </form>
      </div>

      <div className="panel p-5">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase mb-2">Add artists without Spotify</h2>
        <form action="/api/admin/import" method="post" encType="multipart/form-data" className="space-y-2">
          <textarea name="text" rows={4} className="w-full" placeholder={"One per line: artist name, or a Spotify artist URL (https://open.spotify.com/artist/...)"} />
          <div className="flex gap-2 items-center text-sm"><input type="file" name="file" accept=".csv,.txt,.json" /> <span className="muted">CSV (first column = name) or Spotify data export</span></div>
          <button className="btn">Import</button>
        </form>
      </div>

      <div className="panel p-5 text-sm space-y-1">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase mb-2">Integration URLs</h2>
        <div>Spotify redirect URI: <code>{base}/api/spotify/callback</code></div>
        <div>Telegram webhook: <code>{base}/api/telegram/webhook</code> (secret header required; use the button above)</div>
        <div>Fast lane: <code>POST {base}/api/cron/scan?lane=fast</code> · Deep lane: <code>POST {base}/api/cron/scan?lane=deep</code> (Bearer CRON_SECRET)</div>
        <div>Daily (Vercel Cron): <code>{base}/api/cron/daily</code> · Health: <code>{base}/api/health</code></div>
      </div>
    </div>
  );
}
