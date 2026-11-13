import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, FlatList, ActivityIndicator, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT } from '../../src/theme';
import {
  getRound, getHoleScores, updateHoleScore, completeRound,
  getShotMeasurements, insertShotMeasurement, deleteShotMeasurement,
  getHoles, getRoundPlayers, updateRound, getClubProfiles, ClubProfile,
  getAllRoundStats,
} from '../../src/lib/api';
import { HoleScore, Hole, TeeColor, RoundPlayer } from '../../src/types';
import { ScorePad } from '../../src/components/ScorePad';
import { GPSPanel } from '../../src/components/GPSPanel';
import { ClubRecommendation } from '../../src/components/ClubRecommendation';
import { ShotMapModal } from '../../src/components/ShotMapModal';
import { CoursePreviewModal } from '../../src/components/CoursePreviewModal';
import { TeeColorPicker } from '../../src/components/TeeColorPicker';
import { ShotMeasurePanel } from '../../src/components/ShotMeasure';
import { ShotMeasurement } from '../../src/types';
import { stablefordPoints, GameFormat, GAME_FORMAT_LABELS } from '../../src/types';
import { computeFormatResult, courseHandicap, rankHolesByDifficulty, strokesReceived, netStablefordPoints } from '../../src/services/gameFormats';
import { calcHandicapIndex } from '../../src/services/handicap';
import { Ionicons } from '@expo/vector-icons';

