import { useCallback, useEffect, useRef, useState } from "react";

/** Keep CSS particles until their animation completes, with one expiry timer. */
export function useExpiringParticles<T extends { durationMs: number }>() {
  const [particles, setParticles] = useState<T[]>(() => []);
  const entries = useRef<Array<{ particle: T; expiresAt: number }> | null>(null);
  if (entries.current === null) entries.current = [];
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const mounted = useRef(true);

  const cancelTimer = useCallback(() => {
    generation.current += 1;
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const schedule = useCallback((): void => {
    cancelTimer();
    const current = entries.current!;
    if (!mounted.current || current.length === 0) return;
    let nextExpiry = Infinity;
    for (const entry of current) nextExpiry = Math.min(nextExpiry, entry.expiresAt);
    const scheduledGeneration = generation.current;
    timer.current = window.setTimeout(() => {
      if (!mounted.current || generation.current !== scheduledGeneration) return;
      timer.current = undefined;
      const now = Date.now();
      entries.current = entries.current!.filter((entry) => entry.expiresAt > now);
      setParticles(entries.current.map((entry) => entry.particle));
      schedule();
    }, Math.max(0, Math.ceil(nextExpiry - Date.now())));
  }, [cancelTimer]);

  const spawn = useCallback((batch: T[]) => {
    if (!mounted.current || batch.length === 0) return;
    const now = Date.now();
    for (const particle of batch) {
      entries.current!.push({ particle, expiresAt: now + particle.durationMs + 80 });
    }
    setParticles(entries.current!.map((entry) => entry.particle));
    schedule();
  }, [schedule]);

  const clear = useCallback(() => {
    cancelTimer();
    entries.current = [];
    if (mounted.current) setParticles([]);
  }, [cancelTimer]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelTimer();
      entries.current = [];
    };
  }, [cancelTimer]);

  return { particles, spawn, clear };
}
