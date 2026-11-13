import {
  getHoles, updateHole, updateHoleTee, updateHoleGPS, insertZone, deleteZonesForHole,
} from '../lib/api';
import { haversineM } from './geo';

export interface OsmHoleImport {
  holeNumber: number;
  teeLat: number | null;
  teeLon: number | null;
  greenCentroid: { lat: number; lon: number } | null;
  greenPolygon: { lat: number; lon: number }[];
  fairway: { lat: number; lon: number }[];
  bunkers: { lat: number; lon: number }[][];
  water: { lat: number; lon: number }[][];
}

function centroid(pts: { lat: number; lon: number }[]): { lat: number; lon: number } {
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
  };
}

function degDist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return Math.hypot(a.lat - b.lat, a.lon - b.lon);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// The public Overpass instance is occasionally flaky (transient 406/5xx or a
// dropped connection) even for a well-formed query — retried a couple of
// times with a short backoff before giving up, since a single hiccup
// shouldn't fail an otherwise-good import. A server-side query timeout
// (`remark`, e.g. an expensive area-lookup for a sparsely-mapped course) is
// NOT retried — the same query will time out the same way again, so retrying
// it just wastes up to 3× the timeout for nothing; the caller's own
// area-then-radius fallback strategy handles that case instead.
async function overpassFetch(query: string, attempt = 0): Promise<any[]> {
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'User-Agent': 'GolfTracker/1.0 (personal golf tracking app)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.remark) throw new Error(`Overpass: ${json.remark}`);
    return json.elements ?? [];
  } catch (err) {
    const isServerTimeout = err instanceof Error && err.message.startsWith('Overpass: ');
    if (isServerTimeout || attempt >= 2) throw err;
    await sleep(1200 * (attempt + 1));
    return overpassFetch(query, attempt + 1);
  }
}

export interface OsmHolesResult {
  holes: OsmHoleImport[];
  // false when no hole in `holes` came from a real OSM hole-number ref
  // (relation ref/hole/name tag) — i.e. every hole number was *guessed* by
  // sorting green positions north-to-south, which is wrong for any course
  // that doesn't run in a straight line. Callers that can't have a human
  // sanity-check the result (the bulk importer) should treat this as
  // "don't trust these hole numbers."
  reliable: boolean;
}

async function fetchOsmElements(centerLat: number, centerLon: number, radiusM: number): Promise<any[]> {
  // Strategy 1: area-based (find course boundary, then features inside)
  // Strategy 2: radius-based fallback
  const queries = [
    `[out:json][timeout:30];
area["leisure"="golf_course"](around:600,${centerLat},${centerLon})->.g;
(
  way["golf"~"^(tee|green|bunker|fairway|water_hazard)$"](area.g);
  node["golf"="tee"](area.g);
  relation["golf"="hole"](area.g);
  relation["type"="route"]["golf"~"hole"](area.g);
);
out geom;`,
    `[out:json][timeout:30];
(
  way["golf"~"^(tee|green|bunker|fairway|water_hazard)$"](around:${radiusM},${centerLat},${centerLon});
  node["golf"="tee"](around:${radiusM},${centerLat},${centerLon});
  relation["golf"="hole"](around:${radiusM},${centerLat},${centerLon});
  relation["type"="route"]["golf"~"hole"](around:${radiusM},${centerLat},${centerLon});
);
out geom;`,
  ];

  for (const q of queries) {
    try {
      const elements = await overpassFetch(q);
      if (elements.length > 0) return elements;
    } catch { /* try the next strategy */ }
  }
  return [];
}

