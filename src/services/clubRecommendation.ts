import { ClubProfile } from '../lib/api';

export interface ClubRecommendation {
  club: string;
  avgDist: number;
  diff: number; // target - avgDist (signed)
  avgLateral: number | null;
  source: 'gps' | 'manual';
}

/**
 * Picks the club whose logged average distance is closest to the target
 * distance. Purely distance-based — left/right tendency is informational
 * only (shown alongside the pick, never changes which club gets picked).
 * Needs at least 2 logged shots for a club before trusting its average.
 */
export function recommendClub(targetDistanceM: number, profiles: ClubProfile[]): ClubRecommendation | null {
  const usable = profiles.filter(p => p.shots >= 2);
  if (usable.length === 0) return null;

  let best = usable[0];
  let bestDiff = Math.abs(usable[0].avgDist - targetDistanceM);
  for (const p of usable.slice(1)) {
    const d = Math.abs(p.avgDist - targetDistanceM);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }

  return {
    club: best.club,
    avgDist: best.avgDist,
    diff: targetDistanceM - best.avgDist,
    avgLateral: best.avgLateral,
    source: best.source,
  };
}

export interface ClubRecommendationRange {
  best: ClubRecommendation;
  less: ClubRecommendation | null;  // next club down by average distance (swing easier / take less club)
  more: ClubRecommendation | null;  // next club up by average distance (swing fuller / take more club)
}

/**
 * Same pick as `recommendClub`, plus the one club shorter and one club
 * longer than it (by logged average distance) — so a player can see the
 * "take less" / "take more" alternative right alongside the best match,
 * the way you'd actually think it through standing over the ball.
 */
export function recommendClubRange(targetDistanceM: number, profiles: ClubProfile[]): ClubRecommendationRange | null {
  const usable = profiles.filter(p => p.shots >= 2).sort((a, b) => a.avgDist - b.avgDist);
  if (usable.length === 0) return null;

  let bestIdx = 0;
  let bestDiff = Math.abs(usable[0].avgDist - targetDistanceM);
  for (let i = 1; i < usable.length; i++) {
    const d = Math.abs(usable[i].avgDist - targetDistanceM);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }

  const toRec = (p: ClubProfile): ClubRecommendation => ({
    club: p.club, avgDist: p.avgDist, diff: targetDistanceM - p.avgDist, avgLateral: p.avgLateral, source: p.source,
  });

  return {
    best: toRec(usable[bestIdx]),
    less: bestIdx > 0 ? toRec(usable[bestIdx - 1]) : null,
    more: bestIdx < usable.length - 1 ? toRec(usable[bestIdx + 1]) : null,
  };
}
