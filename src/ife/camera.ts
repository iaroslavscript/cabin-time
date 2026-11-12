import type { Rect } from './map.ts';

interface Puff {
  x: number;
  z: number;
  r: number;
}

const FAR = 28;
const puffs: Puff[] = Array.from({ length: 90 }, (_, i) => {
  // Deterministic scatter so the scene looks the same on every device.
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  return { x: ((a - Math.floor(a)) * 2 - 1) * 9, z: 1 + (b - Math.floor(b)) * FAR, r: 0.6 + ((a * 7) % 1 + 1) % 1 };
});

type RGB = [number, number, number];
const lerp = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.min(1, Math.max(0, t));
  return a.map((v, i) => Math.round(v + (b[i]! - v) * k)) as RGB;
};
const mix = (a: RGB, b: RGB, t: number): string => `rgb(${lerp(a, b, t).join(' ')})`;

/**
 * A rendered "tail camera" view looking forward over the fuselage.
 * sunElev drives the sky colours; speed (0..1) drives how fast clouds pass.
 */
export const drawCamera = (ctx: CanvasRenderingContext2D, rect: Rect, time: number, sunElev: number, speed: number, dt: number): void => {
  const { x: rx, y: ry, w, h } = rect;
  const day = Math.min(1, Math.max(0, (sunElev + 4) / 14));
  const golden = Math.max(0, 1 - Math.abs(sunElev - 2) / 8);
  const horizon = ry + h * 0.4;
  const shake = Math.sin(time / 90) * h * 0.0015 + Math.sin(time / 37) * h * 0.001;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, w, h);
  ctx.clip();
  ctx.translate(0, shake);

  const sky = ctx.createLinearGradient(0, ry, 0, horizon);
  sky.addColorStop(0, mix([8, 12, 32], [38, 98, 196], day));
  sky.addColorStop(0.75, mix([30, 34, 70], [120, 175, 235], day));
  sky.addColorStop(1, mix(lerp([40, 40, 80], [200, 225, 250], day), [255, 170, 90], golden * 0.8));
  ctx.fillStyle = sky;
  ctx.fillRect(rx, ry - h * 0.02, w, horizon - ry + h * 0.02);

  // Ground far below, fading into haze towards the horizon.
  const deck = ctx.createLinearGradient(0, horizon, 0, ry + h);
  deck.addColorStop(0, mix([40, 44, 70], [205, 218, 236], day));
  deck.addColorStop(0.25, mix([22, 28, 46], [120, 145, 160], day));
  deck.addColorStop(1, mix([10, 14, 24], [70, 98, 92], day));
  ctx.fillStyle = deck;
  ctx.fillRect(rx, horizon, w, h);

  const cx = rx + w / 2;
  const [cr, cg, cb] = lerp([80, 84, 110], [255, 255, 255], day);
  for (const p of puffs) {
    p.z -= dt * 0.0006 * (0.4 + speed);
    if (p.z < 0.6) p.z += FAR;
  }
  for (const p of [...puffs].sort((a, b) => b.z - a.z)) {
    const sx = cx + (p.x / p.z) * w * 0.35;
    const sy = horizon + (h * 0.55) / p.z;
    const r = (p.r * w * 0.2) / p.z;
    if (sx + r * 2 < rx || sx - r * 2 > rx + w) continue;
    const alpha = Math.min(1, (FAR - p.z) / 6) * 0.8;
    // A soft cumulus: a few overlapping blobs with feathered edges.
    for (const [dx, dy, k] of [[-0.6, 0.05, 0.75], [0.55, 0.08, 0.7], [0, -0.1, 1]] as const) {
      const bx = sx + dx * r;
      const by = sy + dy * r;
      const br = r * k;
      const g = ctx.createRadialGradient(bx, by - br * 0.2, 0, bx, by, br);
      g.addColorStop(0, `rgb(${cr} ${cg} ${cb} / ${alpha})`);
      g.addColorStop(0.6, `rgb(${cr} ${cg} ${cb} / ${alpha * 0.7})`);
      g.addColorStop(1, `rgb(${cr} ${cg} ${cb} / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Fuselage and wings, seen from the top of the fin.
  const body = mix([45, 48, 58], [228, 230, 236], day);
  const shade = mix([25, 27, 34], [160, 166, 178], day);
  const wing = (side: 1 | -1): void => {
    ctx.beginPath();
    ctx.moveTo(cx + side * w * 0.05, ry + h * 0.66);
    ctx.lineTo(cx + side * w * 0.52, ry + h * 0.74);
    ctx.lineTo(cx + side * w * 0.52, ry + h * 0.765);
    ctx.lineTo(cx + side * w * 0.06, ry + h * 0.75);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, ry + h * 0.66, 0, ry + h * 0.77);
    g.addColorStop(0, body);
    g.addColorStop(1, shade);
    ctx.fillStyle = g;
    ctx.fill();
    // Winglet and navigation light (red on the left, green on the right).
    ctx.fillStyle = shade;
    ctx.fillRect(cx + side * w * 0.505 - w * 0.006, ry + h * 0.69, w * 0.012, h * 0.06);
    const blink = Math.floor(time / 900) % 2 === 0 ? 1 : 0.35;
    ctx.fillStyle = side < 0 ? `rgb(255 40 40 / ${blink})` : `rgb(40 255 90 / ${blink})`;
    ctx.beginPath();
    ctx.arc(cx + side * w * 0.505, ry + h * 0.69, Math.max(1.5, w * 0.004), 0, Math.PI * 2);
    ctx.fill();
  };
  wing(-1);
  wing(1);

  ctx.beginPath();
  ctx.moveTo(cx - w * 0.11, ry + h * 1.02);
  ctx.bezierCurveTo(cx - w * 0.08, ry + h * 0.7, cx - w * 0.03, ry + h * 0.5, cx, ry + h * 0.47);
  ctx.bezierCurveTo(cx + w * 0.03, ry + h * 0.5, cx + w * 0.08, ry + h * 0.7, cx + w * 0.11, ry + h * 1.02);
  ctx.closePath();
  const fus = ctx.createLinearGradient(cx - w * 0.1, 0, cx + w * 0.1, 0);
  fus.addColorStop(0, shade);
  fus.addColorStop(0.5, body);
  fus.addColorStop(1, shade);
  ctx.fillStyle = fus;
  ctx.fill();
  ctx.restore();

  // Lens vignette.
  const v = ctx.createRadialGradient(cx, ry + h / 2, h * 0.3, cx, ry + h / 2, w * 0.7);
  v.addColorStop(0, 'rgb(0 0 0 / 0)');
  v.addColorStop(1, 'rgb(0 0 0 / 0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(rx, ry, w, h);
};
