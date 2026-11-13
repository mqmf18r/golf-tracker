// Place search (Nominatim) + bulk golf-course discovery (Overpass) — the
// "search a place, list every golf course OSM knows about there" step
// that feeds the bulk importer. Complements osmGolf.ts, which handles the
// per-course geometry pipeline once a course has been picked.

// react-native-maps' `Region` shape (latitude/longitude + deltas) → the
// {south,west,north,east} bbox `findGolfCoursesInBbox` expects — powers
// the map's "buscar en esta zona" re-search on pan/zoom.
export function bboxFromRegion(region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) {
  return {
    south: region.latitude - region.latitudeDelta / 2,
    north: region.latitude + region.latitudeDelta / 2,
    west: region.longitude - region.longitudeDelta / 2,
    east: region.longitude + region.longitudeDelta / 2,
  };
}

// Nominatim's own `addresstype`/`type` values → a short Spanish label, so
// two results that share the same display name (e.g. a city and the
// province around it, both called "Sevilla") read as distinguishable in
// the disambiguation list instead of two identical-looking rows.
const PLACE_TYPE_ES: Record<string, string> = {
  city: 'Ciudad', town: 'Pueblo', village: 'Aldea', hamlet: 'Aldea',
  state: 'Comunidad/Región', region: 'Región', province: 'Provincia',
  county: 'Comarca', administrative: 'Región administrativa',
  country: 'País', municipality: 'Municipio', suburb: 'Barrio',
};

export interface GeocodeResult {
  displayName: string;
  placeType: string | null; // short Spanish label — see PLACE_TYPE_ES
  lat: number;
  lon: number;
  boundingBox: { south: number; north: number; west: number; east: number };
  countryCode: string | null; // ISO 3166-1 alpha-2, lowercase (Nominatim convention)
}

export async function geocodePlace(query: string): Promise<GeocodeResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'GolfTracker/1.0 (personal golf tracking app)' },
  });
  if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`);
  const json = await resp.json();
  return (json as any[]).map(r => {
    const rawType: string | undefined = r.addresstype ?? r.type;
    return {
      displayName: r.display_name as string,
      placeType: rawType ? (PLACE_TYPE_ES[rawType] ?? rawType) : null,
      lat: parseFloat(r.lat), lon: parseFloat(r.lon),
      boundingBox: {
        south: parseFloat(r.boundingbox[0]), north: parseFloat(r.boundingbox[1]),
        west: parseFloat(r.boundingbox[2]), east: parseFloat(r.boundingbox[3]),
      },
      countryCode: r.address?.country_code ?? null,
    };
  });
}

export interface DiscoveredCourse {
  osmId: string; // "way/123" or "relation/456" — just for a stable React key
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  holes: number | null; // from the `holes` OSM tag, when present
}

export async function findGolfCoursesInBbox(
  bbox: { south: number; north: number; west: number; east: number },
): Promise<DiscoveredCourse[]> {
  const { south, west, north, east } = bbox;
  const query = `[out:json][timeout:25];
(
  way["leisure"="golf_course"](${south},${west},${north},${east});
  relation["leisure"="golf_course"](${south},${west},${north},${east});
);
out center tags;`;

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
  const elements: any[] = json.elements ?? [];

  const out: DiscoveredCourse[] = [];
  const seenNames = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name: string = tags.name ?? '';
    if (!name) continue; // unnamed course shapes aren't useful to pick from a list
    const center = el.center ?? (el.type === 'node' ? { lat: el.lat, lon: el.lon } : null);
    if (!center) continue;
    const key = `${name.trim().toLowerCase()}|${Math.round(center.lat * 1000)},${Math.round(center.lon * 1000)}`;
    if (seenNames.has(key)) continue; // way+relation sometimes both tag the same course
    seenNames.add(key);
    const holesTag = parseInt(tags.holes, 10);
    out.push({
      osmId: `${el.type}/${el.id}`,
      name: name.trim(),
      city: tags['addr:city'] ?? null,
      lat: center.lat, lon: center.lon,
      holes: Number.isFinite(holesTag) ? holesTag : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
