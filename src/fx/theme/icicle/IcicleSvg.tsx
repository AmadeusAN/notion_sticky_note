const VARIANTS = 3;

export function IcicleSvg({
  color,
  flip,
  variant = 0,
}: {
  color: string;
  flip?: boolean;
  variant?: number;
}) {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const gid = `ice-g-${v}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      viewBox="0 0 14 40"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="35%" stopColor={color} stopOpacity="0.88" />
          <stop offset="78%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {v === 0 && (
        <>
          <path
            d="M2.2 1.2h9.6c.55 0 .9.55.7 1.05L8.2 36.8c-.2.7-1.2.7-1.4 0L1.5 2.25C1.3 1.75 1.65 1.2 2.2 1.2z"
            fill={`url(#${gid})`}
          />
          <path
            d="M4.1 2.4l1.8 30.2"
            stroke="rgba(255,255,255,0.65)"
            strokeWidth="1.15"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M7.8 3.2l.6 18"
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="0.8"
            fill="none"
          />
          <ellipse cx="7" cy="2.8" rx="4.6" ry="1.5" fill="#fff" opacity="0.45" />
          <path
            d="M3.2 8.5l1.2 0.4M9.5 12l1.1.35"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.7"
            strokeLinecap="round"
          />
        </>
      )}

      {v === 1 && (
        <>
          <path
            d="M3 1.4h8c.5 0 .85.5.68 1L9.1 20.5l1.1 4.2-2.4 13.8c-.18.7-1.15.65-1.28-.08L3.4 24.2 2.2 2.45C2.05 1.9 2.45 1.4 3 1.4z"
            fill={`url(#${gid})`}
          />
          <path
            d="M5 3l1.2 28"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="1"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M8.4 4.5c.2 6 .1 12-.2 17"
            stroke="rgba(180,220,240,0.35)"
            strokeWidth="0.9"
            fill="none"
          />
          <ellipse cx="7" cy="2.6" rx="4.2" ry="1.35" fill="#fff" opacity="0.4" />
        </>
      )}

      {v === 2 && (
        <>
          <path
            d="M1.8 1.5h10.4c.45 0 .75.42.62.85L10 14.5l1.4 3.8L7.4 37.5c-.2.65-1.1.6-1.25-.08L2.6 18.2 1.2 2.4C1.08 1.95 1.4 1.5 1.8 1.5z"
            fill={`url(#${gid})`}
          />
          <path
            d="M4.4 2.8l2.1 31"
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="1.1"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M8.6 3.5l-.4 14"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="0.75"
            fill="none"
          />
          <ellipse cx="7" cy="2.7" rx="4.8" ry="1.45" fill="#fff" opacity="0.42" />
          <path
            d="M3.5 10h2.2M8.2 15h1.8"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="0.65"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

export const ICICLE_VARIANT_COUNT = VARIANTS;
