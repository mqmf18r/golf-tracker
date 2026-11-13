import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, Switch, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  getAllRoundStats, RoundStats, getScramblingStats, ScramblingStats,
  getAllClubStats, ClubStat, getPuttingStats, PuttingStats, getApproachStats, ApproachStats,
} from '../../src/lib/api';
import { calcHandicapIndex } from '../../src/services/handicap';
import { handicapDifferential } from '../../src/types';
import { Ionicons } from '@expo/vector-icons';
import { BarChart } from 'react-native-gifted-charts';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';

const W = Dimensions.get('window').width;

function hasRating(r: RoundStats): r is RoundStats & { courseRating: number; slopeRating: number } {
  return !!(r.courseRating && r.slopeRating);
}

function removeOutliers(rounds: RoundStats[]): RoundStats[] {
  if (rounds.length < 5) return rounds;
  const scores = rounds.map(r => r.totalStrokes);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd   = Math.sqrt(scores.map(s => (s - mean) ** 2).reduce((a, b) => a + b, 0) / scores.length);
  return rounds.filter(r => Math.abs(r.totalStrokes - mean) <= 1.5 * sd);
}

export default function StatsScreen() {
  const [allRounds, setAllRounds]       = useState<RoundStats[]>([]);
  const [scrambling, setScrambling]     = useState<ScramblingStats>({ missedGir: 0, scrambled: 0, bunkerHoles: 0, bunkerSaves: 0 });
  const [excludeOutliers, setExclude]   = useState(false);
  const [clubStats, setClubStats]       = useState<ClubStat[]>([]);
  const [putting, setPutting]           = useState<PuttingStats>({ avgPuttsGir: null, avgPuttsNonGir: null, girHoles: 0, nonGirHoles: 0 });
  const [approach, setApproach]         = useState<ApproachStats>({ avgFirstPuttDist: null, count: 0 });
  const [loading, setLoading]           = useState(true);

  const loadStats = useCallback(() => {
    let mounted = true;
    (async () => {
      const [rounds, scram, clubs, putt, appr] = await Promise.all([
        getAllRoundStats(), getScramblingStats(), getAllClubStats(), getPuttingStats(), getApproachStats(),
      ]);
      if (!mounted) return;
      setAllRounds(rounds);
      setScrambling(scram);
      setClubStats(clubs);
      setPutting(putt);
      setApproach(appr);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  useFocusEffect(loadStats);

  const rounds = excludeOutliers ? removeOutliers(allRounds) : allRounds;

  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (allRounds.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="stats-chart-outline" size={60} color={COLORS.emptyIcon} />
        <Text style={styles.emptyText}>Sin rondas completadas</Text>
        <Text style={styles.emptyHint}>
          Finaliza una ronda desde el Historial{'\n'}(toca el banner "Ronda en curso" → Finalizar y guardar)
        </Text>
      </View>
    );
  }

  const avgStrokes = avg(rounds.map((r) => r.totalStrokes));
  const avgPuttsHole = avg(rounds.map((r) => r.totalPutts / Math.max(r.holesCount, 1)));
  const avgFW = avg(rounds.map((r) => (r.fairwaysHit / Math.max(r.fairwaysTotal, 1)) * 100));
  const avgGIR = avg(rounds.map((r) => (r.girsHit / Math.max(r.holesCount, 1)) * 100));
  const handicapIndex = calcHandicapIndex(rounds);
  const driverAvg = clubStats.find(c => c.club === 'D')?.avgDist ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md }}>
      {/* Handicap Index */}
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

      {/* Outlier toggle */}
      <View style={styles.outlierRow}>
        <View>
          <Text style={styles.outlierLabel}>Excluir valores atípicos</Text>
          <Text style={styles.outlierSub}>
            {excludeOutliers
              ? `${allRounds.length - rounds.length} ronda${allRounds.length - rounds.length !== 1 ? 's' : ''} excluida${allRounds.length - rounds.length !== 1 ? 's' : ''} (±1.5 SD)`
              : 'Incluye todas las rondas'}
          </Text>
        </View>
        <Switch
          value={excludeOutliers}
          onValueChange={setExclude}
          trackColor={{ true: COLORS.primary }}
        />
      </View>

      {/* ── SCORING ─────────────────────────────────────────────── */}
      <SectionHeader title="Scoring" icon="golf-outline" />
      <View style={styles.grid}>
        <StatCard icon="golf" label="Score promedio" value={avgStrokes.toFixed(1)} color={COLORS.textPrimary} />
        <StatCard icon="star-outline" label="Stableford prom." value={avg(rounds.map(r => r.stablefordPoints)).toFixed(1)} color={COLORS.primary} />
      </View>
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Evolución del score</Text>
        <BarChart
          data={rounds.slice(-12).map((r) => ({
            value: r.totalStrokes,
            label: shortDate(r.date),
            topLabelComponent: () => <Text style={styles.barValue}>{r.totalStrokes}</Text>,
          }))}
          frontColor={COLORS.primary}
          width={W - 64}
          height={100}
          barWidth={22}
          spacing={14}
          initialSpacing={10}
          roundedTop
          hideRules
          noOfSections={3}
          yAxisThickness={0}
          xAxisThickness={0}
          xAxisLabelTextStyle={styles.barLabel}
          isAnimated
        />
      </View>
      {rounds.some((r) => r.courseRating && r.slopeRating) && (() => {
        const diffData = rounds.slice(-12)
          .filter(hasRating)
          .map((r) => ({
            value: handicapDifferential(r.totalStrokes, r.courseRating, r.slopeRating),
            label: shortDate(r.date),
          }));
        return (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Diferencial de handicap</Text>
            {diffData.length >= 2 ? (
              <SimpleLineChart data={diffData} color={COLORS.info} />
            ) : (
              <Text style={styles.chartEmptyText}>Juega otra ronda para ver la tendencia</Text>
            )}
          </View>
        );
      })()}

      {/* ── DRIVING ─────────────────────────────────────────────── */}
      <SectionHeader title="Driving" icon="arrow-forward-outline" />
      <View style={styles.grid}>
        <StatCard icon="arrow-up-circle" label="Fairways %" value={`${Math.round(avgFW)}%`} color={COLORS.success} />
        <StatCard
          icon="speedometer-outline" label="Distancia prom. (Driver)"
          value={driverAvg !== null ? `${driverAvg}m` : '—'}
          color={driverAvg !== null ? COLORS.textPrimary : COLORS.textSecondary}
        />
      </View>

      {/* ── APPROACH ────────────────────────────────────────────── */}
      <SectionHeader title="Approach" icon="locate-outline" />
      <View style={styles.grid}>
        <StatCard icon="radio-button-on" label="GIR %" value={`${Math.round(avgGIR)}%`} color={COLORS.warning} />
        <StatCard
          icon="analytics-outline" label="Prox. al hoyo"
          value={approach.avgFirstPuttDist !== null ? `${approach.avgFirstPuttDist.toFixed(1)}m` : '—'}
          color={approach.avgFirstPuttDist !== null ? COLORS.textPrimary : COLORS.textSecondary}
        />
      </View>

      {/* ── SHORT GAME ──────────────────────────────────────────── */}
      <SectionHeader title="Short Game" icon="cut-outline" />
      <View style={styles.grid}>
        <StatCard
          icon="sync-outline" label="Scrambling %"
          value={scrambling.missedGir > 0 ? `${Math.round((scrambling.scrambled / scrambling.missedGir) * 100)}%` : '—'}
          color="#8e44ad"
        />
        <StatCard
          icon="flag-outline" label="Sand save %"
          value={scrambling.bunkerHoles > 0 ? `${Math.round((scrambling.bunkerSaves / scrambling.bunkerHoles) * 100)}%` : '—'}
          color="#d4ac0d"
        />
      </View>

      {/* ── PUTTING ─────────────────────────────────────────────── */}
      <SectionHeader title="Putting" icon="ellipse-outline" />
      <View style={styles.grid}>
        <StatCard icon="flag" label="Putts / hoyo" value={avgPuttsHole.toFixed(2)} color={COLORS.info} />
        <StatCard
          icon="trending-down-outline" label="Putts en GIR"
          value={putting.avgPuttsGir !== null ? putting.avgPuttsGir.toFixed(2) : '—'}
          color={putting.avgPuttsGir !== null ? COLORS.info : COLORS.textSecondary}
        />
      </View>
    </ScrollView>
  );
}

