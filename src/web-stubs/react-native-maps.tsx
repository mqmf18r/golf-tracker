// Dev-only stand-in for `react-native-maps` on the web platform. That
// package has no web target (it's backed by native Google/Apple Maps SDKs),
// so importing it crashes the whole Metro web bundle at boot — not just the
// screens that use it. This stub exists purely so `expo start --web` is
// usable for visually testing screens that don't otherwise care about the
// map (wired in via `metro.config.js`'s web-only resolver alias). Native
// builds (iOS/Android) never see this file — they get the real package.
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FONT } from '../theme';

const noop = () => {};
const asyncNoop = async () => {};
const pointForCoordinate = async () => ({ x: 0, y: 0 });
const coordinateForPoint = async () => ({ latitude: 0, longitude: 0 });

const MapView = forwardRef<any, any>(function MapView(props, ref) {
  useImperativeHandle(ref, () => ({
    animateCamera: noop,
    animateToRegion: noop,
    fitToCoordinates: noop,
    pointForCoordinate,
    coordinateForPoint,
    setCamera: noop,
    getCamera: asyncNoop,
  }));
  return (
    <View style={[styles.map, props.style]}>
      <Text style={styles.label}>Mapa (no disponible en web)</Text>
      {props.children}
    </View>
  );
});

function Marker() { return null; }
function Polygon() { return null; }
function Polyline() { return null; }
function Circle() { return null; }
function Callout() { return null; }

const styles = StyleSheet.create({
  map: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1a26', minHeight: 120 },
  label: { color: '#7a8a99', fontSize: 12, fontFamily: FONT.bodyMedium },
});

export default MapView;
export { Marker, Polygon, Polyline, Circle, Callout };
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = 'default';
