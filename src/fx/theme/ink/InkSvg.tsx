const VARIANTS = 3;

export function InkSvg({
  color,
  flip,
  variant = 0,
}: {
  color: string;
  flip?: boolean;
  variant?: number;
}) {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  return (
    <svg
      viewBox="0 0 28 36"
      width="100%"
      height="100%"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      {v === 0 && (
        <>
          <path
            d="M14 2c-3.2 1.2-7.5 5-9.2 10.5C2.8 18.8 4 24.5 7.5 29c2.2 2.8 5.2 4.5 6.5 4.8 1.4-.4 4.1-2.2 6.2-5.2 3.2-4.6 4.2-10.2 2.2-15.5C20.2 7.5 16.8 3.2 14 2z"
            fill={color}
            opacity="0.88"
          />
          <ellipse cx="10" cy="12" rx="3.2" ry="2.4" fill={color} opacity="0.35" />
          <circle cx="18.5" cy="20" r="2.2" fill={color} opacity="0.45" />
        </>
      )}
      {v === 1 && (
        <>
          <path
            d="M8 4c4-2 10-1 14 3 3.5 3.5 4 9 2 14-1.5 4-5 8-9 10-3 1.2-6 .2-8-2.5-2.5-3.2-3-8-1.5-12C7 11 6.5 6.5 8 4z"
            fill={color}
            opacity="0.85"
          />
          <path
            d="M12 8c2 3 3 7 2.5 11"
            stroke={color}
            strokeWidth="1.4"
            fill="none"
            opacity="0.4"
            strokeLinecap="round"
          />
          <circle cx="20" cy="14" r="1.8" fill={color} opacity="0.5" />
        </>
      )}
      {v === 2 && (
        <>
          <ellipse cx="14" cy="16" rx="9" ry="12" fill={color} opacity="0.72" />
          <circle cx="8" cy="10" r="3.5" fill={color} opacity="0.55" />
          <circle cx="19" cy="24" r="2.8" fill={color} opacity="0.5" />
          <circle cx="21" cy="9" r="1.6" fill={color} opacity="0.4" />
          <path
            d="M6 22c3 4 8 6 12 4"
            stroke={color}
            strokeWidth="1.2"
            fill="none"
            opacity="0.35"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
