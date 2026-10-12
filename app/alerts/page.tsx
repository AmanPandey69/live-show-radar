import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { getRepo } from "@/lib/db";
import { formatIst } from "@/lib/text/dates-ist";
import { fmtMins, latencyStats } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const repo = getRepo();
  const alerts = await repo.listAlerts({ limit: 200 });
  const deliveries = await repo.listDeliveries(alerts.map((a) => a.id));
  const lat = latencyStats(alerts);
  const visible = alerts.filter((a) => !(a.payload as { bundled_into?: string }).bundled_into);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Detection-latency ledger" title={<>Alert <i>history</i></>}>
        <span>
          Detection latency (first public sign → alert sent, real alerts only): median <b>{fmtMins(lat.median)}</b>, p90 <b>{fmtMins(lat.p90)}</b> over {lat.n} alerts.
          The first public sign is the source&apos;s publish time when given; otherwise our first sighting.
        </span>
      </PageHeader>
      <div className="panel overflow-x-auto">
        <table className="t">
          <thead><tr><th>Created (IST)</th><th>Type</th><th>Pri</th><th>Alert</th><th>Latency</th><th>Channels</th></tr></thead>
          <tbody>
            {visible.map((a) => {
              const sign = a.first_public_at ?? a.first_seen_at;
              const latency = a.sent_at && sign ? (Date.parse(a.sent_at) - Date.parse(sign)) / 60000 : null;
              const ds = deliveries.filter((d) => d.alert_id === a.id);
              return (
                <tr key={a.id}>
                  <td className="text-xs whitespace-nowrap">{formatIst(a.created_at)}</td>
                  <td>{a.is_demo && <span className="chip chip-demo mr-1">Demo</span>}<span className="chip">{a.type.replace(/_/g, " ")}</span></td>
                  <td>{a.priority}{a.held_for_quiet ? " (held)" : ""}</td>
                  <td className="text-xs max-w-md">
                    {a.event_id ? <Link className="underline" href={`/event/${a.event_id}`}>{((a.payload as { title?: string }).title ?? a.text.split("\n")[0])}</Link> : a.text.split("\n")[0]}
                  </td>
                  <td className="text-xs">{latency == null || latency < 0 ? "n/a" : fmtMins(latency)}</td>
                  <td className="text-xs">{[...new Set(ds.map((d) => `${d.channel}:${d.status}`))].join(", ") || "n/a"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="muted text-sm p-4">No alerts yet.</p>}
      </div>
    </div>
  );
}
