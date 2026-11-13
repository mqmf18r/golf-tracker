import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { getAllRoundStats, getActiveRound, deleteRound, completeRound, RoundStats } from '../../src/lib/api';
import { calcHandicapIndex } from '../../src/services/handicap';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export default function HomeScreen() {
  const router = useRouter();
  const [rounds, setRounds] = useState<RoundStats[]>([]);
  const [active, setActive] = useState<Awaited<ReturnType<typeof getActiveRound>>>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    (async () => {
      const [r, a] = await Promise.all([getAllRoundStats(), getActiveRound()]);
      if (!mounted) return;
      setRounds(r);
      setActive(a);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []));

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  async function handleActiveRoundPress() {
    if (!active) return;
    Alert.alert(
      'Ronda en curso',
      `${active.courseName}`,
      [
        { text: 'Continuar ronda', onPress: () => router.push(`/round/${active.id}`) },
        {
          text: 'Finalizar y guardar',
          onPress: async () => {
            await completeRound(active.id as string);
            const [r, a] = await Promise.all([getAllRoundStats(), getActiveRound()]);
            setRounds(r); setActive(a);
          },
        },
        {
          text: 'Eliminar ronda', style: 'destructive',
          onPress: async () => {
            await deleteRound(active.id as string);
            setActive(await getActiveRound());
          },
        },
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  }

  async function handleDelete(id: string) {
    Alert.alert('Eliminar ronda', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          await deleteRound(id);
          setRounds(r => r.filter(x => x.id !== id));
        }
      },
    ]);
  }

  return (
    <View style={styles.container}>
      {active && (
        <TouchableOpacity style={styles.activeBanner} onPress={handleActiveRoundPress}>
          <Ionicons name="golf" size={22} color={COLORS.textOnPrimary} />
          <View style={{ flex: 1, marginLeft: SPACING.sm }}>
            <Text style={styles.bannerTitle}>Ronda en curso</Text>
            <Text style={styles.bannerSub}>{(active as any).courseName}</Text>
          </View>
          <Text style={styles.bannerOptions}>Continuar / Finalizar ›</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={rounds}
        keyExtractor={(r) => r.id}
        contentContainerStyle={rounds.length === 0 ? styles.empty : { padding: SPACING.md, gap: SPACING.sm }}
        ListHeaderComponent={rounds.length > 0 ? <HomeStats rounds={rounds} /> : null}
        ListEmptyComponent={
          <View style={styles.emptyContent}>
            <Ionicons name="golf-outline" size={60} color={COLORS.emptyIcon} />
            <Text style={styles.emptyText}>Sin rondas completadas</Text>
            <Text style={styles.emptyHint}>Pulsa + para empezar</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RoundCard
            round={item}
            onPress={() => router.push(`/history/${item.id}`)}
            onDelete={() => handleDelete(item.id)}
          />
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/round/new')}>
        <Ionicons name="add" size={30} color={COLORS.textOnPrimary} />
      </TouchableOpacity>
    </View>
  );
}

function HomeStats({ rounds }: { rounds: RoundStats[] }) {
  const handicapIndex = calcHandicapIndex(rounds);
  const diffs = rounds.map(r => r.totalStrokes - r.totalPar);
  const avgDiff = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  const bestDiff = Math.min(...diffs);
  const fmt = (d: number) => (d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`);
  const now = new Date();
  const thisMonth = rounds.filter(r => {
    const d = new Date(r.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <View style={styles.homeStats}>
      <LinearGradient
        colors={[COLORS.primary, '#0f3d3e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hiCard}
      >
        <View pointerEvents="none" style={styles.hiBlobA} />
        <View pointerEvents="none" style={styles.hiBlobB} />
        <View>
          <Text style={styles.hiLabel}>Handicap Index (WHS)</Text>
          <Text style={styles.hiSub}>{Math.min(rounds.length, 20) === 1 ? 'Última ronda' : `Últimas ${Math.min(rounds.length, 20)} rondas`}</Text>
        </View>
        <Text style={styles.hiValue}>{handicapIndex !== null ? handicapIndex.toFixed(1) : '—'}</Text>
      </LinearGradient>
      <View style={styles.quickStatsGrid}>
        <StatTile icon="flag" value={`${rounds.length}`} label="Rondas" color={COLORS.info} />
        <StatTile icon="trending-up" value={fmt(avgDiff)} label="Promedio" color={COLORS.warning} />
        <StatTile icon="trophy" value={fmt(bestDiff)} label="Mejor ronda" color={COLORS.success} />
        <StatTile icon="calendar" value={`${thisMonth}`} label="Este mes" color={COLORS.accent} />
      </View>
    </View>
  );
}

function StatTile({ icon, value, label, color }: { icon: IoniconName; value: string; label: string; color: string }) {
  return (
    <View style={[styles.statTile, { backgroundColor: color + '14' }]}>
      <View style={[styles.statIconBadge, { backgroundColor: color + '24' }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={[styles.statTileValue, { color }]}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function RoundCard({ round, onPress, onDelete }: {
  round: RoundStats;
  onPress: () => void;
  onDelete: () => void;
}) {
  const scoreToPar = round.totalStrokes - round.totalPar;
  const scoreStr = scoreToPar === 0 ? 'E' : scoreToPar > 0 ? `+${scoreToPar}` : `${scoreToPar}`;
  const scoreColor = scoreToPar < 0 ? COLORS.danger : scoreToPar === 0 ? COLORS.success : COLORS.textPrimary;
  const date = new Date(round.date);
  const fw = Math.round((round.fairwaysHit / Math.max(round.fairwaysTotal, 1)) * 100);
  const gir = Math.round((round.girsHit / Math.max(round.holesCount, 1)) * 100);

  return (
    <TouchableOpacity style={styles.cardOuter} onPress={onPress} onLongPress={onDelete} activeOpacity={0.7}>
      <View style={[styles.cardAccent, { backgroundColor: scoreColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.courseName}>{round.courseName}</Text>
          <View style={[styles.scoreBadge, { borderColor: scoreColor }]}>
            <Text style={[styles.scoreBadgeText, { color: scoreColor }]}>{scoreStr}</Text>
          </View>
        </View>
        <Text style={styles.cardDate}>{date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        <View style={styles.pills}>
          <Pill icon="golf-outline" label={`${round.totalStrokes} golpes`} color={COLORS.textSecondary} />
          <Pill icon="ellipse-outline" label={`${round.totalPutts} putts`} color={COLORS.textSecondary} />
          <Pill icon="flag-outline" label={`FW ${fw}%`} color={COLORS.info} />
          <Pill icon="checkmark-done-outline" label={`GIR ${gir}%`} color={COLORS.success} />
          <Pill icon="trophy-outline" label={`Stfd ${round.stablefordPoints}`} color={COLORS.accent} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Pill({ icon, label, color }: { icon: IoniconName; label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color + '14' }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary,
    padding: SPACING.md, margin: SPACING.md, borderRadius: RADIUS.lg,
  },
  bannerTitle: { color: COLORS.textOnPrimary, fontFamily: FONT.bodySemiBold, fontSize: 15 },
  bannerSub: { color: COLORS.primaryMuted, fontFamily: FONT.body, fontSize: 12 },
  bannerOptions: { color: COLORS.primaryMuted, fontFamily: FONT.bodySemiBold, fontSize: 11 },
  empty: { flex: 1 },
  emptyContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: SPACING.xl * 3 },
  emptyText: { fontSize: 18, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary, marginTop: SPACING.md },
  emptyHint: { fontSize: 14, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: SPACING.sm },
  homeStats: { gap: SPACING.sm },
  hiCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: RADIUS.lg, padding: SPACING.md, overflow: 'hidden',
  },
  hiBlobA: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.07)', top: -50, right: -30 },
  hiBlobB: { position: 'absolute', width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.06)', bottom: -30, left: -20 },
  hiLabel: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  hiSub: { fontSize: 12, fontFamily: FONT.body, color: COLORS.primaryMuted, marginTop: SPACING.xs },
  hiValue: { fontSize: 44, fontFamily: FONT.headingExtraBold, color: COLORS.textOnPrimary },
  quickStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  statTile: { flexBasis: '47%', flexGrow: 1, borderRadius: RADIUS.lg, padding: SPACING.sm, gap: SPACING.xs, ...CARD_SHADOW },
  statIconBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statTileValue: { fontSize: 20, fontFamily: FONT.heading },
  statTileLabel: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  cardOuter: { flexDirection: 'row', backgroundColor: COLORS.card, borderRadius: RADIUS.lg, overflow: 'hidden', ...CARD_SHADOW },
  cardAccent: { width: 5 },
  cardBody: { flex: 1, padding: SPACING.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  courseName: { fontSize: 17, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  scoreBadge: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  scoreBadgeText: { fontSize: 14, fontFamily: FONT.bodySemiBold },
  cardDate: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: 20 },
  pillText: { fontSize: 12, fontFamily: FONT.bodySemiBold },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.shadow, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
