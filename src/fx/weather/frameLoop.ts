export interface WeatherCanvasController {
  wake: () => void;
  stopAndClear: () => void;
}

/** One pending frame; sleeping restarts time rather than catching up hidden time. */
export function createWeatherFrameLoop(options: {
  enabled: () => boolean;
  hasWork: () => boolean;
  onFrame: (dt: number, timeSec: number) => void;
  clear: () => void;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  now: () => number;
}): WeatherCanvasController {
  let pending: number | null = null;
  let last: number | null = null;
  let timeSec = 0;
  let stopped = true;
  const tick = (now: number) => {
    pending = null;
    if (stopped || !options.enabled()) return;
    const dt = Math.min(0.05, Math.max(0, (now - (last ?? now)) / 1000));
    last = now;
    timeSec += dt;
    options.onFrame(dt, timeSec);
    if (!stopped && options.enabled() && options.hasWork()) {
      pending = options.request(tick);
    } else {
      last = null;
      stopped = true;
    }
  };
  return {
    wake() {
      if (!options.enabled() || !options.hasWork() || pending !== null || !stopped) return;
      stopped = false;
      last = options.now();
      pending = options.request(tick);
    },
    stopAndClear() {
      stopped = true;
      if (pending !== null) options.cancel(pending);
      pending = null;
      last = null;
      options.clear();
    },
  };
}
