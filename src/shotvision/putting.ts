// ShotVision — Putt mode. Same self-calibration idea as the full-swing
// pipeline (kinematics.ts): a golf ball has a fixed, known real-world
// diameter (42.67 mm), so the app reads real-world scale directly off how
// big the ball looks on camera — no LiDAR, no manual "stand exactly Xm away"
// step, no ruler. `pixelblob.ts`'s findBlob() already does the detection
// (background subtraction, works in Expo Go); this file turns a short track
// of auto-detected ball positions into a roll speed, then a rolling-friction
// model extrapolates that into a predicted total distance — the number the
// user actually wants ("how far did that putt roll").
//
// Camera setup (locked, 2026-09-24): face-on, perpendicular to the target
// line, 0.5–1.2 m from the ball, ~30 cm high — same geometry as the
// full-swing capture, just closer and far slower. Ball rolls along the
// target line, which (face-on) is the frame's horizontal axis, so the
// existing horizontal-velocity fit (linFit from kinematics.ts) applies
// directly; there's no vertical "launch" to measure (the ball stays on the
// ground), so unlike a full swing this mode never asks for a launch angle.
//
// Line (push/pull) is NOT measured in v1 — same call the full-swing pipeline
// already made for launchDirectionDeg (null until it has depth cues or a
// second camera). A single face-on camera can't reliably tell "rolled dead
// straight" from "drifted slightly toward/away from the lens" — chasing that
// from apparent-radius change alone reproduces exactly the scale-noise
// problem SHOTVISION_PLAN.md documents for the full swing. Left as `null`,
// same shape as `LaunchMeasurement.launchDirectionDeg`, so it's a natural
// slot to fill in later without a data-model change.

import { BALL_RADIUS_M } from './types';
import { linFit } from './kinematics';
import { BallDetectionFrame } from './types';

export interface PuttMeasurement {
  rollSpeedMs: number;
  startLineDeg: number | null;   // reserved — see file header; always null in v1
  confidence: number;            // 0..1
  framesTracked: number;
  ballDiameterPx: number;        // self-calibration anchor, shown for QA
}

export interface PuttRollResult {
  distanceMeters: number;
  rollTimeSec: number;
  decelMs2: number;              // deceleration used for this estimate
}

export interface PuttShot {
  id: string;
  sessionId: string;
  createdAt: string;
  measure: PuttMeasurement;
  roll: PuttRollResult;
  targetDistanceMeters?: number | null;
  notes?: string;
}

export interface PuttSession {
  id: string;
  createdAt: string;
  label?: string;
  shotIds: string[];
  targetDistanceMeters?: number | null;
  decelMs2?: number;
  saved: boolean;
}

/** Pixel detections (from the live capture loop) → a putt measurement. */
export function measurePuttFromDetections(
  frames: BallDetectionFrame[],
): PuttMeasurement | null {
  const good = frames
    .filter(f => f.confidence > 0.3 && f.radiusPx > 1)
    .sort((a, b) => a.timeSec - b.timeSec);
  if (good.length < 3) return null;

  // self-calibration anchor: median apparent radius over the first frames
  // (the ball at/just after address, before motion blur grows the streak)
  const early = good.slice(0, Math.min(4, good.length)).map(f => f.radiusPx).sort((a, b) => a - b);
  const medR = early[Math.floor(early.length / 2)];
  if (medR <= 0) return null;
  const metersPerPixel = BALL_RADIUS_M / medR;

  const t0 = good[0].timeSec;
  const ts = good.map(f => f.timeSec - t0);
  const xs = good.map(f => f.cx);
  const vxPx = linFit(ts, xs).slope;
  const rollSpeedMs = Math.abs(vxPx) * metersPerPixel;

  const spanMs = (ts[ts.length - 1] - ts[0]) * 1000;
  const confidence = clamp01(
    (good.length / 5) * (spanMs >= 120 ? 1 : spanMs / 120) * (rollSpeedMs > 0.15 ? 1 : 0.2),
  );

  return {
    rollSpeedMs,
    startLineDeg: null,
    confidence,
    framesTracked: good.length,
    ballDiameterPx: medR * 2,
  };
}

