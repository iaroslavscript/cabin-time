export const REGIONS = ['europe', 'north-america', 'asia', 'world'] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_NAMES: Record<Region, string> = {
  europe: 'Europe (EU, EEA, UK, CH)',
  'north-america': 'North America',
  asia: 'Asia & Middle East',
  world: 'Anywhere in the world',
};

// prettier-ignore
const COUNTRIES: Record<Exclude<Region, 'world'>, ReadonlySet<string>> = {
  europe: new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
    'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH', 'GB', 'GI', 'FO', 'GG', 'JE', 'IM',
  ]),
  'north-america': new Set(['US', 'CA', 'MX', 'PR', 'BS', 'BM', 'JM', 'DO', 'CU', 'GL']),
  asia: new Set([
    'JP', 'KR', 'CN', 'HK', 'MO', 'TW', 'MN', 'SG', 'MY', 'TH', 'VN', 'KH', 'LA', 'MM', 'PH', 'ID', 'BN', 'IN', 'PK',
    'BD', 'LK', 'NP', 'MV', 'AE', 'QA', 'SA', 'OM', 'BH', 'KW', 'JO', 'IL', 'IR', 'IQ', 'KZ', 'UZ',
  ]),
};

/** A flight belongs to a region when both of its airports are in that region. */
export const inRegion = (region: Region, fromCountry: string, toCountry: string): boolean =>
  region === 'world' || (COUNTRIES[region].has(fromCountry) && COUNTRIES[region].has(toCountry));

/** Points around which the snapshot script samples live traffic (adsb.lol radius queries). */
export const SAMPLE_POINTS: Record<Exclude<Region, 'world'> | 'other', [number, number][]> = {
  europe: [
    [50.03, 8.57], [51.47, -0.45], [49.01, 2.55], [40.47, -3.56], [41.8, 12.25], [52.31, 4.76], [48.35, 11.79],
    [52.17, 20.97], [59.65, 17.92], [37.94, 23.94], [38.77, -9.13], [47.46, 8.55], [53.42, -6.27], [60.19, 11.1],
  ],
  'north-america': [
    [40.64, -73.78], [41.97, -87.9], [33.64, -84.43], [32.9, -97.04], [39.86, -104.67], [33.94, -118.41],
    [47.45, -122.31], [43.68, -79.63], [25.79, -80.29], [19.44, -99.07],
  ],
  asia: [
    [35.55, 139.78], [37.46, 126.44], [40.08, 116.58], [31.14, 121.81], [22.31, 113.91], [1.36, 103.99],
    [13.69, 100.75], [28.56, 77.1], [25.25, 55.36], [25.27, 51.61],
  ],
  other: [[-33.95, 151.18], [-23.43, -46.47], [-26.14, 28.24], [52, -30], [30.12, 31.41], [55.97, 37.41]],
};
