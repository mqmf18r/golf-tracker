// Handicap-aware scoring for the 3 non-trivial game formats (Stableford,
// Skins, Match Play). Stroke Play needs none of this — gross totals are
// already computed inline wherever they're shown.
//
// All three share the same foundation: a player's WHS-style course
// handicap, and the standard "hardest holes get the extra stroke first"
// allocation. Both are pure functions, validated against known-correct
// examples in a throwaway script before being wired into any screen (see
// HANDOFF.md / the memory note for this feature).

import { Hole, RoundPlayer, GameFormat, stablefordPoints } from '../types';

export interface PlayerHoleScore {
  holeId: string;
  strokes: number;
}

/** WHS-style course handicap from a player's Handicap Index + this tee's rating/slope + the course's total par. */
export function courseHandicap(handicapIndex: number, slopeRating: number, courseRating: number, totalPar: number): number {
  return Math.round(handicapIndex * (slopeRating / 113) + (courseRating - totalPar));
}

/**
 * Ranks the holes actually being played 1..N by difficulty (1 = hardest),
 * from their RELATIVE `handicapIndex` order rather than trusting the raw
 * stored value to already be a clean 1..N permutation for this hole count.
 * A true 9-hole course, or an 18-hole course's front/back 9 (which often
 * keeps odd/even-numbered handicap indexes like 1,3,5,7... instead of
 * 1..9), both come out correct this way — the standard "N hardest holes
 * first" table only cares about relative order, not the absolute number.
 */
export function rankHolesByDifficulty(holes: { id: string; handicapIndex: number }[]): Map<string, number> {
  const sorted = [...holes].sort((a, b) => a.handicapIndex - b.handicapIndex);
  const ranks = new Map<string, number>();
  sorted.forEach((h, i) => ranks.set(h.id, i + 1));
  return ranks;
}

/**
 * Standard handicap stroke allocation for one hole: how many strokes a
 * player receives, given their course handicap and that hole's relative
 * difficulty rank (1 = hardest, out of `holesCount`). Generalizes to a
 * negative (plus-handicap) course handicap, where the player instead
 * GIVES a stroke back on the easiest holes.
 */
export function strokesReceived(courseHcp: number, holeRank: number, holesCount: number): number {
  const sign = courseHcp < 0 ? -1 : 1;
  const abs = Math.abs(courseHcp);
  const base = Math.floor(abs / holesCount) * sign;
  const remainder = abs % holesCount;
  const rankForSign = sign > 0 ? holeRank : holesCount + 1 - holeRank;
  const extra = rankForSign <= remainder ? sign : 0;
  return base + extra;
}

export function netStablefordPoints(strokes: number, par: number, received: number): number {
  return stablefordPoints(strokes - received, par);
}

// ── Per-player setup shared by every format ─────────────────────────────

interface PlayerContext {
  player: RoundPlayer;
  courseHcp: number;
  scoresByHole: Map<string, PlayerHoleScore>; // keyed by holeId
}

function buildContexts(
  players: RoundPlayer[],
  holes: Hole[],
  scoresByPlayer: Map<string, PlayerHoleScore[]>,
  courseRating: number,
  slopeRating: number,
): PlayerContext[] {
  const totalPar = holes.reduce((a, h) => a + h.par, 0);
  return players.map(player => {
    const hcp = courseHandicap(player.handicapIndex ?? 0, slopeRating, courseRating, totalPar);
    const scores = scoresByPlayer.get(player.id) ?? [];
    const scoresByHole = new Map(scores.map(s => [s.holeId, s]));
    return { player, courseHcp: hcp, scoresByHole };
  });
}

// ── Stableford ───────────────────────────────────────────────────────────

export interface StablefordRow { player: RoundPlayer; netPoints: number; }

export function computeStableford(
  players: RoundPlayer[], holes: Hole[], scoresByPlayer: Map<string, PlayerHoleScore[]>,
  courseRating: number, slopeRating: number,
): StablefordRow[] {
  const ranks = rankHolesByDifficulty(holes);
  const contexts = buildContexts(players, holes, scoresByPlayer, courseRating, slopeRating);
  const rows = contexts.map(ctx => {
    let netPoints = 0;
    for (const hole of holes) {
      const s = ctx.scoresByHole.get(hole.id);
      if (!s) continue;
      const rank = ranks.get(hole.id) ?? 1;
      const received = strokesReceived(ctx.courseHcp, rank, holes.length);
      netPoints += netStablefordPoints(s.strokes, hole.par, received);
    }
    return { player: ctx.player, netPoints };
  });
  return rows.sort((a, b) => b.netPoints - a.netPoints);
}

// ── Skins ────────────────────────────────────────────────────────────────

export interface SkinsHoleResult { holeId: string; holeNumber: number; winnerPlayerId: string | null; skinsValue: number; }
export interface SkinsRow { player: RoundPlayer; skinsWon: number; }
export interface SkinsResult { rows: SkinsRow[]; holes: SkinsHoleResult[]; }

