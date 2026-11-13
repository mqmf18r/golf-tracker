import * as SQLite from 'expo-sqlite';
import { getCourses, getHoles, getZonesForCourse, getCourseHazards } from '../db/queries';

const BLOB_API  = 'https://jsonblob.com/api/jsonBlob';
const SHORT_API = 'https://is.gd/create.php';

interface BackupData {
  version: 2;
  exportedAt: string;
  courses: {
    id: string; name: string; city: string;
    courseRating: number; slopeRating: number;
    holes: {
      id: string; courseId: string; number: number; par: number;
      handicapIndex: number; distanceMeters: number;
      pinLat: number; pinLon: number;
      frontLat: number; frontLon: number;
      centerLat: number; centerLon: number;
      backLat: number; backLon: number;
      teeLat: number; teeLon: number;
      zones: { id: string; holeId: string; type: string; points: { lat: number; lon: number }[] }[];
    }[];
    hazards: { id: string; courseId: string; type: string; points: { lat: number; lon: number }[] }[];
  }[];
}

function run(db: SQLite.SQLiteDatabase, sql: string, params: SQLite.SQLiteBindParams) {
  try {
    db.runSync(sql, params);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    throw new Error(`SQL falló: ${msg}\nSQL: ${sql.slice(0, 80)}`);
  }
}

export async function exportBackup(db: SQLite.SQLiteDatabase): Promise<string> {
  const courses = getCourses(db);
  const data: BackupData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    courses: courses.map(course => {
      const zones = getZonesForCourse(db, course.id);
      return {
        ...course,
        holes: getHoles(db, course.id).map(hole => ({
          ...hole,
          zones: zones.filter(z => z.holeId === hole.id),
        })),
        hazards: getCourseHazards(db, course.id),
      };
    }),
  };

  const blobResp = await fetch(BLOB_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!blobResp.ok) throw new Error(`Error subiendo datos (${blobResp.status})`);

  const location = blobResp.headers.get('Location') ?? '';
  const blobId   = location.split('/').pop() ?? '';
  if (!blobId) throw new Error('No se recibió ID del servidor');

  const shortResp = await fetch(
    `${SHORT_API}?format=simple&url=${encodeURIComponent(`${BLOB_API}/${blobId}`)}`
  );
  if (!shortResp.ok) throw new Error(`Error generando código corto (${shortResp.status})`);

  const shortUrl = (await shortResp.text()).trim();
  const code = shortUrl.split('/').pop() ?? '';
  if (!code) throw new Error('No se recibió código corto');

  return code;
}

export async function importBackup(db: SQLite.SQLiteDatabase, code: string): Promise<number> {
  const clean = code.trim();
  if (clean.length < 2) throw new Error('Código inválido');

  const resp = await fetch(`https://is.gd/${clean}`);
  if (resp.status === 404) throw new Error('Código no encontrado');
  if (!resp.ok) throw new Error(`Error descargando backup (${resp.status})`);

  let data: BackupData;
  try {
    data = await resp.json();
  } catch {
    throw new Error('El código no contiene un backup válido (respuesta no es JSON)');
  }
  if (!data.courses || !Array.isArray(data.courses)) throw new Error('Formato de backup inválido');

  let holesRestored = 0;

  for (const c of data.courses) {
    // INSERT OR IGNORE first (won't delete existing rows = preserves rounds)
    run(db,
      `INSERT OR IGNORE INTO courses (id, name, city, courseRating, slopeRating)
       VALUES (?, ?, ?, ?, ?)`,
      [c.id, c.name, c.city ?? '', Number(c.courseRating) || 72, Number(c.slopeRating) || 113]
    );
    // Then UPDATE to sync latest values
    run(db,
      `UPDATE courses SET name=?, city=?, courseRating=?, slopeRating=? WHERE id=?`,
      [c.name, c.city ?? '', Number(c.courseRating) || 72, Number(c.slopeRating) || 113, c.id]
    );

    for (const h of c.holes ?? []) {
      const par = Number(h.par) || 4;
      const vals = [
        h.id, h.courseId,
        Number(h.number) || 1, par,
        Number(h.handicapIndex) || 1, Number(h.distanceMeters) || 0,
        Number(h.pinLat)    || 0, Number(h.pinLon)    || 0,
        Number(h.frontLat)  || 0, Number(h.frontLon)  || 0,
        Number(h.centerLat) || 0, Number(h.centerLon) || 0,
        Number(h.backLat)   || 0, Number(h.backLon)   || 0,
        Number(h.teeLat)    || 0, Number(h.teeLon)    || 0,
      ];
      run(db,
        `INSERT OR IGNORE INTO holes
           (id, courseId, number, par, handicapIndex, distanceMeters,
            pinLat, pinLon, frontLat, frontLon, centerLat, centerLon,
            backLat, backLon, teeLat, teeLon)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        vals
      );
      run(db,
        `UPDATE holes SET
           number=?, par=?, handicapIndex=?, distanceMeters=?,
           pinLat=?, pinLon=?, frontLat=?, frontLon=?,
           centerLat=?, centerLon=?, backLat=?, backLon=?,
           teeLat=?, teeLon=?
         WHERE id=?`,
        [
          Number(h.number) || 1, par,
          Number(h.handicapIndex) || 1, Number(h.distanceMeters) || 0,
          Number(h.pinLat)    || 0, Number(h.pinLon)    || 0,
          Number(h.frontLat)  || 0, Number(h.frontLon)  || 0,
          Number(h.centerLat) || 0, Number(h.centerLon) || 0,
          Number(h.backLat)   || 0, Number(h.backLon)   || 0,
          Number(h.teeLat)    || 0, Number(h.teeLon)    || 0,
          h.id,
        ]
      );
      holesRestored++;

      for (const z of h.zones ?? []) {
        run(db,
          `INSERT OR REPLACE INTO course_zones (id, holeId, type, points) VALUES (?,?,?,?)`,
          [z.id, z.holeId, z.type, JSON.stringify(z.points ?? [])]
        );
      }
    }

    for (const hz of c.hazards ?? []) {
      run(db,
        `INSERT OR REPLACE INTO course_hazards (id, courseId, type, points) VALUES (?,?,?,?)`,
        [hz.id, hz.courseId, hz.type, JSON.stringify(hz.points ?? [])]
      );
    }
  }

  return holesRestored;
}
