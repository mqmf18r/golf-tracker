import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ShotVisionShot } from '../../../src/shotvision/types';
import { listShots } from '../../../src/shotvision/store';
import { aggregateByClub, ClubAggregate } from '../../../src/shotvision/aggregate';
import { useSettings } from '../../../src/shotvision/useSettings';
import { distNum, distUnit, speedNum } from '../../../src/shotvision/format';
import { SV, CLUB_NAMES, SpreadBar } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();
  const [shots, setShots] = useState<ShotVisionShot[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    listShots(id).then(s => { if (alive) { setShots(s); setLoading(false); } });
    return () => { alive = false; };
  }, [id]));

  const headerOpts = { title: 'Resumen', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink };

  if (loading) return <><Stack.Screen options={headerOpts} /><View style={styles.center}><ActivityIndicator color={SV.green} /></View></>;

  const clubs = aggregateByClub(shots);
  if (clubs.length === 0) {
    return <><Stack.Screen options={headerOpts} /><View style={styles.center}><Text style={styles.dim}>Sin golpes que resumir.</Text></View></>;
  }

  const u = distUnit(settings);
  const maxCarry = Math.max(...clubs.map(c => distNum(c.carryMeters.max, settings)));
  const minCarry = Math.min(...clubs.map(c => distNum(c.carryMeters.min, settings)));

  return (
    <>
      <Stack.Screen options={headerOpts} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <Text style={styles.head}>{shots.length} golpes · {clubs.length} palo{clubs.length === 1 ? '' : 's'}</Text>

        {clubs.map(c => (
          <ClubCard
            key={c.club} c={c} u={u} s={settings}
            domainMin={minCarry} domainMax={maxCarry}
            onBest={c.bestShotId ? () => router.push(`/shotvision/shot/${c.bestShotId}`) : undefined}
          />
        ))}

        <Text style={styles.note}>
          Consistencia = cómo de agrupado queda el carry (100 = golpes idénticos).
          Barra = rango min–max, marca naranja = media.
        </Text>
      </ScrollView>
    </>
  );
}

function ClubCard({
  c, u, s, domainMin, domainMax, onBest,
}: {
  c: ClubAggregate; u: string; s: any; domainMin: number; domainMax: number; onBest?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.clubChip}><Text style={styles.clubChipTxt}>{c.club}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.clubName}>{CLUB_NAMES[c.club] ?? c.club}</Text>
          <Text style={styles.clubMeta}>{c.count} golpe{c.count === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.consBadge}>
          <Text style={styles.consNum}>{c.consistency}</Text>
          <Text style={styles.consLbl}>consist.</Text>
        </View>
      </View>

      <SpreadBar
        min={distNum(c.carryMeters.min, s)} max={distNum(c.carryMeters.max, s)}
        avg={distNum(c.carryMeters.avg, s)} unit={u}
        domainMin={domainMin} domainMax={domainMax}
      />

      <View style={styles.statsRow}>
        <Mini label="Vel. bola" value={`${speedNum(c.ballSpeedMs.avg, s)}`} />
        <Mini label="Salida" value={`${c.launchDeg.avg.toFixed(0)}°`} />
        <Mini label={`Total ⌀ (${u})`} value={`${distNum(c.totalMeters.avg, s)}`} />
        <Mini label={`Apex ⌀ (${u})`} value={`${distNum(c.apexMeters.avg, s)}`} />
      </View>

      {onBest && (
        <TouchableOpacity style={styles.bestRow} onPress={onBest}>
          <Ionicons name="trophy-outline" size={14} color={SV.accent} />
          <Text style={styles.bestTxt}>Mejor golpe · {distNum(c.carryMeters.max, s)} {u}</Text>
          <Ionicons name="chevron-forward" size={14} color={SV.faint} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.miniLbl}>{label}</Text>
      <Text style={styles.miniVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SV.bg },
  dim: { fontSize: 13, color: SV.sub },
  head: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: SV.ink },
  note: { fontSize: 11, color: SV.faint, lineHeight: 16, marginTop: 4 },

  card: { backgroundColor: SV.surface, borderRadius: 16, padding: 14, gap: 12, borderWidth: 1, borderColor: SV.line },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clubChip: { width: 42, height: 42, borderRadius: 11, backgroundColor: SV.green, alignItems: 'center', justifyContent: 'center' },
  clubChipTxt: { color: '#06210f', fontSize: 14, fontFamily: FONT.headingExtraBold },
  clubName: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: SV.ink },
  clubMeta: { fontSize: 11, color: SV.sub, marginTop: 1 },
  consBadge: { alignItems: 'center', backgroundColor: SV.surfaceAlt, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  consNum: { fontSize: 16, fontFamily: FONT.headingExtraBold, color: SV.green },
  consLbl: { fontSize: 8, color: SV.sub, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase' },

  statsRow: { flexDirection: 'row', gap: 8 },
  miniLbl: { fontSize: 9, color: SV.sub, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase' },
  miniVal: { fontSize: 14, fontFamily: FONT.headingSemiBold, color: SV.ink, marginTop: 1 },

  bestRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderColor: SV.line, paddingTop: 10 },
  bestTxt: { flex: 1, fontSize: 12, fontFamily: FONT.bodySemiBold, color: SV.ink },
});
