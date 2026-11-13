import * as SQLite from 'expo-sqlite';

interface SeedHole {
  number: number;
  par: number;
  handicapIndex: number;
  distanceMeters: number;
}

interface SeedCourse {
  id: string;
  name: string;
  city: string;
  courseRating: number;
  slopeRating: number;
  holes: SeedHole[];
}

const COURSES: SeedCourse[] = [
  // ── 9 hoyos individuales ──────────────────────────────────────────────────
  {
    id: 'seed-escorpion-masia',
    name: 'Escorpión · La Masía (9h)',
    city: 'Bétera, Valencia',
    courseRating: 36.0,
    slopeRating: 120,
    holes: [
      { number: 1, par: 5, handicapIndex: 3, distanceMeters: 441 },
      { number: 2, par: 4, handicapIndex: 8, distanceMeters: 298 },
      { number: 3, par: 4, handicapIndex: 5, distanceMeters: 318 },
      { number: 4, par: 4, handicapIndex: 1, distanceMeters: 376 },
      { number: 5, par: 4, handicapIndex: 2, distanceMeters: 336 },
      { number: 6, par: 3, handicapIndex: 9, distanceMeters: 132 },
      { number: 7, par: 4, handicapIndex: 4, distanceMeters: 337 },
      { number: 8, par: 3, handicapIndex: 7, distanceMeters: 155 },
      { number: 9, par: 5, handicapIndex: 6, distanceMeters: 428 },
    ],
  },
  {
    id: 'seed-escorpion-lagos',
    name: 'Escorpión · Los Lagos (9h)',
    city: 'Bétera, Valencia',
    courseRating: 35.0,
    slopeRating: 118,
    holes: [
      { number: 1, par: 4, handicapIndex: 3, distanceMeters: 331 },
      { number: 2, par: 4, handicapIndex: 5, distanceMeters: 290 },
      { number: 3, par: 3, handicapIndex: 9, distanceMeters: 122 },
      { number: 4, par: 4, handicapIndex: 2, distanceMeters: 302 },
      { number: 5, par: 3, handicapIndex: 8, distanceMeters: 113 },
      { number: 6, par: 5, handicapIndex: 7, distanceMeters: 433 },
      { number: 7, par: 4, handicapIndex: 6, distanceMeters: 278 },
      { number: 8, par: 3, handicapIndex: 4, distanceMeters: 145 },
      { number: 9, par: 5, handicapIndex: 1, distanceMeters: 427 },
    ],
  },
  {
    id: 'seed-escorpion-nuevos',
    name: 'Escorpión · Los Nuevos (9h)',
    city: 'Bétera, Valencia',
    courseRating: 36.0,
    slopeRating: 121,
    holes: [
      { number: 1, par: 4, handicapIndex: 8, distanceMeters: 400 },
      { number: 2, par: 4, handicapIndex: 3, distanceMeters: 300 },
      { number: 3, par: 5, handicapIndex: 7, distanceMeters: 438 },
      { number: 4, par: 3, handicapIndex: 9, distanceMeters: 111 },
      { number: 5, par: 5, handicapIndex: 5, distanceMeters: 466 },
      { number: 6, par: 4, handicapIndex: 1, distanceMeters: 347 },
      { number: 7, par: 4, handicapIndex: 2, distanceMeters: 323 },
      { number: 8, par: 3, handicapIndex: 6, distanceMeters: 155 },
      { number: 9, par: 4, handicapIndex: 4, distanceMeters: 319 },
    ],
  },
  // ── Recorridos de 18 hoyos ────────────────────────────────────────────────
  {
    id: 'seed-escorpion-blue',
    name: 'Escorpión · Blue Tour (Masía+Lagos)',
    city: 'Bétera, Valencia',
    courseRating: 71.4,
    slopeRating: 128,
    holes: [
      { number: 1,  par: 5, handicapIndex: 6,  distanceMeters: 441 },
      { number: 2,  par: 4, handicapIndex: 16, distanceMeters: 298 },
      { number: 3,  par: 4, handicapIndex: 10, distanceMeters: 318 },
      { number: 4,  par: 4, handicapIndex: 2,  distanceMeters: 376 },
      { number: 5,  par: 4, handicapIndex: 4,  distanceMeters: 336 },
      { number: 6,  par: 3, handicapIndex: 18, distanceMeters: 132 },
      { number: 7,  par: 4, handicapIndex: 8,  distanceMeters: 337 },
      { number: 8,  par: 3, handicapIndex: 14, distanceMeters: 155 },
      { number: 9,  par: 5, handicapIndex: 12, distanceMeters: 428 },
      { number: 10, par: 4, handicapIndex: 5,  distanceMeters: 331 },
      { number: 11, par: 4, handicapIndex: 9,  distanceMeters: 290 },
      { number: 12, par: 3, handicapIndex: 17, distanceMeters: 122 },
      { number: 13, par: 4, handicapIndex: 3,  distanceMeters: 302 },
      { number: 14, par: 3, handicapIndex: 15, distanceMeters: 113 },
      { number: 15, par: 5, handicapIndex: 13, distanceMeters: 433 },
      { number: 16, par: 4, handicapIndex: 11, distanceMeters: 278 },
      { number: 17, par: 3, handicapIndex: 7,  distanceMeters: 145 },
      { number: 18, par: 5, handicapIndex: 1,  distanceMeters: 427 },
    ],
  },
  {
    id: 'seed-escorpion-red',
    name: 'Escorpión · Red Tour (Lagos+Nuevos)',
    city: 'Bétera, Valencia',
    courseRating: 73.6,
    slopeRating: 135,
    holes: [
      { number: 1,  par: 4, handicapIndex: 6,  distanceMeters: 331 },
      { number: 2,  par: 4, handicapIndex: 10, distanceMeters: 290 },
      { number: 3,  par: 3, handicapIndex: 18, distanceMeters: 122 },
      { number: 4,  par: 4, handicapIndex: 4,  distanceMeters: 302 },
      { number: 5,  par: 3, handicapIndex: 16, distanceMeters: 113 },
      { number: 6,  par: 5, handicapIndex: 14, distanceMeters: 433 },
      { number: 7,  par: 4, handicapIndex: 12, distanceMeters: 278 },
      { number: 8,  par: 3, handicapIndex: 8,  distanceMeters: 145 },
      { number: 9,  par: 5, handicapIndex: 2,  distanceMeters: 427 },
      { number: 10, par: 4, handicapIndex: 15, distanceMeters: 400 },
      { number: 11, par: 4, handicapIndex: 5,  distanceMeters: 300 },
      { number: 12, par: 5, handicapIndex: 13, distanceMeters: 438 },
      { number: 13, par: 3, handicapIndex: 17, distanceMeters: 111 },
      { number: 14, par: 5, handicapIndex: 9,  distanceMeters: 466 },
      { number: 15, par: 4, handicapIndex: 1,  distanceMeters: 347 },
      { number: 16, par: 4, handicapIndex: 3,  distanceMeters: 323 },
      { number: 17, par: 3, handicapIndex: 11, distanceMeters: 155 },
      { number: 18, par: 4, handicapIndex: 7,  distanceMeters: 319 },
    ],
  },
  {
    id: 'seed-escorpion-yellow',
    name: 'Escorpión · Yellow Tour (Masía+Nuevos)',
    city: 'Bétera, Valencia',
    courseRating: 74.0,
    slopeRating: 133,
    holes: [
      { number: 1,  par: 5, handicapIndex: 6,  distanceMeters: 441 },
      { number: 2,  par: 4, handicapIndex: 16, distanceMeters: 298 },
      { number: 3,  par: 4, handicapIndex: 10, distanceMeters: 318 },
      { number: 4,  par: 4, handicapIndex: 2,  distanceMeters: 376 },
      { number: 5,  par: 4, handicapIndex: 4,  distanceMeters: 336 },
      { number: 6,  par: 3, handicapIndex: 18, distanceMeters: 132 },
      { number: 7,  par: 4, handicapIndex: 8,  distanceMeters: 337 },
      { number: 8,  par: 3, handicapIndex: 14, distanceMeters: 155 },
      { number: 9,  par: 5, handicapIndex: 12, distanceMeters: 428 },
      { number: 10, par: 4, handicapIndex: 15, distanceMeters: 400 },
      { number: 11, par: 4, handicapIndex: 5,  distanceMeters: 300 },
      { number: 12, par: 5, handicapIndex: 13, distanceMeters: 438 },
      { number: 13, par: 3, handicapIndex: 17, distanceMeters: 111 },
      { number: 14, par: 5, handicapIndex: 9,  distanceMeters: 466 },
      { number: 15, par: 4, handicapIndex: 1,  distanceMeters: 347 },
      { number: 16, par: 4, handicapIndex: 3,  distanceMeters: 323 },
      { number: 17, par: 3, handicapIndex: 11, distanceMeters: 155 },
      { number: 18, par: 4, handicapIndex: 7,  distanceMeters: 319 },
    ],
  },
];

export function seedCoursesIfEmpty(db: SQLite.SQLiteDatabase) {
  const existing = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM courses WHERE id LIKE "seed-%"'
  );
  if (existing && existing.count > 0) return;

  for (const course of COURSES) {
    db.runSync(
      `INSERT OR IGNORE INTO courses (id, name, city, courseRating, slopeRating)
       VALUES (?, ?, ?, ?, ?)`,
      [course.id, course.name, course.city, course.courseRating, course.slopeRating]
    );
    for (const hole of course.holes) {
      const holeId = `${course.id}-h${hole.number}`;
      db.runSync(
        `INSERT OR IGNORE INTO holes
           (id, courseId, number, par, handicapIndex, distanceMeters)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [holeId, course.id, hole.number, hole.par, hole.handicapIndex, hole.distanceMeters]
      );
    }
  }
}
