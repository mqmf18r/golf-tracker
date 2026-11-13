import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

export interface LatLon { lat: number; lon: number }

export function distanceMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const x =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function useLocation() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [permission, setPermission] = useState<boolean>(false);
  const subRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setPermission(true);
      subRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
        setLocation
      );
    })();
    return () => { subRef.current?.remove(); };
  }, []);

  function distanceTo(target: LatLon): number | null {
    if (!location) return null;
    return Math.round(
      distanceMeters(
        { lat: location.coords.latitude, lon: location.coords.longitude },
        target
      )
    );
  }

  return { location, permission, distanceTo };
}

export function useShotMeasure() {
  const { location, distanceTo } = useLocation();
  const [startCoords, setStartCoords] = useState<LatLon | null>(null);
  const [measuring, setMeasuring] = useState(false);

  function start() {
    if (!location) return false;
    setStartCoords({ lat: location.coords.latitude, lon: location.coords.longitude });
    setMeasuring(true);
    return true;
  }

  function stop(): number | null {
    if (!startCoords || !location) { setMeasuring(false); return null; }
    const dist = Math.round(
      distanceMeters(startCoords, { lat: location.coords.latitude, lon: location.coords.longitude })
    );
    setMeasuring(false);
    setStartCoords(null);
    return dist;
  }

  function cancel() {
    setMeasuring(false);
    setStartCoords(null);
  }

  return { measuring, start, stop, cancel };
}
