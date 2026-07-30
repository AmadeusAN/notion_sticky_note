export function LeafSvg({ color, flip }: { color: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 32"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <path
        d="M12 1.5C12 1.5 3.5 9 3.5 18.5c0 5.2 3.6 10 8.5 10s8.5-4.8 8.5-10C20.5 9 12 1.5 12 1.5z"
        fill={color}
        opacity="0.92"
      />
      <path
        d="M12 4.5v22.5"
        stroke="rgba(0,40,20,0.28)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M12 12c-2.2 1.4-3.8 3.2-4.6 5.2M12 16c2.1 1.2 3.5 2.8 4.2 4.6"
        stroke="rgba(0,40,20,0.2)"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
