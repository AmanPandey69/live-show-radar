/**
 * Simple components map (12 boxes). Grey = people, purple = outside services, green = our app on Vercel.
 * Hand-drawn SVG so it renders identically everywhere (no Mermaid layout surprises).
 */
type Kind = "person" | "ext" | "app";
const W = 320, H = 96;
const X = [70, 440, 810];
const Y = { top: 40, a: 236, b: 380, bottom: 576 };
const COLORS: Record<Kind, { fill: string; stroke: string; title: string; sub: string }> = {
  person: { fill: "#3d3b36", stroke: "#6e6a61", title: "#f2efe8", sub: "#c9c4b8" },
  ext: { fill: "#3a3486", stroke: "#6d63d9", title: "#ebe8ff", sub: "#b9b1ff" },
  app: { fill: "#1f4d3c", stroke: "#3f9d76", title: "#dcf6e9", sub: "#8fd9b5" },
};

function Box({ x, y, kind, title, sub }: { x: number; y: number; kind: Kind; title: string; sub: string }) {
  const c = COLORS[kind];
  return (
    <g>
      <rect x={x} y={y} width={W} height={H} rx={8} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} />
      <text x={x + W / 2} y={y + 42} textAnchor="middle" fill={c.title} fontSize={27} fontWeight={600} fontFamily="Inter, system-ui, sans-serif">{title}</text>
      <text x={x + W / 2} y={y + 74} textAnchor="middle" fill={c.sub} fontSize={19} fontFamily="Inter, system-ui, sans-serif">{sub}</text>
    </g>
  );
}

const mid = (i: number) => X[i] + W / 2;

export function ComponentsDiagram() {
  const line = { stroke: "#9a978f", strokeWidth: 2, fill: "none", markerEnd: "url(#arrow)" } as const;
  return (
    <svg viewBox="0 0 1200 720" className="w-full h-auto" role="img" aria-label="Live Show Radar components map">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#9a978f" strokeWidth="1.6" />
        </marker>
      </defs>
      <rect x="0" y="0" width="1200" height="720" rx="18" fill="#161616" />

      {/* Our app boundary */}
      <rect x="40" y="180" width="1120" height="318" rx="14" fill="none" stroke="#4a4a4a" strokeDasharray="7 7" />
      <text x="250" y="216" fill="#d6d3cb" fontSize={21} fontFamily="Inter, system-ui, sans-serif">Live Show Radar app on Vercel</text>

      {/* Row: inputs */}
      <Box x={X[0]} y={Y.top} kind="ext" title="Spotify" sub="Karan's followed artists" />
      <Box x={X[1]} y={Y.top} kind="ext" title="Schedulers" sub="Every 5 / 30 min + daily" />
      <Box x={X[2]} y={Y.top} kind="ext" title="Ticket & news sites" sub="District, SkillBox, news" />

      {/* App row A (right → left, like the data flows) */}
      <Box x={X[0]} y={Y.a} kind="app" title="Rules engine" sub="Truth check, dedupe, priority" />
      <Box x={X[1]} y={Y.a} kind="app" title="Gemini Flash" sub="Search, extract, verify" />
      <Box x={X[2]} y={Y.a} kind="app" title="Scan API" sub="Fetch, skip unchanged" />

      {/* App row B */}
      <Box x={X[0]} y={Y.b} kind="app" title="Neon database" sub="Artists, shows, alerts" />
      <Box x={X[1]} y={Y.b} kind="app" title="Alert engine" sub="Once per fact, reminders" />
      <Box x={X[2]} y={Y.b} kind="app" title="Dashboard" sub="Radar, health, map" />

      {/* Row: outputs */}
      <Box x={X[0]} y={Y.bottom} kind="ext" title="Telegram" sub="Alerts, buttons, share" />
      <Box x={X[1]} y={Y.bottom} kind="ext" title="Resend email" sub="Backup channel" />
      <Box x={X[2]} y={Y.bottom} kind="person" title="Karan" sub="Buys tickets, feedback" />

      {/* Arrows */}
      <path d={`M ${mid(0)} ${Y.top + H} V ${Y.a - 2}`} {...line} />
      <path d={`M ${mid(1)} ${Y.top + H} V 162 H ${mid(2) - 60} V ${Y.a - 2}`} {...line} />
      <path d={`M ${mid(2) + 40} ${Y.top + H} V ${Y.a - 2}`} {...line} />
      <path d={`M ${X[2]} ${Y.a + H / 2} H ${X[1] + W + 2}`} {...line} />
      <path d={`M ${X[1]} ${Y.a + H / 2} H ${X[0] + W + 2}`} {...line} />
      <path d={`M ${mid(0)} ${Y.a + H} V ${Y.b - 2}`} {...line} />
      <path d={`M ${X[0] + W} ${Y.b + H / 2} H ${X[1] - 2}`} {...line} />
      <path d={`M ${X[1] + W} ${Y.b + H / 2} H ${X[2] - 2}`} {...line} />
      <path d={`M ${mid(1) - 40} ${Y.b + H} V 530 H ${mid(0)} V ${Y.bottom - 2}`} {...line} />
      <path d={`M ${mid(1) + 40} ${Y.b + H} V ${Y.bottom - 2}`} {...line} />
      <path d={`M ${X[1] + W} ${Y.bottom + H / 2} H ${X[2] - 2}`} {...line} />
      <path d={`M ${mid(2)} ${Y.bottom} V ${Y.b + H + 2}`} {...line} />
      <path d={`M ${mid(0)} ${Y.bottom + H} V 700 H ${mid(2)} V ${Y.bottom + H + 2}`} {...line} />
    </svg>
  );
}
