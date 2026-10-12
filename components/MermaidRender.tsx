"use client";
import { useEffect } from "react";

/** Turns ```mermaid code blocks (rendered by marked as <code class="language-mermaid">) into diagrams. */
export function MermaidRender() {
  useEffect(() => {
    const blocks = Array.from(document.querySelectorAll("code.language-mermaid"));
    if (!blocks.length) return;
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
    s.onload = () => {
      const m = (window as unknown as { mermaid: { initialize: (o: object) => void; run: (o: object) => void } }).mermaid;
      for (const b of blocks) {
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = b.textContent ?? "";
        b.parentElement?.replaceWith(div);
      }
      m.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
      m.run({ querySelector: ".mermaid" });
    };
    document.body.appendChild(s);
  }, []);
  return null;
}
