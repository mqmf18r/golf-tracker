// ShotVision settings — persisted to AsyncStorage. The `show` map is the
// checklist that drives what appears on the result screen.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PUTT_DECEL_MS2 } from './putting';

const KEY = 'sv:settings';

export type MetricKey =
  | 'ballSpeed' | 'clubSpeed' | 'smash'
  | 'launchAngle' | 'launchDirection'
  | 'spinRate' | 'spinAxis'
  | 'carry' | 'total' | 'apex' | 'descentAngle' | 'hangTime' | 'offline';

export const METRIC_LABELS: Record<MetricKey, string> = {
  ballSpeed: 'Velocidad de bola',
  clubSpeed: 'Velocidad de palo',
  smash: 'Smash factor',
  launchAngle: 'Ángulo de salida',
  launchDirection: 'Dirección de salida',
  spinRate: 'Spin (rpm)',
  spinAxis: 'Eje de spin',
  carry: 'Carry',
  total: 'Total',
  apex: 'Altura máxima',
  descentAngle: 'Ángulo de caída',
  hangTime: 'Tiempo de vuelo',
  offline: 'Desviación (offline)',
};

/** Metrics not measured yet — shown greyed with "próximamente". */
export const METRIC_PENDING: Record<MetricKey, boolean> = {
  ballSpeed: false, clubSpeed: true, smash: true,
  launchAngle: false, launchDirection: true,
  spinRate: true, spinAxis: true,
  carry: false, total: false, apex: false, descentAngle: false, hangTime: false, offline: false,
};

export interface SVSettings {
  distanceUnit: 'yd' | 'm';
  speedUnit: 'mph' | 'kmh';
  ballType: 'premium' | 'range';
  altitudeOverrideM: number | null;
  tempOverrideC: number | null;
  surface: 'tee' | 'mat' | 'turf';
  targetDistanceM: number | null;
  // capture geometry
  cameraDistanceM: number;              // 1.2–1.5
  ballCorner: 'bottomRight' | 'bottomLeft';
  handsFree: boolean;
  torchSignal: boolean;
  autoAdvanceSec: number;
  show: Record<MetricKey, boolean>;
  views: { numbers: boolean; trajectory: boolean; perspective: boolean };
  // Putt mode — capture geometry + roll model. Camera is face-on, close
  // range (0.5–1.2 m), fixed low height; no ballCorner/handedness concept
  // since the ball rolls along the ground, not up into the air.
  puttCameraDistanceM: number;     // 0.5–1.2
  puttDecelMs2: number;            // "green speed" knob, see putting.ts
  puttTargetDistanceM: number | null;
}

export const DEFAULT_SETTINGS: SVSettings = {
  distanceUnit: 'yd',
  speedUnit: 'mph',
  ballType: 'premium',
  altitudeOverrideM: null,
  tempOverrideC: null,
  surface: 'mat',
  targetDistanceM: null,
  cameraDistanceM: 1.35,
  ballCorner: 'bottomLeft',
  handsFree: true,
  torchSignal: true,
  autoAdvanceSec: 6,
  show: {
    ballSpeed: true, clubSpeed: true, smash: true,
    launchAngle: true, launchDirection: true,
    spinRate: true, spinAxis: false,
    carry: true, total: true, apex: true, descentAngle: true, hangTime: false, offline: true,
  },
  views: { numbers: true, trajectory: true, perspective: true },
  puttCameraDistanceM: 0.8,
  puttDecelMs2: DEFAULT_PUTT_DECEL_MS2,
  puttTargetDistanceM: null,
};

export async function getSettings(): Promise<SVSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      show: { ...DEFAULT_SETTINGS.show, ...(parsed.show ?? {}) },
      views: { ...DEFAULT_SETTINGS.views, ...(parsed.views ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(next: SVSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}
