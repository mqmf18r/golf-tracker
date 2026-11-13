import * as SQLite from 'expo-sqlite';
import { seedCoursesIfEmpty } from './seedCourses';

export function migrateDatabase(db: SQLite.SQLiteDatabase) {
  db.execSync(`PRAGMA journal_mode = WAL;`);
  db.execSync(`PRAGMA foreign_keys = ON;`);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      courseRating REAL NOT NULL DEFAULT 72.0,
      slopeRating INTEGER NOT NULL DEFAULT 113,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holes (
      id TEXT PRIMARY KEY,
      courseId TEXT NOT NULL,
      number INTEGER NOT NULL,
      par INTEGER NOT NULL DEFAULT 4,
      handicapIndex INTEGER NOT NULL DEFAULT 1,
      distanceMeters INTEGER NOT NULL DEFAULT 360,
      pinLat REAL NOT NULL DEFAULT 0,
      pinLon REAL NOT NULL DEFAULT 0,
      frontLat REAL NOT NULL DEFAULT 0,
      frontLon REAL NOT NULL DEFAULT 0,
      centerLat REAL NOT NULL DEFAULT 0,
      centerLon REAL NOT NULL DEFAULT 0,
      backLat REAL NOT NULL DEFAULT 0,
      backLon REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY,
      courseId TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT (datetime('now')),
      isCompleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hole_scores (
      id TEXT PRIMARY KEY,
      roundId TEXT NOT NULL,
      holeId TEXT NOT NULL,
      strokes INTEGER NOT NULL DEFAULT 4,
      putts INTEGER NOT NULL DEFAULT 2,
      fairwayHit INTEGER,
      gir INTEGER NOT NULL DEFAULT 0,
      penaltyStrokes INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (roundId) REFERENCES rounds(id) ON DELETE CASCADE,
      FOREIGN KEY (holeId) REFERENCES holes(id)
    );

    CREATE TABLE IF NOT EXISTS shot_measurements (
      id TEXT PRIMARY KEY,
      holeScoreId TEXT NOT NULL,
      distanceMeters REAL NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (holeScoreId) REFERENCES hole_scores(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS course_zones (
      id TEXT PRIMARY KEY,
      holeId TEXT NOT NULL,
      type TEXT NOT NULL,
      points TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (holeId) REFERENCES holes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS course_hazards (
      id TEXT PRIMARY KEY,
      courseId TEXT NOT NULL,
      type TEXT NOT NULL,
      points TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  // Add tee GPS columns (migration for existing DBs)
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeLat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeLon REAL NOT NULL DEFAULT 0'); } catch {}

  // Per-color tee positions (7 colors: farthest → closest)
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeBlackLat  REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeBlackLon  REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeBrownLat  REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeBrownLon  REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeBlueLat   REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeBlueLon   REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeYellowLat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeYellowLon REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeOrangeLat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeOrangeLon REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeRedLat    REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeRedLon    REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeSilverLat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE holes ADD COLUMN teeSilverLon REAL NOT NULL DEFAULT 0'); } catch {}
  // Copy existing single tee → black tee slot for legacy data
  try { db.execSync('UPDATE holes SET teeBlackLat=teeLat, teeBlackLon=teeLon WHERE teeLat != 0 AND teeBlackLat = 0'); } catch {}

  // Pin color per round
  try { db.execSync("ALTER TABLE rounds ADD COLUMN pinColor TEXT NOT NULL DEFAULT 'yellow'"); } catch {}
  // Tee color per round
  try { db.execSync("ALTER TABLE rounds ADD COLUMN teeColor TEXT NOT NULL DEFAULT 'yellow'"); } catch {}

  // GPS shot position + club
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN lat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN lon REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync("ALTER TABLE shot_measurements ADD COLUMN club TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.execSync("ALTER TABLE shot_measurements ADD COLUMN zone TEXT NOT NULL DEFAULT ''"); } catch {}

  // Per-hole flag color (chosen on the fly during the round)
  try { db.execSync("ALTER TABLE hole_scores ADD COLUMN pinColor TEXT NOT NULL DEFAULT 'yellow'"); } catch {}
  try { db.execSync("ALTER TABLE hole_scores ADD COLUMN teeColor TEXT NOT NULL DEFAULT 'yellow'"); } catch {}
  try { db.execSync('ALTER TABLE hole_scores ADD COLUMN firstPuttDist REAL'); } catch {}
  try { db.execSync("ALTER TABLE shot_measurements ADD COLUMN shotType TEXT NOT NULL DEFAULT 'normal'"); } catch {}
  // Wind at time of shot
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN windSpeed  INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN windDir    INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN windGusts  INTEGER NOT NULL DEFAULT 0'); } catch {}
  // Aim direction + origin per shot
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN aimLat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN aimLon REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN originLat REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.execSync('ALTER TABLE shot_measurements ADD COLUMN originLon REAL NOT NULL DEFAULT 0'); } catch {}

  // Manual club distances set by the user
  db.execSync(`
    CREATE TABLE IF NOT EXISTS club_settings (
      club TEXT PRIMARY KEY,
      manualDist INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Remove non-Escorpión seed courses from old installs
  db.execSync(`DELETE FROM courses WHERE id LIKE 'seed-%' AND id NOT LIKE 'seed-escorpion-%'`);

  seedCoursesIfEmpty(db);
}
