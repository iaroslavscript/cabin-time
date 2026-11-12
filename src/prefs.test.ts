import { describe, expect, it } from 'vitest';
import { defaultPrefs, parsePrefs } from './prefs.ts';

describe('preferences', () => {
  it('defaults to European flights in metric units', () => {
    expect(parsePrefs(null)).toEqual({
      region: 'europe',
      units: 'metric',
      clock: '24h',
      ife: true,
      row: 17,
      seats: 'ABC',
    });
  });

  it('keeps valid values and drops invalid or corrupt ones', () => {
    expect(
      parsePrefs('{"region":"asia","units":"imperial","clock":"12h","ife":false,"row":3,"seats":"DEF"}'),
    ).toEqual({
      region: 'asia',
      units: 'imperial',
      clock: '12h',
      ife: false,
      row: 3,
      seats: 'DEF',
    });
    expect(parsePrefs('{"region":"mars","units":42,"ife":"yes","row":0,"seats":"XYZ"}')).toEqual(defaultPrefs);
    expect(parsePrefs('{"row":100}').row).toBe(17);
    expect(parsePrefs('{"row":12.5}').row).toBe(17);
    expect(parsePrefs('{not json')).toEqual(defaultPrefs);
  });
});
