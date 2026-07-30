export function SnowSvg({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <circle cx="12" cy="12" r="3.2" fill={color} opacity="0.95" />
      <g stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.85">
        <line x1="12" y1="2.5" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="21.5" y2="12" />
        <line x1="5.2" y1="5.2" x2="18.8" y2="18.8" />
        <line x1="18.8" y1="5.2" x2="5.2" y2="18.8" />
      </g>
      <g fill={color} opacity="0.75">
        <circle cx="12" cy="4.2" r="1.1" />
        <circle cx="12" cy="19.8" r="1.1" />
        <circle cx="4.2" cy="12" r="1.1" />
        <circle cx="19.8" cy="12" r="1.1" />
      </g>
    </svg>
  );
}
