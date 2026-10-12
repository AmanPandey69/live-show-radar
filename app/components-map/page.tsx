import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { MermaidRender } from "@/components/MermaidRender";

export const dynamic = "force-static";

export default function ComponentsMapPage() {
  const md = readFileSync(join(process.cwd(), "docs", "components-map.md"), "utf8");
  const html = marked.parse(md, { async: false }) as string;
  return (
    <div className="panel p-6">
      <div className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />
      <MermaidRender />
    </div>
  );
}
