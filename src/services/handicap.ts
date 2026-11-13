import { RoundStats } from '../lib/api';
import { handicapDifferential } from '../types';

function hasRating(r: RoundStats): r is RoundStats & { courseRating: number; slopeRating: number } {
  return !!(r.courseRating && r.slopeRating);
}

export function calcHandicapIndex(rounds: RoundStats[]): number | null {
  if (rounds.length === 0) return null;
  const diffs = rounds
    .slice(-20)
    .filter(hasRating)
    .map((r) => handicapDifferential(r.totalStrokes, r.courseRating, r.slopeRating));

  if (diffs.length === 0) return null;

  const sorted = [...diffs].sort((a, b) => a - b);
  const count = sorted.length;
  const bestCount = [0, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8][count] ?? 8;
  const best = sorted.slice(0, bestCount);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  return Math.round(avg * 0.96 * 10) / 10;
}
