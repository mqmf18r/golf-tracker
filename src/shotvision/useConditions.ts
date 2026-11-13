import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';

import { fetchConditions, Conditions } from '../services/weather';
import { FlightEnv, STANDARD_ENV } from './ballflight';

/**
 * Playing conditions for the ball-flight model. Only air density is applied
 * (wind needs a target bearing we don't have indoors). Never prompts for
 * location — uses it only if already granted elsewhere in the app.
 */
export function useConditions(apply = true) {
  const [cond, setCond] = useState<Conditions | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
        if (!pos || !alive) return;
        const c = await fetchConditions(pos.coords.latitude, pos.coords.longitude);
        if (alive) setCond(c);
      } catch {
        /* keep standard conditions */
      }
    })();
    return () => { alive = false; };
  }, []));

  const env: FlightEnv =
    apply && cond
      ? { airDensity: cond.airDensity, windMs: 0, windCrossMs: 0, rollFirmness: 1 }
      : STANDARD_ENV;

  return { cond, env };
}
