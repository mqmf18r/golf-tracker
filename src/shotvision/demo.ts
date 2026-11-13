// Phase 1 stand-in: synthesize the per-frame ball detections the CV pipeline
// (Phase 2) will produce from a real slow-mo clip. Lets the whole
// detections → kinematics → physics chain run and render today, in Expo Go.

import { BallDetectionFrame, CaptureConfig, BALL_RADIUS_M } from './types';

interface DemoShot {
  ballSpeedMs: number;
  launchAngleDeg: number;
  backspinRpm: number;
  launchDirectionDeg?: number;
  sidespinRpm?: number;
}

/** Rough ball-speed / launch presets per club, for the demo only. */
export const DEMO_PRESETS: Record<string, DemoShot> = {
  D:   { ballSpeedMs: 63, launchAngleDeg: 13, backspinRpm: 2900 },
  '3M':{ ballSpeedMs: 58, launchAngleDeg: 11, backspinRpm: 3600 },
  '5M':{ ballSpeedMs: 55, launchAngleDeg: 12, backspinRpm: 4200 },
  Hib: { ballSpeedMs: 52, launchAngleDeg: 14, backspinRpm: 4800 },
  '5i':{ ballSpeedMs: 49, launchAngleDeg: 15, backspinRpm: 5600 },
  '7i':{ ballSpeedMs: 45, launchAngleDeg: 18, backspinRpm: 6800 },
  '9i':{ ballSpeedMs: 40, launchAngleDeg: 22, backspinRpm: 8200 },
  PW:  { ballSpeedMs: 37, launchAngleDeg: 25, backspinRpm: 9200 },
  SW:  { ballSpeedMs: 28, launchAngleDeg: 31, backspinRpm: 10500 },
};

export function demoPreset(club: string): DemoShot {
  return DEMO_PRESETS[club] ?? { ballSpeedMs: 45, launchAngleDeg: 18, backspinRpm: 6500 };
}

/** A preset with realistic shot-to-shot scatter — so a session of demo shots
 *  actually shows spread in the summary. */
export function demoShotWithScatter(club: string): DemoShot {
  const p = demoPreset(club);
  const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ~N(0,1)
  const dir = g() * 1.7;                         // start line, ±deg
  const side = g() * 700 + dir * 180;            // sidespin correlates with face-to-path
  return {
    ballSpeedMs: p.ballSpeedMs * (1 + g() * 0.035),
    launchAngleDeg: p.launchAngleDeg + g() * 1.6,
    backspinRpm: Math.max(1200, p.backspinRpm * (1 + g() * 0.09)),
    launchDirectionDeg: dir,
    sidespinRpm: side,
  };
}

/**
 * Build a straight-line post-impact ball track (with a little noise) as it
 * would look face-on. The ball rests in `cfg.ballCorner` and travels up and
 * across toward the opposite side, so it stays in frame for as many frames as
 * possible.
 */
export function syntheticDetections(shot: DemoShot, cfg: CaptureConfig): BallDetectionFrame[] {
  // horizontal field of view at the ball plane for a typical iPhone wide lens
  const hfovRad = (67 * Math.PI) / 180;
  const planeWidthM = 2 * cfg.lensToBallMeters * Math.tan(hfovRad / 2);
  const metersPerPixel = planeWidthM / cfg.frameWidth;
  const radiusPx = BALL_RADIUS_M / metersPerPixel;

  const la = (shot.launchAngleDeg * Math.PI) / 180;
  const across = shot.ballSpeedMs * Math.cos(la);   // horizontal speed (m/s)
  const vy = shot.ballSpeedMs * Math.sin(la);       // vertical speed (m/s)

  // bottom-right → travels left (dir = -1); bottom-left → travels right (+1)
  const dir = cfg.ballCorner === 'bottomRight' ? -1 : 1;
  const startX = cfg.ballCorner === 'bottomRight' ? cfg.frameWidth * 0.86 : cfg.frameWidth * 0.14;
  const startY = cfg.frameHeight * 0.82;
  const noise = () => (Math.random() - 0.5) * 0.6; // sub-pixel jitter

  const frames: BallDetectionFrame[] = [];
  for (let i = 0; i < 16; i++) {
    const t = i / cfg.fps;
    const cx = startX + (dir * across * t) / metersPerPixel + noise();
    const cy = startY - (vy * t) / metersPerPixel + noise();
    if (cx < -cfg.frameWidth * 0.05 || cx > cfg.frameWidth * 1.05 || cy < 0) break;
    frames.push({
      frame: i,
      timeSec: t,
      cx,
      cy,
      radiusPx: radiusPx * (1 + noise() * 0.02),
      confidence: 0.9,
    });
  }
  return frames;
}
