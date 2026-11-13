import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { COLORS, FONT } from '../../src/theme';
import MapView, { Marker, LongPressEvent } from 'react-native-maps';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import {
  getRound, getHoles, getHoleScores, getRoundStats,
  getGPSShotsForRound, insertShotMeasurement, deleteShotMeasurement,
  updateHoleScore, updateShotType, updateShotDistance, getTeePos,
  updateRound, getRoundPlayers, getAllRoundStats,
  RoundRow, HoleScoreRow,
} from '../../src/lib/api';
import { scoreLabel, handicapDifferential, stablefordPoints, GameFormat, GAME_FORMAT_LABELS, ShotMeasurement, TeeColor, Hole, RoundPlayer } from '../../src/types';
import { computeFormatResult, courseHandicap, rankHolesByDifficulty, strokesReceived, netStablefordPoints } from '../../src/services/gameFormats';
import { calcHandicapIndex } from '../../src/services/handicap';
import { CoursePreviewModal } from '../../src/components/CoursePreviewModal';
import { ShotMapModal } from '../../src/components/ShotMapModal';
import { TeeColorPicker } from '../../src/components/TeeColorPicker';
import { bearing } from '../../src/services/geo';
import { Ionicons } from '@expo/vector-icons';

const PIN_COORDS: Record<'red' | 'yellow' | 'blue', (h: Hole) => { lat: number; lon: number }> = {
  red:    h => ({ lat: h.frontLat,  lon: h.frontLon  }),
  yellow: h => ({ lat: h.centerLat, lon: h.centerLon }),
  blue:   h => ({ lat: h.backLat,   lon: h.backLon   }),
};
const PIN_NATIVE_COLOR: Record<string, string> = { red: 'red', yellow: 'yellow', blue: 'blue' };

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

