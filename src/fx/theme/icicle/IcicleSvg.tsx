export function IcicleSvg({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 36"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <path
        d="M2 1.5h8c.4 0 .7.4.55.8L6.8 32.5c-.15.55-.9.55-1.05 0L1.45 2.3C1.3 1.9 1.6 1.5 2 1.5z"
        fill={color}
        opacity="0.88"
      />
      <path
        d="M4.2 2.5l1.5 26.5"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="6" cy="3.2" rx="4.2" ry="1.6" fill={color} opacity="0.7" />
    </svg>
  );
}