function parseOsmHoles(elements: any[]): OsmHolesResult {
  if (elements.length === 0) return { holes: [], reliable: false };

  const holesMap = new Map<number, OsmHoleImport>();
  // Features that couldn't be assigned by ref — proximity-matched later
  const unrefFeatures: { type: string; pts: { lat: number; lon: number }[] }[] = [];

  function getOrCreate(num: number): OsmHoleImport {
    if (!holesMap.has(num)) {
      holesMap.set(num, {
        holeNumber: num, teeLat: null, teeLon: null,
        greenCentroid: null, greenPolygon: [],
        fairway: [], bunkers: [], water: [],
      });
    }
    return holesMap.get(num)!;
  }

  function assignFeature(h: OsmHoleImport, golfType: string, pts: { lat: number; lon: number }[], role?: string) {
    const type = role ?? golfType;
    switch (type) {
      case 'tee':
        if (h.teeLat === null) { const c = centroid(pts); h.teeLat = c.lat; h.teeLon = c.lon; }
        break;
      case 'green':
        h.greenCentroid = centroid(pts);
        h.greenPolygon = pts;
        break;
      case 'fairway':
        if (pts.length > h.fairway.length) h.fairway = pts;
        break;
      case 'bunker':
        h.bunkers.push(pts);
        break;
      case 'water_hazard':
        h.water.push(pts);
        break;
    }
  }

  function holeRefFromTags(tags: Record<string, string>): number {
    const raw = tags['ref'] ?? tags['hole'] ?? tags['golf:hole'] ?? tags['name'];
    if (!raw) return NaN;
    // handle "Hole 7", "7", "#7" etc.
    const m = String(raw).match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }

  function ptsFromEl(el: any): { lat: number; lon: number }[] {
    if (el.type === 'node') return [{ lat: el.lat as number, lon: el.lon as number }];
    if (el.type === 'way' && Array.isArray(el.geometry))
      return (el.geometry as { lat: number; lon: number }[]).map(g => ({ lat: g.lat, lon: g.lon }));
    return [];
  }

  for (const el of elements) {
    const tags: Record<string, string> = el.tags ?? {};
    const golfType: string = tags['golf'] ?? '';

    // ── Hole relations ─────────────────────────────────────────────────────────
    if (el.type === 'relation') {
      const num = holeRefFromTags(tags);
      if (isNaN(num) || num < 1 || num > 18) continue;
      const h = getOrCreate(num);
      for (const member of (el.members ?? []) as any[]) {
        if (!Array.isArray(member.geometry) || member.geometry.length === 0) continue;
        const pts = (member.geometry as { lat: number; lon: number }[]).map(g => ({ lat: g.lat, lon: g.lon }));
        const role: string = member.role ?? member.tags?.golf ?? '';
        // roles: 'tee', 'green', 'fairway', 'bunker', 'water_hazard'
        if (role) assignFeature(h, role, pts, role);
        else {
          const memberGolfTag: string = member.tags?.golf ?? '';
          if (memberGolfTag) assignFeature(h, memberGolfTag, pts);
        }
      }
      continue;
    }

    // ── Individual ways / nodes ────────────────────────────────────────────────
    if (!golfType) continue;
    const pts = ptsFromEl(el);
    if (pts.length === 0) continue;

    const num = holeRefFromTags(tags);
    if (!isNaN(num) && num >= 1 && num <= 18) {
      assignFeature(getOrCreate(num), golfType, pts);
    } else {
      // No hole ref — collect for proximity matching
      unrefFeatures.push({ type: golfType, pts });
    }
  }

  // ── Proximity-match unref'd features to nearest known green/tee ──────────────
  if (unrefFeatures.length > 0 && holesMap.size > 0) {
    const anchors = Array.from(holesMap.values()).map(h => ({
      h,
      pos: h.greenCentroid ?? (h.teeLat !== null ? { lat: h.teeLat!, lon: h.teeLon! } : null),
    })).filter(a => a.pos !== null) as { h: OsmHoleImport; pos: { lat: number; lon: number } }[];

    if (anchors.length > 0) {
      for (const feat of unrefFeatures) {
        const c = centroid(feat.pts);
        let best = anchors[0];
        for (const a of anchors) {
          if (degDist(c, a.pos) < degDist(c, best.pos)) best = a;
        }
        // Only assign if within ~500m (0.005 degrees ≈ 500m)
        if (degDist(c, best.pos) < 0.005) {
          assignFeature(best.h, feat.type, feat.pts);
        }
      }
    }
  }

  // Reliable iff at least one hole number came from a real OSM ref, i.e.
  // before the crude "guess by green latitude" fallback below ever runs.
  const reliable = holesMap.size > 0;

  // ── If NOTHING had refs, treat everything as belonging to holes by green position ─
  if (holesMap.size === 0 && unrefFeatures.length > 0) {
    // Find all greens and assign them as holes 1..N in order
    const greens = unrefFeatures.filter(f => f.type === 'green');
    if (greens.length > 0) {
      // Sort greens roughly north→south (crude but better than nothing)
      greens.sort((a, b) => centroid(b.pts).lat - centroid(a.pts).lat);
      greens.forEach((g, i) => {
        const h = getOrCreate(i + 1);
        h.greenCentroid = centroid(g.pts);
        h.greenPolygon = g.pts;
      });
      // Assign other features to nearest green
      const others = unrefFeatures.filter(f => f.type !== 'green');
      const anchors = Array.from(holesMap.values())
        .filter(h => h.greenCentroid !== null)
        .map(h => ({ h, pos: h.greenCentroid! }));
      for (const feat of others) {
        if (anchors.length === 0) break;
        const c = centroid(feat.pts);
        let best = anchors[0];
        for (const a of anchors) if (degDist(c, a.pos) < degDist(c, best.pos)) best = a;
        if (degDist(c, best.pos) < 0.008) assignFeature(best.h, feat.type, feat.pts);
      }
    }
  }

  return {
    holes: Array.from(holesMap.values()).sort((a, b) => a.holeNumber - b.holeNumber),
    reliable,
  };
}

