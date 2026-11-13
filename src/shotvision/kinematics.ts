// ShotVision — turn per-frame ball detections into launch numbers.
//
// The camera is face-on, low, ~0.6 m from the ball (ShotVision-style). In the
// first ~40 ms after impact the ball path is almost a straight line, so a
// least-squares fit of the first frames gives ball speed + launch angle
// directly. Scale is self-calibrated from the known ball size — no ruler,
// no manual calibration.

import {
  BALL_RADIUS_M, BallDetectionFrame, BallSample, CaptureConfig, LaunchMeasurement,
} from './types';

export interface CalibratedTrack {
  samples: BallSample[];
  metersPerPixel: number;
}

/** Pixel detections → metric samples in the capture plane. */
export function calibrateTrack(
  frames: BallDetectionFrame[],
  _cfg: CaptureConfig,
): CalibratedTrack {
  const good = frames
    .filter(f => f.confidence > 0.3 && f.radiusPx > 1)
    .sort((a, b) => a.timeSec - b.timeSec);
  if (good.length < 3) return { samples: [], metersPerPixel: 0 };

  // median apparent radius over the first frames = the calibration
  const early = good.slice(0, Math.min(6, good.length))
    .map(f => f.radiusPx)
    .sort((a, b) => a - b);
  const medR = early[Math.floor(early.length / 2)];
  const metersPerPixel = BALL_RADIUS_M / medR;

  const t0 = good[0].timeSec;
  const x0 = good[0].cx;
  const y0 = good[0].cy;
  const samples: BallSample[] = good.map(f => ({
    t: f.timeSec - t0,
    x: (f.cx - x0) * metersPerPixel,
    y: -(f.cy - y0) * metersPerPixel,   // image y grows downward → negate
    radiusPx: f.radiusPx,
  }));
  return { samples, metersPerPixel };
}

export function linFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const d = n * sxx - sx * sx || 1e-9;
  const slope = (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * Ball speed + vertical launch angle from a calibrated track.
 * Launch direction and spin stay null until Phase 4 (needs the marked ball
 * and/or a second camera).
 */
export function measureLaunch(
  track: CalibratedTrack,
  _cfg: CaptureConfig,
): LaunchMeasurement | null {
  const { samples } = track;
  if (samples.length < 3) return null;

  const early = samples.filter(s => s.t <= 0.045);
  const use = early.length >= 3 ? early : samples.slice(0, Math.min(6, samples.length));

  const ts = use.map(s => s.t);
  const vx = linFit(ts, use.map(s => s.x)).slope;   // signed: + right, - left
  const vy = linFit(ts, use.map(s => s.y)).slope;

  const ballSpeedMs = Math.hypot(vx, vy);
  // launch is measured off the horizontal regardless of travel direction
  const launchAngleDeg = (Math.atan2(vy, Math.abs(vx)) * 180) / Math.PI;

  const spanMs = (use[use.length - 1].t - use[0].t) * 1000;
  const confidence = clamp01(
    (use.length / 6) * (spanMs >= 15 ? 1 : spanMs / 15) * (ballSpeedMs > 5 ? 1 : 0.2),
  );

  return {
    ballSpeedMs,
    launchAngleDeg,
    launchDirectionDeg: null,
    backspinRpm: null,
    sidespinRpm: null,
    confidence,
    framesTracked: samples.length,
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Full pipeline: detections → launch measurement. */
export function analyseDetections(
  frames: BallDetectionFrame[],
  cfg: CaptureConfig,
): { measure: LaunchMeasurement | null; track: CalibratedTrack } {
  const track = calibrateTrack(frames, cfg);
  return { measure: measureLaunch(track, cfg), track };
}
