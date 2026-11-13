import { MS_TO_MPH, M_TO_YARDS } from './types';
import { SVSettings } from './settings';

export function dist(meters: number, s: SVSettings): string {
  return s.distanceUnit === 'yd'
    ? `${Math.round(meters * M_TO_YARDS)} yd`
    : `${Math.round(meters)} m`;
}
export function distNum(meters: number, s: SVSettings): number {
  return s.distanceUnit === 'yd' ? Math.round(meters * M_TO_YARDS) : Math.round(meters);
}
export function distUnit(s: SVSettings): string {
  return s.distanceUnit;
}

export function speed(ms: number, s: SVSettings): string {
  return s.speedUnit === 'mph'
    ? `${Math.round(ms * MS_TO_MPH)} mph`
    : `${Math.round(ms * 3.6)} km/h`;
}
export function speedNum(ms: number, s: SVSettings): number {
  return s.speedUnit === 'mph' ? Math.round(ms * MS_TO_MPH) : Math.round(ms * 3.6);
}
export function speedUnit(s: SVSettings): string {
  return s.speedUnit === 'mph' ? 'mph' : 'km/h';
}
