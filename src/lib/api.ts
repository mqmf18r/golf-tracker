import { supabase } from './supabase';
import {
  Course, Hole, Round, HoleScore, ShotMeasurement,
  CourseZone, CourseHazard, ZoneType, HazardType, TeeColor,
  stablefordPoints, GameFormat, RoundPlayer,
} from '../types';
import { LatLon, lateralDeviationM } from '../services/geo';

// ── Pure helpers (no DB) ────────────────────────────────────────────────────
export { getTeePos, getAnyTeePos } from '../db/queries';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── snake_case ↔ camelCase converters ───────────────────────────────────────
function s2c(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_(\w)/g, (_, c) => c.toUpperCase()),
      v,
    ]),
  );
}
function c2s(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k.replace(/([A-Z])/g, '_$1').toLowerCase(), v]),
  );
}

async function uid(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ── Exported stat / extra types ────────────────────────────────────────────

export interface RoundStats {
  id: string;
  courseId: string;
  courseName: string;
  date: string;
  courseRating?: number;
  slopeRating?: number;
  teeColor?: string;
  pinColor?: string;
  totalStrokes: number;
  totalPutts: number;
  totalPar: number;
  fairwaysHit: number;
  fairwaysTotal: number;
  girsHit: number;
  holesCount: number;
  stablefordPoints: number;
}

export interface ScramblingStats {
  missedGir: number;
  scrambled: number;
  bunkerHoles: number;
  bunkerSaves: number;
}

export interface PuttingStats {
  avgPuttsGir: number | null;
  avgPuttsNonGir: number | null;
  girHoles: number;
  nonGirHoles: number;
}

export interface ApproachStats {
  avgFirstPuttDist: number | null;
  count: number;
}

export interface ClubStat {
  club: string;
  shots: number;
  avgDist: number;
  minDist: number;
  maxDist: number;
}

export interface ClubProfile extends ClubStat {
  avgLateral: number | null; // signed metres, +right / -left; null if no aimed shots logged
  source: 'gps' | 'manual'; // 'manual' = falls back to the "Mis palos" manual distance (not enough real GPS shots yet)
}

export interface ShotRecord {
  id: string;
  dist: number;
  club: string;
  zone: string;
  shotType: string;
  roundId: string;
  holeId: string;
  holeNumber?: number;
  courseName: string;
  date: string;
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

// ── COURSES ────────────────────────────────────────────────────────────────

export async function getCourses(): Promise<Course[]> {
  const { data } = await supabase.from('courses').select('*').order('name');
  return (data ?? []).map(r => s2c(r) as Course);
}

export async function getCourse(id: string): Promise<Course | null> {
  const { data } = await supabase.from('courses').select('*').eq('id', id).single();
  return data ? s2c(data) as Course : null;
}

export async function insertCourse(info: {
  name: string; city: string; country?: string; courseRating: number; slopeRating: number;
}): Promise<string> {
  const userId = await uid();
  const id = uuid();
  const { error } = await supabase.from('courses').insert({
    id, user_id: userId, ...c2s(info),
  });
  if (error) throw error;
  return id;
}

export async function updateCourse(id: string, info: Partial<{
  name: string; city: string; country: string | null; courseRating: number; slopeRating: number;
}>) {
  const { error } = await supabase.from('courses').update(c2s(info)).eq('id', id);
  if (error) throw error;
}

export async function deleteCourse(id: string) {
  const { error } = await supabase.from('courses').delete().eq('id', id);
  if (error) throw error;
}

export async function mergeCourses(firstId: string, secondId: string, mergedName: string) {
  const holes = await getHoles(secondId);
  const firstHoles = await getHoles(firstId);
  const offset = firstHoles.length;

  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const newId = uuid();
    await supabase.from('holes').insert(c2s({
      id: newId, courseId: firstId, number: offset + i + 1, par: h.par,
      handicapIndex: h.handicapIndex, distanceMeters: h.distanceMeters,
      pinLat: h.pinLat, pinLon: h.pinLon,
      frontLat: h.frontLat, frontLon: h.frontLon,
      centerLat: h.centerLat, centerLon: h.centerLon,
      backLat: h.backLat, backLon: h.backLon,
      teeLat: h.teeLat, teeLon: h.teeLon,
      teeBlackLat: h.teeBlackLat, teeBlackLon: h.teeBlackLon,
      teeBrownLat: h.teeBrownLat, teeBrownLon: h.teeBrownLon,
      teeBlueLat: h.teeBlueLat, teeBlueLon: h.teeBlueLon,
      teeYellowLat: h.teeYellowLat, teeYellowLon: h.teeYellowLon,
      teeOrangeLat: h.teeOrangeLat, teeOrangeLon: h.teeOrangeLon,
      teeRedLat: h.teeRedLat, teeRedLon: h.teeRedLon,
      teeSilverLat: h.teeSilverLat, teeSilverLon: h.teeSilverLon,
    }));
    const zones = await getZonesForHole(h.id);
    for (const z of zones) {
      await supabase.from('course_zones').insert({ id: uuid(), hole_id: newId, type: z.type, points: z.points });
    }
  }
  await updateCourse(firstId, { name: mergedName });
}

// ── HOLES ──────────────────────────────────────────────────────────────────

export async function getHoles(courseId: string): Promise<Hole[]> {
  const { data } = await supabase.from('holes').select('*').eq('course_id', courseId).order('number');
  return (data ?? []).map(r => s2c(r) as Hole);
}

export async function insertHole(info: {
  courseId: string; number: number; par: number; handicapIndex: number; distanceMeters?: number;
}): Promise<string> {
  const id = uuid();
  const { error } = await supabase.from('holes').insert({ id, ...c2s(info) });
  if (error) throw error;
  return id;
}

export async function updateHole(id: string, info: Partial<Omit<Hole, 'id' | 'courseId'>>) {
  const { error } = await supabase.from('holes').update(c2s(info as any)).eq('id', id);
  if (error) throw error;
}

export async function updateHoleTee(id: string, lat: number, lon: number) {
  await supabase.from('holes').update({ tee_lat: lat, tee_lon: lon }).eq('id', id);
}

export async function updateHoleTeeColor(id: string, color: TeeColor, lat: number, lon: number) {
  await supabase.from('holes').update({ [`tee_${color}_lat`]: lat, [`tee_${color}_lon`]: lon }).eq('id', id);
}

export async function updateHolePinColor(id: string, color: 'red' | 'yellow' | 'blue', lat: number, lon: number) {
  const map: Record<string, { lat: string; lon: string }> = {
    red:    { lat: 'front_lat',  lon: 'front_lon'  },
    yellow: { lat: 'center_lat', lon: 'center_lon' },
    blue:   { lat: 'back_lat',   lon: 'back_lon'   },
  };
  await supabase.from('holes').update({ [map[color].lat]: lat, [map[color].lon]: lon }).eq('id', id);
}

export async function updateHoleGPS(id: string, coords: {
  pinLat?: number; pinLon?: number;
  frontLat?: number; frontLon?: number;
  centerLat?: number; centerLon?: number;
  backLat?: number; backLon?: number;
  teeLat?: number; teeLon?: number;
  teeBlackLat?: number; teeBlackLon?: number;
  teeBrownLat?: number; teeBrownLon?: number;
  teeBlueLat?: number; teeBlueLon?: number;
  teeYellowLat?: number; teeYellowLon?: number;
  teeOrangeLat?: number; teeOrangeLon?: number;
  teeRedLat?: number; teeRedLon?: number;
  teeSilverLat?: number; teeSilverLon?: number;
}) {
  const { error } = await supabase.from('holes').update(c2s(coords as any)).eq('id', id);
  if (error) throw error;
}

// ── ROUNDS ─────────────────────────────────────────────────────────────────

export type RoundRow = Round & { courseName: string; courseRating: number | null; slopeRating: number | null };

export async function getRounds(): Promise<RoundRow[]> {
  const { data } = await supabase
    .from('rounds')
    .select('*, courses!course_id(name)')
    .eq('is_completed', 1)
    .order('date', { ascending: false });
  return (data ?? []).map(row => {
    const { courses: c, ...rest } = row as any;
    return { ...(s2c(rest) as Round), courseName: c?.name ?? '', courseRating: null, slopeRating: null };
  });
}

export async function getActiveRound(): Promise<RoundRow | null> {
  const userId = await uid();
  const { data } = await supabase
    .from('rounds')
    .select('*, courses!course_id(name)')
    .eq('user_id', userId)
    .eq('is_completed', 0)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { courses: c, ...rest } = data as any;
  return { ...(s2c(rest) as Round), courseName: c?.name ?? '', courseRating: null, slopeRating: null };
}

export async function getRound(id: string): Promise<RoundRow | null> {
  const { data } = await supabase
    .from('rounds')
    .select('*, courses!course_id(name, course_rating, slope_rating)')
    .eq('id', id)
    .single();
  if (!data) return null;
  const { courses: c, ...rest } = data as any;
  return {
    ...(s2c(rest) as Round),
    courseName: c?.name ?? '',
    courseRating: c?.course_rating ?? null,
    slopeRating: c?.slope_rating ?? null,
  };
}

export async function insertRound(
  courseId: string, pinColor: string, teeColor: string, gameFormat: GameFormat = 'stroke_play',
): Promise<string> {
  const userId = await uid();
  const id = uuid();
  const { error } = await supabase.from('rounds').insert({
    id, user_id: userId, course_id: courseId,
    pin_color: pinColor, tee_color: teeColor, game_format: gameFormat,
    date: new Date().toISOString(), is_completed: 0,
  });
  if (error) throw error;
  return id;
}

export async function updateRound(id: string, info: Partial<{
  teeColor: string; pinColor: string; gameFormat: GameFormat;
}>) {
  const { error } = await supabase.from('rounds').update(c2s(info as any)).eq('id', id);
  if (error) throw error;
}

export async function completeRound(id: string) {
  await supabase.from('rounds').update({ is_completed: 1 }).eq('id', id);
}

export async function deleteRound(id: string) {
  await supabase.from('rounds').delete().eq('id', id);
}

// ── PROFILES (for search-by-email/name when adding a round player) ────────

export async function upsertOwnProfile(email: string, displayName?: string) {
  const userId = await uid();
  const { error } = await supabase.from('profiles')
    .upsert({ id: userId, email, ...(displayName ? { display_name: displayName } : {}) }, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateOwnDisplayName(displayName: string) {
  const userId = await uid();
  await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId);
}

export interface ProfileSearchResult { id: string; email: string; displayName: string | null }

export async function getOwnProfile(): Promise<ProfileSearchResult | null> {
  const userId = await uid();
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data ? (s2c(data) as ProfileSearchResult) : null;
}

export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  if (query.trim().length < 2) return [];
  const userId = await uid();
  const q = encodeURIComponent(`%${query.trim()}%`);
  const { data } = await supabase.from('profiles').select('*')
    .or(`email.ilike.${q},display_name.ilike.${q}`)
    .neq('id', userId)
    .limit(20);
  return (data ?? []).map(r => s2c(r) as ProfileSearchResult);
}

// ── ROUND PLAYERS ────────────────────────────────────────────────────────────

export async function getRoundPlayers(roundId: string): Promise<RoundPlayer[]> {
  const { data } = await supabase.from('round_players').select('*').eq('round_id', roundId).order('sort_order');
  return (data ?? []).map(r => s2c(r) as RoundPlayer);
}

export async function addRoundPlayer(roundId: string, info: {
  userId?: string; displayName: string; handicapIndex?: number; isOwner?: boolean; sortOrder: number;
}): Promise<string> {
  const id = uuid();
  const { error } = await supabase.from('round_players').insert({
    id, round_id: roundId, ...c2s(info as any),
  });
  if (error) throw error;
  return id;
}

export async function updateRoundPlayer(id: string, info: Partial<{
  displayName: string; handicapIndex: number | null;
}>) {
  await supabase.from('round_players').update(c2s(info as any)).eq('id', id);
}

export async function removeRoundPlayer(id: string) {
  await supabase.from('round_players').delete().eq('id', id);
}

// ── HOLE SCORES ────────────────────────────────────────────────────────────

export type HoleScoreRow = HoleScore & { holeNumber: number; holePar: number };

// `playerId` selects which player's rows to fetch: omitted ⇒ every player's
// rows for the round (used by the player-selector/leaderboard); `null` ⇒
// explicitly the legacy/owner rows from before multiplayer existed; a real
// id ⇒ just that player.
export async function getHoleScores(roundId: string, playerId?: string | null): Promise<HoleScoreRow[]> {
  let q = supabase
    .from('hole_scores')
    .select('*, holes!hole_id(number, par)')
    .eq('round_id', roundId);
  if (playerId === null) q = q.is('player_id', null);
  else if (playerId !== undefined) q = q.eq('player_id', playerId);
  const { data } = await q;
  return (data ?? [])
    .map(row => {
      const { holes: h, ...rest } = row as any;
      return { ...(s2c(rest) as HoleScore), holeNumber: h?.number ?? 0, holePar: h?.par ?? 4 };
    })
    .sort((a, b) => a.holeNumber - b.holeNumber);
}

export async function insertHoleScore(info: {
  roundId: string; holeId: string; strokes: number; par: number; pinColor: string; teeColor: string;
  playerId?: string;
}) {
  const id = uuid();
  const fairwayHit = info.par === 3 ? null : 0;
  const { error } = await supabase.from('hole_scores').insert({
    id, round_id: info.roundId, hole_id: info.holeId, player_id: info.playerId ?? null,
    strokes: info.strokes, putts: 0, fairway_hit: fairwayHit, gir: 0,
    penalty_strokes: 0, pin_color: info.pinColor, tee_color: info.teeColor,
  });
  if (error) throw error;
  return id;
}

export async function updateHoleScore(id: string, data: Partial<{
  strokes: number; putts: number; fairwayHit: number | null; gir: number;
  penaltyStrokes: number; pinColor: string; teeColor: string; firstPuttDist: number | null;
}>) {
  const { error } = await supabase.from('hole_scores').update(c2s(data as any)).eq('id', id);
  if (error) throw error;
}

// ── SHOT MEASUREMENTS ──────────────────────────────────────────────────────

export async function getShotMeasurements(holeScoreId: string): Promise<ShotMeasurement[]> {
  const { data } = await supabase
    .from('shot_measurements')
    .select('*')
    .eq('hole_score_id', holeScoreId)
    .order('timestamp');
  return (data ?? []).map(r => s2c(r) as ShotMeasurement);
}

export async function insertShotMeasurement(
  holeScoreId: string,
  distanceMeters: number,
  opts: Partial<{
    lat: number; lon: number; club: string; zone: string; shotType: string;
    windSpeed: number; windDir: number; windGusts: number;
    aimLat: number; aimLon: number; originLat: number; originLon: number;
  }> = {},
): Promise<string> {
  const id = uuid();
  const { error } = await supabase.from('shot_measurements').insert({
    id, hole_score_id: holeScoreId, distance_meters: distanceMeters,
    timestamp: new Date().toISOString(),
    lat: opts.lat ?? 0, lon: opts.lon ?? 0,
    club: opts.club ?? '', zone: opts.zone ?? '',
    shot_type: opts.shotType ?? 'normal',
    wind_speed: opts.windSpeed ?? 0, wind_dir: opts.windDir ?? 0, wind_gusts: opts.windGusts ?? 0,
    aim_lat: opts.aimLat ?? 0, aim_lon: opts.aimLon ?? 0,
    origin_lat: opts.originLat ?? 0, origin_lon: opts.originLon ?? 0,
  });
  if (error) throw error;
  return id;
}

export async function getGPSShotsForRound(roundId: string): Promise<(ShotMeasurement & { holeId: string })[]> {
  const { data: holeScores } = await supabase
    .from('hole_scores')
    .select('id, hole_id')
    .eq('round_id', roundId);
  if (!holeScores?.length) return [];

  const hsMap = new Map(holeScores.map(hs => [hs.id, hs.hole_id]));
  const hsIds = holeScores.map(hs => hs.id);

  const { data: shots } = await supabase
    .from('shot_measurements')
    .select('*')
    .in('hole_score_id', hsIds)
    .neq('lat', 0)
    .order('timestamp');

  return (shots ?? []).map(s => ({
    ...(s2c(s) as ShotMeasurement),
    holeId: hsMap.get(s.hole_score_id) ?? '',
  }));
}

export async function updateShotPosition(id: string, lat: number, lon: number) {
  await supabase.from('shot_measurements').update({ lat, lon }).eq('id', id);
}

export async function updateShotDistance(id: string, distanceMeters: number) {
  await supabase.from('shot_measurements').update({ distance_meters: distanceMeters }).eq('id', id);
}

export async function updateShotZone(id: string, zone: string) {
  await supabase.from('shot_measurements').update({ zone }).eq('id', id);
}

export async function updateShotType(id: string, shotType: string) {
  await supabase.from('shot_measurements').update({ shot_type: shotType }).eq('id', id);
}

export async function updateShotClub(id: string, club: string) {
  await supabase.from('shot_measurements').update({ club }).eq('id', id);
}

export async function updateShotAim(id: string, aimLat: number, aimLon: number) {
  await supabase.from('shot_measurements').update({ aim_lat: aimLat, aim_lon: aimLon }).eq('id', id);
}

export async function deleteShotMeasurement(id: string) {
  await supabase.from('shot_measurements').delete().eq('id', id);
}

// ── ZONES ──────────────────────────────────────────────────────────────────

export async function getZonesForHole(holeId: string): Promise<CourseZone[]> {
  const { data } = await supabase.from('course_zones').select('*').eq('hole_id', holeId);
  return (data ?? []).map(r => ({ id: r.id, holeId: r.hole_id, type: r.type as ZoneType, points: r.points ?? [] }));
}

export async function getZonesForCourse(courseId: string): Promise<CourseZone[]> {
  const { data: holes } = await supabase.from('holes').select('id').eq('course_id', courseId);
  if (!holes?.length) return [];
  const holeIds = holes.map(h => h.id);
  const { data } = await supabase.from('course_zones').select('*').in('hole_id', holeIds);
  return (data ?? []).map(r => ({ id: r.id, holeId: r.hole_id, type: r.type as ZoneType, points: r.points ?? [] }));
}

export async function insertZone(holeId: string, type: ZoneType, points: LatLon[]) {
  const id = uuid();
  const { error } = await supabase.from('course_zones').insert({ id, hole_id: holeId, type, points });
  if (error) throw error;
  return id;
}

export async function deleteZone(id: string) {
  await supabase.from('course_zones').delete().eq('id', id);
}

export async function deleteZonesForHole(holeId: string) {
  await supabase.from('course_zones').delete().eq('hole_id', holeId);
}

// ── HAZARDS ────────────────────────────────────────────────────────────────

export async function getCourseHazards(courseId: string): Promise<CourseHazard[]> {
  const { data } = await supabase.from('course_hazards').select('*').eq('course_id', courseId);
  return (data ?? []).map(r => ({ id: r.id, courseId: r.course_id, type: r.type as HazardType, points: r.points ?? [] }));
}

export async function insertCourseHazard(courseId: string, type: HazardType, points: LatLon[]) {
  const id = uuid();
  const { error } = await supabase.from('course_hazards').insert({ id, course_id: courseId, type, points });
  if (error) throw error;
  return id;
}

export async function deleteCourseHazard(id: string) {
  await supabase.from('course_hazards').delete().eq('id', id);
}

// ── CLUB SETTINGS ──────────────────────────────────────────────────────────

export async function getClubSettings(): Promise<{ club: string; manualDist: number }[]> {
  const userId = await uid();
  const { data } = await supabase.from('club_settings').select('*').eq('user_id', userId).order('club');
  return (data ?? []).map(r => ({ club: r.club, manualDist: r.manual_dist }));
}

export async function setClubManualDist(club: string, dist: number) {
  const userId = await uid();
  const { error } = await supabase.from('club_settings').upsert(
    { user_id: userId, club, manual_dist: dist },
    { onConflict: 'user_id,club' },
  );
  if (error) throw error;
}

// ── STATS ──────────────────────────────────────────────────────────────────

async function buildRoundStats(
  roundRow: { id: string; courseId: string; courseName: string; date: string; courseRating?: number; slopeRating?: number; teeColor?: string; pinColor?: string },
  allScores: { strokes: number; putts: number; holePar: number; fairwayHit: number | null; gir: number }[],
): Promise<RoundStats> {
  // strokes === 0 means that hole was never played (a round finished early
  // leaves the rest seeded at 0, not at par) — never count those.
  const scores          = allScores.filter(s => s.strokes > 0);
  const totalStrokes   = scores.reduce((a, s) => a + s.strokes, 0);
  const totalPutts     = scores.reduce((a, s) => a + s.putts, 0);
  const totalPar       = scores.reduce((a, s) => a + (s.holePar ?? 4), 0);
  const fairwaysHit    = scores.filter(s => s.fairwayHit === 1).length;
  const fairwaysTotal  = scores.filter(s => s.fairwayHit !== null).length;
  const girsHit        = scores.filter(s => s.gir === 1).length;
  const holesCount     = scores.length;
  const stblfd         = scores.reduce((a, s) => a + stablefordPoints(s.strokes, s.holePar ?? 4), 0);
  return { ...roundRow, totalStrokes, totalPutts, totalPar, fairwaysHit, fairwaysTotal, girsHit, holesCount, stablefordPoints: stblfd };
}

export async function getRoundStats(roundId: string): Promise<RoundStats | null> {
  const round = await getRound(roundId);
  if (!round) return null;

  const { data: hsRows } = await supabase
    .from('hole_scores')
    .select('strokes, putts, fairway_hit, gir, holes!hole_id(par)')
    .eq('round_id', roundId);
  if (!hsRows?.length) return null;

  const scores = (hsRows as any[]).map(r => ({
    strokes: r.strokes, putts: r.putts,
    holePar: r.holes?.par ?? 4,
    fairwayHit: r.fairway_hit, gir: r.gir,
  }));
  return buildRoundStats({
    id: round.id as string,
    courseId: round.courseId as string,
    courseName: (round as any).courseName,
    date: round.date as string,
    courseRating: (round as any).courseRating,
    slopeRating: (round as any).slopeRating,
    teeColor: round.teeColor as string,
    pinColor: round.pinColor as string,
  }, scores);
}

export async function getAllRoundStats(): Promise<RoundStats[]> {
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, course_id, date, tee_color, pin_color, courses!course_id(name, course_rating, slope_rating)')
    .eq('is_completed', 1)
    .order('date', { ascending: false });
  if (!rounds?.length) return [];

  const roundIds = rounds.map(r => r.id);
  const { data: allScores } = await supabase
    .from('hole_scores')
    .select('round_id, strokes, putts, fairway_hit, gir, holes!hole_id(par)')
    .in('round_id', roundIds);

  const scoresMap = new Map<string, any[]>();
  for (const s of allScores ?? []) {
    const arr = scoresMap.get(s.round_id) ?? [];
    arr.push(s);
    scoresMap.set(s.round_id, arr);
  }

  return rounds.map(r => {
    const c = (r as any).courses;
    // strokes === 0 means that hole was never played — never count those.
    const scores = (scoresMap.get(r.id) ?? [])
      .filter((s: any) => s.strokes > 0)
      .map((s: any) => ({
        strokes: s.strokes, putts: s.putts,
        holePar: s.holes?.par ?? 4, fairwayHit: s.fairway_hit, gir: s.gir,
      }));
    const totalStrokes  = scores.reduce((a: number, s: any) => a + s.strokes, 0);
    const totalPutts    = scores.reduce((a: number, s: any) => a + s.putts, 0);
    const totalPar      = scores.reduce((a: number, s: any) => a + s.holePar, 0);
    const fairwaysHit   = scores.filter((s: any) => s.fairwayHit === 1).length;
    const fairwaysTotal = scores.filter((s: any) => s.fairwayHit !== null).length;
    const girsHit       = scores.filter((s: any) => s.gir === 1).length;
    const holesCount    = scores.length;
    const stblfd        = scores.reduce((a: number, s: any) => a + stablefordPoints(s.strokes, s.holePar), 0);
    return {
      id: r.id, courseId: r.course_id,
      courseName: c?.name ?? '', date: r.date,
      courseRating: c?.course_rating, slopeRating: c?.slope_rating,
      teeColor: r.tee_color, pinColor: r.pin_color,
      totalStrokes, totalPutts, totalPar, fairwaysHit, fairwaysTotal, girsHit, holesCount,
      stablefordPoints: stblfd,
    };
  });
}

// Countries the user has actually played in (any round, in-progress or
// completed, at a course tagged with a country) — used by the visited-
// countries world map. Not "courses added," since a course can be in the
// account without ever having been played.
export async function getVisitedCountries(): Promise<string[]> {
  const userId = await uid();
  const { data } = await supabase
    .from('rounds')
    .select('courses!course_id(country)')
    .eq('user_id', userId);
  const set = new Set<string>();
  for (const r of data ?? []) {
    const country = (r as any).courses?.country;
    if (country) set.add(country);
  }
  return Array.from(set);
}

export async function getScramblingStats(): Promise<ScramblingStats> {
  const userId = await uid();
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id')
    .eq('user_id', userId)
    .eq('is_completed', 1);
  if (!rounds?.length) return { missedGir: 0, scrambled: 0, bunkerHoles: 0, bunkerSaves: 0 };

  const roundIds = rounds.map(r => r.id);
  const { data: holeScores } = await supabase
    .from('hole_scores')
    .select('id, round_id, strokes, gir, holes!hole_id(par)')
    .in('round_id', roundIds);
  if (!holeScores?.length) return { missedGir: 0, scrambled: 0, bunkerHoles: 0, bunkerSaves: 0 };

  const hsIds = holeScores.map(hs => hs.id);
  const { data: allShots } = await supabase
    .from('shot_measurements')
    .select('hole_score_id, zone')
    .in('hole_score_id', hsIds);

  const shotsByScore = new Map<string, string[]>();
  for (const s of allShots ?? []) {
    const arr = shotsByScore.get(s.hole_score_id) ?? [];
    arr.push(s.zone);
    shotsByScore.set(s.hole_score_id, arr);
  }

  let missedGir = 0, scrambled = 0, bunkerHoles = 0, bunkerSaves = 0;
  for (const hs of holeScores as any[]) {
    if (hs.strokes === 0) continue; // hole never played
    const par = hs.holes?.par ?? 4;
    const hadBunker = (shotsByScore.get(hs.id) ?? []).some(z => z === 'bunker');
    if (hadBunker) { bunkerHoles++; if (hs.strokes <= par) bunkerSaves++; }
    if (hs.gir === 0) {
      missedGir++;
      if (hs.strokes <= par) scrambled++;
    }
  }
  return { missedGir, scrambled, bunkerHoles, bunkerSaves };
}

export async function getPuttingStats(): Promise<PuttingStats> {
  const userId = await uid();
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id')
    .eq('user_id', userId)
    .eq('is_completed', 1);
  if (!rounds?.length) return { avgPuttsGir: null, avgPuttsNonGir: null, girHoles: 0, nonGirHoles: 0 };

  const roundIds = rounds.map(r => r.id);
  const { data: holeScores } = await supabase
    .from('hole_scores')
    .select('strokes, putts, gir')
    .in('round_id', roundIds);
  if (!holeScores?.length) return { avgPuttsGir: null, avgPuttsNonGir: null, girHoles: 0, nonGirHoles: 0 };

  const played = holeScores.filter(hs => hs.strokes > 0); // exclude never-played holes
  const girPutts = played.filter(hs => hs.gir === 1).map(hs => hs.putts);
  const nonGirPutts = played.filter(hs => hs.gir === 0).map(hs => hs.putts);
  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  return {
    avgPuttsGir: mean(girPutts),
    avgPuttsNonGir: mean(nonGirPutts),
    girHoles: girPutts.length,
    nonGirHoles: nonGirPutts.length,
  };
}

export async function getApproachStats(): Promise<ApproachStats> {
  const userId = await uid();
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id')
    .eq('user_id', userId)
    .eq('is_completed', 1);
  if (!rounds?.length) return { avgFirstPuttDist: null, count: 0 };

  const roundIds = rounds.map(r => r.id);
  const { data: holeScores } = await supabase
    .from('hole_scores')
    .select('first_putt_dist')
    .in('round_id', roundIds)
    .not('first_putt_dist', 'is', null);
  if (!holeScores?.length) return { avgFirstPuttDist: null, count: 0 };

  const dists = holeScores.map(hs => hs.first_putt_dist as number);
  return { avgFirstPuttDist: dists.reduce((a, b) => a + b, 0) / dists.length, count: dists.length };
}

export async function getClubStats(): Promise<ClubStat[]> {
  const userId = await uid();
  const { data: rounds } = await supabase.from('rounds').select('id').eq('user_id', userId);
  if (!rounds?.length) return [];

  const roundIds = rounds.map(r => r.id);
  const { data: holeScores } = await supabase.from('hole_scores').select('id').in('round_id', roundIds);
  if (!holeScores?.length) return [];

  const hsIds = holeScores.map(hs => hs.id);
  const { data: shots } = await supabase
    .from('shot_measurements')
    .select('club, distance_meters')
    .in('hole_score_id', hsIds)
    .neq('club', '');
  if (!shots?.length) return [];

  const map = new Map<string, number[]>();
  for (const s of shots) {
    if (!s.club || s.distance_meters <= 0) continue;
    const arr = map.get(s.club) ?? [];
    arr.push(s.distance_meters);
    map.set(s.club, arr);
  }

  return Array.from(map.entries()).map(([club, dists]) => ({
    club,
    shots: dists.length,
    avgDist: Math.round(dists.reduce((a, b) => a + b, 0) / dists.length),
    minDist: Math.min(...dists),
    maxDist: Math.max(...dists),
  }));
}

export async function getAllClubStats(): Promise<ClubStat[]> {
  const userId = await uid();
  const { data: rounds } = await supabase.from('rounds').select('id').eq('user_id', userId).eq('is_completed', 1);
  if (!rounds?.length) return [];

  const roundIds = rounds.map(r => r.id);
  const { data: holeScores } = await supabase.from('hole_scores').select('id').in('round_id', roundIds);
  if (!holeScores?.length) return [];

  const hsIds = holeScores.map(hs => hs.id);
  const { data: shots } = await supabase
    .from('shot_measurements')
    .select('club, distance_meters, shot_type')
    .in('hole_score_id', hsIds)
    .neq('club', '');
  if (!shots?.length) return [];

  const map = new Map<string, number[]>();
  for (const s of shots) {
    if (!s.club || s.distance_meters < 5 || s.shot_type === 'punch' || s.shot_type === 'poor') continue;
    const arr = map.get(s.club) ?? [];
    arr.push(s.distance_meters);
    map.set(s.club, arr);
  }

  return Array.from(map.entries()).map(([club, dists]) => ({
    club,
    shots: dists.length,
    avgDist: Math.round(dists.reduce((a, b) => a + b, 0) / dists.length),
    minDist: Math.min(...dists),
    maxDist: Math.max(...dists),
  }));
}

/**
 * Per-club distance + signed lateral tendency (+right / -left), used by the
 * in-round club recommendation. Same "every one of the user's rounds, not
 * just completed ones" scope as `getClubStats` — this is about the
 * player's swing tendencies, not about official round history.
 */
export async function getClubProfiles(): Promise<ClubProfile[]> {
  const userId = await uid();
  const { data: rounds } = await supabase.from('rounds').select('id').eq('user_id', userId);

  const map = new Map<string, { dists: number[]; laterals: number[] }>();
  if (rounds?.length) {
    const roundIds = rounds.map(r => r.id);
    const { data: holeScores } = await supabase.from('hole_scores').select('id').in('round_id', roundIds);
    if (holeScores?.length) {
      const hsIds = holeScores.map(hs => hs.id);
      const { data: shots } = await supabase
        .from('shot_measurements')
        .select('club, distance_meters, shot_type, lat, lon, aim_lat, aim_lon, origin_lat, origin_lon')
        .in('hole_score_id', hsIds)
        .neq('club', '');
      for (const s of shots ?? []) {
        // Recovery ("punch") and mishit ("poor") shots aren't a real full
        // swing with this club — averaging them in drags a club's distance
        // way down and can recommend it for distances it shouldn't be.
        if (!s.club || s.distance_meters <= 0 || s.shot_type === 'punch' || s.shot_type === 'poor') continue;
        const entry = map.get(s.club) ?? { dists: [], laterals: [] };
        entry.dists.push(s.distance_meters);
        const hasAim = (s.aim_lat !== 0 || s.aim_lon !== 0) && (s.origin_lat !== 0 || s.origin_lon !== 0);
        if (hasAim) {
          entry.laterals.push(lateralDeviationM(
            { lat: s.origin_lat, lon: s.origin_lon },
            { lat: s.aim_lat, lon: s.aim_lon },
            { lat: s.lat, lon: s.lon },
          ));
        }
        map.set(s.club, entry);
      }
    }
  }

  const profiles = new Map<string, ClubProfile>();
  for (const [club, { dists, laterals }] of map.entries()) {
    if (dists.length < 2) continue; // not enough real shots to trust yet — manual fallback below wins instead
    profiles.set(club, {
      club,
      shots: dists.length,
      avgDist: Math.round(dists.reduce((a, b) => a + b, 0) / dists.length),
      minDist: Math.min(...dists),
      maxDist: Math.max(...dists),
      avgLateral: laterals.length ? laterals.reduce((a, b) => a + b, 0) / laterals.length : null,
      source: 'gps',
    });
  }

  // Fill in manual "Mis palos" distances for any club that doesn't yet have
  // ≥2 real GPS shots — provisional numbers until real data replaces them.
  const manual = await getClubSettings();
  for (const m of manual) {
    if (m.manualDist <= 0 || profiles.has(m.club)) continue;
    profiles.set(m.club, {
      club: m.club, shots: 2, avgDist: m.manualDist,
      minDist: m.manualDist, maxDist: m.manualDist, avgLateral: null, source: 'manual',
    });
  }

  return Array.from(profiles.values());
}

export async function getShotsForClub(club: string): Promise<ShotRecord[]> {
  const userId = await uid();
  const { data: rounds } = await supabase
    .from('rounds')
    .select('id, date, course_id, courses!course_id(name)')
    .eq('user_id', userId)
    .eq('is_completed', 1);
  if (!rounds?.length) return [];

  const roundMap = new Map(rounds.map((r: any) => [r.id, { date: r.date, courseName: r.courses?.name ?? '' }]));
  const { data: holeScores } = await supabase.from('hole_scores').select('id, round_id, hole_id').in('round_id', rounds.map(r => r.id));
  if (!holeScores?.length) return [];

  const holeIds = [...new Set(holeScores.map(hs => hs.hole_id))];
  const { data: holes } = await supabase.from('holes').select('id, number').in('id', holeIds);
  const holeNumMap = new Map((holes ?? []).map(h => [h.id, h.number]));

  const hsMap = new Map(holeScores.map(hs => [hs.id, { roundId: hs.round_id, holeId: hs.hole_id, holeNumber: holeNumMap.get(hs.hole_id) }]));
  const hsIds = holeScores.map(hs => hs.id);

  const { data: shots } = await supabase
    .from('shot_measurements')
    .select('*')
    .in('hole_score_id', hsIds)
    .eq('club', club)
    .order('timestamp');
  if (!shots?.length) return [];

  return shots.map(s => {
    const hs = hsMap.get(s.hole_score_id);
    const r = hs ? roundMap.get(hs.roundId) : undefined;
    return {
      id: s.id, dist: s.distance_meters, club: s.club, zone: s.zone, shotType: s.shot_type,
      roundId: hs?.roundId ?? '', holeId: hs?.holeId ?? '', holeNumber: hs?.holeNumber,
      courseName: r?.courseName ?? '', date: r?.date ?? '',
      lat: s.lat, lon: s.lon, aimLat: s.aim_lat, aimLon: s.aim_lon,
      originLat: s.origin_lat, originLon: s.origin_lon,
      windSpeed: s.wind_speed, windDir: s.wind_dir, windGusts: s.wind_gusts,
    };
  });
}

export async function getClubStatsForRound(roundId: string): Promise<ClubStat[]> {
  const { data: holeScores } = await supabase.from('hole_scores').select('id').eq('round_id', roundId);
  if (!holeScores?.length) return [];
  const hsIds = holeScores.map(hs => hs.id);
  const { data: shots } = await supabase.from('shot_measurements').select('club, distance_meters').in('hole_score_id', hsIds).neq('club', '');
  if (!shots?.length) return [];

  const map = new Map<string, number[]>();
  for (const s of shots) {
    if (s.distance_meters <= 0) continue;
    const arr = map.get(s.club) ?? [];
    arr.push(s.distance_meters);
    map.set(s.club, arr);
  }
  return Array.from(map.entries()).map(([club, dists]) => ({
    club, shots: dists.length,
    avgDist: Math.round(dists.reduce((a, b) => a + b, 0) / dists.length),
    minDist: Math.min(...dists), maxDist: Math.max(...dists),
  }));
}

// ── RESTORE (used by cloudCourses) ─────────────────────────────────────────

export async function restoreCourseData(data: any): Promise<number> {
  if (!data?.holes && !data?.courses) throw new Error('Formato de datos inválido');
  const courses: any[] = data.courses ?? [data];
  let holesRestored = 0;
  const userId = await uid();

  for (const c of courses) {
    const newCourseId = uuid();
    await supabase.from('courses').insert({
      id: newCourseId, user_id: userId,
      name: c.name, city: c.city ?? '', country: c.country ?? null,
      course_rating: Number(c.courseRating) || 72,
      slope_rating: Number(c.slopeRating) || 113,
    });

    for (const h of c.holes ?? []) {
      const n = (f: string) => Number(h[f]) || 0;
      const newHoleId = uuid();
      await supabase.from('holes').insert({
        id: newHoleId, course_id: newCourseId,
        number: n('number') || 1, par: n('par') || 4,
        handicap_index: n('handicapIndex') || 1, distance_meters: n('distanceMeters'),
        pin_lat: n('pinLat'), pin_lon: n('pinLon'),
        front_lat: n('frontLat'), front_lon: n('frontLon'),
        center_lat: n('centerLat'), center_lon: n('centerLon'),
        back_lat: n('backLat'), back_lon: n('backLon'),
        tee_lat: n('teeLat'), tee_lon: n('teeLon'),
        tee_black_lat: n('teeBlackLat'), tee_black_lon: n('teeBlackLon'),
        tee_brown_lat: n('teeBrownLat'), tee_brown_lon: n('teeBrownLon'),
        tee_blue_lat: n('teeBlueLat'), tee_blue_lon: n('teeBlueLon'),
        tee_yellow_lat: n('teeYellowLat'), tee_yellow_lon: n('teeYellowLon'),
        tee_orange_lat: n('teeOrangeLat'), tee_orange_lon: n('teeOrangeLon'),
        tee_red_lat: n('teeRedLat'), tee_red_lon: n('teeRedLon'),
        tee_silver_lat: n('teeSilverLat'), tee_silver_lon: n('teeSilverLon'),
      });
      holesRestored++;

      for (const z of h.zones ?? []) {
        await supabase.from('course_zones').insert({
          id: uuid(), hole_id: newHoleId, type: z.type, points: z.points ?? [],
        });
      }
    }

    for (const hz of c.hazards ?? []) {
      await supabase.from('course_hazards').insert({
        id: uuid(), course_id: newCourseId, type: hz.type, points: hz.points ?? [],
      });
    }
  }
  return holesRestored;
}