export function computeSkins(
  players: RoundPlayer[], holes: Hole[], scoresByPlayer: Map<string, PlayerHoleScore[]>,
  courseRating: number, slopeRating: number,
): SkinsResult {
  const ranks = rankHolesByDifficulty(holes);
  const contexts = buildContexts(players, holes, scoresByPlayer, courseRating, slopeRating);
  const won = new Map<string, number>(players.map(p => [p.id, 0]));
  const holeResults: SkinsHoleResult[] = [];
  let carry = 1;

  for (const hole of holes) {
    const nets = contexts
      .map(ctx => {
        const s = ctx.scoresByHole.get(hole.id);
        if (!s) return null;
        const rank = ranks.get(hole.id) ?? 1;
        const received = strokesReceived(ctx.courseHcp, rank, holes.length);
        return { playerId: ctx.player.id, net: s.strokes - received };
      })
      .filter((x): x is { playerId: string; net: number } => x !== null);

    if (nets.length < players.length) {
      // not every player has a score for this hole yet — no result, no carry change
      holeResults.push({ holeId: hole.id, holeNumber: hole.number, winnerPlayerId: null, skinsValue: carry });
      continue;
    }

    const minNet = Math.min(...nets.map(n => n.net));
    const winners = nets.filter(n => n.net === minNet);
    if (winners.length === 1) {
      won.set(winners[0].playerId, (won.get(winners[0].playerId) ?? 0) + carry);
      holeResults.push({ holeId: hole.id, holeNumber: hole.number, winnerPlayerId: winners[0].playerId, skinsValue: carry });
      carry = 1;
    } else {
      // tied for lowest — skin(s) carry to the next hole
      holeResults.push({ holeId: hole.id, holeNumber: hole.number, winnerPlayerId: null, skinsValue: carry });
      carry += 1;
    }
  }

  const rows = players
    .map(p => ({ player: p, skinsWon: won.get(p.id) ?? 0 }))
    .sort((a, b) => b.skinsWon - a.skinsWon);
  return { rows, holes: holeResults };
}

// ── Match Play (exactly 2 players) ────────────────────────────────────────

export interface MatchPlayResult {
  players: [RoundPlayer, RoundPlayer];
  holesPlayed: number;
  totalHoles: number;
  margin: number; // positive = players[0] ahead, negative = players[1] ahead, 0 = level
  closedOut: boolean; // match already decided with holes to spare
  statusLabel: string; // "2 UP", "AS", "3&2", etc — always from players[0]'s perspective when ahead
}

export function computeMatchPlay(
  players: RoundPlayer[], holes: Hole[], scoresByPlayer: Map<string, PlayerHoleScore[]>,
  courseRating: number, slopeRating: number,
): MatchPlayResult | null {
  if (players.length !== 2) return null; // standard match play is 1v1 — see plan for why
  const ranks = rankHolesByDifficulty(holes);
  const contexts = buildContexts(players, holes, scoresByPlayer, courseRating, slopeRating);
  const [a, b] = contexts;

  let margin = 0; // + = a ahead
  let holesPlayed = 0;
  let closedOut = false;

  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    const sa = a.scoresByHole.get(hole.id);
    const sb = b.scoresByHole.get(hole.id);
    if (!sa || !sb) continue;
    const rank = ranks.get(hole.id) ?? 1;
    const netA = sa.strokes - strokesReceived(a.courseHcp, rank, holes.length);
    const netB = sb.strokes - strokesReceived(b.courseHcp, rank, holes.length);
    if (netA < netB) margin += 1;
    else if (netB < netA) margin -= 1;
    holesPlayed += 1;

    const holesRemaining = holes.length - holesPlayed;
    if (Math.abs(margin) > holesRemaining) {
      closedOut = true;
      break; // match is decided — remaining holes are moot ("dormie" territory already passed)
    }
  }

  const holesRemaining = holes.length - holesPlayed;
  const absMargin = Math.abs(margin);
  const statusLabel = margin === 0
    ? 'AS'
    : closedOut
      ? `${absMargin}&${holesRemaining}`
      : `${absMargin} UP`;

  return { players: [players[0], players[1]], holesPlayed, totalHoles: holes.length, margin, closedOut, statusLabel };
}

// ── Single entry point the UI calls ───────────────────────────────────────

export type FormatResult =
  | { format: 'stableford'; stableford: StablefordRow[] }
  | { format: 'skins'; skins: SkinsResult }
  | { format: 'match_play'; matchPlay: MatchPlayResult | null };

export function computeFormatResult(
  format: GameFormat,
  players: RoundPlayer[],
  holes: Hole[],
  scoresByPlayer: Map<string, PlayerHoleScore[]>,
  courseRating: number,
  slopeRating: number,
): FormatResult | null {
  if (format === 'stroke_play') return null; // gross totals already computed inline everywhere
  if (format === 'stableford') {
    return { format, stableford: computeStableford(players, holes, scoresByPlayer, courseRating, slopeRating) };
  }
  if (format === 'skins') {
    return { format, skins: computeSkins(players, holes, scoresByPlayer, courseRating, slopeRating) };
  }
  return { format, matchPlay: computeMatchPlay(players, holes, scoresByPlayer, courseRating, slopeRating) };
}
