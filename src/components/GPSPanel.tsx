import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Hole } from '../types';
import { useLocation } from '../services/location';
import { COLORS, RADIUS, SPACING, FONT } from '../theme';

interface Props {
  hole: Hole;
  pinColor?: 'red' | 'yellow' | 'blue'; // kept for API compatibility, unused
  onDistanceChange?: (dist: number | null) => void;
  enabled: boolean;
  onToggleEnabled: (next: boolean) => void;
}

export function GPSPanel({ hole, onDistanceChange, enabled, onToggleEnabled }: Props) {
  const { distanceTo, permission } = useLocation();

  const pin = hole.centerLat !== 0 ? { lat: hole.centerLat, lon: hole.centerLon }
            : hole.frontLat  !== 0 ? { lat: hole.frontLat,  lon: hole.frontLon  }
            : hole.backLat   !== 0 ? { lat: hole.backLat,   lon: hole.backLon   }
            : null;

  const dist = enabled && permission && pin ? distanceTo(pin) : null;

  useEffect(() => { onDistanceChange?.(dist); }, [dist]);

  if (!enabled) {
    return (
      <View style={styles.offRow}>
        <Text style={styles.offText}>GPS desactivado</Text>
        <TouchableOpacity style={styles.offBtn} onPress={() => onToggleEnabled(true)}>
          <Ionicons name="navigate" size={14} color={COLORS.textOnPrimary} />
          <Text style={styles.offBtnTxt}>Activar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.noPermission}>
        <Text style={styles.noPermissionText}>Sin permiso de ubicación del dispositivo</Text>
        <ToggleBtn on={enabled} onPress={() => onToggleEnabled(!enabled)} dark={false} />
      </View>
    );
  }

  if (!pin) {
    return (
      <View style={styles.noCoords}>
        <Text style={styles.noCoordsText}>Sin coordenadas GPS para este hoyo</Text>
        <Text style={styles.noCoordsHint}>Márcalas desde Campos → Mapa GPS</Text>
        <ToggleBtn on={enabled} onPress={() => onToggleEnabled(!enabled)} dark={false} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ToggleBtn on={enabled} onPress={() => onToggleEnabled(!enabled)} dark />
      <Text style={styles.label}>Al hoyo</Text>
      <Text style={styles.dist}>{dist !== null ? dist : '—'}</Text>
      <Text style={styles.unit}>metros</Text>
    </View>
  );
}

function ToggleBtn({ on, onPress, dark }: { on: boolean; onPress: () => void; dark: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.toggleBtn, dark ? styles.toggleBtnDark : styles.toggleBtnLight]}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name={on ? 'navigate' : 'navigate-outline'} size={13} color={dark ? '#7ab87a' : COLORS.textTertiary} />
      <Text style={[styles.toggleBtnTxt, dark ? styles.toggleBtnTxtDark : styles.toggleBtnTxtLight]}>GPS {on ? 'ON' : 'OFF'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg - 4,
    marginBottom: SPACING.sm + 4, alignItems: 'center',
  },
  label: { fontSize: 12, color: COLORS.primaryMuted, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  dist:  { fontSize: 52, fontFamily: FONT.headingExtraBold, color: COLORS.textOnPrimary, lineHeight: 60, marginTop: 2 },
  unit:  { fontSize: 13, color: COLORS.primaryMuted, fontFamily: FONT.bodySemiBold, marginTop: 2 },
  noPermission: { backgroundColor: '#fff3cd', borderRadius: RADIUS.md, padding: SPACING.sm + 6, marginBottom: SPACING.sm + 4 },
  noPermissionText: { color: '#856404', fontSize: 13, fontFamily: FONT.body, textAlign: 'center' },
  noCoords: { backgroundColor: '#f8f9fa', borderRadius: RADIUS.md, padding: SPACING.sm + 6, marginBottom: SPACING.sm + 4, alignItems: 'center' },
  noCoordsText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT.body },
  noCoordsHint: { color: COLORS.textTertiary, fontSize: 11, fontFamily: FONT.body, marginTop: 4 },

  offRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f0f2f5', borderRadius: RADIUS.md, paddingVertical: SPACING.sm + 2, paddingHorizontal: SPACING.sm + 6, marginBottom: SPACING.sm + 4,
  },
  offText: { fontSize: 13, color: COLORS.textSecondary, fontFamily: FONT.bodySemiBold },
  offBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xs + 2 },
  offBtnTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  toggleBtn: { position: 'absolute', top: 10, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  toggleBtnDark: { backgroundColor: 'rgba(255,255,255,0.12)' },
  toggleBtnLight: { backgroundColor: 'rgba(0,0,0,0.06)' },
  toggleBtnTxt: { fontSize: 10, fontFamily: FONT.bodySemiBold },
  toggleBtnTxtDark: { color: COLORS.primaryMuted },
  toggleBtnTxtLight: { color: COLORS.textTertiary },
});
