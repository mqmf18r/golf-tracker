// One place the screens call to turn "a shot happened" into measured + modelled
// numbers. Today it runs the demo pipeline (synthetic detections → kinematics →
// physics). Phase 2 swaps `demoShotWithScatter`/`syntheticDetections` for the
// real frame extractor + tracker; everything downstream stays the same.

import { CaptureConfig, DEFAULT_CAPTURE, FlightResult, LaunchMeasurement } from './types';
import { analyseDetections } from './kinematics';
import { simulateFlight, STANDARD_ENV, FlightEnv } from './ballflight';
import { demoShotWithScatter, syntheticDetections } from './demo';
import { SVSettings, DEFAULT_SETTINGS } from './settings';

export interface AnalyzedShot {
  measure: LaunchMeasurement;
  flight: FlightResult;
}

export function captureConfig(s: SVSettings = DEFAULT_SETTINGS): CaptureConfig {
  return {
    ...DEFAULT_CAPTURE,
    lensToBallMeters: s.cameraDistanceM,
    ballCorner: s.ballCorner,
  };
}

export function analyzeDemoShot(
  club: string,
  env: FlightEnv = STANDARD_ENV,
  cfg: CaptureConfig = DEFAULT_CAPTURE,
): AnalyzedShot | null {
  const shot = demoShotWithScatter(club);
  const { measure } = analyseDetections(syntheticDetections(shot, cfg), cfg);
  if (!measure) return null;

  // Demo: we "know" the spin + direction we generated, so fill them in.
  measure.launchDirectionDeg = shot.launchDirectionDeg ?? null;
  measure.backspinRpm = shot.backspinRpm;
  measure.sidespinRpm = shot.sidespinRpm ?? null;

  const flight = simulateFlight(
    {
      ballSpeedMs: measure.ballSpeedMs,
      launchAngleDeg: measure.launchAngleDeg,
      launchDirectionDeg: shot.launchDirectionDeg ?? 0,
      backspinRpm: shot.backspinRpm,
      sidespinRpm: shot.sidespinRpm ?? 0,
    },
    env,
    { collectPath: true },
  );
  return { measure, flight };
}
