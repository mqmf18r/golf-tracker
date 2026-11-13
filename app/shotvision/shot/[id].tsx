import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ShotVisionShot } from '../../../src/shotvision/types';
import { getShot, deleteShot } from '../../../src/shotvision/store';
import { useSettings } from '../../../src/shotvision/useSettings';
import { speedNum, speedUnit } from '../../../src/shotvision/format';
import {
  CLUB_NAMES, SV, NumbersPanel, TrajectoryChart, PerspectiveFlight,
} from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

export function ShotResult({ shot }: { shot: ShotVisionShot }) {
  const { settings } = useSettings();
  const { measure: m, flight: f } = shot;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>VELOCIDAD DE BOLA · {CLUB_NAMES[shot.club] ?? shot.club}</Text>
        <View style={styles.heroRow}>
          <Text style={styles.heroNum}>{speedNum(m.ballSpeedMs, settings)}</Text>
          <Text style={styles.heroUnit}>{speedUnit(settings)}</Text>
        </View>
        <Text style={styles.heroSub}>
          salida {m.launchAngleDeg.toFixed(1)}°
          {m.launchDirectionDeg != null ? ` · ${m.launchDirectionDeg > 0 ? 'der' : 'izq'} ${Math.abs(m.launchDirectionDeg).toFixed(1)}°` : ''}
          {m.confidence != null ? ` · confianza ${Math.round(m.confidence * 100)}%` : ''}
        </Text>
      </View>

      {settings.views.perspective && <PerspectiveFlight flight={f} s={settings} />}
      {settings.views.trajectory && <TrajectoryChart flight={f} s={settings} />}
      {settings.views.numbers && <NumbersPanel m={m} f={f} s={settings} />}
    </View>
  );
}

export default function ShotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [shot, setShot] = useState<ShotVisionShot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getShot(id).then(s => { setShot(s); setLoading(false); }); }, [id]);

  function confirmDelete() {
    Alert.alert('Borrar golpe', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteShot(id); router.back(); } },
    ]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={SV.green} /></View>;
  if (!shot) return <View style={styles.center}><Text style={styles.dim}>Golpe no encontrado.</Text></View>;

  const when = new Date(shot.createdAt).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      <Stack.Screen options={{
        title: CLUB_NAMES[shot.club] ?? shot.club,
        headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
        headerRight: () => (
          <TouchableOpacity onPress={confirmDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={SV.danger} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <Text style={styles.when}>{when}</Text>
        <ShotResult shot={shot} />
        <Text style={styles.disclaimer}>
          Carry, total y altura salen de un modelo físico ajustado por la densidad del aire.
          Golpe de demostración con dispersión realista hasta activar la cámara.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SV.bg },
  dim: { fontSize: 13, color: SV.sub },
  when: { fontSize: 12, color: SV.sub, fontFamily: FONT.bodyMedium },
  disclaimer: { fontSize: 11, color: SV.faint, lineHeight: 16, marginTop: 4 },

  hero: {
    backgroundColor: SV.surface, borderRadius: 16, padding: 18, gap: 4,
    borderWidth: 1, borderColor: SV.line,
  },
  heroLabel: { fontSize: 10, fontFamily: FONT.headingSemiBold, color: SV.sub, letterSpacing: 0.8 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  heroNum: { fontSize: 52, fontFamily: FONT.headingExtraBold, color: SV.ink, lineHeight: 56 },
  heroUnit: { fontSize: 16, fontFamily: FONT.bodySemiBold, color: SV.sub, marginBottom: 8 },
  heroSub: { fontSize: 12, color: SV.sub },
});
