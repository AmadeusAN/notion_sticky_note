export function SakuraSvg({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      {/* Five soft petals around a tiny center */}
      <g fill={color} opacity="0.92">
        <ellipse cx="12" cy="6.2" rx="3.2" ry="5.2" />
        <ellipse
          cx="12"
          cy="6.2"
          rx="3.2"
          ry="5.2"
          transform="rotate(72 12 12)"
        />
        <ellipse
          cx="12"
          cy="6.2"
          rx="3.2"
          ry="5.2"
          transform="rotate(144 12 12)"
        />
        <ellipse
          cx="12"
          cy="6.2"
          rx="3.2"
          ry="5.2"
          transform="rotate(216 12 12)"
        />
        <ellipse
          cx="12"
          cy="6.2"
          rx="3.2"
          ry="5.2"
          transform="rotate(288 12 12)"
        />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="#f8e8a0" opacity="0.9" />
    </svg>
  );
}
