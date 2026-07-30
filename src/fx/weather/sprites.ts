/** Offscreen-baked sprites for weather particles. */

export interface WeatherSprites {
  rainStreak: HTMLCanvasElement;
  snowSoft: HTMLCanvasElement;
  snowNear: HTMLCanvasElement;
  splash: HTMLCanvasElement;
  iceChip: HTMLCanvasElement;
  drip: HTMLCanvasElement;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function bakeRainStreak() {
  const c = makeCanvas(8, 48);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(4, 0, 4, 48);
  g.addColorStop(0, "rgba(190, 220, 240, 0)");
  g.addColorStop(0.25, "rgba(170, 205, 230, 0.15)");
  g.addColorStop(0.55, "rgba(200, 225, 245, 0.55)");
  g.addColorStop(0.85, "rgba(220, 235, 250, 0.85)");
  g.addColorStop(1, "rgba(240, 248, 255, 0.2)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(3.2, 0);
  ctx.lineTo(4.8, 0);
  ctx.lineTo(5.4, 48);
  ctx.lineTo(2.6, 48);
  ctx.closePath();
  ctx.fill();
  return c;
}

function bakeSoftSnow(size: number, withArms: boolean) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext("2d")!;
  const mid = size / 2;
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.92);
  g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  g.addColorStop(0.35, "rgba(245, 250, 255, 0.7)");
  g.addColorStop(0.7, "rgba(220, 232, 245, 0.25)");
  g.addColorStop(1, "rgba(200, 220, 240, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.9, 0, Math.PI * 2);
  ctx.fill();

  if (withArms) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = Math.max(0.8, size * 0.04);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(mid + Math.cos(a) * mid * 0.15, mid + Math.sin(a) * mid * 0.15);
      ctx.lineTo(mid + Math.cos(a) * mid * 0.72, mid + Math.sin(a) * mid * 0.72);
      ctx.stroke();
    }
  }
  return c;
}

function bakeSplash() {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "rgba(200, 225, 245, 0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(16, 18, 10, 4.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(220, 235, 250, 0.35)";
  ctx.beginPath();
  ctx.ellipse(16, 18, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.35;
    ctx.strokeStyle = `rgba(210, 230, 250, ${0.45 + i * 0.05})`;
    ctx.beginPath();
    ctx.moveTo(16, 16);
    ctx.lineTo(16 + Math.cos(a) * 9, 16 + Math.sin(a) * 7);
    ctx.stroke();
  }
  return c;
}

function bakeIceChip() {
  const c = makeCanvas(16, 16);
  const ctx = c.getContext("2d")!;
  ctx.translate(8, 8);
  ctx.rotate(0.3);
  const g = ctx.createLinearGradient(-6, -6, 6, 6);
  g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  g.addColorStop(0.45, "rgba(200, 230, 245, 0.75)");
  g.addColorStop(1, "rgba(160, 200, 225, 0.2)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, -1);
  ctx.lineTo(3, 6);
  ctx.lineTo(-4, 5);
  ctx.lineTo(-5, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-1, -5);
  ctx.lineTo(2, 4);
  ctx.stroke();
  return c;
}

function bakeDrip() {
  const c = makeCanvas(10, 18);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(5, 0, 5, 18);
  g.addColorStop(0, "rgba(220, 240, 255, 0.15)");
  g.addColorStop(0.4, "rgba(190, 220, 240, 0.55)");
  g.addColorStop(1, "rgba(240, 250, 255, 0.85)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(5, 1);
  ctx.bezierCurveTo(8.5, 6, 8.5, 12, 5, 17);
  ctx.bezierCurveTo(1.5, 12, 1.5, 6, 5, 1);
  ctx.fill();
  return c;
}

let cached: WeatherSprites | null = null;

export function getWeatherSprites(): WeatherSprites {
  if (cached) return cached;
  cached = {
    rainStreak: bakeRainStreak(),
    snowSoft: bakeSoftSnow(28, false),
    snowNear: bakeSoftSnow(36, true),
    splash: bakeSplash(),
    iceChip: bakeIceChip(),
    drip: bakeDrip(),
  };
  return cached;
}
