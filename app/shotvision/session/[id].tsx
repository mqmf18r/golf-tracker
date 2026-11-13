import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ShotSession, ShotVisionShot } from '../../../src/shotvision/types';
import { getSession, listShots, deleteShot, deleteSession } from '../../../src/shotvision/store';
import { summariseSession } from '../../../src/shotvision/aggregate';
import { useSettings } from '../../../src/shotvision/useSettings';
import { dist, speedNum, speedUnit } from '../../../src/shotvision/format';
import { SV } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();
  const [session, setSession] = useState<ShotSession | null | undefined>(undefined);
  const [shots, setShots] = useState<ShotVisionShot[]>([]);

  const reload = useCallback(async () => {
    const [se, sh] = await Promise.all([getSession(id), listShots(id)]);
    setSession(se); setShots(sh);
  }, [id]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  function confirmDeleteSession() {
    Alert.alert('Borrar sesión', '¿Borrar la sesión y todos sus golpes?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteSession(id); router.back(); } },
    ]);
  }

  if (session === undefined) return <View style={styles.center}><ActivityIndicator color={SV.green} /></View>;
  if (session === null) return <View style={styles.center}><Text style={styles.dim}>Sesión no encontrada.</Text></View>;

  const sum = summariseSession(shots);
  const when = new Date(session.createdAt).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const tags = [
    session.mode === 'sim' ? (session.sim?.platform === 'e6' ? 'E6' : 'GSPro') : null,
    session.venue === 'indoor' ? 'Interior' : session.venue === 'outdoor' ? 'Exterior' : null,
    session.ballType === 'range' ? 'Bola práctica' : session.ballType === 'premium' ? 'Bola normal' : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <Stack.Screen options={{
        title: session.label || 'Sesión',
        headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
        headerRight: () => (
          <TouchableOpacity onPress={confirmDeleteSession} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={SV.danger} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>

        <View>
          <Text style={styles.when}>{when}</Text>
          {tags.length > 0 && (
            <View style={styles.tagRow}>
              {tags.map(t => <View key={t} style={styles.tag}><Text style={styles.tagTxt}>{t}</Text></View>)}
            </View>
          )}
        </View>

        {shots.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="golf-outline" size={30} color={SV.faint} />
            <Text style={styles.dim}>Esta sesión no tiene golpes.</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.summaryStrip} activeOpacity={0.85}
              onPress={() => router.push(`/shotvision/summary/${id}`)}>
              <View style={styles.summaryRow}>
                <SumStat n={String(shots.length)} l="golpes" />
                <SumStat n={String(sum.clubCount)} l={sum.clubCount === 1 ? 'palo' : 'palos'} />
                <SumStat n={dist(sum.longestCarryMeters, settings).split(' ')[0]} l={`best (${settings.distanceUnit})`} />
              </View>
              <View style={styles.summaryCta}>
                <Text style={styles.summaryCtaTxt}>Ver resumen por palo</Text>
                <Ionicons name="chevron-forward" size={16} color={SV.green} />
              </View>
            </TouchableOpacity>

            <View style={{ gap: 8 }}>
              <Text style={styles.cardTitle}>Golpes</Text>
              {shots.map((sh, idx) => (
                <TouchableOpacity key={sh.id} style={styles.shotRow} activeOpacity={0.8}
                  onPress={() => router.push(`/shotvision/shot/${sh.id}`)}
                  onLongPress={() => Alert.alert('Golpe', '', [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteShot(sh.id); reload(); } },
                  ])}>
                  <View style={styles.shotIdx}><Text style={styles.shotIdxTxt}>{shots.length - idx}</Text></View>
                  <View style={styles.shotClub}><Text style={styles.shotClubTxt}>{sh.club}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shotMain}>
                      {dist(sh.flight.carryMeters, settings)} carry · {speedNum(sh.measure.ballSpeedMs, settings)} {speedUnit(settings)}
                    </Text>
                    <Text style={styles.shotSub}>salida {sh.measure.launchAngleDeg.toFixed(0)}° · apex {dist(sh.flight.apexMeters, settings)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={SV.faint} />
                </TouchableOpacity>
              ))}
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
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  tag: { backgroundColor: SV.surfaceAlt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagTxt: { fontSize: 10, fontFamily: FONT.bodySemiBold, color: SV.sub },

  cardTitle: { fontSize: 11, fontFamily: FONT.headingSemiBold, color: SV.sub, textTransform: 'uppercase', letterSpacing: 1 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 28 },

  summaryStrip: { backgroundColor: SV.surface, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: SV.line },
  summaryRow: { flexDirection: 'row' },
  sumN: { fontSize: 19, fontFamily: FONT.headingExtraBold, color: SV.green },
  sumL: { fontSize: 10, color: SV.sub, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },
  summaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderTopWidth: 1, borderColor: SV.line, paddingTop: 8 },
  summaryCtaTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: SV.green },

  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: SV.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: SV.line },
  shotIdx: { width: 22, alignItems: 'center' },
  shotIdxTxt: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.faint },
  shotClub: { width: 40, height: 40, borderRadius: 10, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  shotClubTxt: { fontSize: 13, fontFamily: FONT.headingSemiBold, color: SV.green },
  shotMain: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: SV.ink },
  shotSub: { fontSize: 11, color: SV.sub, marginTop: 2 },
});
