import { CourseZone, ZoneType, ShotZone, TeeColor, TEE_COLORS } from '../types';

export interface LatLon { lat: number; lon: number }

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Ray-casting point-in-polygon (lon = x, lat = y)
export function pointInPolygon(p: LatLon, poly: LatLon[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon, yi = poly[i].lat;
    const xj = poly[j].lon, yj = poly[j].lat;
    const intersect = (yi > p.lat) !== (yj > p.lat)
      && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Approx polygon area in m² (planar, fine for small zones) — used to pick most-specific zone
function polygonAreaM2(poly: LatLon[]): number {
  if (poly.length < 3) return Infinity;
  const latRef = poly[0].lat * Math.PI / 180;
  const mPerLat = 111320;
  const mPerLon = 111320 * Math.cos(latRef);
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon * mPerLon, yi = poly[i].lat * mPerLat;
    const xj = poly[j].lon * mPerLon, yj = poly[j].lat * mPerLat;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area / 2);
}

function segDistM(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Distance (m) from a point to the nearest edge of a polygon (0 if inside)
export function distanceToPolygonM(p: LatLon, poly: LatLon[]): number {
  if (poly.length < 2) return Infinity;
  if (pointInPolygon(p, poly)) return 0;
  const latRef = p.lat * Math.PI / 180;
  const mPerLat = 111320, mPerLon = 111320 * Math.cos(latRef);
  const px = p.lon * mPerLon, py = p.lat * mPerLat;
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].lon * mPerLon, ay = poly[j].lat * mPerLat;
    const bx = poly[i].lon * mPerLon, by = poly[i].lat * mPerLat;
    min = Math.min(min, segDistM(px, py, ax, ay, bx, by));
  }
  return Math.round(min);
}

// Returns the zone type the point falls in. If overlapping, the smallest (most specific) wins.
export function detectZone(p: LatLon, zones: CourseZone[]): ZoneType | '' {
  let best: { type: ZoneType; area: number } | null = null;
  for (const z of zones) {
    if (pointInPolygon(p, z.points)) {
      const area = polygonAreaM2(z.points);
      if (!best || area < best.area) best = { type: z.type, area };
    }
  }
  return best ? best.type : '';
}

// Initial bearing (degrees, 0=N) from one point to another
export function bearing(from: LatLon, to: LatLon): number {
  const φ1 = from.lat * Math.PI / 180, φ2 = to.lat * Math.PI / 180;
  const Δλ = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function midpoint(a: LatLon, b: LatLon): LatLon {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

// Generate a ~circular polygon (n points) around a center with radius in meters
export function circlePolygon(center: LatLon, radiusM: number, n = 18): LatLon[] {
  const pts: LatLon[] = [];
  const latRef = center.lat * Math.PI / 180;
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(latRef));
  for (let i = 0; i < n; i++) {
    const θ = (i / n) * 2 * Math.PI;
    pts.push({ lat: center.lat + dLat * Math.sin(θ), lon: center.lon + dLon * Math.cos(θ) });
  }
  return pts;
}

/**
 * Estimate positions for all 7 tee colors given one known tee and the green center.
 * Tees are spaced ~15 m apart along the tee→green bearing.
 * Returns only colors that are NOT the known color (caller saves them as estimates).
 */
export function estimateTeePositions(
  knownColor: TeeColor,
  knownPos:   LatLon,
  green:      LatLon,
): Partial<Record<TeeColor, LatLon>> {
  const result: Partial<Record<TeeColor, LatLon>> = {};
  const knownIdx = TEE_COLORS.indexOf(knownColor);
  const brg = bearing(knownPos, green) * Math.PI / 180;
  const cosLat = Math.cos(knownPos.lat * Math.PI / 180);
  for (let i = 0; i < TEE_COLORS.length; i++) {
    if (i === knownIdx) continue;
    const offsetM = (i - knownIdx) * 15; // positive = toward green
    result[TEE_COLORS[i]] = {
      lat: knownPos.lat + (offsetM * Math.cos(brg)) / 111320,
      lon: knownPos.lon + (offsetM * Math.sin(brg)) / (111320 * cosLat),
    };
  }
  return result;
}

/** Signed lateral deviation (m) of a landed shot from the origin→aim line. Positive = right, negative = left. */
export function lateralDeviationM(origin: LatLon, aim: LatLon, land: LatLon): number {
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  const kLon = 111320 * cosLat, kLat = 110540;
  const oaX = (aim.lon  - origin.lon) * kLon, oaY = (aim.lat  - origin.lat) * kLat;
  const olX = (land.lon - origin.lon) * kLon, olY = (land.lat - origin.lat) * kLat;
  const len = Math.sqrt(oaX * oaX + oaY * oaY);
  if (len < 1) return 0;
  return -(oaX * olY - oaY * olX) / len;
}

// Destination point given a start, bearing (deg) and distance (m)
export function destinationPoint(from: LatLon, distanceM: number, bearingDeg: number): LatLon {
  const R = 6371000, δ = distanceM / R, θ = bearingDeg * Math.PI / 180;
  const φ1 = from.lat * Math.PI / 180, λ1 = from.lon * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * 180 / Math.PI, lon: ((λ2 * 180 / Math.PI) + 540) % 360 - 180 };
}

export const ZONE_LABELS: Record<ZoneType | Exclude<ShotZone, ''>, string> = {
  green: 'Green', calle: 'Calle', bunker: 'Búnker', agua: 'Agua', rough: 'Rough', tee: 'Tee',
};
