/* eslint-disable @next/next/no-img-element */
const GRADS = [
  "linear-gradient(135deg,#7c3aed,#ec4899)",
  "linear-gradient(135deg,#2563eb,#a855f7)",
  "linear-gradient(135deg,#db2777,#f97316)",
  "linear-gradient(135deg,#0ea5e9,#8b5cf6)",
  "linear-gradient(135deg,#9333ea,#3b82f6)",
  "linear-gradient(135deg,#c026d3,#6366f1)",
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Real poster from the ticketing source, or a generated gradient poster with the artist name. */
export function Poster({ src, name, className = "", fontSize = 34 }: { src: string | null; name: string; className?: string; fontSize?: number }) {
  if (src) {
    return <img src={src} alt={name} className={className} loading="lazy" referrerPolicy="no-referrer" />;
  }
  return (
    <div className={`gen-poster ${className}`} style={{ background: GRADS[hash(name) % GRADS.length] }}>
      <div className="gp-word" style={{ fontSize }}>{name}</div>
    </div>
  );
}
