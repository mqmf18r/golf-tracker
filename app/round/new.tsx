import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  Modal, TextInput, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getCourses, getHoles, insertRound, insertHoleScore, addRoundPlayer, searchProfiles, getOwnProfile, ProfileSearchResult } from '../../src/lib/api';
import { Course, TeeColor, GameFormat, GAME_FORMATS, GAME_FORMAT_LABELS } from '../../src/types';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';
import { TeeColorPicker } from '../../src/components/TeeColorPicker';
import { useAuth } from '../../src/context/AuthContext';

interface AddedPlayer {
  userId?: string;
  displayName: string;
  handicapIndex?: number;
}

const MATCH_PLAY_MAX = 2; // owner + 1 opponent

export default function NewRoundScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedTee, setSelectedTee] = useState<TeeColor>('yellow');
  const [gameFormat, setGameFormat] = useState<GameFormat>('stroke_play');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  // ── Players ────────────────────────────────────────────────────────────────
  const [ownerHandicap, setOwnerHandicap] = useState('');
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [players, setPlayers] = useState<AddedPlayer[]>([]);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [addTab, setAddTab] = useState<'search' | 'manual'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualName, setManualName] = useState('');

  const totalPlayers = 1 + players.length;
  const matchPlayCapped = gameFormat === 'match_play' && totalPlayers >= MATCH_PLAY_MAX;

  useEffect(() => {
    getCourses().then(c => { setCourses(c); setLoading(false); });
  }, []);

  useEffect(() => {
    getOwnProfile().then(p => { if (p?.displayName) setOwnerDisplayName(p.displayName); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (addTab !== 'search' || !showAddPlayer) return;
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      searchProfiles(searchQuery).then(setSearchResults).finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, addTab, showAddPlayer]);

  function openAddPlayer() {
    setAddTab('search');
    setSearchQuery('');
    setSearchResults([]);
    setManualName('');
    setShowAddPlayer(true);
  }

  function addSearchedPlayer(result: ProfileSearchResult) {
    setPlayers(p => [...p, { userId: result.id, displayName: result.displayName ?? result.email }]);
    setShowAddPlayer(false);
  }

  function addManualPlayer() {
    const name = manualName.trim();
    if (!name) return;
    setPlayers(p => [...p, { displayName: name }]);
    setShowAddPlayer(false);
  }

  function removePlayer(index: number) {
    setPlayers(p => p.filter((_, i) => i !== index));
  }

  function updatePlayerHandicap(index: number, text: string) {
    const value = text.trim() === '' ? undefined : Number(text);
    setPlayers(p => p.map((pl, i) => i === index ? { ...pl, handicapIndex: value !== undefined && !isNaN(value) ? value : undefined } : pl));
  }

  function handleGameFormatChange(format: GameFormat) {
    if (format === 'match_play' && totalPlayers > MATCH_PLAY_MAX) {
      Alert.alert(
        'Match Play es 1 contra 1',
        'Elimina jugadores hasta quedar solo con 2 antes de cambiar a Match Play.',
      );
      return;
    }
    setGameFormat(format);
  }

  async function startRound(course: Course) {
    setStarting(true);
    try {
      const holes = await getHoles(course.id);
      if (holes.length === 0) {
        Alert.alert('Sin hoyos', 'Añade los hoyos a este campo primero.');
        return;
      }
      const roundId = await insertRound(course.id, 'yellow', selectedTee, gameFormat);

      const ownerHandicapValue = ownerHandicap.trim() === '' ? undefined : Number(ownerHandicap);
      const ownerPlayerId = await addRoundPlayer(roundId, {
        userId: user?.id,
        displayName: ownerDisplayName || 'Yo',
        handicapIndex: ownerHandicapValue !== undefined && !isNaN(ownerHandicapValue) ? ownerHandicapValue : undefined,
        isOwner: true,
        sortOrder: 0,
      });

      const playerIds: string[] = [ownerPlayerId];
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const id = await addRoundPlayer(roundId, {
          userId: p.userId,
          displayName: p.displayName,
          handicapIndex: p.handicapIndex,
          isOwner: false,
          sortOrder: i + 1,
        });
        playerIds.push(id);
      }

      for (const h of holes) {
        for (const playerId of playerIds) {
          await insertHoleScore({ roundId, holeId: h.id, strokes: 0, par: h.par, pinColor: 'yellow', teeColor: selectedTee, playerId });
        }
      }
      router.replace(`/round/${roundId}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Error iniciando ronda');
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={COLORS.primary} size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={courses}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl }}
        ListHeaderComponent={
          <View>
            <View style={styles.teeSection}>
              <Text style={styles.teeTitle}>Tees de salida</Text>
              <TeeColorPicker value={selectedTee} onChange={setSelectedTee} />
            </View>

            <View style={styles.teeSection}>
              <Text style={styles.teeTitle}>Formato de juego</Text>
              <View style={styles.teeRow}>
                {GAME_FORMATS.map(format => (
                  <TouchableOpacity
                    key={format}
                    style={[styles.formatBtn, gameFormat === format && styles.formatBtnActive]}
                    onPress={() => handleGameFormatChange(format)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.formatTxt, gameFormat === format && styles.formatTxtActive]} numberOfLines={1}>
                      {GAME_FORMAT_LABELS[format]}
                    </Text>
                    {gameFormat === format && <Ionicons name="checkmark" size={12} color={COLORS.textOnPrimary} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.teeSection}>
              <Text style={styles.teeTitle}>Jugadores</Text>

              <View style={styles.playerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>{ownerDisplayName || 'Yo'}</Text>
                  <Text style={styles.playerHint}>Tú (organizador)</Text>
                </View>
                <TextInput
                  style={styles.hcpInput}
                  value={ownerHandicap}
                  onChangeText={setOwnerHandicap}
                  placeholder="HCP"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="numeric"
                />
              </View>

              {players.map((p, i) => (
                <View key={i} style={styles.playerRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.playerName}>{p.displayName}</Text>
                  </View>
                  <TextInput
                    style={styles.hcpInput}
                    value={p.handicapIndex === undefined ? '' : String(p.handicapIndex)}
                    onChangeText={(t) => updatePlayerHandicap(i, t)}
                    placeholder="HCP"
                    placeholderTextColor={COLORS.textTertiary}
                    keyboardType="numeric"
                  />
                  <TouchableOpacity onPress={() => removePlayer(i)} style={styles.removeBtn}>
                    <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}

              {!matchPlayCapped ? (
                <TouchableOpacity style={styles.addPlayerBtn} onPress={openAddPlayer} activeOpacity={0.75}>
                  <Ionicons name="add" size={16} color={COLORS.primary} />
                  <Text style={styles.addPlayerTxt}>Añadir jugador</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.playerHint}>Match Play es 1 contra 1 — máximo 2 jugadores.</Text>
              )}
            </View>

            <Text style={styles.subtitle}>Selecciona el campo</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="flag-outline" size={48} color={COLORS.emptyIcon} />
            <Text style={styles.emptyText}>Añade un campo primero</Text>
          </View>
        }
        renderItem={({ item }) => (
          <CourseRow course={item} onPress={() => startRound(item)} disabled={starting} />
        )}
      />

      <Modal visible={showAddPlayer} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddPlayer(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Añadir jugador</Text>
            <TouchableOpacity onPress={() => setShowAddPlayer(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, addTab === 'search' && styles.tabBtnActive]}
              onPress={() => setAddTab('search')}
            >
              <Ionicons name="search-outline" size={16} color={addTab === 'search' ? COLORS.textOnPrimary : COLORS.textSecondary} />
              <Text style={[styles.tabTxt, addTab === 'search' && styles.tabTxtActive]}>Buscar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, addTab === 'manual' && styles.tabBtnActive]}
              onPress={() => setAddTab('manual')}
            >
              <Ionicons name="person-outline" size={16} color={addTab === 'manual' ? COLORS.textOnPrimary : COLORS.textSecondary} />
              <Text style={[styles.tabTxt, addTab === 'manual' && styles.tabTxtActive]}>Nombre manual</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.sm + 6 }}>
            {addTab === 'search' ? (
              <>
                <TextInput
                  style={styles.codeInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Buscar por email o nombre..."
                  placeholderTextColor={COLORS.textTertiary}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {searching && <ActivityIndicator color={COLORS.primary} style={{ alignSelf: 'center' }} />}
                {!searching && searchResults.map(r => (
                  <TouchableOpacity key={r.id} style={styles.searchResult} onPress={() => addSearchedPlayer(r)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchResultName}>{r.displayName ?? r.email}</Text>
                      <Text style={styles.searchResultMeta}>{r.email}</Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={22} color={COLORS.info} />
                  </TouchableOpacity>
                ))}
                {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <Text style={styles.sectionDesc}>Sin resultados.</Text>
                )}
              </>
            ) : (
              <>
                <TextInput
                  style={styles.codeInput}
                  value={manualName}
                  onChangeText={setManualName}
                  placeholder="Nombre del jugador"
                  placeholderTextColor={COLORS.textTertiary}
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.actionBtn, !manualName.trim() && { opacity: 0.4 }]}
                  onPress={addManualPlayer}
                  disabled={!manualName.trim()}
                >
                  <Text style={styles.actionBtnTxt}>Añadir</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function CourseRow({ course, onPress, disabled }: { course: Course; onPress: () => void; disabled: boolean }) {
  const [holesCount, setHolesCount] = useState(0);
  const [par, setPar] = useState(0);

  useEffect(() => {
    getHoles(course.id).then(holes => {
      setHolesCount(holes.length);
      setPar(holes.reduce((a, h) => a + h.par, 0));
    });
  }, [course.id]);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7} disabled={disabled}>
      <View>
        <Text style={styles.courseName}>{course.name}</Text>
        <Text style={styles.meta}>{course.city} · {holesCount} hoyos · Par {par}</Text>
      </View>
      <Ionicons name="play-circle" size={30} color={COLORS.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  teeSection: { backgroundColor: COLORS.card, padding: SPACING.md, borderBottomWidth: 1, borderColor: '#e9ecef' },
  teeTitle: { fontSize: 13, fontFamily: FONT.headingSemiBold, color: COLORS.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm + 2 },
  subtitle: { fontSize: 14, fontFamily: FONT.body, color: COLORS.textSecondary, padding: SPACING.md, paddingBottom: 0 },
  empty: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm + 4 },
  emptyText: { fontSize: 16, fontFamily: FONT.body, color: COLORS.textSecondary },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, ...CARD_SHADOW },
  courseName: { fontSize: 17, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  meta: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  teeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm - 2 },

  // Filled/tinted chips instead of the old outline-pill look, matching the
  // rest of the app's selected-state language (course rows, country picker).
  formatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.sm, paddingVertical: SPACING.xs + 3, paddingHorizontal: SPACING.sm + 2, backgroundColor: COLORS.primaryTint },
  formatBtnActive: { backgroundColor: COLORS.primary },
  formatTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.primary },
  formatTxtActive: { color: COLORS.textOnPrimary },

  playerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs + 4 },
  playerName: { fontSize: 15, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary },
  playerHint: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  hcpInput: { width: 56, backgroundColor: '#f8f9fa', borderRadius: RADIUS.sm, borderWidth: 1, borderColor: '#e9ecef', paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2, fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary, textAlign: 'center' },
  removeBtn: { padding: SPACING.xs },
  addPlayerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: SPACING.xs + 2, paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.sm + 2, borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryTint },
  addPlayerTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.primary },

  modal: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, paddingBottom: 0 },
  modalTitle: { fontSize: 20, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  tabBar: { flexDirection: 'row', gap: SPACING.xs + 2, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: SPACING.sm + 1, borderRadius: RADIUS.sm, backgroundColor: '#e9ecef' },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  tabTxtActive: { color: COLORS.textOnPrimary },
  sectionDesc: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary, lineHeight: 19 },
  codeInput: { backgroundColor: COLORS.card, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md - 2, fontSize: 15, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e9ecef' },
  searchResult: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.sm + 6, gap: SPACING.sm + 4, ...CARD_SHADOW },
  searchResultName: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  searchResultMeta: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md - 2 },
  actionBtnTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
});
