export interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface FlightInfo {
  callsign: string;
  flightNo: string;
  airline: string;
  aircraft: string;
  typeCode: string;
  reg: string;
  from: string;
  to: string;
  /** Cruise altitude and ground speed observed when the snapshot was taken. */
  altFt: number;
  speedKt: number;
}

/** [city, lat, lon] — used for map labels, most important first. */
export type City = [string, number, number];

export interface Snapshot {
  generatedAt: string;
  flights: FlightInfo[];
  airports: Record<string, Airport>;
  cities: City[];
}
