export const TEE_COLORS = ['black', 'brown', 'blue', 'yellow', 'orange', 'red', 'silver'] as const;
export type TeeColor = typeof TEE_COLORS[number]; // farthest → closest

export const TEE_LABELS: Record<TeeColor, string> = {
  black:  'Negro',    brown:  'Marrón',   blue:   'Azul',
  yellow: 'Amarillo', orange: 'Naranja',  red:    'Rojo',   silver: 'Plateado',
};
export const TEE_HEX: Record<TeeColor, string> = {
  black:  '#111111',  brown:  '#8B4513',  blue:   '#2980b9',
  yellow: '#f1c40f',  orange: '#e67e22',  red:    '#e74c3c', silver: '#95a5a6',
};

export interface Course {
  id: string;
  name: string;
  city: string;
  country?: string | null; // ISO 3166-1 alpha-2, e.g. 'ES' — see src/data/worldMap.ts
  courseRating: number;
  slopeRating: number;
  createdAt: string;
}

export interface Hole {
  id: string;
  courseId: string;
  number: number;
  par: 3 | 4 | 5;
  handicapIndex: number;
  distanceMeters: number;
  pinLat: number;
  pinLon: number;
  frontLat: number;
  frontLon: number;
  centerLat: number;
  centerLon: number;
  backLat: number;
  backLon: number;
  teeLat: number;
  teeLon: number;
  // Per-color tee positions
  teeBlackLat: number;  teeBlackLon: number;
  teeBrownLat: number;  teeBrownLon: number;
  teeBlueLat: number;   teeBlueLon: number;
  teeYellowLat: number; teeYellowLon: number;
  teeOrangeLat: number; teeOrangeLon: number;
  teeRedLat: number;    teeRedLon: number;
  teeSilverLat: number; teeSilverLon: number;
}

export const GAME_FORMATS = ['stroke_play', 'stableford', 'skins', 'match_play'] as const;
export type GameFormat = typeof GAME_FORMATS[number];
export const GAME_FORMAT_LABELS: Record<GameFormat, string> = {
  stroke_play: 'Stroke Play',
  stableford: 'Stableford',
  skins: 'Skins',
  match_play: 'Match Play',
};

export interface Round {
  id: string;
  courseId: string;
  courseName?: string;
  date: string;
  isCompleted: number; // 0 | 1
  pinColor: 'red' | 'yellow' | 'blue';
  teeColor?: TeeColor;
  gameFormat?: GameFormat;
}

export interface RoundPlayer {
  id: string;
  roundId: string;
  userId: string | null;
  displayName: string;
  handicapIndex: number | null;
  isOwner: boolean;
  sortOrder: number;
}

export interface HoleScore {
  id: string;
  roundId: string;
  holeId: string;
  playerId?: string | null; // null = legacy/owner row from before multiplayer
  holeNumber?: number;
  holePar?: number;
  strokes: number;
  putts: number;
  fairwayHit: number | null; // null=par3, 0=no, 1=yes
  gir: number; // 0 | 1
  penaltyStrokes: number;
  pinColor: 'red' | 'yellow' | 'blue';
  teeColor?: TeeColor;
  firstPuttDist?: number | null;
  pinLat?: number | null;
  pinLon?: number | null;
  teeLat?: number | null;
  teeLon?: number | null;
}

export type ShotZone = 'tee' | 'calle' | 'rough' | 'bunker' | 'green' | 'agua' | '';

export interface ShotMeasurement {
  id: string;
  holeScoreId: string;
  distanceMeters: number;
  timestamp: string;
  lat: number;
  lon: number;
  club: string;
  zone: ShotZone;
  shotType?: 'normal' | 'punch' | 'poor';
  windSpeed?: number;
  windDir?: number;
  windGusts?: number;
  aimLat?: number;
  aimLon?: number;
  originLat?: number;
  originLon?: number;
}

export type ZoneType = 'green' | 'calle' | 'bunker' | 'agua';

export interface CourseZone {
  id: string;
  holeId: string;
  type: ZoneType;
  points: { lat: number; lon: number }[];
}

export type HazardType = 'agua' | 'ob';

export interface CourseHazard {
  id: string;
  courseId: string;
  type: HazardType;
  points: { lat: number; lon: number }[];
}

// Computed helpers
export function scoreToPar(round: { totalStrokes: number }, par: number) {
  return round.totalStrokes - par;
}

export function stablefordPoints(strokes: number, par: number): number {
  const diff = strokes - par;
  if (diff <= -3) return 5;
  if (diff === -2) return 4;
  if (diff === -1) return 3;
  if (diff === 0) return 2;
  if (diff === 1) return 1;
  return 0;
}

export function scoreLabel(strokes: number, par: number): string {
  const diff = strokes - par;
  switch (diff) {
    case -3: return 'Albatross';
    case -2: return 'Eagle';
    case -1: return 'Birdie';
    case 0: return 'Par';
    case 1: return 'Bogey';
    case 2: return 'Doble';
    default: return diff > 0 ? `+${diff}` : `${diff}`;
  }
}

export function handicapDifferential(score: number, courseRating: number, slopeRating: number): number {
  return (score - courseRating) * (113 / slopeRating);
}