export default function RoundDetailScreen() {
  const { id, holeId: paramHoleId, openMap } = useLocalSearchParams<{ id: string; holeId?: string; openMap?: string }>();
  const navigation = useNavigation();
  const mapRef = useRef<MapView>(null);

  const [round, setRound] = useState<RoundRow | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [scores, setScores] = useState<HoleScoreRow[]>([]);
  const [gpsShots, setGpsShots] = useState<(ShotMeasurement & { holeId: string })[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getRoundStats>>>(null);

  const [tab, setTab] = useState<'scorecard' | 'shots'>('scorecard');
  const [showPreview, setShowPreview] = useState(false);
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shotMapScoreId, setShotMapScoreId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [editingTee, setEditingTee] = useState(false);
  const [players, setPlayers] = useState<RoundPlayer[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [ownHandicapIndex, setOwnHandicapIndex] = useState<number | null>(null);

  useEffect(() => {
    getAllRoundStats().then(rs => setOwnHandicapIndex(calcHandicapIndex(rs))).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const r = await getRound(id);
      if (!r) return;
      setRound(r);
      navigation.setOptions({ title: r.courseName ?? 'Detalle' });

      const [freshScores, h, gps, st, ps] = await Promise.all([
        getHoleScores(id),
        getHoles(r.courseId),
        getGPSShotsForRound(id),
        getRoundStats(id),
        getRoundPlayers(id),
      ]);
      setScores(freshScores);
      setHoles(h);
      setGpsShots(gps);
      setStats(st);
      setPlayers(ps);
      if (ps.length > 1) {
        setSelectedPlayerId((ps.find(p => p.isOwner) ?? ps[0]).id);
      }

      const startHole = paramHoleId ?? (h.length > 0 ? h[0].id : null);
      setSelectedHoleId(startHole ?? null);
      if (paramHoleId && openMap === 'true') {
        const hs = freshScores.find(s => s.holeId === paramHoleId);
        if (hs) setShotMapScoreId(hs.id);
      }
    })();
  }, [id]);

  const teeColor = (round?.teeColor ?? 'yellow') as TeeColor;

  function orientCamera(holeId: string | null) {
    const hole = holes.find(h => h.id === holeId);
    const tee = hole ? getTeePos(hole, teeColor) : null;
    if (!tee) return;
    const pin = hole!.centerLat !== 0 ? { lat: hole!.centerLat, lon: hole!.centerLon }
              : hole!.frontLat  !== 0 ? { lat: hole!.frontLat,  lon: hole!.frontLon  }
              : null;
    if (!pin) return;
    const dist = haversineM(tee.lat, tee.lon, pin.lat, pin.lon) || 130;
    const zoom = Math.max(14.5, Math.min(17, 16 - Math.log2(dist / 130)));
    setTimeout(() => {
      mapRef.current?.animateCamera({
        center: { latitude: (tee.lat + pin.lat) / 2, longitude: (tee.lon + pin.lon) / 2 },
        heading: bearing(tee, pin), pitch: 0, zoom,
      }, { duration: 650 });
    }, 100);
  }

  useEffect(() => {
    if (tab === 'shots') orientCamera(selectedHoleId);
  }, [selectedHoleId, tab]);

  async function reloadScores() {
    setScores(await getHoleScores(id));
  }

  async function bump(scoreId: string, data: Parameters<typeof updateHoleScore>[1]) {
    await updateHoleScore(scoreId, data);
    reloadScores();
  }

  async function handleTeeColorChange(color: TeeColor) {
    await updateRound(id, { teeColor: color });
    setRound(prev => (prev ? { ...prev, teeColor: color } : prev));
    setEditingTee(false);
  }

  async function reloadShots() {
    setGpsShots(await getGPSShotsForRound(id));
  }

  async function saveShot(lat: number, lon: number) {
    if (!selectedHoleId) return;
    const score = scores.find(s => s.holeId === selectedHoleId);
    if (!score) return;
    await insertShotMeasurement(score.id, 0, { lat, lon, club: '' });
    reloadShots();
  }

  function deleteShot(shotId: string) {
    Alert.alert('Borrar golpe', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteShotMeasurement(shotId); reloadShots(); } },
    ]);
  }

  if (!round || !stats) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const pinColor = (round.pinColor ?? 'yellow') as 'red' | 'yellow' | 'blue';

  // `stats` (getRoundStats) sums every hole_scores row for the round with
  // no player filter — correct for single-player, but for a multiplayer
  // round it silently adds every player's strokes together. Recompute the
  // same shape from just the selected player's rows in that case instead
  // of showing a meaningless combined total.
  const isMultiplayer = players.length > 1;
  // Derived synchronously from the one unfiltered `scores` fetch already
  // loaded above — no second round-trip, so there's no "0 golpes" flash
  // while a player-specific fetch resolves.
  const playerScores = isMultiplayer && selectedPlayerId
    ? scores.filter(s => s.playerId === selectedPlayerId).sort((a, b) => (a.holeNumber ?? 0) - (b.holeNumber ?? 0))
    : scores;
  // strokes === 0 means that hole was never played (a round finished early
  // leaves the rest seeded at 0, not at par) — exclude those everywhere so
  // an early finish doesn't silently count untouched holes as pars.
  const playedScores = playerScores.filter(s => s.strokes > 0);
  const displayStats = isMultiplayer
    ? {
        totalStrokes: playedScores.reduce((a, s) => a + s.strokes, 0),
        totalPutts: playedScores.reduce((a, s) => a + s.putts, 0),
        totalPar: playedScores.reduce((a, s) => a + (s.holePar ?? 4), 0),
        fairwaysHit: playedScores.filter(s => s.fairwayHit === 1).length,
        fairwaysTotal: playedScores.filter(s => s.fairwayHit !== null).length,
        girsHit: playedScores.filter(s => s.gir === 1).length,
        holesCount: playedScores.length,
        stablefordPoints: playedScores.reduce((a, s) => a + stablefordPoints(s.strokes, s.holePar ?? 4), 0),
      }
    : stats;

  const diff = displayStats.totalStrokes - displayStats.totalPar;
  const hcDiff = round.courseRating && round.slopeRating
    ? handicapDifferential(displayStats.totalStrokes, round.courseRating, round.slopeRating).toFixed(1)
    : null;

  // Net score for the selected player — their own round handicap if one was
  // set, else (solo rounds, or nobody typed one in at setup) their real
  // calculated Handicap Index, same fallback as the active-round screen.
  const selectedPlayerHandicap = players.find(p => p.id === selectedPlayerId)?.handicapIndex
    ?? (!isMultiplayer ? ownHandicapIndex : null) ?? null;
  const netResult = (() => {
    if (selectedPlayerHandicap == null || holes.length === 0 || playedScores.length === 0) return null;
    const totalCoursePar = holes.reduce((a, h) => a + h.par, 0);
    const courseRating = round.courseRating ?? totalCoursePar;
    const slopeRating = round.slopeRating ?? 113;
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
    return { netDiff: netStrokes - grossParPlayed, netStbl };
  })();
  const netDiff = netResult?.netDiff ?? null;
  const fwPct = displayStats.fairwaysTotal > 0 ? Math.round((displayStats.fairwaysHit / displayStats.fairwaysTotal) * 100) : null;
  const girPct = Math.round((displayStats.girsHit / Math.max(displayStats.holesCount, 1)) * 100);

  const selectedHole = holes.find(h => h.id === selectedHoleId);
  const holeShots = gpsShots.filter(s => s.holeId === selectedHoleId);
  const pinCoord = selectedHole ? PIN_COORDS[pinColor](selectedHole) : null;

  const tableScores = isMultiplayer ? playerScores : scores;
  const playerTotals = isMultiplayer
    ? players
        .map(p => ({ player: p, total: scores.filter(s => s.playerId === p.id).reduce((sum, s) => sum + s.strokes, 0) }))
        .sort((a, b) => a.total - b.total)
    : [];

  const gameFormat = (round.gameFormat ?? 'stroke_play') as GameFormat;
  // Same "only swap the number once it's the active format" rule as the
  // active-round screen — gross Stableford stays gross for every other format.
  const selectedNetStbl = gameFormat === 'stableford' ? netResult?.netStbl ?? null : null;
  const formatResult = isMultiplayer && gameFormat !== 'stroke_play' && holes.length > 0
    ? computeFormatResult(
        gameFormat, players, holes,
        new Map(players.map(p => [p.id, scores.filter(s => s.playerId === p.id && s.strokes > 0).map(s => ({ holeId: s.holeId, strokes: s.strokes }))])),
        round.courseRating ?? holes.reduce((a, h) => a + h.par, 0),
        round.slopeRating ?? 113,
      )
    : null;

  const mapMarkers = [
    ...(selectedHole && getTeePos(selectedHole, teeColor) ? [{
      id: 'tee', lat: getTeePos(selectedHole, teeColor)!.lat, lon: getTeePos(selectedHole, teeColor)!.lon,
      pinColor: 'orange' as const, title: 'Tee',
    }] : []),
    ...(pinCoord && pinCoord.lat !== 0 ? [{
      id: 'pin', lat: pinCoord.lat, lon: pinCoord.lon,
      pinColor: PIN_NATIVE_COLOR[pinColor] as any, title: 'Pin',
    }] : []),
  ];

  const allCoords = [...mapMarkers.map(m => ({ lat: m.lat, lon: m.lon })), ...holeShots.map(s => ({ lat: s.lat, lon: s.lon }))];
  const mapRegion = allCoords.length > 0
    ? (() => {
        const lats = allCoords.map(p => p.lat), lons = allCoords.map(p => p.lon);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        return { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2, latitudeDelta: Math.max(maxLat - minLat, 0.002) * 2.0, longitudeDelta: Math.max(maxLon - minLon, 0.002) * 2.0 };
      })()
    : { latitude: 39.5872, longitude: -0.4669, latitudeDelta: 0.008, longitudeDelta: 0.008 };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'scorecard' && styles.tabBtnActive]} onPress={() => setTab('scorecard')}>
          <Ionicons name="list" size={15} color={tab === 'scorecard' ? COLORS.textOnPrimary : COLORS.textSecondary} />
          <Text style={[styles.tabText, tab === 'scorecard' && styles.tabTextActive]}>Scorecard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'shots' && styles.tabBtnActive]} onPress={() => setTab('shots')}>
          <Ionicons name="map" size={15} color={tab === 'shots' ? COLORS.textOnPrimary : COLORS.textSecondary} />
          <Text style={[styles.tabText, tab === 'shots' && styles.tabTextActive]}>Golpes GPS</Text>
        </TouchableOpacity>
      </View>

      <CoursePreviewModal
        visible={showPreview}
        courseId={round.courseId}
        roundId={id}
        initialPinColor={pinColor}
        initialTeeColor={teeColor}
        initialHoleId={selectedHoleId ?? undefined}
        onClose={() => setShowPreview(false)}
      />
      {(() => {
        const hs = scores.find(s => s.id === shotMapScoreId);
        const hole = hs ? holes.find(h => h.id === hs.holeId) : null;
        return hole && hs ? (
          <ShotMapModal
            visible={shotMapScoreId !== null}
            hole={hole}
            holeNumber={hs.holeNumber ?? hole.number}
            holeScoreId={hs.id}
            pinColor={(hs.pinColor ?? 'yellow') as 'red' | 'yellow' | 'blue'}
            teeColor={teeColor}
            pinOverride={hs.pinLat && hs.pinLon ? { lat: hs.pinLat, lon: hs.pinLon } : null}
            teeOverride={hs.teeLat && hs.teeLon ? { lat: hs.teeLat, lon: hs.teeLon } : null}
            onClose={() => { setShotMapScoreId(null); reloadScores(); }}
          />
        ) : null;
      })()}

      {tab === 'scorecard' ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          {isMultiplayer && (
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>Resultados · {GAME_FORMAT_LABELS[gameFormat]}</Text>

              {!formatResult && playerTotals.map(({ player, total }, i) => (
                <ResultRow key={player.id} rank={i + 1} player={player} value={`${total}`} />
              ))}

              {formatResult?.format === 'stableford' && formatResult.stableford.map(({ player, netPoints }, i) => (
                <ResultRow key={player.id} rank={i + 1} player={player} value={`${netPoints} pts`} />
              ))}

              {formatResult?.format === 'skins' && formatResult.skins.rows.map(({ player, skinsWon }, i) => (
                <ResultRow key={player.id} rank={i + 1} player={player} value={`${skinsWon}`} />
              ))}

              {formatResult?.format === 'match_play' && (
                formatResult.matchPlay ? (() => {
                  const mp = formatResult.matchPlay;
                  const leaderName = mp.margin === 0 ? null : mp.players[mp.margin > 0 ? 0 : 1].displayName;
                  return (
                    <View style={styles.matchWrap}>
                      <Text style={styles.resultsName}>{mp.players[0].displayName} vs {mp.players[1].displayName}</Text>
                      <Text style={[styles.matchStatus, leaderName && { color: COLORS.warning }]}>
                        {leaderName ? `${leaderName} · ${mp.statusLabel}` : 'Empatado (AS)'}
                      </Text>
                    </View>
                  );
                })() : (
                  <Text style={styles.resultsName}>Match Play necesita exactamente 2 jugadores.</Text>
                )
              )}
            </View>
          )}

          <View style={styles.summaryCard}>
            <View style={styles.summaryMain}>
              <Text style={styles.totalStrokes}>{displayStats.totalStrokes}</Text>
              <View style={[styles.scoreBadge, { borderColor: diff < 0 ? COLORS.danger : diff === 0 ? COLORS.success : COLORS.textSecondary }]}>
                <Text style={[styles.scoreStr, { color: diff < 0 ? COLORS.danger : diff === 0 ? COLORS.success : COLORS.textPrimary }]}>
                  {diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`}
                </Text>
              </View>
              <View style={[styles.pinBadge, { backgroundColor: { red: COLORS.danger, yellow: '#d4ac0d', blue: COLORS.info }[pinColor] }]}>
                <Text style={styles.pinBadgeTxt}>Pin {pinColor === 'red' ? 'Rojo' : pinColor === 'yellow' ? 'Amarillo' : 'Azul'}</Text>
              </View>
              <TouchableOpacity style={styles.teeEditBtn} onPress={() => setEditingTee(v => !v)}>
                <Ionicons name="pencil" size={13} color={COLORS.textOnPrimary} />
              </TouchableOpacity>
            </View>
            {editingTee && (
              <View style={styles.teeEditPanel}>
                <Text style={styles.teeEditLabel}>Corregir tee</Text>
                <TeeColorPicker value={teeColor} onChange={handleTeeColorChange} />
              </View>
            )}
            <Text style={styles.dateText}>
              {new Date(round.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
            <View style={styles.statsRow}>
              <StatItem label="Putts"      value={`${displayStats.totalPutts}`} />
              <StatItem
                label={selectedNetStbl !== null ? 'Stbl. neto' : 'Stableford'}
                value={`${selectedNetStbl !== null ? selectedNetStbl : displayStats.stablefordPoints}`}
              />
              {fwPct !== null && <StatItem label="Fairways" value={`${fwPct}%`} />}
              <StatItem label="GIR"        value={`${girPct}%`} />
              {netDiff !== null && <StatItem label="Neto" value={netDiff === 0 ? 'E' : netDiff > 0 ? `+${netDiff}` : `${netDiff}`} />}
              {hcDiff && <StatItem label="H. Diff" value={hcDiff} />}
            </View>
          </View>

          {isMultiplayer && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {players.map(p => {
                const active = selectedPlayerId === p.id;
                return (
                  <TouchableOpacity key={p.id} style={[styles.pill, active && styles.pillActive]} onPress={() => setSelectedPlayerId(p.id)}>
                    <Text style={[styles.pillNum, active && styles.pillNumActive]} numberOfLines={1}>
                      {p.displayName} <Text style={{ opacity: 0.7, fontFamily: FONT.bodyMedium }}>· {p.handicapIndex ?? '—'}</Text>
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 0.5 }]}>H</Text>
              <Text style={[styles.th, { flex: 0.5 }]}>Par</Text>
              <Text style={[styles.th, { flex: 0.8 }]}>Score</Text>
              <Text style={[styles.th, { flex: 1.1 }]}>Result.</Text>
              <Text style={[styles.th, { flex: 1.0 }]}>Putts</Text>
              <Text style={[styles.th, { flex: 1.1 }]}>FW/GIR</Text>
              <View style={{ width: 18 }} />
            </View>
            {tableScores.map((hs) => {
              const played = hs.strokes > 0;
              const d = hs.strokes - (hs.holePar ?? 4);
              const color = !played ? COLORS.textTertiary : d < 0 ? COLORS.danger : d === 0 ? COLORS.success : COLORS.textPrimary;
              const isEditing = editingId === hs.id;
              const puttLabel = hs.firstPuttDist ? `${hs.putts} (${hs.firstPuttDist}m)` : `${hs.putts}`;
              return (
                <View key={hs.id}>
                  <TouchableOpacity style={[styles.tableRow, isEditing && styles.tableRowActive]} onPress={() => setEditingId(isEditing ? null : hs.id)} activeOpacity={0.7}>
                    <Text style={[styles.td, { flex: 0.5 }]}>{hs.holeNumber}</Text>
                    <Text style={[styles.td, { flex: 0.5 }]}>{hs.holePar}</Text>
                    <Text style={[styles.td, { flex: 0.8, fontFamily: FONT.bodySemiBold, color }]}>{hs.strokes}</Text>
                    <Text style={[styles.td, { flex: 1.1, color, fontSize: 11 }]}>{played ? scoreLabel(hs.strokes, hs.holePar ?? 4) : 'Sin jugar'}</Text>
                    <Text style={[styles.td, { flex: 1.0, fontSize: 12 }]}>{puttLabel}</Text>
                    <View style={{ flex: 1.1, flexDirection: 'row', gap: 4, justifyContent: 'center' }}>
                      {hs.fairwayHit !== null && <Ionicons name={hs.fairwayHit ? 'checkmark' : 'close'} size={14} color={hs.fairwayHit ? COLORS.success : COLORS.textTertiary} />}
                      <Ionicons name={hs.gir ? 'checkmark' : 'close'} size={14} color={hs.gir ? COLORS.info : COLORS.textTertiary} />
                    </View>
                    <Ionicons name={isEditing ? 'chevron-up' : 'create-outline'} size={14} color={COLORS.textTertiary} />
                  </TouchableOpacity>
                  {isEditing && (
                    <View style={styles.editPanel}>
                      <View style={styles.editRow}>
                        <EditStepper label="Golpes" value={hs.strokes} color={COLORS.textPrimary} onDec={() => bump(hs.id, { strokes: Math.max(1, hs.strokes - 1) })} onInc={() => bump(hs.id, { strokes: hs.strokes + 1 })} />
                        <EditStepper label="Putts" value={hs.putts} color={COLORS.info} onDec={() => bump(hs.id, { putts: Math.max(0, hs.putts - 1) })} onInc={() => bump(hs.id, { putts: hs.putts + 1 })} />
                        <EditStepper label="Penalizac." value={hs.penaltyStrokes} color={COLORS.danger} onDec={() => bump(hs.id, { penaltyStrokes: Math.max(0, hs.penaltyStrokes - 1) })} onInc={() => bump(hs.id, { penaltyStrokes: hs.penaltyStrokes + 1 })} />
                      </View>
                      <View style={styles.editRow}>
                        <EditStepper label="1er putt (m)" value={hs.firstPuttDist ?? 0} color="#8e44ad" onDec={() => bump(hs.id, { firstPuttDist: Math.max(0, (hs.firstPuttDist ?? 0) - 1) || null })} onInc={() => bump(hs.id, { firstPuttDist: (hs.firstPuttDist ?? 0) + 1 })} />
                        {hs.fairwayHit !== null && (
                          <View style={styles.editToggle}>
                            <Text style={styles.editToggleLabel}>Fairway</Text>
                            <TouchableOpacity style={[styles.editToggleBtn, hs.fairwayHit === 1 && styles.editToggleBtnOn]} onPress={() => bump(hs.id, { fairwayHit: hs.fairwayHit === 1 ? 0 : 1 })}>
                              <Ionicons name={hs.fairwayHit ? 'checkmark' : 'close'} size={16} color={hs.fairwayHit ? COLORS.textOnPrimary : COLORS.textTertiary} />
                            </TouchableOpacity>
                          </View>
                        )}
                        <View style={styles.editToggle}>
                          <Text style={styles.editToggleLabel}>GIR</Text>
                          <TouchableOpacity style={[styles.editToggleBtn, hs.gir === 1 && styles.editToggleBtnGir]} onPress={() => bump(hs.id, { gir: hs.gir === 1 ? 0 : 1 })}>
                            <Ionicons name={hs.gir ? 'checkmark' : 'close'} size={16} color={hs.gir ? COLORS.textOnPrimary : COLORS.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <TouchableOpacity style={styles.shotMapEditBtn} onPress={() => setShotMapScoreId(hs.id)}>
                        <Ionicons name="golf-outline" size={15} color={COLORS.primary} />
                        <Text style={styles.shotMapEditTxt}>Editar mapa de golpes</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll} contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}>
            {holes.map(hole => {
              const count = gpsShots.filter(s => s.holeId === hole.id).length;
              const active = selectedHoleId === hole.id;
              return (
                <TouchableOpacity key={hole.id} style={[styles.pill, active && styles.pillActive]} onPress={() => setSelectedHoleId(hole.id)}>
                  <Text style={[styles.pillNum, active && styles.pillNumActive]}>{hole.number}</Text>
                  {count > 0 && <Text style={[styles.pillCount, active && { color: COLORS.primaryMuted }]}>{count}</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <MapView ref={mapRef} style={{ flex: 1 }} mapType={'satelliteFlyover' as any} initialRegion={mapRegion}
            onLongPress={(e: LongPressEvent) => { const { latitude, longitude } = e.nativeEvent.coordinate; saveShot(latitude, longitude); }}
            showsUserLocation showsCompass>
            {mapMarkers.map(m => <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lon }} title={m.title} pinColor={m.pinColor} />)}
            {holeShots.map((shot) => (
              <Marker key={shot.id} coordinate={{ latitude: shot.lat, longitude: shot.lon }}
                pinColor={shot.shotType === 'punch' ? 'orange' : shot.shotType === 'poor' ? 'red' : 'white'}
                tracksViewChanges={false}
                onPress={() => setSelectedShotId(prev => prev === shot.id ? null : shot.id)}
              />
            ))}
          </MapView>

          {(() => {
            const shot = holeShots.find(s => s.id === selectedShotId);
            if (!shot) return null;
            const i = holeShots.indexOf(shot);
            const distToPin = pinCoord && pinCoord.lat !== 0 ? haversineM(shot.lat, shot.lon, pinCoord.lat, pinCoord.lon) : null;
            return (
              <View style={styles.shotPanel}>
                <View style={styles.shotPanelHeader}>
                  <Text style={styles.shotPanelTitle}>Golpe {i + 1}{distToPin !== null ? `  ·  ${distToPin}m al pin` : ''}</Text>
                  <TouchableOpacity onPress={() => setSelectedShotId(null)}><Ionicons name="close" size={20} color={COLORS.textSecondary} /></TouchableOpacity>
                </View>
                <View style={styles.shotPanelTypes}>
                  {(['normal', 'punch', 'poor'] as const).map((key) => {
                    const labels = { normal: 'Normal', punch: 'Recuperación', poor: 'Mal golpe' };
                    const colors = { normal: COLORS.success, punch: COLORS.warning, poor: COLORS.danger };
                    const active = (shot.shotType ?? 'normal') === key;
                    return (
                      <TouchableOpacity key={key} style={[styles.shotPanelTypeBtn, active && { backgroundColor: colors[key], borderColor: colors[key] }]}
                        onPress={async () => { await updateShotType(shot.id, key); reloadShots(); }}>
                        <Text style={[styles.shotPanelTypeTxt, active && { color: COLORS.textOnPrimary }]}>{labels[key]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.shotPanelDist}>
                  <Text style={styles.shotPanelDistLabel}>Distancia</Text>
                  <View style={styles.shotPanelDistRow}>
                    <TouchableOpacity style={styles.shotPanelBtn} onPress={async () => { await updateShotDistance(shot.id, Math.max(0, shot.distanceMeters - 5)); reloadShots(); }}><Ionicons name="remove" size={20} color={COLORS.primary} /></TouchableOpacity>
                    <TouchableOpacity style={styles.shotPanelBtn} onPress={async () => { await updateShotDistance(shot.id, Math.max(0, shot.distanceMeters - 1)); reloadShots(); }}><Text style={styles.shotPanelSmallBtn}>-1</Text></TouchableOpacity>
                    <Text style={styles.shotPanelDistNum}>{shot.distanceMeters}m</Text>
                    <TouchableOpacity style={styles.shotPanelBtn} onPress={async () => { await updateShotDistance(shot.id, shot.distanceMeters + 1); reloadShots(); }}><Text style={styles.shotPanelSmallBtn}>+1</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.shotPanelBtn} onPress={async () => { await updateShotDistance(shot.id, shot.distanceMeters + 5); reloadShots(); }}><Ionicons name="add" size={20} color={COLORS.primary} /></TouchableOpacity>
                  </View>
                </View>
                <TouchableOpacity style={styles.shotPanelDelete} onPress={() => { setSelectedShotId(null); deleteShot(shot.id); }}>
                  <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                  <Text style={styles.shotPanelDeleteTxt}>Borrar golpe</Text>
                </TouchableOpacity>
              </View>
            );
          })()}

          <TouchableOpacity style={styles.previewFloat} onPress={() => setShowPreview(true)}>
            <Ionicons name="eye-outline" size={18} color={COLORS.textOnPrimary} />
            <Text style={styles.previewFloatTxt}>Vista previa</Text>
          </TouchableOpacity>
          {!selectedShotId && <View style={styles.hintBar}><Text style={styles.hintTxt}>Mantén pulsado para marcar · toca un marcador para editarlo</Text></View>}
        </View>
      )}
    </View>
  );
}

function EditStepper({ label, value, color, onDec, onInc }: { label: string; value: number; color: string; onDec: () => void; onInc: () => void }) {
  return (
    <View style={styles.stepperWrap}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity onPress={onDec} style={styles.stepperBtn}><Ionicons name="remove" size={18} color={color} /></TouchableOpacity>
        <Text style={[styles.stepperVal, { color }]}>{value}</Text>
        <TouchableOpacity onPress={onInc} style={styles.stepperBtn}><Ionicons name="add" size={18} color={color} /></TouchableOpacity>
      </View>
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.statItem}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function ResultRow({ rank, player, value }: { rank: number; player: RoundPlayer; value: string }) {
  const leading = rank === 1;
  return (
    <View style={[styles.resultsRow, leading && styles.resultsRowLeading]}>
      {leading ? (
        <Ionicons name="trophy" size={15} color={COLORS.warning} style={{ width: 16 }} />
      ) : (
        <Text style={styles.resultsRank}>{rank}</Text>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.resultsName, leading && { fontFamily: FONT.heading }]} numberOfLines={1}>{player.displayName}</Text>
        <Text style={styles.resultsHcp}>HCP {player.handicapIndex ?? '—'}</Text>
      </View>
      <Text style={[styles.resultsTotal, leading && { fontSize: 17, color: COLORS.warning }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.card, paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderColor: '#e9ecef' },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f0f2f5' },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.textOnPrimary },
  summaryCard: { backgroundColor: COLORS.primary, borderRadius: 16, padding: 16 },
  summaryMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  totalStrokes: { fontSize: 48, fontFamily: FONT.headingExtraBold, color: COLORS.textOnPrimary },
  scoreBadge: { borderWidth: 2, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  scoreStr: { fontSize: 18, fontFamily: FONT.bodySemiBold },
  pinBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  pinBadgeTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  teeEditBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  teeEditPanel: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.18)', gap: 6 },
  teeEditLabel: { fontSize: 11, color: COLORS.primaryMuted, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },
  dateText: { fontSize: 13, fontFamily: FONT.body, color: COLORS.primaryMuted, marginTop: 4, marginBottom: 12, textTransform: 'capitalize' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  statLabel: { fontSize: 11, fontFamily: FONT.body, color: COLORS.primaryMuted },
  resultsCard: { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, gap: 2 },
  resultsTitle: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary, marginBottom: 4 },
  resultsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8 },
  resultsRowLeading: { backgroundColor: COLORS.primaryTint },
  resultsRank: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textTertiary, width: 16, textAlign: 'center' },
  resultsName: { fontSize: 13, color: COLORS.textPrimary, fontFamily: FONT.bodyMedium },
  resultsHcp: { fontSize: 10, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: 1 },
  resultsTotal: { fontSize: 15, fontFamily: FONT.heading, color: COLORS.primary },
  matchWrap: { alignItems: 'center', gap: 4, paddingVertical: 6, backgroundColor: COLORS.primaryTint, borderRadius: 10 },
  matchStatus: { fontSize: 18, fontFamily: FONT.heading, color: COLORS.primary },
  table: { backgroundColor: COLORS.card, borderRadius: 14, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f0f4f0', padding: 10, alignItems: 'center' },
  th: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.primary, textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: '#f0f2f5', alignItems: 'center' },
  tableRowActive: { backgroundColor: '#f0f9f0' },
  td: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary, textAlign: 'center' },
  editPanel: { backgroundColor: '#f8faf8', borderTopWidth: 1, borderColor: '#e9ecef', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  editRow: { flexDirection: 'row', gap: 8, justifyContent: 'space-around' },
  stepperWrap: { flex: 1, alignItems: 'center', gap: 4 },
  stepperLabel: { fontSize: 10, color: COLORS.textSecondary, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  stepperVal: { fontSize: 20, fontFamily: FONT.heading, minWidth: 28, textAlign: 'center' },
  editToggle: { flex: 1, alignItems: 'center', gap: 4 },
  editToggleLabel: { fontSize: 10, color: COLORS.textSecondary, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },
  editToggleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  editToggleBtnOn: { backgroundColor: COLORS.success },
  editToggleBtnGir: { backgroundColor: COLORS.info },
  shotMapEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 10, paddingVertical: 9, marginTop: 2 },
  shotMapEditTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.primary },
  shotPanel: { backgroundColor: COLORS.card, borderTopWidth: 1, borderColor: '#e9ecef', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  shotPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shotPanelTitle: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  shotPanelTypes: { flexDirection: 'row', gap: 8 },
  shotPanelTypeBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: '#e9ecef', backgroundColor: '#f8f9fa' },
  shotPanelTypeTxt: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  shotPanelDist: { gap: 6 },
  shotPanelDistLabel: { fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },
  shotPanelDistRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shotPanelBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  shotPanelSmallBtn: { fontSize: 13, fontFamily: FONT.heading, color: COLORS.primary },
  shotPanelDistNum: { flex: 1, textAlign: 'center', fontSize: 24, fontFamily: FONT.headingExtraBold, color: COLORS.primary },
  shotPanelDelete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: '#fff5f5' },
  shotPanelDeleteTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.danger },
  pillScroll: { backgroundColor: COLORS.card, paddingVertical: 8, maxHeight: 52, borderBottomWidth: 1, borderColor: '#e9ecef' },
  pill: { minWidth: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#f0f2f5' },
  pillActive: { backgroundColor: COLORS.primary },
  pillNum: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  pillNumActive: { color: COLORS.textOnPrimary },
  pillCount: { fontSize: 10, color: COLORS.success, fontFamily: FONT.bodySemiBold },
  hintBar: { backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 7 },
  hintTxt: { fontSize: 12, fontFamily: FONT.body, color: COLORS.primaryMuted },
  previewFloat: { position: 'absolute', bottom: 48, right: 16, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: COLORS.primary, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5 },
  previewFloatTxt: { color: COLORS.textOnPrimary, fontSize: 13, fontFamily: FONT.bodySemiBold },
});
