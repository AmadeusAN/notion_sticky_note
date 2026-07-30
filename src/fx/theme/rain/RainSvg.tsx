export function RainSvg({ color }: { color: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 8 28" width="100%" height="100%" aria-hidden>
      <path
        d="M4 1.5C4 1.5 1.2 10 1.2 16.5c0 3.2 1.25 6 2.8 6s2.8-2.8 2.8-6C6.8 10 4 1.5 4 1.5z"
        fill={color}
        opacity="0.78"
      />
      <ellipse cx="4" cy="22.5" rx="1.6" ry="2.2" fill={color} opacity="0.5" />
    </svg>
  );
}
