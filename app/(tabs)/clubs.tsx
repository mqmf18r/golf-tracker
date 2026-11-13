import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getClubStats, ClubStat, getClubSettings, setClubManualDist,
  getShotsForClub, ShotRecord,
} from '../../src/lib/api';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';
import { DispersionChart } from '../../src/components/DispersionChart';

const ALL_CLUBS = ['D', '3W', '5W', '4H', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'P'];

const CLUB_NAMES: Record<string, string> = {
  D: 'Driver', '3W': 'Madera 3', '5W': 'Madera 5', '4H': 'Híbrido 4',
  '5i': 'Hierro 5', '6i': 'Hierro 6', '7i': 'Hierro 7', '8i': 'Hierro 8', '9i': 'Hierro 9',
  PW: 'Pitching W.', GW: 'Gap W.', SW: 'Sand W.', LW: 'Lob W.', P: 'Putter',
};

const CARD_WIDTH = Dimensions.get('window').width - 16 * 2 - 14 * 2; // scroll padding + card padding

export default function ClubsScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<ClubStat[]>([]);
  const [manuals, setManuals] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shotHistory, setShotHistory] = useState<Record<string, ShotRecord[]>>({});
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    (async () => {
      const [s, settings] = await Promise.all([getClubStats(), getClubSettings()]);
      if (!mounted) return;
      setStats(s);
      const m: Record<string, number> = {};
      settings.forEach(s => { if (s.manualDist > 0) m[s.club] = s.manualDist; });
      setManuals(m);
      setExpanded(null);
      setShotHistory({});
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []));

  async function reload() {
    const [s, settings] = await Promise.all([getClubStats(), getClubSettings()]);
    setStats(s);
    const m: Record<string, number> = {};
    settings.forEach(s => { if (s.manualDist > 0) m[s.club] = s.manualDist; });
    setManuals(m);
  }

  function startEdit(club: string) {
    setEditing(club);
    setDraft(manuals[club] ? String(manuals[club]) : '');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function confirmEdit(club: string) {
    const n = parseInt(draft, 10);
    if (isNaN(n) || n < 1 || n > 400) {
      Alert.alert('Distancia no válida', 'Introduce un número entre 1 y 400 metros.');
      return;
    }
    await setClubManualDist(club, n);
    setEditing(null);
    reload();
  }

  async function clearManual(club: string) {
    await setClubManualDist(club, 0);
    reload();
  }

  async function toggleExpand(club: string) {
    if (expanded === club) {
      setExpanded(null);
    } else {
      setExpanded(club);
      if (!shotHistory[club]) {
        const shots = await getShotsForClub(club);
        setShotHistory(prev => ({ ...prev, [club]: shots }));
      }
    }
  }

  const statMap = new Map(stats.map(s => [s.club, s]));
  const maxDist = ALL_CLUBS.reduce((m, c) => {
    const v = statMap.get(c)?.avgDist ?? manuals[c] ?? 0;
    return Math.max(m, v);
  }, 1);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl }}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageHint}>Toca un palo para ver su patrón · edita la distancia manual a la derecha</Text>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} /><Text style={styles.legendTxt}>Distancia manual</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.success }]} /><Text style={styles.legendTxt}>Media GPS real</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.warning, width: 2, borderRadius: 1, height: 10 }]} /><Text style={styles.legendTxt}>Media</Text></View>
      </View>

      {ALL_CLUBS.map((club) => {
        const stat = statMap.get(club);
        const manual = manuals[club] ?? 0;
        const displayDist = stat?.avgDist ?? manual;
        const isEditing = editing === club;
        const isExpanded = expanded === club;
        return (
          <TouchableOpacity key={club} style={[styles.card, isExpanded && styles.cardExpanded]} onPress={() => toggleExpand(club)} activeOpacity={0.85}>
            <View style={styles.cardTop}>
              <View style={styles.clubChip}><Text style={styles.clubChipTxt}>{club}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.clubName}>{CLUB_NAMES[club]}</Text>
                {stat && <Text style={styles.clubMeta}>GPS: {stat.avgDist}m · {stat.shots} {stat.shots === 1 ? 'golpe' : 'golpes'} · {stat.minDist}–{stat.maxDist}m</Text>}
              </View>
              <View style={styles.rightCol}>
                {isEditing ? (
                  <View style={styles.inputRow}>
                    <TextInput ref={inputRef} style={styles.distInput} value={draft} onChangeText={setDraft} keyboardType="number-pad" maxLength={3} selectTextOnFocus onSubmitEditing={() => confirmEdit(club)} />
                    <Text style={styles.inputUnit}>m</Text>
                    <TouchableOpacity style={styles.okBtn} onPress={() => confirmEdit(club)}><Ionicons name="checkmark" size={16} color={COLORS.textOnPrimary} /></TouchableOpacity>
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setEditing(null); }} style={styles.cancelIconBtn}><Ionicons name="close" size={16} color={COLORS.textSecondary} /></TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.manualBox} onPress={(e) => { e.stopPropagation?.(); startEdit(club); }} activeOpacity={0.7}>
                    {manual > 0 ? (
                      <><Text style={styles.manualNum}>{manual}</Text><Text style={styles.manualUnit}>m</Text>
                        <TouchableOpacity style={styles.clearBtn} onPress={(e) => { e.stopPropagation?.(); clearManual(club); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={14} color={COLORS.textTertiary} />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <View style={styles.addBtn}><Ionicons name="add" size={14} color={COLORS.textSecondary} /><Text style={styles.addTxt}>Añadir</Text></View>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {displayDist > 0 && (
              <View style={styles.barTrack}>
                {manual > 0 && <View style={[styles.barManual, { width: `${Math.max(4, (manual / maxDist) * 100)}%` }]} />}
                {stat && <View style={[styles.barGps, { width: `${Math.max(4, (stat.avgDist / maxDist) * 100)}%`, marginTop: manual > 0 ? 3 : 0 }]} />}
              </View>
            )}
            {isExpanded && (
              <>
                <DispersionChart shots={shotHistory[club] ?? []} width={CARD_WIDTH} />
                <ShotHistoryList
                  shots={shotHistory[club] ?? []}
                  onSelect={(shot) => {
                    router.push({ pathname: `/history/${shot.roundId}`, params: { holeId: shot.holeId, openMap: 'true' } } as any);
                  }}
                />
              </>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function ShotHistoryList({ shots, onSelect }: { shots: ShotRecord[]; onSelect: (shot: ShotRecord) => void }) {
  if (shots.length === 0) return null;
  return (
    <View style={styles.shotList}>
      {shots.map(shot => {
        const typeColor = shot.shotType === 'punch' ? COLORS.warning : shot.shotType === 'poor' ? COLORS.danger : COLORS.success;
        const typeLabel = shot.shotType === 'punch' ? 'Recuperación' : shot.shotType === 'poor' ? 'Mal golpe' : 'Normal';
        return (
          <TouchableOpacity
            key={shot.id}
            style={styles.shotRow}
            onPress={(e) => { e.stopPropagation?.(); onSelect(shot); }}
          >
            <View style={styles.shotDist}>
              <Text style={styles.shotDistNum}>{shot.dist}</Text>
              <Text style={styles.shotDistUnit}>m</Text>
            </View>
            <View style={styles.shotInfo}>
              <Text style={styles.shotCourse}>{shot.courseName}</Text>
              <Text style={styles.shotMeta}>
                {shot.holeNumber ? `H${shot.holeNumber} · ` : ''}{new Date(shot.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}
                {shot.zone ? ` · ${shot.zone}` : ''}
              </Text>
            </View>
            <View style={styles.shotRight}>
              <View style={[styles.shotTypeBadge, { backgroundColor: typeColor + '22', borderColor: typeColor }]}>
                <Text style={[styles.shotTypeTxt, { color: typeColor }]}>{typeLabel}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textTertiary} style={{ marginTop: 4 }} />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  pageHeader: { gap: SPACING.xs, marginBottom: SPACING.xs },
  pageHint: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textTertiary, lineHeight: 17 },
  legend: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.xs, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  card: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm, ...CARD_SHADOW },
  cardExpanded: { borderWidth: 1.5, borderColor: COLORS.primary, shadowOpacity: 0.12, shadowRadius: 10, elevation: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  clubChip: { width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  clubChipTxt: { color: COLORS.textOnPrimary, fontSize: 15, fontFamily: FONT.headingSemiBold },
  clubName: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  clubMeta: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  rightCol: { alignItems: 'flex-end', minWidth: 90 },
  manualBox: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f0f2f5', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 3, minWidth: 70, justifyContent: 'center' },
  manualNum: { fontSize: 20, fontFamily: FONT.heading, color: COLORS.primary },
  manualUnit: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 4 },
  clearBtn: { marginLeft: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  distInput: { width: 52, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2, fontSize: 18, fontFamily: FONT.bodySemiBold, color: COLORS.primary, textAlign: 'center' },
  inputUnit: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  okBtn: { width: 30, height: 30, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  cancelIconBtn: { padding: 3 },
  barTrack: { gap: 0 },
  barManual: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  barGps: { height: 6, borderRadius: 3, backgroundColor: COLORS.success },

  shotList: { gap: SPACING.sm, marginTop: SPACING.xs },
  shotRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md, padding: SPACING.sm, gap: SPACING.sm,
  },
  shotDist:     { alignItems: 'center', minWidth: 46 },
  shotDistNum:  { fontSize: 22, fontFamily: FONT.heading, color: COLORS.primary },
  shotDistUnit: { fontSize: 11, fontFamily: FONT.body, color: COLORS.primaryMuted, marginTop: -4 },
  shotInfo:     { flex: 1, gap: 3 },
  shotCourse:   { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  shotMeta:     { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary },
  shotRight:    { alignItems: 'flex-end', gap: 2 },
  shotTypeBadge:{ borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 7, paddingVertical: 3 },
  shotTypeTxt:  { fontSize: 10, fontFamily: FONT.bodySemiBold },
});
