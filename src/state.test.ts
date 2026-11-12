import { describe, expect, it } from 'vitest';
import { SEATS, cycleFan, initialState, parseState, setAim, toggleCall, toggleLight } from './state.ts';

describe('panel state', () => {
  it('toggles a reading light without touching the other seats', () => {
    const on = toggleLight(initialState(), 'B');
    expect(on.lights).toEqual({ A: false, B: true, C: false });
    expect(toggleLight(on, 'B').lights.B).toBe(false);
  });

  it('cycles an air vent off → low → high → off', () => {
    let s = initialState();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      s = cycleFan(s, 'C');
      seen.push(s.fans.C);
    }
    expect(seen).toEqual([1, 2, 0, 1]);
    expect(s.fans.A).toBe(0);
  });

  it('keeps the crew call on until pressed again', () => {
    const called = toggleCall(initialState());
    expect(called.call).toBe(true);
    expect(toggleCall(called).call).toBe(false);
  });

  it('restores a saved state and ignores malformed parts', () => {
    const saved = toggleCall(cycleFan(toggleLight(initialState(), 'A'), 'B'));
    expect(parseState(JSON.stringify(saved))).toEqual(saved);
    expect(parseState('{"lights":{"A":"yes"},"fans":{"B":7,"C":2},"call":1}')).toEqual({
      ...initialState(),
      fans: { A: 0, B: 0, C: 2 },
    });
    expect(parseState('not json')).toEqual(initialState());
    expect(parseState('null')).toEqual(initialState());
    expect(parseState(null)).toEqual(initialState());
  });

  it('aims a lamp or nozzle only slightly toward the neighbours and remembers it', () => {
    const s = setAim(initialState(), 'fans', 'B', [3, 4]);
    expect(s.aim.fans.B).toEqual([0.36, 0.48]);
    expect(s.aim.lights).toEqual(initialState().aim.lights);
    expect(parseState(JSON.stringify(s)).aim.fans.B).toEqual([0.36, 0.48]);
    // The window seat swivels fully outward but not far toward the aisle, and vice versa.
    expect(setAim(s, 'lights', 'A', [-1, 0]).aim.lights.A).toEqual([-1, 0]);
    expect(setAim(s, 'lights', 'A', [1, 0]).aim.lights.A).toEqual([0.4, 0]);
    expect(setAim(s, 'lights', 'C', [-1, 0]).aim.lights.C).toEqual([-0.4, 0]);
    const bad = parseState('{"aim":{"lights":{"A":[1],"B":["x",0],"C":[0.3,-2]}}}').aim.lights;
    expect(bad).toEqual({ ...initialState().aim.lights, C: [0.3, -0.7] });
  });

  it('starts with every head inside its swivel range', () => {
    const { aim } = initialState();
    for (const kind of ['lights', 'fans'] as const) {
      for (const seat of SEATS) expect(setAim(initialState(), kind, seat, aim[kind][seat]).aim[kind][seat]).toEqual(aim[kind][seat]);
    }
  });
});
