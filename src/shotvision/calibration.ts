// Manual calibration: turn a handful of user-tapped ball positions (from a
// picked slow-mo video, viewed frame-by-frame) into a launch measurement —
// no native frame extractor needed, works today in Expo Go. Assumes a
// face-on capture; down-the-line footage can still be reviewed for framing
// but the speed/launch numbers here won't be meaningful for that angle.

import { BALL_RADIUS_M, LaunchMeasurement } from './types';
import { linFit } from './kinematics';

export interface ManualMark {
  timeMs: number;   // video position when this mark was placed
  x: number;        // tap position in native video pixels
  y: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Launch angle from the marks alone — no ball-diameter/scale needed. It's a
 * ratio of the same two pixel slopes `fitLaunchFromMarks` uses, so any scale
 * error (wrong diameter, wrong calibration factor) cancels out identically
 * top and bottom. Use this with a known carry (`solveSpeedForCarry` in
 * ballflight.ts) instead of trusting a pixel-scale speed measurement.
 */
export function angleOnlyFromMarks(marks: ManualMark[]): number | null {
  if (marks.length < 2) return null;
  const sorted = [...marks].sort((a, b) => a.timeMs - b.timeMs);
  const t0 = sorted[0].timeMs;
  const ts = sorted.map(m => (m.timeMs - t0) / 1000);
  const vxPx = linFit(ts, sorted.map(m => m.x)).slope;
  const vyPx = linFit(ts, sorted.map(m => m.y)).slope;
  return (Math.atan2(-vyPx, Math.abs(vxPx)) * 180) / Math.PI;
}

/**
 * `ballDiameterPx` comes from a 2-tap "scale" step (tap one edge of the ball,
 * then the opposite edge) on a frame where the ball is at rest — this is the
 * self-calibration anchor, same idea as the automatic pipeline but done by eye.
 */
/**
 * Single-frame speed from a motion-blur streak: tap the two ends of the
 * blur (near end first, far end second) instead of tapping the ball across
 * several frames. Needs an assumed shutter duty cycle (exposure ÷ frame
 * interval) — ~0.90 measured against a clip with a known multi-frame track;
 * tune it if results drift once the camera setup is fixed.
 */
export interface StreakSample {
  timeMs: number;
  x1: number; y1: number;   // near end (closer to address)
  x2: number; y2: number;   // far end
  lengthPx: number;
  speedMs: number;
  launchAngleDeg: number;
}

export function computeStreak(
  timeMs: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  ballDiameterPx: number,
  dutyCycle: number,
  fps: number,
): StreakSample {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthPx = Math.hypot(dx, dy);
  const mmPerPx = (BALL_RADIUS_M * 2 * 1000) / ballDiameterPx;
  const travelM = (lengthPx * mmPerPx) / 1000;
  const exposureS = dutyCycle / fps;
  const speedMs = travelM / exposureS;
  const launchAngleDeg = (Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI;
  return { timeMs, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, lengthPx, speedMs, launchAngleDeg };
}

export interface StreakSummary {
  speedMean: number; speedStd: number;
  launchMean: number; launchStd: number;
  n: number;
}

export function summariseStreaks(streaks: StreakSample[]): StreakSummary | null {
  if (streaks.length === 0) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  const speeds = streaks.map(s => s.speedMs);
  const launches = streaks.map(s => s.launchAngleDeg);
  return {
    speedMean: mean(speeds), speedStd: std(speeds),
    launchMean: mean(launches), launchStd: std(launches),
    n: streaks.length,
  };
}

export function fitLaunchFromMarks(
  marks: ManualMark[],
  ballDiameterPx: number,
): LaunchMeasurement | null {
  if (marks.length < 2 || ballDiameterPx <= 0) return null;
  const sorted = [...marks].sort((a, b) => a.timeMs - b.timeMs);
  const t0 = sorted[0].timeMs;
  const ts = sorted.map(m => (m.timeMs - t0) / 1000);

  const vxPx = linFit(ts, sorted.map(m => m.x)).slope;
  const vyPx = linFit(ts, sorted.map(m => m.y)).slope;

  const mmPerPx = (BALL_RADIUS_M * 2 * 1000) / ballDiameterPx;
  const vx = (vxPx * mmPerPx) / 1000;      // m/s, + = right
  const vy = (-vyPx * mmPerPx) / 1000;     // m/s, + = up (image y grows downward)

  const ballSpeedMs = Math.hypot(vx, vy);
  const launchAngleDeg = (Math.atan2(vy, Math.abs(vx)) * 180) / Math.PI;

  const spanMs = sorted[sorted.length - 1].timeMs - t0;
  const confidence = clamp01((sorted.length / 6) * (spanMs >= 15 ? 1 : spanMs / 15));

  return {
    ballSpeedMs,
    launchAngleDeg,
    launchDirectionDeg: null,
    backspinRpm: null,
    sidespinRpm: null,
    confidence,
    framesTracked: sorted.length,
  };
}
