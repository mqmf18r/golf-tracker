// ShotVision — camera-only launch monitor.
// Phase 1: data model + physics + kinematics (see SHOTVISION_PLAN.md).

export const MS_TO_MPH = 2.2369362920544;
export const M_TO_YARDS = 1.0936132983377;
export const RPM_TO_RADS = Math.PI / 30;

/** Golf ball, R1/USGA conforming. */
export const BALL_RADIUS_M = 0.021335;   // 42.67 mm diameter
export const BALL_MASS_KG = 0.0459;

export type Handedness = 'right' | 'left';

/** Which corner the ball sits in at address — so it crosses the whole frame
 *  (max frames of flight before it exits). */
export type BallCorner = 'bottomRight' | 'bottomLeft';

export interface CaptureConfig {
  // iPhone slo-mo .mov is a true 240 fps — read it from per-frame timestamps,
  // NOT the container's nominal rate (AVAsset/ffprobe often report ~206–228).
  fps: number;                 // 240 (or better)
  frameWidth: number;
  frameHeight: number;
  lensToBallMeters: number;    // 1.2–1.5
  cameraHeightMeters: number;  // 0.25–0.35
  handedness: Handedness;
  /** Which side of the ball the phone sits on, lens pointed at the golfer. */
  cameraSide: 'target' | 'player';
  /** Ball's resting corner; it travels toward the opposite (top) side. */
  ballCorner: BallCorner;
}

export const DEFAULT_CAPTURE: CaptureConfig = {
  fps: 240,
  frameWidth: 1920,
  frameHeight: 1080,
  lensToBallMeters: 1.35,
  cameraHeightMeters: 0.3,
  handedness: 'right',
  cameraSide: 'target',
  ballCorner: 'bottomLeft',
};

/** Raw per-frame ball detection, in pixels, before calibration. */
export interface BallDetectionFrame {
  frame: number;
  timeSec: number;
  cx: number;
  cy: number;
  radiusPx: number;
  confidence: number;   // 0..1
}

/** A tracked ball sample in the calibrated capture plane (metres). */
export interface BallSample {
  t: number;            // seconds since impact
  x: number;            // downrange (horizontal in frame), + = toward target
  y: number;            // vertical, + = up
  radiusPx: number;
}

/** Measured directly from the video. */
export interface LaunchMeasurement {
  ballSpeedMs: number;
  launchAngleDeg: number;              // vertical
  launchDirectionDeg: number | null;   // + = right of target line (RH). Phase 4.
  backspinRpm: number | null;          // Phase 4
  sidespinRpm: number | null;          // Phase 4
  confidence: number;                  // 0..1
  framesTracked: number;
}

/** Output of the ball-flight physics model. */
export interface FlightResult {
  carryMeters: number;
  totalMeters: number;
  apexMeters: number;
  descentAngleDeg: number;
  sideMeters: number;      // + = right of target at landing
  flightTimeSec: number;
  landingSpeedMs: number;
  /** Downrange/side/height samples (metres), present when requested. */
  path?: { x: number; y: number; z: number }[];
}

export interface ShotVisionShot {
  id: string;
  sessionId: string;
  club: string;            // matches club codes used in clubs.tsx (D, 7i, PW…)
  createdAt: string;
  measure: LaunchMeasurement;
  flight: FlightResult;
  videoPath?: string | null;
  notes?: string;
}

export type SessionMode = 'practice' | 'sim';
export type Venue = 'indoor' | 'outdoor';
export type SimPlatform = 'gspro' | 'e6';

export interface SimConfig {
  platform: SimPlatform;
  host: string;
  port: number;
  alignmentOffsetDeg: number;   // added to measured launch direction before sending
}

export interface ShotSession {
  id: string;
  createdAt: string;
  label?: string;
  shotIds: string[];
  mode: SessionMode;
  venue?: Venue;
  ballType?: 'premium' | 'range';
  sim?: SimConfig;
  /** practice sessions start unsaved; the user confirms on exit */
  saved: boolean;
}
