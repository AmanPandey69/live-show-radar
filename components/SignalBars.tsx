/** Waveform-style meter: urgency 0–100 rendered as signal bars (filled bars in ink/accent, rest as dots). */
export function SignalBars({ value, hot, n = 34 }: { value: number; hot?: boolean; n?: number }) {
  const filled = Math.round((value / 100) * n);
  return (
    <div className="flex items-center gap-[5px] h-6" aria-label={`urgency ${value}/100`}>
      {Array.from({ length: n }, (_, i) => {
        const on = i < filled;
        // Deterministic "waveform" heights so it looks like a signal, not a progress bar.
        const h = 6 + ((i * 37 + value * 3) % 15);
        return (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: 3,
              height: on ? h : 3,
              background: on ? (hot ? "var(--accent)" : "var(--ink)") : "var(--border-2)",
              opacity: on ? 0.55 + (i / n) * 0.45 : 1,
            }}
          />
        );
      })}
    </div>
  );
}
