import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { ComponentsDiagram } from "@/components/ComponentsDiagram";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-static";

export default function ComponentsMapPage() {
  const md = readFileSync(join(process.cwd(), "docs", "components-map.md"), "utf8")
    .replace(/^# .*\n/, "") // title rendered by PageHeader
    .replace(/```mermaid[\s\S]*?```\n?/, ""); // the page shows the SVG version of the same diagram
  const html = marked.parse(md, { async: false }) as string;
  return (
    <div>
      <PageHeader eyebrow="Deliverable" title={<>Components <i>map</i></>} />
      <div className="rounded-[22px] overflow-hidden border border-[var(--border)]">
        <ComponentsDiagram />
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <span className="chip !bg-[#3d3b36] !text-[#f2efe8] !border-[#6e6a61]">Person</span>
        <span className="chip !bg-[#3a3486] !text-[#ebe8ff] !border-[#6d63d9]">Outside service</span>
        <span className="chip !bg-[#1f4d3c] !text-[#dcf6e9] !border-[#3f9d76]">Our app on Vercel</span>
      </div>
      <div className="prose-doc mt-8 max-w-5xl" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
