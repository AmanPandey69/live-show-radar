import { PageHeader } from "@/components/ui";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { effectiveAffinity } from "@/lib/domain/rules";
import { formatIst } from "@/lib/text/dates-ist";
import { coverage } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function ArtistsPage() {
  const repo = getRepo();
  const [artists, aliases, blocks, settings, admin] = await Promise.all([repo.listArtists(), repo.listAliases(), repo.listBlocks(), repo.getSettings(), isAdmin()]);
  const cov = coverage(artists, settings);
  const overdue = cov.filter((c) => c.overdue).length;
  const order = { must_see: 0, like: 1, casual: 2 } as const;
  const sorted = [...artists].sort((a, b) => order[effectiveAffinity(a)] - order[effectiveAffinity(b)] || a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`${artists.length} artists`} title={<>Who we&apos;re <i>watching</i></>}>
        <span>
          Source: {artists.some((a) => a.origin === "spotify") ? "Spotify (synced daily)" : "seed list (Spotify not connected)"}.
          Coverage target: must-see every {settings.coverage_hours.must_see}h, others every {settings.coverage_hours.default}h by the grounded scout; {overdue} currently overdue.
          Listing/news sources are checked every 5 minutes for all artists.
        </span>
      </PageHeader>
      <div className="panel overflow-x-auto">
        <table className="t">
          <thead><tr><th>Artist</th><th>Affinity</th><th>Aliases / blocks</th><th>Last checked</th><th>Last deep (scout)</th>{admin && <th>Actions</th>}</tr></thead>
          <tbody>
            {sorted.map((a) => {
              const c = cov.find((x) => x.artist.id === a.id);
              const aff = effectiveAffinity(a);
              return (
                <tr key={a.id} className={a.enabled ? "" : "opacity-50"}>
                  <td><b>{a.name}</b><div className="text-xs muted">{a.is_international ? "International" : "Indian"} · {a.genres.slice(0, 2).join(", ")} · {a.origin}</div></td>
                  <td><span className={`chip ${aff === "must_see" ? "chip-accent" : aff === "like" ? "chip-ok" : ""}`}>{aff === "must_see" ? "★ must-see" : aff}</span>{a.affinity_override && <div className="text-xs muted">manual</div>}</td>
                  <td className="text-xs muted">
                    {aliases.filter((x) => x.artist_id === a.id && x.alias !== a.name).map((x) => x.alias).join(", ") || "n/a"}
                    {blocks.some((b) => b.artist_id === a.id) && <div>blocks: {blocks.filter((b) => b.artist_id === a.id).map((b) => b.pattern).join(", ")}</div>}
                  </td>
                  <td className="text-xs">{a.last_checked_at ? formatIst(a.last_checked_at) : "n/a"}</td>
                  <td className="text-xs">{a.last_deep_checked_at ? formatIst(a.last_deep_checked_at) : "never"} {c?.overdue && <span className="chip chip-warn">due</span>}</td>
                  {admin && (
                    <td>
                      <form action="/api/admin/artists" method="post" className="flex gap-1">
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn !py-1 !px-2.5 !text-xs" name="action" value="must_see">★</button>
                        <button className="btn !py-1 !px-2.5 !text-xs" name="action" value="like">like</button>
                        <button className="btn !py-1 !px-2.5 !text-xs" name="action" value="casual">casual</button>
                        <button className="btn !py-1 !px-2.5 !text-xs" name="action" value="toggle">{a.enabled ? "off" : "on"}</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