// Unchanged public signature — used by the single-course "Importar del
// campo" flow, which a developer reviews visually afterward, so the
// unreliable-fallback case is still worth returning (better than nothing,
// easy to spot and redo by hand).
export async function fetchOsmGolfHoles(
  centerLat: number,
  centerLon: number,
  radiusM = 3000
): Promise<OsmHoleImport[]> {
  const elements = await fetchOsmElements(centerLat, centerLon, radiusM);
  return parseOsmHoles(elements).holes;
}

// Used by the unattended bulk importer, which has no human to sanity-check
// a bad hole-numbering guess — callers should skip the course entirely
// when `reliable` is false rather than import data likely to be wrong.
export async function fetchOsmGolfHolesWithConfidence(
  centerLat: number,
  centerLon: number,
  radiusM = 3000
): Promise<OsmHolesResult> {
  const elements = await fetchOsmElements(centerLat, centerLon, radiusM);
  return parseOsmHoles(elements);
}

// ── Per-hole area detect: all golf features inside a user-drawn circle ──────

export type OsmAreaFeatureType = 'green' | 'tee' | 'bunker' | 'fairway' | 'water_hazard';

export interface OsmAreaFeature {
  golfType: OsmAreaFeatureType;
  points: { lat: number; lon: number }[];
}

// Query using a freehand polygon (Overpass poly: filter — no hole-number matching needed)
export async function fetchOsmFeaturesInPolygon(
  points: { lat: number; lon: number }[]
): Promise<OsmAreaFeature[]> {
  if (points.length < 3) return [];
  // Overpass poly: format = "lat1 lon1 lat2 lon2 ..."
  const polyStr = points.map(p => `${p.lat} ${p.lon}`).join(' ');
  const query = `[out:json][timeout:20];
(
  way["golf"~"^(green|bunker|fairway|water_hazard|tee)$"](poly:"${polyStr}");
  node["golf"="tee"](poly:"${polyStr}");
);
out geom;`;

  const elements = await overpassFetch(query);
  const features: OsmAreaFeature[] = [];
  for (const el of elements as any[]) {
    const golfType: string = el.tags?.golf ?? '';
    if (!['green', 'tee', 'bunker', 'fairway', 'water_hazard'].includes(golfType)) continue;
    let pts: { lat: number; lon: number }[] = [];
    if (el.type === 'node') pts = [{ lat: el.lat, lon: el.lon }];
    else if (el.type === 'way' && Array.isArray(el.geometry))
      pts = (el.geometry as { lat: number; lon: number }[]).map(g => ({ lat: g.lat, lon: g.lon }));
    if (pts.length === 0) continue;
    features.push({ golfType: golfType as OsmAreaFeatureType, points: pts });
  }
  return features;
}

export async function fetchOsmFeaturesInArea(
  lat: number,
  lon: number,
  radiusM: number
): Promise<OsmAreaFeature[]> {
  const query = `[out:json][timeout:20];
(
  way["golf"~"^(green|bunker|fairway|water_hazard|tee)$"](around:${Math.round(radiusM)},${lat},${lon});
  node["golf"="tee"](around:${Math.round(radiusM)},${lat},${lon});
);
out geom;`;

  const elements = await overpassFetch(query);
  const features: OsmAreaFeature[] = [];

  for (const el of elements as any[]) {
    const golfType: string = el.tags?.golf ?? '';
    if (!['green', 'tee', 'bunker', 'fairway', 'water_hazard'].includes(golfType)) continue;

    let pts: { lat: number; lon: number }[] = [];
    if (el.type === 'node') {
      pts = [{ lat: el.lat as number, lon: el.lon as number }];
    } else if (el.type === 'way' && Array.isArray(el.geometry)) {
      pts = (el.geometry as { lat: number; lon: number }[]).map(g => ({ lat: g.lat, lon: g.lon }));
    }
    if (pts.length === 0) continue;

    features.push({ golfType: golfType as OsmAreaFeatureType, points: pts });
  }

  return features;
}

// ── Course-wide hazard auto-detection (water + OB) ──────────────────────────

export interface OsmHazardResult {
  type: 'agua' | 'ob';
  points: { lat: number; lon: number }[];
}

