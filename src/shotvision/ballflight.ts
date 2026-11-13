// Golf ball flight model — aerodynamic drag + Magnus lift, RK4 integration.
//
// World axes:  x = downrange (toward target),  y = right of target line,  z = up.
// Spin sign:   backspinRpm  > 0  → lift (normal shot)
//              sidespinRpm  > 0  → ball curves RIGHT  (slice for a RH golfer)
//
// The drag / lift coefficients below are engineering approximations. Once we can
// compare against a real launch monitor, tune dragCoeff() / liftCoeff() and the
// roll model here — everything else in ShotVision feeds off this file.

import {
  BALL_MASS_KG, BALL_RADIUS_M, RPM_TO_RADS, FlightResult,
} from './types';

const BALL_AREA_M2 = Math.PI * BALL_RADIUS_M * BALL_RADIUS_M;
const G = 9.80665;

export interface FlightEnv {
  airDensity: number;     // kg/m^3  (1.225 ≈ sea level, 15 °C)
  windMs?: number;        // + = helping wind (blows toward target)
  windCrossMs?: number;   // + = blows ball to the right
  rollFirmness?: number;  // 0.5 soft turf … 1.5 firm/links ; default 1
}

export const STANDARD_ENV: FlightEnv = {
  airDensity: 1.225, windMs: 0, windCrossMs: 0, rollFirmness: 1,
};

/** Dry-air density from altitude (m) and temperature (°C). */
export function airDensity(altitudeMeters: number, tempC: number): number {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitudeMeters, 5.25588);
  return p / (287.058 * (tempC + 273.15));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// spin ratio  S = ω·R / v
// Fitted to TrackMan PGA-Tour averages (driver → wedge): carry within ~3 %,
// apex/descent within a few degrees for the long/mid bag; wedges run a touch
// short & shallow. Re-tune these + SPIN_DECAY_PER_SEC against a real monitor.
function dragCoeff(S: number): number {
  return clamp(0.24 + 0.18 * S, 0.24, 0.45);
}
function liftCoeff(S: number): number {
  // ~linear for small S, saturating near 0.32
  return clamp((1.85 * S) / (1.0 + S), 0, 0.32);
}
const SPIN_DECAY_PER_SEC = 1 / 40;

export interface FlightInput {
  ballSpeedMs: number;
  launchAngleDeg: number;
  launchDirectionDeg?: number;   // + = right
  backspinRpm?: number;
  sidespinRpm?: number;
}

interface Vec { x: number; y: number; z: number; }
interface State { p: Vec; v: Vec; }

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const mag = (a: Vec) => Math.hypot(a.x, a.y, a.z);