/**
 * Rolling-friction model: constant deceleration from the measured initial
 * roll speed until the ball stops. `decelMs2` is the "green speed" knob —
 * higher = slower/firmer green (ball dies faster), lower = faster green
 * (ball keeps rolling). Simple v0²/(2a) physics, same spirit as
 * ballflight.ts's fitted-not-derived coefficients: a starting point, meant
 * to be tuned once compared against real rolled-out putts.
 */
export function predictPuttRoll(rollSpeedMs: number, decelMs2: number): PuttRollResult {
  const a = Math.max(0.05, decelMs2);
  const distanceMeters = (rollSpeedMs * rollSpeedMs) / (2 * a);
  const rollTimeSec = rollSpeedMs / a;
  return { distanceMeters, rollTimeSec, decelMs2: a };
}

/** Default deceleration ≈ a medium-pace green (~9–10 on the Stimp). */
export const DEFAULT_PUTT_DECEL_MS2 = 0.4;

/** Named presets shown in settings — a rough, honest starting point per green speed. */
export const PUTT_GREEN_PRESETS: { key: string; label: string; decelMs2: number }[] = [
  { key: 'slow', label: 'Lento (green de práctica)', decelMs2: 0.55 },
  { key: 'medium', label: 'Medio', decelMs2: 0.4 },
  { key: 'fast', label: 'Rápido (torneo)', decelMs2: 0.3 },
];

/**
 * Inverse of predictPuttRoll — given a putt that actually finished at a known
 * distance (the user paced it off, or "went in the hole at Xm"), solve for
 * the deceleration that reproduces it. Lets a session self-calibrate its
 * green-speed knob from real results instead of trusting the presets blind,
 * same idea as ballflight.ts's solveSpeedForCarry.
 */
export function solveDecelForDistance(rollSpeedMs: number, distanceMeters: number): number {
  if (distanceMeters <= 0) return DEFAULT_PUTT_DECEL_MS2;
  return (rollSpeedMs * rollSpeedMs) / (2 * distanceMeters);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface PuttSessionSummary {
  count: number;
  avgDistanceM: number;
  avgSpeedMs: number;
  /** consistency 0–100: how tightly distance clusters (100 = identical putts) */
  consistency: number;
  /** only set when every putt in the session has a target distance */
  avgErrorM: number | null;
  longestId: string | null;
}

export function summarisePutts(shots: PuttShot[]): PuttSessionSummary {
  if (shots.length === 0) {
    return { count: 0, avgDistanceM: 0, avgSpeedMs: 0, consistency: 0, avgErrorM: null, longestId: null };
  }
  const distances = shots.map(s => s.roll.distanceMeters);
  const speeds = shots.map(s => s.measure.rollSpeedMs);
  const avgDistanceM = distances.reduce((a, b) => a + b, 0) / distances.length;
  const avgSpeedMs = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sd = Math.sqrt(distances.reduce((a, b) => a + (b - avgDistanceM) ** 2, 0) / distances.length);
  const cv = avgDistanceM > 0 ? sd / avgDistanceM : 0;

  const errors = shots
    .filter(s => s.targetDistanceMeters != null)
    .map(s => Math.abs(s.roll.distanceMeters - s.targetDistanceMeters!));
  const avgErrorM = errors.length === shots.length
    ? errors.reduce((a, b) => a + b, 0) / errors.length
    : null;

  const longest = shots.reduce((a, b) => (b.roll.distanceMeters > a.roll.distanceMeters ? b : a));

  return {
    count: shots.length,
    avgDistanceM,
    avgSpeedMs,
    consistency: Math.max(0, Math.round(100 - cv * 600)),
    avgErrorM,
    longestId: shots.length > 1 ? longest.id : null,
  };
}
