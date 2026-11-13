import * as SQLite from 'expo-sqlite';
import { Course, Hole, Round, HoleScore, ShotMeasurement, CourseZone, ZoneType, CourseHazard, HazardType, TeeColor, TEE_COLORS } from '../types';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── COURSES ─────────────────────────────────────────────────────────────────

export function getCourses(db: SQLite.SQLiteDatabase): Course[] {
  return db.getAllSync<Course>('SELECT * FROM courses ORDER BY name ASC');
}

export function getCourse(db: SQLite.SQLiteDatabase, id: string): Course | null {
  return db.getFirstSync<Course>('SELECT * FROM courses WHERE id = ?', [id]);
}

export function insertCourse(
  db: SQLite.SQLiteDatabase,
  data: { name: string; city: string; courseRating: number; slopeRating: number }
): string {
  const id = uuid();
  db.runSync(
    'INSERT INTO courses (id, name, city, courseRating, slopeRating) VALUES (?, ?, ?, ?, ?)',
    [id, data.name, data.city, data.courseRating, data.slopeRating]
  );
  return id;
}

export function updateCourse(
  db: SQLite.SQLiteDatabase,
  id: string,
  data: Partial<{ name: string; city: string; courseRating: number; slopeRating: number }>
) {
  const fields = Object.keys(data).map((k) => `${k} = ?`).join(', ');
  db.runSync(`UPDATE courses SET ${fields} WHERE id = ?`, [...Object.values(data), id]);
}

export function deleteCourse(db: SQLite.SQLiteDatabase, id: string) {
  db.runSync('DELETE FROM courses WHERE id = ?', [id]);
}

/**
 * Adds holes from secondId into firstId (in place).
 * - firstId course is renamed to mergedName and gains the extra holes.
 * - secondId course is NOT deleted — it stays untouched.
 * - Hole IDs from secondId are preserved (they just change courseId + number).
 */
