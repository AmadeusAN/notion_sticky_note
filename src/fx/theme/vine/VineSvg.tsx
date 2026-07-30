export function VineSvg({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 36"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <path
        d="M10 2c0 0-1.2 6-1 12 .2 5 1.4 10 1 16"
        stroke={color}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        opacity="0.85"
      />
      <ellipse
        cx="6.5"
        cy="10"
        rx="4.2"
        ry="2.4"
        fill={color}
        opacity="0.9"
        transform="rotate(-35 6.5 10)"
      />
      <ellipse
        cx="14"
        cy="16"
        rx="4.5"
        ry="2.5"
        fill={color}
        opacity="0.88"
        transform="rotate(40 14 16)"
      />
      <ellipse
        cx="7"
        cy="23"
        rx="3.8"
        ry="2.2"
        fill={color}
        opacity="0.86"
        transform="rotate(-28 7 23)"
      />
      <ellipse
        cx="13.5"
        cy="29"
        rx="3.6"
        ry="2"
        fill={color}
        opacity="0.84"
        transform="rotate(32 13.5 29)"
      />
    </svg>
  );
}