export async function fetchOsmCourseHazards(
  centerLat: number,
  centerLon: number,
  radiusM = 1500
): Promise<OsmHazardResult[]> {
  const r = Math.round(radiusM);

  // Two queries: one for water + explicit OB, one for course boundary (fallback OB)
  const waterObQuery = `[out:json][timeout:30];
(
  way["golf"="water_hazard"](around:${r},${centerLat},${centerLon});
  way["golf"="lateral_water_hazard"](around:${r},${centerLat},${centerLon});
  way["natural"="water"](around:${r},${centerLat},${centerLon});
  relation["natural"="water"](around:${r},${centerLat},${centerLon});
  way["waterway"="pond"](around:${r},${centerLat},${centerLon});
  way["golf"="out_of_bounds"](around:${r},${centerLat},${centerLon});
  relation["golf"="out_of_bounds"](around:${r},${centerLat},${centerLon});
);
out geom;`;

  const boundaryQuery = `[out:json][timeout:30];
(
  way["leisure"="golf_course"](around:${r},${centerLat},${centerLon});
  relation["leisure"="golf_course"](around:${r},${centerLat},${centerLon});
);
out geom;`;

  function ptsFromEl(el: any): { lat: number; lon: number }[] {
    if (el.type === 'way' && Array.isArray(el.geometry))
      return el.geometry.map((g: any) => ({ lat: g.lat as number, lon: g.lon as number }));
    if (el.type === 'relation') {
      for (const member of (el.members ?? []) as any[]) {
        if (member.role === 'outer' && Array.isArray(member.geometry) && member.geometry.length >= 3)
          return member.geometry.map((g: any) => ({ lat: g.lat as number, lon: g.lon as number }));
      }
    }
    return [];
  }

  const [waterObEls, boundaryEls] = await Promise.all([
    overpassFetch(waterObQuery).catch(() => [] as any[]),
    overpassFetch(boundaryQuery).catch(() => [] as any[]),
  ]);

  const results: OsmHazardResult[] = [];
  let hasExplicitOb = false;

  for (const el of waterObEls as any[]) {
    const tags = el.tags ?? {};
    let type: 'agua' | 'ob' | null = null;

    if (
      tags.golf === 'water_hazard' || tags.golf === 'lateral_water_hazard' ||
      tags.natural === 'water' || tags.waterway === 'pond'
    ) {
      type = 'agua';
    } else if (tags.golf === 'out_of_bounds') {
      type = 'ob';
      hasExplicitOb = true;
    }

    if (!type) continue;
    const pts = ptsFromEl(el);
    if (pts.length >= 3) results.push({ type, points: pts });
  }

  // If no explicit OB found, use the golf course boundary as OB limit
  if (!hasExplicitOb) {
    // Pick the largest boundary polygon (most likely the full course outline)
    let bestPts: { lat: number; lon: number }[] = [];
    for (const el of boundaryEls as any[]) {
      const pts = ptsFromEl(el);
      if (pts.length > bestPts.length) bestPts = pts;
    }
    if (bestPts.length >= 3) results.push({ type: 'ob', points: bestPts });
  }

  return results;
}

// ── Write a fetchOsmGolfHoles() result into the DB for one course ──────────
// Shared by the single-course "Importar del campo" flow
// (app/courses/[id].tsx) and the bulk OSM importer — matches each OSM hole
// to the course's existing `holes` rows by hole number (so the holes must
// already exist, same as before) and overwrites their tee/green GPS +
// green/fairway/bunker/water zones.

export interface OsmImportCounts {
  holes: number; tees: number; greens: number; fairways: number; bunkers: number; water: number;
}

export async function applyOsmHolesToDb(courseId: string, osmHoles: OsmHoleImport[]): Promise<OsmImportCounts> {
  const counts: OsmImportCounts = { holes: osmHoles.length, tees: 0, greens: 0, fairways: 0, bunkers: 0, water: 0 };
  const currentHoles = await getHoles(courseId);

  for (const oh of osmHoles) {
    const dbHole = currentHoles.find(h => h.number === oh.holeNumber);
    if (!dbHole) continue;
    await deleteZonesForHole(dbHole.id);

    if (oh.teeLat !== null && oh.teeLon !== null) {
      await updateHoleTee(dbHole.id, oh.teeLat, oh.teeLon);
      counts.tees++;
    }
    if (oh.greenCentroid) {
      const { lat, lon } = oh.greenCentroid;
      await updateHoleGPS(dbHole.id, {
        pinLat: lat, pinLon: lon,
        frontLat: lat, frontLon: lon,
        centerLat: lat, centerLon: lon,
        backLat: lat, backLon: lon,
      });
      counts.greens++;
      if (oh.teeLat !== null && oh.teeLon !== null) {
        await updateHole(dbHole.id, { distanceMeters: haversineM(oh.teeLat, oh.teeLon, lat, lon) });
      }
    }
    if (oh.greenPolygon.length >= 3) await insertZone(dbHole.id, 'green', oh.greenPolygon);
    if (oh.fairway.length >= 3) { await insertZone(dbHole.id, 'calle', oh.fairway); counts.fairways++; }
    for (const b of oh.bunkers) if (b.length >= 3) { await insertZone(dbHole.id, 'bunker', b); counts.bunkers++; }
    for (const w of oh.water) if (w.length >= 3) { await insertZone(dbHole.id, 'agua', w); counts.water++; }
  }

  return counts;
}