export function simulateFlight(
  input: FlightInput,
  env: FlightEnv = STANDARD_ENV,
  opts: { collectPath?: boolean } = {},
): FlightResult {
  const rho = env.airDensity;
  const windVec: Vec = { x: env.windMs ?? 0, y: env.windCrossMs ?? 0, z: 0 };

  const la = (input.launchAngleDeg * Math.PI) / 180;
  const dir = ((input.launchDirectionDeg ?? 0) * Math.PI) / 180;
  const v0 = input.ballSpeedMs;

  // spin angular-velocity vector (rad/s), constant direction, slow decay.
  // backspin → axis along +y (right)  ⇒  Magnus  ∝  v × ω  points up.
  // sidespin → axis along +z (up)     ⇒  Magnus points to the right for +spin.
  const wBack = (input.backspinRpm ?? 2500) * RPM_TO_RADS;
  const wSide = (input.sidespinRpm ?? 0) * RPM_TO_RADS;

  let st: State = {
    p: { x: 0, y: 0, z: 0 },
    v: {
      x: v0 * Math.cos(la) * Math.cos(dir),
      y: v0 * Math.cos(la) * Math.sin(dir),
      z: v0 * Math.sin(la),
    },
  };

  const accel = (s: State, t: number): Vec => {
    const decay = Math.exp(-SPIN_DECAY_PER_SEC * t);
    const omega: Vec = { x: 0, y: wBack * decay, z: -wSide * decay };
    const vRel = add(s.v, scale(windVec, -1));
    const speed = mag(vRel) || 1e-6;
    const S = (mag(omega) * BALL_RADIUS_M) / speed;

    const q = 0.5 * rho * BALL_AREA_M2 * speed * speed;      // dynamic pressure × area
    const drag = scale(vRel, (-dragCoeff(S) * q) / (speed * BALL_MASS_KG));

    const ldir = cross(vRel, omega);
    const lmag = mag(ldir) || 1e-6;
    const lift = scale(ldir, (liftCoeff(S) * q) / (lmag * BALL_MASS_KG));

    return { x: drag.x + lift.x, y: drag.y + lift.y, z: drag.z + lift.z - G };
  };

  const dt = 0.002;
  let t = 0;
  let apex = 0;
  let prev = st;
  const path: Vec[] = opts.collectPath ? [{ x: 0, y: 0, z: 0 }] : [];

  for (let i = 0; i < 8000; i++) {
    // RK4
    const k1v = accel(st, t);
    const k1p = st.v;
    const s2: State = { p: add(st.p, scale(k1p, dt / 2)), v: add(st.v, scale(k1v, dt / 2)) };
    const k2v = accel(s2, t + dt / 2);
    const k2p = s2.v;
    const s3: State = { p: add(st.p, scale(k2p, dt / 2)), v: add(st.v, scale(k2v, dt / 2)) };
    const k3v = accel(s3, t + dt / 2);
    const k3p = s3.v;
    const s4: State = { p: add(st.p, scale(k3p, dt)), v: add(st.v, scale(k3v, dt)) };
    const k4v = accel(s4, t + dt);
    const k4p = s4.v;

    prev = st;
    st = {
      p: add(st.p, scale(add(add(k1p, scale(k2p, 2)), add(scale(k3p, 2), k4p)), dt / 6)),
      v: add(st.v, scale(add(add(k1v, scale(k2v, 2)), add(scale(k3v, 2), k4v)), dt / 6)),
    };
    t += dt;
    apex = Math.max(apex, st.p.z);
    if (opts.collectPath && i % 15 === 0) path.push({ ...st.p });

    if (st.p.z <= 0 && prev.p.z > 0) {
      // linear interpolation to the ground crossing
      const f = prev.p.z / (prev.p.z - st.p.z);
      const land: Vec = add(prev.p, scale(add(st.p, scale(prev.p, -1)), f));
      const landV: Vec = add(prev.v, scale(add(st.v, scale(prev.v, -1)), f));
      const carry = land.x;
      const descentAngleDeg = (Math.atan2(-landV.z, Math.hypot(landV.x, landV.y)) * 180) / Math.PI;
      const landingSpeedMs = mag(landV);

      const roll = rollDistance(descentAngleDeg, landingSpeedMs, env.rollFirmness ?? 1);
      const dirUnit = Math.hypot(landV.x, landV.y) || 1e-6;
      if (opts.collectPath) path.push({ ...land });

      return {
        carryMeters: carry,
        totalMeters: carry + roll * (landV.x / dirUnit),
        apexMeters: apex,
        descentAngleDeg,
        sideMeters: land.y + roll * (landV.y / dirUnit),
        flightTimeSec: t - dt + dt * f,
        landingSpeedMs,
        path: opts.collectPath ? path : undefined,
      };
    }
  }

  // Should not happen; return a safe fallback.
  return {
    carryMeters: st.p.x, totalMeters: st.p.x, apexMeters: apex,
    descentAngleDeg: 45, sideMeters: st.p.y, flightTimeSec: t, landingSpeedMs: mag(st.v),
  };
}

/** Rough roll-out on a fairway/range, from descent angle + landing speed. */
function rollDistance(descentAngleDeg: number, landingSpeedMs: number, firmness: number): number {
  // fraction of the landing speed's horizontal component that becomes ground roll
  const table: [number, number][] = [
    [10, 0.55], [20, 0.34], [30, 0.18], [40, 0.08], [50, 0.03], [60, 0.0],
  ];
  let frac = 0.03;
  for (let i = 0; i < table.length - 1; i++) {
    const [a, fa] = table[i];
    const [b, fb] = table[i + 1];
    if (descentAngleDeg >= a && descentAngleDeg <= b) {
      frac = fa + ((fb - fa) * (descentAngleDeg - a)) / (b - a);
      break;
    }
  }
  if (descentAngleDeg < 10) frac = 0.55;
  const horiz = landingSpeedMs * Math.cos((descentAngleDeg * Math.PI) / 180);
  return Math.max(0, horiz * frac * firmness * 0.9);
}

/** Smash factor from ball & club speed (Phase 4 will measure club speed). */
export function smashFactor(ballSpeedMs: number, clubSpeedMs: number): number {
  return clubSpeedMs > 0 ? ballSpeedMs / clubSpeedMs : 0;
}

/**
 * Invert the flight model: given a launch angle you trust (it's scale-free —
 * a pixel-ratio, unaffected by any ball-size/calibration error) and a carry
 * distance you know independently (paced off, GPS, a range marker), solve
 * for the ball speed that reproduces it. Carry is monotonic in speed for a
 * fixed angle/spin, so bisection converges reliably. Use this instead of a
 * pixel-scale speed measurement when the ball's on-screen size is the weak
 * link — it sidesteps that error source entirely.
 */
export function solveSpeedForCarry(
  launchAngleDeg: number,
  targetCarryM: number,
  backspinRpm: number,
  env: FlightEnv = STANDARD_ENV,
  launchDirectionDeg = 0,
): number {
  const carryAt = (v: number) =>
    simulateFlight({ ballSpeedMs: v, launchAngleDeg, launchDirectionDeg, backspinRpm }, env).carryMeters;

  let lo = 3, hi = 90;
  for (let i = 0; i < 40 && carryAt(hi) < targetCarryM; i++) hi *= 1.3;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (carryAt(mid) < targetCarryM) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