export default function ActiveRoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [scores, setScores] = useState<(HoleScore & { holeNumber: number; holePar: number })[]>([]);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [shots, setShots] = useState<Map<string, ShotMeasurement[]>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [round, setRound] = useState<Awaited<ReturnType<typeof getRound>>>(null);
  const [players, setPlayers] = useState<RoundPlayer[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [showShotMap, setShowShotMap] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTeeEdit, setShowTeeEdit] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [distToPin, setDistToPin] = useState<number | null>(null);
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [clubProfiles, setClubProfiles] = useState<ClubProfile[]>([]);
  const [ownHandicapIndex, setOwnHandicapIndex] = useState<number | null>(null);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    getClubProfiles().then(setClubProfiles).catch(() => {});
    // Fallback handicap for solo rounds (or any round with no per-player
    // handicap set) — the player's own real, calculated Handicap Index, so
    // "no handicap on this round" doesn't mean "handicap does nothing."
    getAllRoundStats().then(rs => setOwnHandicapIndex(calcHandicapIndex(rs))).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const r = await getRound(id);
      setRound(r);
      if (r) {
        const [s, h, p] = await Promise.all([getHoleScores(id), getHoles(r.courseId as string), getRoundPlayers(id)]);
        setScores(s as any);
        setHoles(h);
        setPlayers(p);
        setSelectedPlayerId(p.length > 0 ? p[0].id : null);
        const shotMap = new Map<string, ShotMeasurement[]>();
        await Promise.all(s.map(async hs => {
          const ms = await getShotMeasurements(hs.id);
          shotMap.set(hs.id, ms);
        }));
        setShots(new Map(shotMap));
      }
      setLoading(false);
    })();
  }, [id]);

  const courseName = (round as any)?.courseName ?? 'Ronda activa';

  // Group every player's rows by playerId (null = legacy/owner row from
  // before multiplayer existed) so the score fed to ScorePad is picked by
  // BOTH the current hole index AND the selected player.
  const scoreMap = useMemo(() => {
    const m = new Map<string | null, (HoleScore & { holeNumber: number; holePar: number })[]>();
    for (const s of scores) {
      const key = s.playerId ?? null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.holeNumber ?? 0) - (b.holeNumber ?? 0));
    return m;
  }, [scores]);
  const playerScores = scoreMap.get(selectedPlayerId) ?? [];

  const currentScore = playerScores[currentIdx];
  const currentHole = holes.find((h) => h.id === currentScore?.holeId);

  // A hole with strokes === 0 hasn't been played yet (fresh rounds seed every
  // hole at 0, not at par) — exclude those from every running total so a
  // round-in-progress doesn't look like it already scored par on holes
  // nobody has touched.
  const playedScores = playerScores.filter(s => s.strokes > 0);
  const totalStrokes = playedScores.reduce((a, s) => a + s.strokes, 0);
  const totalPutts = playedScores.reduce((a, s) => a + s.putts, 0);
  const totalPar = playedScores.reduce((a, s) => a + (s.holePar ?? 4), 0);
  const totalStbl = playedScores.reduce((a, s) => a + stablefordPoints(s.strokes, s.holePar ?? 4), 0);
  const diff = totalStrokes - totalPar;

  // Handicap for the selected player — their own round_players entry if set,
  // else (solo rounds, or any round where nobody typed one in at setup) the
  // player's real calculated Handicap Index, so a round without an explicit
  // per-round HCP still gets a net score instead of handicap doing nothing.
  const selectedPlayerHandicap = players.find(p => p.id === selectedPlayerId)?.handicapIndex
    ?? (selectedPlayerId === null ? ownHandicapIndex : null) ?? null;

  const netInfo = useMemo(() => {
    if (selectedPlayerHandicap == null || holes.length === 0 || playedScores.length === 0) return null;
    const totalCoursePar = holes.reduce((a, h) => a + h.par, 0);
    const courseRating = (round as any)?.courseRating ?? totalCoursePar;
    const slopeRating = (round as any)?.slopeRating ?? 113;
    const courseHcp = courseHandicap(selectedPlayerHandicap, slopeRating, courseRating, totalCoursePar);
    const ranks = rankHolesByDifficulty(holes);
    let netStrokes = 0, grossParPlayed = 0, netStbl = 0;
    for (const s of playedScores) {
      const rank = ranks.get(s.holeId) ?? 1;
      const received = strokesReceived(courseHcp, rank, holes.length);
      netStrokes += s.strokes - received;
      grossParPlayed += s.holePar ?? 4;
      netStbl += netStablefordPoints(s.strokes, s.holePar ?? 4, received);
    }
    return { courseHcp, netDiff: netStrokes - grossParPlayed, netStbl };
  }, [selectedPlayerHandicap, holes, playedScores, round]);

  const leaderboard = players.map(p => {
    const played = (scoreMap.get(p.id) ?? []).filter(s => s.strokes > 0);
    return {
      player: p,
      total: played.reduce((a, s) => a + s.strokes, 0),
      playedPar: played.reduce((a, s) => a + (s.holePar ?? 4), 0),
    };
  }).sort((a, b) => a.total - b.total);

  const gameFormat = ((round as any)?.gameFormat ?? 'stroke_play') as GameFormat;
  const formatResult = useMemo(() => {
    if (gameFormat === 'stroke_play' || players.length < 2 || holes.length === 0) return null;
    const scoresByPlayer = new Map(players.map(p => [
      p.id,
      (scoreMap.get(p.id) ?? []).filter(s => s.strokes > 0).map(s => ({ holeId: s.holeId, strokes: s.strokes })),
    ]));
    const courseRating = (round as any)?.courseRating ?? holes.reduce((a, h) => a + h.par, 0);
    const slopeRating = (round as any)?.slopeRating ?? 113;
    return computeFormatResult(gameFormat, players, holes, scoresByPlayer, courseRating, slopeRating);
  }, [gameFormat, players, holes, scoreMap, round]);

  // Net stableford for the *selected* player — this is what actually
  // matters once handicaps are in play; the plain gross `totalStbl` above
  // stays as-is for stroke-play (nobody wants their handicap silently
  // changing a number that used to just mean "gross points"). Driven by
  // the same standalone `netInfo` calc as the Score/Neto line above (not
  // `formatResult`, which used to require 2+ players) so this works for a
  // solo Stableford round too, not just multiplayer ones.
  const selectedNetStbl = gameFormat === 'stableford' ? netInfo?.netStbl ?? null : null;

  // Always-visible "how are we doing" line — this is the whole point of
  // playing a format instead of just logging strokes, so it shouldn't be
  // hidden behind a tap on the trophy icon (that's still there, for full
  // detail / all players at once).
  const liveStatus = useMemo(() => {
    if (players.length < 2) return null;
    if (formatResult?.format === 'match_play') {
      const mp = formatResult.matchPlay;
      if (!mp) return { text: 'Match Play necesita 2 jugadores', sub: '' };
      if (mp.margin === 0) return { text: 'Empatados', sub: `AS · hoyo ${mp.holesPlayed} de ${mp.totalHoles}` };
      const leader = mp.players[mp.margin > 0 ? 0 : 1];
      return { text: `${leader.displayName} va ganando`, sub: `${mp.statusLabel}${mp.closedOut ? ' · partido decidido' : ` · hoyo ${mp.holesPlayed} de ${mp.totalHoles}`}` };
    }
    if (formatResult?.format === 'stableford') {
      const top = formatResult.stableford[0];
      if (!top) return null;
      return { text: `${top.player.displayName} lidera`, sub: `${top.netPoints} pts netos` };
    }
    if (formatResult?.format === 'skins') {
      const top = formatResult.skins.rows[0];
      if (!top || top.skinsWon === 0) return { text: 'Todavía sin skins', sub: 'gana el hoyo con el mejor golpe neto' };
      return { text: `${top.player.displayName} lidera`, sub: `${top.skinsWon} skin${top.skinsWon === 1 ? '' : 's'}` };
    }
    // stroke play with more than one player: still worth a live standing
    const top = leaderboard[0];
    if (!top || top.total === 0) return null;
    const d = top.total - top.playedPar;
    return { text: `${top.player.displayName} lidera`, sub: d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}` };
  }, [players, formatResult, leaderboard, holes]);

  async function handleChange(field: keyof HoleScore | 'fairwayHit' | 'gir', value: number | null) {
    if (!currentScore) return;
    await updateHoleScore(currentScore.id, { [field]: value } as any);
    setScores((prev) => prev.map((s) => (s.id === currentScore.id ? { ...s, [field]: value } : s)));
  }

  async function handleTeeColorChange(color: TeeColor) {
    await updateRound(id, { teeColor: color });
    setRound((r) => (r ? { ...r, teeColor: color } : r));
    setShowTeeEdit(false);
  }

  function handleFinish() {
    Alert.alert(
      'Finalizar ronda',
      `Total: ${totalStrokes} golpes (${diff >= 0 ? '+' : ''}${diff})`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar', style: 'destructive', onPress: async () => {
            await completeRound(id);
            router.replace('/');
          }
        },
      ]
    );
  }

  function goTo(idx: number) {
    setCurrentIdx(idx);
    flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTitleRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={COLORS.primaryMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{courseName}</Text>
          {selectedPlayerHandicap !== null && (
            <View style={styles.hcpBadge}>
              <Text style={styles.hcpBadgeTxt}>HCP {selectedPlayerHandicap}</Text>
            </View>
          )}
          {players.length > 1 && (
            <TouchableOpacity onPress={() => setShowLeaderboard(true)} style={styles.leaderboardBtn}>
              <Ionicons name="trophy-outline" size={22} color={COLORS.primaryMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleFinish} style={styles.finishBtn}>
            <Ionicons name="checkmark-circle" size={26} color={COLORS.primaryMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerStatsRow}>
          <HeaderStat label="Golpes" value={`${totalStrokes}`} />
          <HeaderStat
            label="Score"
            value={diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`}
            color={diff < 0 ? COLORS.danger : diff === 0 ? COLORS.success : COLORS.textOnPrimary}
            sub={netInfo ? `Neto ${netInfo.netDiff === 0 ? 'E' : netInfo.netDiff > 0 ? `+${netInfo.netDiff}` : netInfo.netDiff}` : undefined}
          />
          <HeaderStat
            label={selectedNetStbl !== null ? 'Stbl. neto' : 'Stableford'}
            value={`${selectedNetStbl !== null ? selectedNetStbl : totalStbl}`}
          />
          <HeaderStat label="Putts" value={`${totalPutts}`} />
        </View>
        {liveStatus && (
          <View style={styles.liveStatusRow}>
            <Ionicons name="trophy" size={13} color={COLORS.warning} />
            <Text style={styles.liveStatusText} numberOfLines={1}>{liveStatus.text}</Text>
            {liveStatus.sub ? <Text style={styles.liveStatusSub} numberOfLines={1}>· {liveStatus.sub}</Text> : null}
          </View>
        )}
      </View>

      {players.length > 1 && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={players}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
          renderItem={({ item }) => {
            const active = selectedPlayerId === item.id;
            return (
              <TouchableOpacity
                onPress={() => setSelectedPlayerId(item.id)}
                style={[styles.playerTab, active && styles.playerTabActive]}
              >
                <View style={[styles.playerAvatar, active && styles.playerAvatarActive]}>
                  <Text style={[styles.playerAvatarTxt, active && styles.playerAvatarTxtActive]}>
                    {item.displayName.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.playerTabText, active && styles.playerTabTextActive]} numberOfLines={1}>
                    {item.displayName.split(' ')[0]}
                  </Text>
                  <Text style={[styles.playerTabHcp, active && styles.playerTabHcpActive]}>
                    HCP {item.handicapIndex ?? '—'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <FlatList
        ref={flatRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        data={playerScores}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            onPress={() => goTo(index)}
            style={[styles.holeTab, currentIdx === index && styles.holeTabActive]}
          >
            <Text style={[styles.holeTabText, currentIdx === index && styles.holeTabTextActive]}>
              {item.holeNumber}
            </Text>
          </TouchableOpacity>
        )}
      />

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {currentScore && (
          <View style={styles.flagRow}>
            {currentHole && (
              <View style={styles.holeInfo}>
                <Text style={styles.holeInfoDist}>{currentHole.distanceMeters}m</Text>
                <Text style={styles.holeInfoHcp}>HI {currentHole.handicapIndex}</Text>
                <TouchableOpacity onPress={() => setShowTeeEdit((v) => !v)} style={styles.teeEditBtn}>
                  <Ionicons name="pencil" size={11} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={styles.mapBtn} onPress={() => setShowShotMap(true)}>
              <Ionicons name="golf-outline" size={18} color={COLORS.textOnPrimary} />
              <Text style={styles.mapBtnTxt}>Mapa golpes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mapBtn} onPress={() => setShowPreview(true)}>
              <Ionicons name="eye-outline" size={18} color={COLORS.textOnPrimary} />
              <Text style={styles.mapBtnTxt}>Vista previa</Text>
            </TouchableOpacity>
          </View>
        )}

        {showTeeEdit && round && (
          <View style={styles.teeEditPanel}>
            <Text style={styles.teeEditLabel}>Color de salida</Text>
            <TeeColorPicker value={(round.teeColor ?? 'yellow') as TeeColor} onChange={handleTeeColorChange} />
          </View>
        )}

        {currentHole && (
          <GPSPanel
            hole={currentHole}
            pinColor={currentScore?.pinColor ?? 'yellow'}
            onDistanceChange={setDistToPin}
            enabled={gpsEnabled}
            onToggleEnabled={(next) => { setGpsEnabled(next); if (!next) setDistToPin(null); }}
          />
        )}

        {currentScore && (
          <ScorePad
            holeNumber={currentScore.holeNumber}
            par={currentScore.holePar ?? 4}
            strokes={currentScore.strokes}
            putts={currentScore.putts}
            fairwayHit={currentScore.fairwayHit}
            gir={currentScore.gir}
            penaltyStrokes={currentScore.penaltyStrokes}
            firstPuttDist={currentScore.firstPuttDist}
            onChange={handleChange}
          />
        )}

        <ClubRecommendation distance={distToPin} profiles={clubProfiles} />

        {currentScore && (
          <ShotMeasurePanel
            shots={shots.get(currentScore.id) ?? []}
            onSave={async (meters) => {
              const shotId = await insertShotMeasurement(currentScore.id, meters);
              setShots((prev) => {
                const next = new Map(prev);
                next.set(currentScore.id, [...(prev.get(currentScore.id) ?? []), { id: shotId, holeScoreId: currentScore.id, distanceMeters: meters, timestamp: new Date().toISOString(), lat: 0, lon: 0, club: '', zone: '' } as ShotMeasurement]);
                return next;
              });
            }}
            onDelete={async (shotId) => {
              await deleteShotMeasurement(shotId);
              setShots((prev) => {
                const next = new Map(prev);
                next.set(currentScore.id, (prev.get(currentScore.id) ?? []).filter((s) => s.id !== shotId));
                return next;
              });
            }}
          />
        )}

        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => goTo(Math.max(0, currentIdx - 1))} style={[styles.navBtn, currentIdx === 0 && styles.navBtnDisabled]} disabled={currentIdx === 0}>
            <Ionicons name="chevron-back" size={20} color={currentIdx === 0 ? COLORS.emptyIcon : COLORS.primary} />
            <Text style={[styles.navBtnText, currentIdx === 0 && { color: COLORS.emptyIcon }]}>Anterior</Text>
          </TouchableOpacity>
          <Text style={styles.navMid}>Hoyo {currentIdx + 1} / {playerScores.length}</Text>
          <TouchableOpacity onPress={() => goTo(Math.min(playerScores.length - 1, currentIdx + 1))} style={[styles.navBtn, currentIdx === playerScores.length - 1 && styles.navBtnDisabled]} disabled={currentIdx === playerScores.length - 1}>
            <Text style={[styles.navBtnText, currentIdx === playerScores.length - 1 && { color: COLORS.emptyIcon }]}>Siguiente</Text>
            <Ionicons name="chevron-forward" size={20} color={currentIdx === playerScores.length - 1 ? COLORS.emptyIcon : COLORS.primary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {currentHole && currentScore && (
        <ShotMapModal
          visible={showShotMap}
          hole={currentHole}
          holeNumber={currentScore.holeNumber}
          holeScoreId={currentScore.id}
          pinColor={currentScore.pinColor ?? 'yellow'}
          teeColor={(round?.teeColor ?? 'yellow') as TeeColor}
          pinOverride={currentScore.pinLat ? { lat: currentScore.pinLat, lon: currentScore.pinLon! } : null}
          teeOverride={currentScore.teeLat ? { lat: currentScore.teeLat, lon: currentScore.teeLon! } : null}
          onClose={() => setShowShotMap(false)}
          onPinMoved={async (pos) => {
            await updateHoleScore(currentScore.id, { pinLat: pos.lat, pinLon: pos.lon } as any);
            setScores(prev => prev.map((s) => s.id === currentScore.id ? { ...s, pinLat: pos.lat, pinLon: pos.lon } : s));
          }}
          onTeeMoved={async (pos) => {
            await updateHoleScore(currentScore.id, { teeLat: pos.lat, teeLon: pos.lon } as any);
            setScores(prev => prev.map((s) => s.id === currentScore.id ? { ...s, teeLat: pos.lat, teeLon: pos.lon } : s));
          }}
        />
      )}
      {round && (
        <CoursePreviewModal
          visible={showPreview}
          courseId={round.courseId as string}
          roundId={id}
          initialPinColor={(currentScore?.pinColor ?? round.pinColor ?? 'yellow') as 'red' | 'yellow' | 'blue'}
          initialTeeColor={(round.teeColor ?? 'yellow') as TeeColor}
          initialHoleId={holes[currentIdx]?.id}
          onClose={() => setShowPreview(false)}
        />
      )}
      {players.length > 1 && (
        <Modal visible={showLeaderboard} transparent animationType="fade" onRequestClose={() => setShowLeaderboard(false)}>
          <View style={styles.lbBackdrop}>
            <View style={styles.lbCard}>
              <Text style={styles.lbTitle}>Clasificación · {GAME_FORMAT_LABELS[gameFormat]}</Text>

              {!formatResult && leaderboard.map(({ player, total }, i) => (
                <LbRow key={player.id} rank={i + 1} player={player} value={`${total}`} />
              ))}

              {formatResult?.format === 'stableford' && formatResult.stableford.map(({ player, netPoints }, i) => (
                <LbRow key={player.id} rank={i + 1} player={player} value={`${netPoints} pts`} />
              ))}

              {formatResult?.format === 'skins' && formatResult.skins.rows.map(({ player, skinsWon }, i) => (
                <LbRow key={player.id} rank={i + 1} player={player} value={`${skinsWon}`} />
              ))}

              {formatResult?.format === 'match_play' && (
                formatResult.matchPlay ? (() => {
                  const mp = formatResult.matchPlay;
                  const leaderName = mp.margin === 0 ? null : mp.players[mp.margin > 0 ? 0 : 1].displayName;
                  return (
                    <View style={styles.lbMatchWrap}>
                      <Text style={styles.lbMatchVs} numberOfLines={1}>
                        {mp.players[0].displayName} vs {mp.players[1].displayName}
                      </Text>
                      <Text style={[styles.lbMatchStatus, leaderName && { color: COLORS.warning }]}>
                        {leaderName ? `${leaderName} · ${mp.statusLabel}` : 'Empatado (AS)'}
                      </Text>
                      <Text style={styles.lbHint}>Hoyo {mp.holesPlayed} de {mp.totalHoles}{mp.closedOut ? ' · partido decidido' : ''}</Text>
                    </View>
                  );
                })() : (
                  <Text style={styles.lbHint}>Match Play necesita exactamente 2 jugadores.</Text>
                )
              )}

              <TouchableOpacity style={styles.lbCloseBtn} onPress={() => setShowLeaderboard(false)}>
                <Text style={styles.lbCloseBtnTxt}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function HeaderStat({ label, value, color = COLORS.textOnPrimary, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <View style={styles.headerStat}>
      <Text style={[styles.headerValue, { color }]}>{value}</Text>
      <Text style={styles.headerLabel}>{label}</Text>
      {sub && <Text style={styles.headerSub}>{sub}</Text>}
    </View>
  );
}

function LbRow({ rank, player, value }: { rank: number; player: RoundPlayer; value: string }) {
  const leading = rank === 1;
  return (
    <View style={[styles.lbRow, leading && styles.lbRowLeading]}>
      {leading ? (
        <Ionicons name="trophy" size={16} color={COLORS.warning} style={{ width: 20 }} />
      ) : (
        <Text style={styles.lbRank}>{rank}</Text>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.lbName, leading && styles.lbNameLeading]} numberOfLines={1}>{player.displayName}</Text>
        <Text style={styles.lbHcp}>HCP {player.handicapIndex ?? '—'}</Text>
      </View>
      <Text style={[styles.lbTotal, leading && styles.lbTotalLeading]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingBottom: 10 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headerTitle: { flex: 1, fontSize: 15, fontFamily: FONT.headingSemiBold, color: COLORS.textOnPrimary, marginHorizontal: 6 },
  headerStatsRow: { flexDirection: 'row', alignItems: 'center' },
  headerStat: { flex: 1, alignItems: 'center' },
  headerValue: { fontSize: 20, fontFamily: FONT.heading, color: COLORS.textOnPrimary },
  headerLabel: { fontSize: 10, fontFamily: FONT.body, color: COLORS.primaryMuted, marginTop: 1 },
  headerSub: { fontSize: 9, fontFamily: FONT.body, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  finishBtn: { paddingLeft: 8 },
  backBtn: { paddingRight: 4 },
  leaderboardBtn: { paddingHorizontal: 6 },
  hcpBadge: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 6 },
  hcpBadgeTxt: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  holeTab: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center' },
  holeTabActive: { backgroundColor: COLORS.primary },
  holeTabText: { fontSize: 13, fontFamily: FONT.bodyMedium, color: COLORS.primary },
  holeTabTextActive: { color: COLORS.textOnPrimary },
  playerTab: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 10, paddingRight: 14, borderRadius: 24, backgroundColor: COLORS.primaryTint },
  playerTabActive: { backgroundColor: COLORS.primary },
  playerTabText: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.primary },
  playerTabTextActive: { color: COLORS.textOnPrimary },
  playerTabHcp: { fontSize: 10, fontFamily: FONT.bodyMedium, color: COLORS.primary, opacity: 0.7, marginTop: 1 },
  playerTabHcpActive: { color: COLORS.textOnPrimary, opacity: 0.75 },
  playerAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  playerAvatarActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  playerAvatarTxt: { fontSize: 13, fontFamily: FONT.heading, color: COLORS.primary },
  playerAvatarTxtActive: { color: COLORS.textOnPrimary },
  liveStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  liveStatusText: { fontSize: 13, fontFamily: FONT.heading, color: COLORS.warning, flexShrink: 1 },
  liveStatusSub: { fontSize: 12, fontFamily: FONT.bodyMedium, color: COLORS.primaryMuted },
  navRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  navBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, gap: 4, shadowColor: COLORS.shadow, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  navBtnDisabled: { opacity: 0.5 },
  navBtnText: { fontSize: 14, fontFamily: FONT.bodyMedium, color: COLORS.primary },
  navMid: { flex: 1, textAlign: 'center', fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  holeInfo: { backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 60 },
  holeInfoDist: { fontSize: 15, fontFamily: FONT.heading, color: COLORS.primary },
  holeInfoHcp: { fontSize: 11, fontFamily: FONT.bodyMedium, color: COLORS.textSecondary },
  teeEditBtn: { marginTop: 4, padding: 2 },
  teeEditPanel: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12, marginBottom: 12 },
  teeEditLabel: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary, marginBottom: 8 },
  mapBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12 },
  mapBtnTxt: { color: COLORS.textOnPrimary, fontSize: 15, fontFamily: FONT.bodySemiBold },
  lbBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  lbCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 18, width: '100%', maxWidth: 360 },
  lbTitle: { fontSize: 16, fontFamily: FONT.headingSemiBold, color: COLORS.primary, marginBottom: 10 },
  lbRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, gap: 10, borderRadius: 10, marginBottom: 2 },
  lbRowLeading: { backgroundColor: COLORS.primaryTint },
  lbRank: { width: 20, textAlign: 'center', fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  lbName: { fontSize: 14, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary },
  lbNameLeading: { fontFamily: FONT.heading },
  lbHcp: { fontSize: 10, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: 1 },
  lbTotal: { fontSize: 15, fontFamily: FONT.heading, color: COLORS.primary },
  lbTotalLeading: { fontSize: 18, color: COLORS.warning },
  lbCloseBtn: { marginTop: 14, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 10 },
  lbCloseBtnTxt: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONT.bodySemiBold },
  lbMatchWrap: { alignItems: 'center', gap: 6, paddingVertical: 10, backgroundColor: COLORS.primaryTint, borderRadius: 12 },
  lbMatchVs: { fontSize: 13, fontFamily: FONT.bodyMedium, color: COLORS.textSecondary },
  lbMatchStatus: { fontSize: 24, fontFamily: FONT.headingExtraBold, color: COLORS.primary },
  lbHint: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textTertiary, textAlign: 'center' },
});
