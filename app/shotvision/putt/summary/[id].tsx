import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PuttSession, PuttShot, summarisePutts } from '../../../../src/shotvision/putting';
import {
  getPuttSession, listPuttShots, deletePuttShot, deletePuttSession,
} from '../../../../src/shotvision/puttStore';
import { useSettings } from '../../../../src/shotvision/useSettings';
import { dist, speed } from '../../../../src/shotvision/format';
import { SV } from '../../../../src/shotvision/ui';
import { FONT } from '../../../../src/theme';

export default function PuttSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();
  const [session, setSession] = useState<PuttSession | null | undefined>(undefined);
  const [shots, setShots] = useState<PuttShot[]>([]);

  const reload = useCallback(async () => {
    const [se, sh] = await Promise.all([getPuttSession(id), listPuttShots(id)]);
    setSession(se); setShots(sh);
  }, [id]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  function confirmDeleteSession() {
    Alert.alert('Borrar sesión', '¿Borrar la sesión y todos sus putts?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deletePuttSession(id); router.back(); } },
    ]);
  }

  if (session === undefined) return <View style={styles.center}><ActivityIndicator color={SV.green} /></View>;
  if (session === null) return <View style={styles.center}><Text style={styles.dim}>Sesión no encontrada.</Text></View>;

  const sum = summarisePutts(shots);
  const when = new Date(session.createdAt).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      <Stack.Screen options={{
        title: 'Resumen · Putt',
        headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
        headerRight: () => (
          <TouchableOpacity onPress={confirmDeleteSession} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={SV.danger} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Text style={styles.when}>{when}</Text>

        {shots.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="golf-outline" size={30} color={SV.faint} />
            <Text style={styles.dim}>Esta sesión no tiene putts.</Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryStrip}>
              <View style={styles.summaryRow}>
                <SumStat n={String(sum.count)} l={sum.count === 1 ? 'putt' : 'putts'} />
                <SumStat n={dist(sum.avgDistanceM, settings).split(' ')[0]} l={`media (${settings.distanceUnit})`} />
                <SumStat n={String(sum.consistency)} l="consistencia" />
                {sum.avgErrorM != null && (
                  <SumStat n={dist(sum.avgErrorM, settings).split(' ')[0]} l={`error medio (${settings.distanceUnit})`} />
                )}
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={styles.cardTitle}>Putts</Text>
              {shots.map((sh, idx) => {
                const diffM = sh.targetDistanceMeters != null
                  ? sh.roll.distanceMeters - sh.targetDistanceMeters
                  : null;
                return (
                  <TouchableOpacity key={sh.id} style={styles.shotRow} activeOpacity={0.8}
                    onLongPress={() => Alert.alert('Putt', '', [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Borrar', style: 'destructive', onPress: async () => { await deletePuttShot(sh.id); reload(); } },
                    ])}>
                    <View style={styles.shotIdx}><Text style={styles.shotIdxTxt}>{shots.length - idx}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shotMain}>
                        {dist(sh.roll.distanceMeters, settings)} · {speed(sh.measure.rollSpeedMs, settings)}
                      </Text>
                      <Text style={styles.shotSub}>
                        {sh.roll.rollTimeSec.toFixed(1)}s de rodada
                        {diffM != null ? ` · ${Math.abs(diffM) < 0.15 ? 'al hoyo' : diffM > 0 ? `${dist(Math.abs(diffM), settings)} largo` : `${dist(Math.abs(diffM), settings)} corto`}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function SumStat({ n, l }: { n: string; l: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.sumN}>{n}</Text>
      <Text style={styles.sumL}>{l}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SV.bg },
  dim: { fontSize: 13, color: SV.sub },
  when: { fontSize: 13, color: SV.sub, fontFamily: FONT.bodyMedium },

  cardTitle: { fontSize: 11, fontFamily: FONT.headingSemiBold, color: SV.sub, textTransform: 'uppercase', letterSpacing: 1 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 28 },

  summaryStrip: { backgroundColor: SV.surface, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: SV.line },
  summaryRow: { flexDirection: 'row' },
  sumN: { fontSize: 19, fontFamily: FONT.headingExtraBold, color: SV.green },
  sumL: { fontSize: 10, color: SV.sub, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },

  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: SV.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: SV.line },
  shotIdx: { width: 22, alignItems: 'center' },
  shotIdxTxt: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.faint },
  shotMain: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: SV.ink },
  shotSub: { fontSize: 11, color: SV.sub, marginTop: 2 },
});
