import { PageHeader } from "@/components/ui";
import { getRepo } from "@/lib/db";
import { STATIC_SOURCES } from "@/lib/sources/registry";
import { formatIst } from "@/lib/text/dates-ist";
import { coverage, fmtMins, geminiBudget, latencyStats } from "@/lib/view";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = { ok: "chip-ok", degraded: "chip-warn", blocked: "chip-bad", disabled: "", no_data: "chip-warn", no_grounding: "chip-warn" };

export default async function HealthPage() {
  const repo = getRepo();
  const [health, runs, alerts, artists, settings, budget, hb] = await Promise.all([
    repo.listHealth(), repo.listRuns(15), repo.listAlerts({ limit: 500 }), repo.listArtists(), repo.getSettings(), geminiBudget(), repo.getKv<{ at: string; lane: string }>("heartbeat"),
  ]);
  const lat = latencyStats(alerts);
  const cov = coverage(artists, settings);
  const firstBy = new Map<string, number>();
  const events = await repo.listEvents({ includeDemo: false });
  for (const e of events) if (e.first_source_id) firstBy.set(e.first_source_id, (firstBy.get(e.first_source_id) ?? 0) + 1);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = runs.filter((r) => r.started_at >= since);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Trust dashboard" title={<>What we <i>checked</i></>}>
        Silence is information: when nothing is alerted, these numbers show what was checked.
      </PageHeader>
      <div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Stat label="Last heartbeat" value={hb ? formatIst(hb.at) : "never"} sub={hb ? `lane: ${hb.lane}` : ""} />
          <Stat label="Scans (24h)" value={String(recent.length)} sub={`${recent.filter((r) => r.status === "ok").length} ok`} />
          <Stat label="Detection latency" value={`median ${fmtMins(lat.median)}`} sub={`p90 ${fmtMins(lat.p90)} · n=${lat.n} · target <10 min`} />
          <Stat label="Gemini today (IST)" value={`${budget.calls}/${budget.callBudget} calls`} sub={`${budget.grounded}/${budget.groundedBudget} grounded · ${budget.model}${budget.enabled ? "" : " · AI off (fallback parsing)"}`} />
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase px-5 py-3.5 border-b border-[var(--border)]">Sources</h2>
        <table className="t">
          <thead><tr><th>Source</th><th>Status</th><th>Last run</th><th>Last OK</th><th>Items</th><th>First to report</th><th>Note</th></tr></thead>
          <tbody>
            {STATIC_SOURCES.map((s) => {
              const h = health.find((x) => x.source_id === s.id);
              const status = h?.status ?? (s.enabled ? "pending" : (s.config.status as string) ?? "disabled");
              return (
                <tr key={s.id}>
                  <td><b>{s.name}</b><div className="text-xs muted">{s.kind}{s.is_primary ? " · primary" : ""}</div></td>
                  <td><span className={`chip ${STATUS_CLS[status] ?? ""}`}>{status}</span></td>
                  <td className="text-xs">{h?.last_run_at ? formatIst(h.last_run_at) : "n/a"}</td>
                  <td className="text-xs">{h?.last_ok_at ? formatIst(h.last_ok_at) : "n/a"}</td>
                  <td>{h?.items_last_run ?? 0}</td>
                  <td>{firstBy.get(s.id) ?? 0}</td>
                  <td className="text-xs muted max-w-xs">{h?.last_error ?? ""}{h?.degraded_until ? ` (retry after ${formatIst(h.degraded_until)})` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel p-5">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase mb-2">Coverage</h2>
        <p className="text-sm">
          {cov.length} enabled artists · {cov.filter((c) => !c.overdue).length} within their deep-scan window · {cov.filter((c) => c.overdue).length} due now
          (must-see every {settings.coverage_hours.must_see}h, others every {settings.coverage_hours.default}h; scout runs every 30 min within the grounded budget).
        </p>
      </div>

      <div className="panel overflow-x-auto">
        <h2 className="mono !text-[11px] tracking-[.14em] uppercase px-5 py-3.5 border-b border-[var(--border)]">Recent scan runs</h2>
        <table className="t">
          <thead><tr><th>Started</th><th>Lane</th><th>Status</th><th>Summary</th></tr></thead>
          <tbody>
            {runs.map((r) => {
              const st = r.stats as Record<string, unknown>;
              return (
                <tr key={r.id}>
                  <td className="text-xs">{formatIst(r.started_at)}</td>
                  <td>{r.lane}</td>
                  <td><span className={`chip ${r.status === "ok" ? "chip-ok" : r.status === "error" ? "chip-bad" : "chip-warn"}`}>{r.status}</span></td>
                  <td className="text-xs muted">
                    {st.observations != null ? `${st.observations} obs · ${st.newEvents ?? 0} new events · ${st.alerts ?? 0} alerts · ${st.fallbacks ?? 0} AI fallbacks` : ""}
                    {st.adapters ? <div>{Object.entries(st.adapters as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div> : null}
                    {r.error}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-5">
      <div className="mono text-[10.5px] tracking-[.12em] uppercase dim">{label}</div>
      <div className="display font-bold text-[24px] leading-tight mt-1.5">{value}</div>
      {sub && <div className="text-xs muted mt-1">{sub}</div>}
    </div>
  );
}