export function mergeCourses(
  db: SQLite.SQLiteDatabase,
  firstId: string,
  secondId: string,
  mergedName: string,
): void {
  const firstHoles  = db.getAllSync<{ id: string; number: number }>(
    'SELECT id, number FROM holes WHERE courseId = ? ORDER BY number ASC', [firstId],
  );
  const secondHoles = db.getAllSync<any>(
    'SELECT * FROM holes WHERE courseId = ? ORDER BY number ASC', [secondId],
  );
  const offset = firstHoles.length;

  // Copy second course's holes into first course with new IDs and renumbered
  for (let i = 0; i < secondHoles.length; i++) {
    const h = secondHoles[i];
    const newHoleId = uuid();
    db.runSync(
      `INSERT INTO holes
         (id, courseId, number, par, handicapIndex, distanceMeters,
          pinLat, pinLon, frontLat, frontLon, centerLat, centerLon,
          backLat, backLon, teeLat, teeLon,
          teeBlackLat, teeBlackLon, teeBrownLat, teeBrownLon,
          teeBlueLat, teeBlueLon, teeYellowLat, teeYellowLon,
          teeOrangeLat, teeOrangeLon, teeRedLat, teeRedLon,
          teeSilverLat, teeSilverLon)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newHoleId, firstId, offset + i + 1,
        h.par ?? 4, h.handicapIndex ?? 1, h.distanceMeters ?? 0,
        h.pinLat ?? 0, h.pinLon ?? 0, h.frontLat ?? 0, h.frontLon ?? 0,
        h.centerLat ?? 0, h.centerLon ?? 0, h.backLat ?? 0, h.backLon ?? 0,
        h.teeLat ?? 0, h.teeLon ?? 0,
        h.teeBlackLat  ?? 0, h.teeBlackLon  ?? 0,
        h.teeBrownLat  ?? 0, h.teeBrownLon  ?? 0,
        h.teeBlueLat   ?? 0, h.teeBlueLon   ?? 0,
        h.teeYellowLat ?? 0, h.teeYellowLon ?? 0,
        h.teeOrangeLat ?? 0, h.teeOrangeLon ?? 0,
        h.teeRedLat    ?? 0, h.teeRedLon    ?? 0,
        h.teeSilverLat ?? 0, h.teeSilverLon ?? 0,
      ],
    );
    // Copy zones for this hole
    const zones = db.getAllSync<any>('SELECT * FROM course_zones WHERE holeId = ?', [h.id]);
    for (const z of zones) {
      db.runSync(
        `INSERT INTO course_zones (id, holeId, type, points) VALUES (?,?,?,?)`,
        [uuid(), newHoleId, z.type, z.points],
      );
    }
  }

  // Copy hazards from second course into first
  const hazards = db.getAllSync<any>('SELECT * FROM course_hazards WHERE courseId = ?', [secondId]);
  for (const hz of hazards) {
    db.runSync(
      `INSERT INTO course_hazards (id, courseId, type, points) VALUES (?,?,?,?)`,
      [uuid(), firstId, hz.type, hz.points],
    );
  }

  // Rename first course
  db.runSync('UPDATE courses SET name = ? WHERE id = ?', [mergedName, firstId]);
}

// ─── HOLES ────────────────────────────────────────────────────────────────────

export function getHoles(db: SQLite.SQLiteDatabase, courseId: string): Hole[] {
  return db.getAllSync<Hole>(
    'SELECT * FROM holes WHERE courseId = ? ORDER BY number ASC',
    [courseId]
  );
}

export function insertHole(
  db: SQLite.SQLiteDatabase,
  data: { courseId: string; number: number; par: number; handicapIndex: number; distanceMeters?: number }
): string {
  const id = uuid();
  db.runSync(
    'INSERT INTO holes (id, courseId, number, par, handicapIndex, distanceMeters) VALUES (?, ?, ?, ?, ?, ?)',
    [id, data.courseId, data.number, data.par, data.handicapIndex, data.distanceMeters ?? 360]
  );
  return id;
}

export function updateHole(db: SQLite.SQLiteDatabase, id: string, data: Partial<Hole>) {
  const { id: _id, courseId: _cId, ...rest } = data as any;
  const fields = Object.keys(rest).map((k) => `${k} = ?`).join(', ');
  if (!fields) return;
  db.runSync(`UPDATE holes SET ${fields} WHERE id = ?`, [...Object.values(rest), id] as any[]);
}

export function updateHoleTee(db: SQLite.SQLiteDatabase, id: string, lat: number, lon: number) {
  db.runSync('UPDATE holes SET teeLat=?, teeLon=? WHERE id=?', [lat, lon, id]);
}

export function updateHoleTeeColor(db: SQLite.SQLiteDatabase, id: string, color: TeeColor, lat: number, lon: number) {
  const cap = color.charAt(0).toUpperCase() + color.slice(1);
  db.runSync(`UPDATE holes SET tee${cap}Lat=?, tee${cap}Lon=? WHERE id=?`, [lat, lon, id]);
}

/** Returns the position of a specific tee color.
 *  Falls back to the legacy teeLat/teeLon for any color so that holes mapped before
 *  multi-tee was added continue to work regardless of which teeColor is selected. */
export function getTeePos(hole: Hole, color: TeeColor): { lat: number; lon: number } | null {
  const cap = color.charAt(0).toUpperCase() + color.slice(1);
  const lat = (hole as any)[`tee${cap}Lat`] as number ?? 0;
  const lon = (hole as any)[`tee${cap}Lon`] as number ?? 0;
  if (lat !== 0) return { lat, lon };
  // Legacy fallback: single tee position stored before multi-tee support
  if (hole.teeLat !== 0) return { lat: hole.teeLat, lon: hole.teeLon };
  return null;
}

/** Returns the first available tee position, farthest-first. */
export function getAnyTeePos(hole: Hole): { lat: number; lon: number } | null {
  for (const c of TEE_COLORS) {
    const p = getTeePos(hole, c);
    if (p) return p;
  }
  return null;
}

export function updateHolePinColor(
  db: SQLite.SQLiteDatabase,
  id: string,
  color: 'red' | 'yellow' | 'blue',
  lat: number,
  lon: number
) {
  if (color === 'red') {
    db.runSync('UPDATE holes SET frontLat=?, frontLon=? WHERE id=?', [lat, lon, id]);
  } else if (color === 'yellow') {
    // Also update pinLat/pinLon (used as hasCoords sentinel)
    db.runSync('UPDATE holes SET centerLat=?, centerLon=?, pinLat=?, pinLon=? WHERE id=?', [lat, lon, lat, lon, id]);
  } else {
    db.runSync('UPDATE holes SET backLat=?, backLon=? WHERE id=?', [lat, lon, id]);
  }
}

export function updateHoleGPS(
  db: SQLite.SQLiteDatabase,
  id: string,
  coords: { pinLat: number; pinLon: number; frontLat: number; frontLon: number; centerLat: number; centerLon: number; backLat: number; backLon: number }
) {
  db.runSync(
    `UPDATE holes SET pinLat=?, pinLon=?, frontLat=?, frontLon=?, centerLat=?, centerLon=?, backLat=?, backLon=? WHERE id=?`,
    [coords.pinLat, coords.pinLon, coords.frontLat, coords.frontLon, coords.centerLat, coords.centerLon, coords.backLat, coords.backLon, id]
  );
}

// ─── ROUNDS ──────────────────────────────────────────────────────────────────

export function getRounds(db: SQLite.SQLiteDatabase): (Round & { courseName: string })[] {
  return db.getAllSync(
    `SELECT r.*, c.name as courseName FROM rounds r
     JOIN courses c ON r.courseId = c.id
     WHERE r.isCompleted = 1
     ORDER BY r.date DESC`
  );
}

export function getActiveRound(db: SQLite.SQLiteDatabase): (Round & { courseName: string }) | null {
  return db.getFirstSync(
    `SELECT r.*, c.name as courseName FROM rounds r
     JOIN courses c ON r.courseId = c.id
     WHERE r.isCompleted = 0
     ORDER BY r.date DESC LIMIT 1`
  );
}

export function getRound(db: SQLite.SQLiteDatabase, id: string): (Round & { courseName: string; courseRating: number; slopeRating: number }) | null {
  return db.getFirstSync(
    `SELECT r.*, c.name as courseName, c.courseRating, c.slopeRating FROM rounds r
     JOIN courses c ON r.courseId = c.id WHERE r.id = ?`,
    [id]
  );
}

export function insertRound(
  db: SQLite.SQLiteDatabase,
  courseId: string,
  pinColor: 'red' | 'yellow' | 'blue' = 'yellow',
  teeColor: TeeColor = 'yellow'
): string {
  const id = uuid();
  db.runSync('INSERT INTO rounds (id, courseId, pinColor, teeColor) VALUES (?, ?, ?, ?)', [id, courseId, pinColor, teeColor]);
  return id;
}

export function completeRound(db: SQLite.SQLiteDatabase, id: string) {
  db.runSync('UPDATE rounds SET isCompleted = 1 WHERE id = ?', [id]);
}

export function deleteRound(db: SQLite.SQLiteDatabase, id: string) {
  db.runSync('DELETE FROM rounds WHERE id = ?', [id]);
}

// ─── HOLE SCORES ─────────────────────────────────────────────────────────────

export function getHoleScores(db: SQLite.SQLiteDatabase, roundId: string): (HoleScore & { holeNumber: number; holePar: number })[] {
  return db.getAllSync(
    `SELECT hs.*, h.number as holeNumber, h.par as holePar
     FROM hole_scores hs JOIN holes h ON hs.holeId = h.id
     WHERE hs.roundId = ? ORDER BY h.number ASC`,
    [roundId]
  );
}

export function insertHoleScore(
  db: SQLite.SQLiteDatabase,
  data: { roundId: string; holeId: string; strokes: number; putts?: number; fairwayHit?: number | null; par: number; pinColor?: 'red' | 'yellow' | 'blue'; teeColor?: TeeColor }
): string {
  const id = uuid();
  const fairway = data.par === 3 ? null : (data.fairwayHit ?? 0);
  db.runSync(
    'INSERT INTO hole_scores (id, roundId, holeId, strokes, putts, fairwayHit, pinColor, teeColor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.roundId, data.holeId, data.strokes, data.putts ?? 2, fairway, data.pinColor ?? 'yellow', data.teeColor ?? 'yellow']
  );
  return id;
}

export function updateHoleScore(
  db: SQLite.SQLiteDatabase,
  id: string,
  data: Partial<{ strokes: number; putts: number; fairwayHit: number | null; gir: number; penaltyStrokes: number; pinColor: 'red' | 'yellow' | 'blue'; firstPuttDist: number | null }>
) {
  const fields = Object.keys(data).map((k) => `${k} = ?`).join(', ');
  db.runSync(`UPDATE hole_scores SET ${fields} WHERE id = ?`, [...Object.values(data), id]);
}

// ─── SHOT MEASUREMENTS ───────────────────────────────────────────────────────

export function getShotMeasurements(db: SQLite.SQLiteDatabase, holeScoreId: string): ShotMeasurement[] {
  return db.getAllSync(
    'SELECT * FROM shot_measurements WHERE holeScoreId = ? ORDER BY timestamp ASC',
    [holeScoreId]
  );
}

export function insertShotMeasurement(
  db: SQLite.SQLiteDatabase,
  holeScoreId: string,
  distanceMeters: number,
  opts?: { lat?: number; lon?: number; club?: string; zone?: string; shotType?: string; aimLat?: number; aimLon?: number; originLat?: number; originLon?: number; windSpeed?: number; windDir?: number; windGusts?: number }
): string {
  const id = uuid();
  db.runSync(
    'INSERT INTO shot_measurements (id, holeScoreId, distanceMeters, lat, lon, club, zone, shotType, aimLat, aimLon, originLat, originLon, windSpeed, windDir, windGusts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, holeScoreId, distanceMeters, opts?.lat ?? 0, opts?.lon ?? 0, opts?.club ?? '', opts?.zone ?? '', opts?.shotType ?? 'normal', opts?.aimLat ?? 0, opts?.aimLon ?? 0, opts?.originLat ?? 0, opts?.originLon ?? 0, opts?.windSpeed ?? 0, opts?.windDir ?? 0, opts?.windGusts ?? 0]
  );
  return id;
}

export function getGPSShotsForRound(
  db: SQLite.SQLiteDatabase,
  roundId: string
): (ShotMeasurement & { holeId: string })[] {
  return db.getAllSync(
    `SELECT sm.*, hs.holeId
     FROM shot_measurements sm
     JOIN hole_scores hs ON sm.holeScoreId = hs.id
     WHERE hs.roundId = ? AND sm.lat != 0
     ORDER BY hs.id, sm.timestamp ASC`,
    [roundId]
  );
}

export function updateShotPosition(db: SQLite.SQLiteDatabase, id: string, lat: number, lon: number) {
  db.runSync('UPDATE shot_measurements SET lat = ?, lon = ? WHERE id = ?', [lat, lon, id]);
}

export function updateShotDistance(db: SQLite.SQLiteDatabase, id: string, distanceMeters: number) {
  db.runSync('UPDATE shot_measurements SET distanceMeters = ? WHERE id = ?', [distanceMeters, id]);
}

export function updateShotZone(db: SQLite.SQLiteDatabase, id: string, zone: string) {
  db.runSync('UPDATE shot_measurements SET zone = ? WHERE id = ?', [zone, id]);
}

export function updateShotType(db: SQLite.SQLiteDatabase, id: string, shotType: string) {
  db.runSync("UPDATE shot_measurements SET shotType = ? WHERE id = ?", [shotType, id]);
}

export function updateShotClub(db: SQLite.SQLiteDatabase, id: string, club: string) {
  db.runSync('UPDATE shot_measurements SET club = ? WHERE id = ?', [club, id]);
}

export function updateShotAim(db: SQLite.SQLiteDatabase, id: string, aimLat: number, aimLon: number) {
  db.runSync('UPDATE shot_measurements SET aimLat = ?, aimLon = ? WHERE id = ?', [aimLat, aimLon, id]);
}

export function deleteShotMeasurement(db: SQLite.SQLiteDatabase, id: string) {
  db.runSync('DELETE FROM shot_measurements WHERE id = ?', [id]);
}

// ─── COURSE ZONES (polygons) ─────────────────────────────────────────────────

function rowsToZones(rows: { id: string; holeId: string; type: string; points: string }[]): CourseZone[] {
  return rows.map((r) => {
    let pts: { lat: number; lon: number }[] = [];
    try { pts = JSON.parse(r.points); } catch {}
    return { id: r.id, holeId: r.holeId, type: r.type as ZoneType, points: pts };
  });
}

export function getZonesForHole(db: SQLite.SQLiteDatabase, holeId: string): CourseZone[] {
  const rows = db.getAllSync<{ id: string; holeId: string; type: string; points: string }>(
    'SELECT * FROM course_zones WHERE holeId = ?',
    [holeId]
  );
  return rowsToZones(rows);
}

export function getZonesForCourse(db: SQLite.SQLiteDatabase, courseId: string): CourseZone[] {
  const rows = db.getAllSync<{ id: string; holeId: string; type: string; points: string }>(
    `SELECT z.* FROM course_zones z JOIN holes h ON z.holeId = h.id WHERE h.courseId = ?`,
    [courseId]
  );
  return rowsToZones(rows);
}

export function insertZone(
  db: SQLite.SQLiteDatabase,
  holeId: string,
  type: ZoneType,
  points: { lat: number; lon: number }[]
): string {
  const id = uuid();
  db.runSync(
    'INSERT INTO course_zones (id, holeId, type, points) VALUES (?, ?, ?, ?)',
    [id, holeId, type, JSON.stringify(points)]
  );
  return id;
}

export function deleteZone(db: SQLite.SQLiteDatabase, id: string) {
  db.runSync('DELETE FROM course_zones WHERE id = ?', [id]);
}

export function deleteZonesForHole(db: SQLite.SQLiteDatabase, holeId: string): void {
  db.runSync('DELETE FROM course_zones WHERE holeId = ?', [holeId]);
}

// ─── COURSE HAZARDS ──────────────────────────────────────────────────────────

function rowsToHazards(rows: { id: string; courseId: string; type: string; points: string }[]): CourseHazard[] {
  return rows.map(r => {
    let pts: { lat: number; lon: number }[] = [];
    try { pts = JSON.parse(r.points); } catch {}
    return { id: r.id, courseId: r.courseId, type: r.type as HazardType, points: pts };
  });
}

export function getCourseHazards(db: SQLite.SQLiteDatabase, courseId: string): CourseHazard[] {
  const rows = db.getAllSync<{ id: string; courseId: string; type: string; points: string }>(
    'SELECT * FROM course_hazards WHERE courseId = ?', [courseId]
  );
  return rowsToHazards(rows);
}

export function insertCourseHazard(
  db: SQLite.SQLiteDatabase, courseId: string, type: HazardType, points: { lat: number; lon: number }[]
): string {
  const id = uuid();
  db.runSync('INSERT INTO course_hazards (id, courseId, type, points) VALUES (?, ?, ?, ?)',
    [id, courseId, type, JSON.stringify(points)]);
  return id;
}

export function deleteCourseHazard(db: SQLite.SQLiteDatabase, id: string) {
  db.runSync('DELETE FROM course_hazards WHERE id = ?', [id]);
}

// ─── CLUB STATS ──────────────────────────────────────────────────────────────

export interface ClubStat {
  club: string;
  shots: number;
  avgDist: number;
  minDist: number;
  maxDist: number;
}

export function getClubStats(db: SQLite.SQLiteDatabase): ClubStat[] {
  return db.getAllSync<ClubStat>(
    `SELECT club,
            COUNT(*)               as shots,
            ROUND(AVG(distanceMeters)) as avgDist,
            MIN(distanceMeters)    as minDist,
            MAX(distanceMeters)    as maxDist
     FROM shot_measurements
     WHERE club != '' AND distanceMeters > 0
     GROUP BY club
     ORDER BY avgDist DESC`
  );
}

export interface ClubSetting {
  club: string;
  manualDist: number;
}

export function getClubSettings(db: SQLite.SQLiteDatabase): ClubSetting[] {
  return db.getAllSync<ClubSetting>('SELECT club, manualDist FROM club_settings ORDER BY club ASC');
}

export function setClubManualDist(db: SQLite.SQLiteDatabase, club: string, dist: number) {
  db.runSync(
    'INSERT INTO club_settings (club, manualDist) VALUES (?, ?) ON CONFLICT(club) DO UPDATE SET manualDist = excluded.manualDist',
    [club, dist]
  );
}

export interface ShotRecord {
  id: string;
  dist: number;
  date: string;
  holeNum: number;
  roundId: string;
  holeId: string;
  courseName: string;
  zone: string;
  shotType: string;
  lat: number;
  lon: number;
  aimLat: number;
  aimLon: number;
  originLat: number;
  originLon: number;
  windSpeed: number;
  windDir: number;
  windGusts: number;
}

export function getShotsForClub(db: SQLite.SQLiteDatabase, club: string): ShotRecord[] {
  return db.getAllSync<ShotRecord>(
    `SELECT sm.id, sm.distanceMeters as dist, r.date, h.number as holeNum,
            hs.roundId, hs.holeId, c.name as courseName,
            sm.zone, COALESCE(sm.shotType, 'normal') as shotType,
            sm.lat, sm.lon,
            COALESCE(sm.aimLat, 0) as aimLat, COALESCE(sm.aimLon, 0) as aimLon,
            COALESCE(sm.originLat, 0) as originLat, COALESCE(sm.originLon, 0) as originLon,
            COALESCE(sm.windSpeed, 0) as windSpeed, COALESCE(sm.windDir, 0) as windDir,
            COALESCE(sm.windGusts, 0) as windGusts
     FROM shot_measurements sm
     JOIN hole_scores hs ON sm.holeScoreId = hs.id
     JOIN rounds r ON hs.roundId = r.id
     JOIN holes h ON hs.holeId = h.id
     JOIN courses c ON r.courseId = c.id
     WHERE sm.club = ? AND sm.distanceMeters > 5 AND sm.lat != 0
     ORDER BY r.date DESC, sm.timestamp DESC`,
    [club]
  );
}

export function getAllClubStats(db: SQLite.SQLiteDatabase): ClubStat[] {
  return db.getAllSync<ClubStat>(
    `SELECT sm.club,
            COUNT(*) as shots,
            ROUND(AVG(sm.distanceMeters)) as avgDist,
            MIN(sm.distanceMeters) as minDist,
            MAX(sm.distanceMeters) as maxDist
     FROM shot_measurements sm
     JOIN hole_scores hs ON sm.holeScoreId = hs.id
     WHERE sm.club != '' AND sm.distanceMeters > 5 AND sm.lat != 0
       AND (sm.shotType IS NULL OR sm.shotType = 'normal')
     GROUP BY sm.club
     ORDER BY avgDist DESC`,
  );
}

export function getClubStatsForRound(db: SQLite.SQLiteDatabase, roundId: string): ClubStat[] {
  return db.getAllSync<ClubStat>(
    `SELECT sm.club,
            COUNT(*)                  as shots,
            ROUND(AVG(sm.distanceMeters)) as avgDist,
            MIN(sm.distanceMeters)    as minDist,
            MAX(sm.distanceMeters)    as maxDist
     FROM shot_measurements sm
     JOIN hole_scores hs ON sm.holeScoreId = hs.id
     WHERE hs.roundId = ? AND sm.club != '' AND sm.distanceMeters > 0
       AND (sm.shotType IS NULL OR sm.shotType = 'normal')
     GROUP BY sm.club
     ORDER BY avgDist DESC`,
    [roundId]
  );
}

export interface ScramblingStats {
  missedGir: number;
  scrambled: number;      // missed GIR but made par or better
  bunkerHoles: number;    // holes with ≥1 bunker shot
  bunkerSaves: number;    // bunker holes where par or better made
}

export function getScramblingStats(db: SQLite.SQLiteDatabase): ScramblingStats {
  const row = db.getFirstSync<ScramblingStats>(`
    SELECT
      SUM(CASE WHEN hs.gir = 0 THEN 1 ELSE 0 END)                                          AS missedGir,
      SUM(CASE WHEN hs.gir = 0 AND hs.strokes <= h.par THEN 1 ELSE 0 END)                  AS scrambled,
      SUM(CASE WHEN EXISTS (
            SELECT 1 FROM shot_measurements sm
            WHERE sm.holeScoreId = hs.id AND sm.zone = 'bunker'
          ) THEN 1 ELSE 0 END)                                                              AS bunkerHoles,
      SUM(CASE WHEN hs.strokes <= h.par AND EXISTS (
            SELECT 1 FROM shot_measurements sm
            WHERE sm.holeScoreId = hs.id AND sm.zone = 'bunker'
          ) THEN 1 ELSE 0 END)                                                              AS bunkerSaves
    FROM hole_scores hs
    JOIN holes h      ON hs.holeId  = h.id
    JOIN rounds r     ON hs.roundId = r.id
    WHERE r.isCompleted = 1
  `);
  return row ?? { missedGir: 0, scrambled: 0, bunkerHoles: 0, bunkerSaves: 0 };
}

// ─── STATS HELPERS ───────────────────────────────────────────────────────────

export interface RoundStats {
  id: string;
  date: string;
  courseName: string;
  courseRating: number;
  slopeRating: number;
  totalStrokes: number;
  totalPutts: number;
  totalPar: number;
  fairwaysHit: number;
  fairwaysTotal: number;
  girsHit: number;
  holesCount: number;
  stablefordPoints: number;
}

export function getRoundStats(db: SQLite.SQLiteDatabase, roundId: string): RoundStats | null {
  return db.getFirstSync(`
    SELECT
      r.id, r.date,
      c.name as courseName, c.courseRating, c.slopeRating,
      SUM(hs.strokes) as totalStrokes,
      SUM(hs.putts) as totalPutts,
      SUM(h.par) as totalPar,
      SUM(CASE WHEN hs.fairwayHit = 1 THEN 1 ELSE 0 END) as fairwaysHit,
      SUM(CASE WHEN h.par > 3 THEN 1 ELSE 0 END) as fairwaysTotal,
      SUM(hs.gir) as girsHit,
      COUNT(hs.id) as holesCount,
      SUM(
        CASE
          WHEN (hs.strokes - h.par) <= -3 THEN 5
          WHEN (hs.strokes - h.par) = -2 THEN 4
          WHEN (hs.strokes - h.par) = -1 THEN 3
          WHEN (hs.strokes - h.par) = 0 THEN 2
          WHEN (hs.strokes - h.par) = 1 THEN 1
          ELSE 0
        END
      ) as stablefordPoints
    FROM rounds r
    JOIN courses c ON r.courseId = c.id
    JOIN hole_scores hs ON hs.roundId = r.id
    JOIN holes h ON hs.holeId = h.id
    WHERE r.id = ?
    GROUP BY r.id
  `, [roundId]);
}

export function getAllRoundStats(db: SQLite.SQLiteDatabase): RoundStats[] {
  return db.getAllSync(`
    SELECT
      r.id, r.date,
      c.name as courseName, c.courseRating, c.slopeRating,
      SUM(hs.strokes) as totalStrokes,
      SUM(hs.putts) as totalPutts,
      SUM(h.par) as totalPar,
      SUM(CASE WHEN hs.fairwayHit = 1 THEN 1 ELSE 0 END) as fairwaysHit,
      SUM(CASE WHEN h.par > 3 THEN 1 ELSE 0 END) as fairwaysTotal,
      SUM(hs.gir) as girsHit,
      COUNT(hs.id) as holesCount,
      SUM(
        CASE
          WHEN (hs.strokes - h.par) <= -3 THEN 5
          WHEN (hs.strokes - h.par) = -2 THEN 4
          WHEN (hs.strokes - h.par) = -1 THEN 3
          WHEN (hs.strokes - h.par) = 0 THEN 2
          WHEN (hs.strokes - h.par) = 1 THEN 1
          ELSE 0
        END
      ) as stablefordPoints
    FROM rounds r
    JOIN courses c ON r.courseId = c.id
    JOIN hole_scores hs ON hs.roundId = r.id
    JOIN holes h ON hs.holeId = h.id
    WHERE r.isCompleted = 1
    GROUP BY r.id
    ORDER BY r.date ASC
  `);
}
