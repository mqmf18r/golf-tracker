export interface WindData {
  speed:     number; // km/h
  gusts:     number; // km/h
  direction: number; // degrees 0-359, meteorological (FROM which direction)
  compass:   string; // 'N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'
  fetchedAt: number; // ms timestamp
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export function degToCompass(deg: number): string {
  return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Arrow rotation so the icon points in the direction the wind is GOING (downwind)
// Ionicons "arrow-forward" points right (East=0°). Rotate clockwise by (direction+90)%360.
export function windArrowDeg(fromDeg: number): string {
  return `${(fromDeg + 90) % 360}deg`;
}

let _cache: { lat: number; lon: number; data: Conditions } | null = null;
const CACHE_MS = 5 * 60 * 1000; // 5 min

/** Full playing conditions — wind plus what the ball-flight model needs. */
export interface Conditions {
  wind: WindData;
  tempC: number;
  pressureHpa: number;        // station pressure at the surface
  relHumidity: number;        // 0-100 %
  elevationM: number;         // ground elevation open-meteo used
  airDensity: number;         // kg/m³, humid-air
}

/** Humid-air density (CIPM-ish, Tetens saturation vapour pressure). */
export function airDensityHumid(tempC: number, pressureHpa: number, relHumidity: number): number {
  const T = tempC + 273.15;
  const p = pressureHpa * 100;                                   // Pa
  const pSat = 610.78 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const pV = (Math.max(0, Math.min(100, relHumidity)) / 100) * pSat;
  const pD = p - pV;
  return pD / (287.058 * T) + pV / (461.495 * T);
}

/**
 * Wind (met. FROM-direction, km/h) resolved into the shot frame for the
 * ball-flight model. `targetBearingDeg` = compass bearing the shot is aimed at.
 * Returns m/s: +windMs helps (tailwind), +windCrossMs pushes the ball right.
 */
export function windToShotFrame(
  wind: WindData,
  targetBearingDeg: number,
): { windMs: number; windCrossMs: number } {
  const speedMs = wind.speed / 3.6;
  // vector the wind blows TOWARD:
  const toDeg = (wind.direction + 180) % 360;
  const rel = ((toDeg - targetBearingDeg) * Math.PI) / 180;
  return {
    windMs: speedMs * Math.cos(rel),        // component along the target line
    windCrossMs: speedMs * Math.sin(rel),   // + = left-to-right across it
  };
}

async function fetchConditions(lat: number, lon: number): Promise<Conditions | null> {
  const now = Date.now();
  if (
    _cache &&
    Math.abs(_cache.lat - lat) < 0.02 &&
    Math.abs(_cache.lon - lon) < 0.02 &&
    now - _cache.data.wind.fetchedAt < CACHE_MS
  ) {
    return _cache.data;
  }
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&current=windspeed_10m,winddirection_10m,windgusts_10m,` +
      `temperature_2m,surface_pressure,relative_humidity_2m` +
      `&wind_speed_unit=kmh&timezone=auto`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    const cur  = json.current;
    const dir  = Math.round(cur.winddirection_10m);
    const wind: WindData = {
      speed:     Math.round(cur.windspeed_10m),
      gusts:     Math.round(cur.windgusts_10m),
      direction: dir,
      compass:   degToCompass(dir),
      fetchedAt: now,
    };
    const tempC       = cur.temperature_2m ?? 15;
    const pressureHpa = cur.surface_pressure ?? 1013.25;
    const relHumidity = cur.relative_humidity_2m ?? 50;
    const data: Conditions = {
      wind, tempC, pressureHpa, relHumidity,
      elevationM: json.elevation ?? 0,
      airDensity: airDensityHumid(tempC, pressureHpa, relHumidity),
    };
    _cache = { lat, lon, data };
    return data;
  } catch {
    return null;
  }
}

export { fetchConditions };

export async function fetchWind(lat: number, lon: number): Promise<WindData | null> {
  return (await fetchConditions(lat, lon))?.wind ?? null;
}
