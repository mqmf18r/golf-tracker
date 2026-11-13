// Session / club aggregates for the ShotVision summary + history screens.

import { ShotVisionShot, M_TO_YARDS } from './types';

export interface MetricSpread {
  avg: number;
  min: number;
  max: number;
  sd: number;      // standard deviation
}

function spread(xs: number[]): MetricSpread {
  if (xs.length === 0) return { avg: 0, min: 0, max: 0, sd: 0 };
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - avg) ** 2, 0) / xs.length);
  return { avg, min: Math.min(...xs), max: Math.max(...xs), sd };
}

export interface ClubAggregate {
  club: string;
  count: number;
  ballSpeedMs: MetricSpread;
  launchDeg: MetricSpread;
  carryMeters: MetricSpread;
  totalMeters: MetricSpread;
  apexMeters: MetricSpread;
  /** consistency 0–100: how tightly carry clusters (100 = identical shots) */
  consistency: number;
  bestShotId: string | null;   // longest carry
}

export function aggregateByClub(shots: ShotVisionShot[]): ClubAggregate[] {
  const byClub = new Map<string, ShotVisionShot[]>();
  for (const s of shots) {
    if (!byClub.has(s.club)) byClub.set(s.club, []);
    byClub.get(s.club)!.push(s);
  }

  const out: ClubAggregate[] = [];
  for (const [club, cs] of byClub) {
    const carry = spread(cs.map(s => s.flight.carryMeters));
    const best = cs.reduce((a, b) => (b.flight.carryMeters > a.flight.carryMeters ? b : a));
    const cv = carry.avg > 0 ? carry.sd / carry.avg : 0;         // coeff. of variation
    out.push({
      club,
      count: cs.length,
      ballSpeedMs: spread(cs.map(s => s.measure.ballSpeedMs)),
      launchDeg: spread(cs.map(s => s.measure.launchAngleDeg)),
      carryMeters: carry,
      totalMeters: spread(cs.map(s => s.flight.totalMeters)),
      apexMeters: spread(cs.map(s => s.flight.apexMeters)),
      consistency: Math.max(0, Math.round(100 - cv * 600)),
      bestShotId: cs.length > 1 ? best.id : null,
    });
  }
  return out.sort((a, b) => b.carryMeters.avg - a.carryMeters.avg);
}

export interface SessionSummary {
  shotCount: number;
  clubCount: number;
  byClub: ClubAggregate[];
  longestCarryMeters: number;
  longestShotId: string | null;
}

export function summariseSession(shots: ShotVisionShot[]): SessionSummary {
  const byClub = aggregateByClub(shots);
  const longest = shots.reduce<ShotVisionShot | null>(
    (a, b) => (!a || b.flight.carryMeters > a.flight.carryMeters ? b : a),
    null,
  );
  return {
    shotCount: shots.length,
    clubCount: byClub.length,
    byClub,
    longestCarryMeters: longest?.flight.carryMeters ?? 0,
    longestShotId: longest?.id ?? null,
  };
}

export const toYd = (m: number) => Math.round(m * M_TO_YARDS);