// ─── Simple inline chart (no library needed) ─────────────────────────────────

function SimpleLineChart({ data, color }: { data: { value: number; label: string }[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = max - min || 1;
  const chartH = 80;
  const chartW = W - 64;
  const stepW = chartW / (data.length - 1);

  const points = data.map((d, i) => ({
    x: i * stepW,
    y: chartH - ((d.value - min) / range) * chartH * 0.8,
    label: d.label,
    value: d.value,
  }));

  return (
    <View style={{ height: chartH + 28 }}>
      <View style={{ position: 'relative', height: chartH }}>
        {points.map((p, i) => (
          <View key={i} style={[styles.dot, { left: p.x - 5, top: p.y - 5, backgroundColor: color }]} />
        ))}
        {/* Simple connecting lines via absolute positioned narrow views */}
        {points.slice(1).map((p, i) => {
          const prev = points[i];
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: prev.x,
                top: prev.y,
                width: len,
                height: 2,
                backgroundColor: color + '66',
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: '0 0',
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {points.map((p, i) => (
          <Text key={i} style={styles.barLabel}>{p.label}</Text>
        ))}
      </View>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon: any }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={16} color={COLORS.primary} />
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 18, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary, marginTop: SPACING.md },
  emptyHint: { fontSize: 14, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: SPACING.sm },
  hiCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: RADIUS.lg, padding: SPACING.md, overflow: 'hidden',
  },
  hiBlobA: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.07)', top: -50, right: -30 },
  hiBlobB: { position: 'absolute', width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.06)', bottom: -30, left: -20 },
  hiLabel: { fontSize: 16, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  hiSub: { fontSize: 12, fontFamily: FONT.body, color: COLORS.primaryMuted, marginTop: SPACING.xs },
  hiValue: { fontSize: 48, fontFamily: FONT.headingExtraBold, color: COLORS.textOnPrimary },
  outlierRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, ...CARD_SHADOW,
  },
  outlierLabel: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  outlierSub:   { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.xs, borderBottomWidth: 2, borderColor: COLORS.primary,
  },
  sectionHeaderText: {
    fontSize: 16, fontFamily: FONT.bodySemiBold, color: COLORS.primary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  statCard: { width: (W - SPACING.md * 2 - SPACING.sm) / 2, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.sm, gap: SPACING.xs, ...CARD_SHADOW },
  statValue: { fontSize: 26, fontFamily: FONT.heading },
  statLabel: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  chartCard: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, ...CARD_SHADOW },
  chartTitle: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary, marginBottom: SPACING.md },
  chartEmptyText: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary, paddingVertical: SPACING.sm },
  barValue: { fontSize: 9, fontFamily: FONT.body, color: COLORS.textSecondary, marginBottom: 2 },
  barLabel: { fontSize: 9, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: 3 },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
});
