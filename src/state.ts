export const SEATS = ['A', 'B', 'C'] as const;
export type Seat = (typeof SEATS)[number];

/** Air vent (gasper) flow, from closed to fully open. */
export const FAN_LEVELS = [0, 1, 2] as const;
export type FanLevel = (typeof FAN_LEVELS)[number];
export const FAN_LEVEL_NAMES: Record<FanLevel, string> = { 0: 'off', 1: 'low', 2: 'high' };

/**
 * Where a swivelling lamp or air nozzle points, as seen from below: x to the right, y down,
 * within the unit circle (0,0 is straight down, length 1 is fully tilted).
 */
export type Aim = readonly [x: number, y: number];
export type Aimable = 'lights' | 'fans';

export interface PanelState {
  lights: Record<Seat, boolean>;
  fans: Record<Seat, FanLevel>;
  call: boolean;
  aim: Record<Aimable, Record<Seat, Aim>>;
}

export const initialState = (): PanelState => ({
  lights: { A: false, B: false, C: false },
  fans: { A: 0, B: 0, C: 0 },
  call: false,
  // Like in a real cabin, every lamp and nozzle was left pointing somewhere else.
  aim: {
    lights: { A: [-0.55, 0.4], B: [0.1, 0.5], C: [0.6, 0.3] },
    fans: { A: [0.25, -0.4], B: [-0.45, 0.3], C: [0.2, 0.6] },
  },
});

export const toggleLight = (s: PanelState, seat: Seat): PanelState => ({
  ...s,
  lights: { ...s.lights, [seat]: !s.lights[seat] },
});

export const cycleFan = (s: PanelState, seat: Seat): PanelState => ({
  ...s,
  fans: { ...s.fans, [seat]: ((s.fans[seat] + 1) % FAN_LEVELS.length) as FanLevel },
});

/** Like on a real aircraft, the call stays on until the button is pressed again. */
export const toggleCall = (s: PanelState): PanelState => ({ ...s, call: !s.call });

/**
 * Each head swivels within a circle shifted toward its own seat, so it can point well over its
 * passenger but only slightly toward a neighbour (the window seat can't light up the aisle seat).
 */
export const SWIVEL: Record<Seat, { cx: number; r: number }> = {
  A: { cx: -0.3, r: 0.7 },
  B: { cx: 0, r: 0.6 },
  C: { cx: 0.3, r: 0.7 },
};

/** Keeps an aim inside the seat's swivel range, rounded to 2 decimals. */
export const clampAim = (seat: Seat, [x, y]: Aim): Aim => {
  const { cx, r } = SWIVEL[seat];
  const len = Math.hypot(x - cx, y);
  const k = len > r ? r / len : 1;
  const round = (n: number): number => Math.round(n * 100) / 100 || 0;
  return [round(cx + (x - cx) * k), round(y * k)];
};

export const setAim = (s: PanelState, kind: Aimable, seat: Seat, aim: Aim): PanelState => ({
  ...s,
  aim: { ...s.aim, [kind]: { ...s.aim[kind], [seat]: clampAim(seat, aim) } },
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Restores a saved state, ignoring anything malformed or unknown. */
export const parseState = (raw: string | null): PanelState => {
  const state = initialState();
  if (!raw) return state;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return state;
  }
  if (!isRecord(data)) return state;
  const { lights, fans, call, aim } = data;
  for (const seat of SEATS) {
    if (isRecord(lights) && typeof lights[seat] === 'boolean') state.lights[seat] = lights[seat];
    const level = isRecord(fans) ? fans[seat] : undefined;
    if ((FAN_LEVELS as readonly unknown[]).includes(level)) state.fans[seat] = level as FanLevel;
  }
  if (typeof call === 'boolean') state.call = call;
  for (const kind of ['lights', 'fans'] as const) {
    const saved = isRecord(aim) ? aim[kind] : undefined;
    for (const seat of SEATS) {
      const v = isRecord(saved) ? saved[seat] : undefined;
      if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        state.aim[kind][seat] = clampAim(seat, v as unknown as Aim);
      }
    }
  }
  return state;
};
