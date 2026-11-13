import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  Dimensions, Animated, Alert, ActivityIndicator,
} from 'react-native';
import MapView, {
  Circle, Marker, Polygon, Polyline,
  MapPressEvent, Region,
} from 'react-native-maps';
import {
  getHoles, getZonesForCourse,
  updateHoleTee, updateHolePinColor, updateHoleGPS,
  updateHoleTeeColor, getTeePos, getAnyTeePos,
  insertZone, deleteZonesForHole,
} from '../lib/api';
import {
  fetchOsmFeaturesInArea, fetchOsmFeaturesInPolygon, OsmAreaFeature,
} from '../services/osmGolf';
import { Hole, CourseZone, ZoneType, TeeColor, TEE_COLORS, TEE_LABELS, TEE_HEX } from '../types';
import { haversineM, bearing, estimateTeePositions } from '../services/geo';
import { COLORS, FONT } from '../theme';
import { Ionicons } from '@expo/vector-icons';

const ZONE_FILL: Record<ZoneType, string> = {
  green:  'rgba(46,204,113,0.45)',
  calle:  'rgba(39,174,96,0.30)',
  bunker: 'rgba(212,160,23,0.45)',
  agua:   'rgba(41,128,185,0.45)',
};

interface Props {
  visible: boolean;
  courseId: string;
  courseName?: string;
  initialCenter?: { lat: number; lon: number };
  onClose: () => void;
}

export function FieldMappingModal({ visible, courseId, courseName, initialCenter, onClose }: Props) {
  const mapRef = useRef<MapView>(null);

  // ── Core state ────────────────────────────────────────────────────────────
  const [holes,     setHoles]     = useState<Hole[]>([]);
  const [holeIdx,   setHoleIdx]   = useState(0);
  const [zones,     setZones]     = useState<CourseZone[]>([]);
  const [liveCenter, setLiveCenter] = useState<{ lat: number; lon: number } | null>(null);

  // ── Detect state ──────────────────────────────────────────────────────────
  const [showDetect,    setShowDetect]    = useState(false);
  const [detectShape,   setDetectShape]   = useState<'circle' | 'polygon'>('circle');
  const [detectCenter,  setDetectCenter]  = useState<{ lat: number; lon: number } | null>(null);
  const [detectRadius,  setDetectRadius]  = useState(200);
  const [detectPts,     setDetectPts]     = useState<{ lat: number; lon: number }[]>([]);
  const [detectResults, setDetectResults] = useState<OsmAreaFeature[]>([]);
  const [detecting,     setDetecting]     = useState(false);

  // ── Tee color being placed ────────────────────────────────────────────────
  const [activeTeeColor, setActiveTeeColor] = useState<TeeColor>('black');

  // ── Flash confirmation ─────────────────────────────────────────────────
  const [flash, setFlash] = useState<string | null>(null);
  const flashOpacity = useRef(new Animated.Value(0)).current;

  function reloadAll() {
    getHoles(courseId).then(setHoles);
    getZonesForCourse(courseId).then(setZones);
  }

  /** For holes that have a legacy teeLat/teeLon but no per-color positions yet,
   *  estimate all 7 colors so the color picker and camera work immediately. */
  async function estimateLegacyTees(loadedHoles: Hole[]) {
    for (const h of loadedHoles) {
      // Find best available black/legacy position
      const blackPos = (h as any).teeBlackLat !== 0
        ? { lat: (h as any).teeBlackLat as number, lon: (h as any).teeBlackLon as number }
        : h.teeLat !== 0 ? { lat: h.teeLat, lon: h.teeLon } : null;
      if (!blackPos) continue;                              // no tee at all
      if ((h as any).teeYellowLat !== 0) continue;         // other colors already estimated
      const green = h.centerLat !== 0 ? { lat: h.centerLat, lon: h.centerLon }
                  : h.frontLat  !== 0 ? { lat: h.frontLat,  lon: h.frontLon  }
                  : null;
      // Ensure black slot is saved
      if ((h as any).teeBlackLat === 0) {
        await updateHoleTeeColor(h.id, 'black', blackPos.lat, blackPos.lon);
        await updateHoleTee(h.id, blackPos.lat, blackPos.lon);
      }
      if (green) {
        const estimates = estimateTeePositions('black', blackPos, green);
        for (const [color, pos] of Object.entries(estimates) as [TeeColor, { lat: number; lon: number }][]) {
          await updateHoleTeeColor(h.id, color, pos.lat, pos.lon);
        }
      }
    }
  }

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const loadedHoles = await getHoles(courseId);
      await estimateLegacyTees(loadedHoles);
      setHoles(await getHoles(courseId));
      setZones(await getZonesForCourse(courseId));
      setHoleIdx(0);
      setShowDetect(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, courseId]);

  const hole = holes[holeIdx] ?? null;

  // ── Camera: focus on current hole ────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    if (hole) {
      const teePos = getAnyTeePos(hole);
      const hasPin = hole.centerLat !== 0;
      if (teePos && hasPin) {
        const d = haversineM(teePos.lat, teePos.lon, hole.centerLat, hole.centerLon) || 150;
        const zoom = Math.max(14, Math.min(17.5, 15.5 - Math.log2(d / 130)));
        mapRef.current.animateCamera({
          center: { latitude: (teePos.lat + hole.centerLat) / 2, longitude: (teePos.lon + hole.centerLon) / 2 },
          heading: bearing(teePos, { lat: hole.centerLat, lon: hole.centerLon }),
          pitch: 0, zoom,
        }, { duration: 600 });
      } else {
        const lat = teePos ? teePos.lat : hasPin ? hole.centerLat : initialCenter?.lat ?? null;
        const lon = teePos ? teePos.lon : hasPin ? hole.centerLon : initialCenter?.lon ?? null;
        if (lat !== null && lon !== null)
          mapRef.current.animateCamera({ center: { latitude: lat, longitude: lon }, zoom: 16, pitch: 0 }, { duration: 500 });
      }
    } else if (initialCenter) {
      mapRef.current.animateCamera({ center: { latitude: initialCenter.lat, longitude: initialCenter.lon }, zoom: 15, pitch: 0 }, { duration: 400 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIdx, holes.length]);

  // ── Camera: pan to the active tee color when it changes ──────────────────
  useEffect(() => {
    if (!mapRef.current || !hole) return;
    const pos = getTeePos(hole, activeTeeColor);
    if (!pos) return;
    mapRef.current.animateCamera(
      { center: { latitude: pos.lat, longitude: pos.lon }, zoom: 18, pitch: 0 },
      { duration: 450 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeeColor]);

  // ── Flash helper ──────────────────────────────────────────────────────────
  function showFlash(label: string) {
    setFlash(label);
    flashOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(900),
      Animated.timing(flashOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setFlash(null));
  }

  // ── Manual save (from map centre) ────────────────────────────────────────
  async function dotCoord(): Promise<{ lat: number; lon: number } | null> {
    if (!mapRef.current) return null;
    const { width: sw, height: sh } = Dimensions.get('window');
    const c = await mapRef.current.coordinateForPoint({ x: sw / 2, y: sh / 2 });
    return { lat: c.latitude, lon: c.longitude };
  }

  async function saveTee() {
    if (!hole) return;
    const pt = await dotCoord(); if (!pt) return;
    await updateHoleTeeColor(hole.id, activeTeeColor, pt.lat, pt.lon);
    if (activeTeeColor === 'black') await updateHoleTee(hole.id, pt.lat, pt.lon);
    const green = hole.centerLat !== 0 ? { lat: hole.centerLat, lon: hole.centerLon }
                : hole.frontLat  !== 0 ? { lat: hole.frontLat,  lon: hole.frontLon  }
                : null;
    if (green) {
      const estimates = estimateTeePositions(activeTeeColor, pt, green);
      for (const [color, pos] of Object.entries(estimates) as [TeeColor, { lat: number; lon: number }][]) {
        if (!getTeePos(hole, color)) {
          await updateHoleTeeColor(hole.id, color, pos.lat, pos.lon);
          if (color === 'black') await updateHoleTee(hole.id, pos.lat, pos.lon);
        }
      }
    }
    reloadAll(); showFlash(`Tee ${TEE_LABELS[activeTeeColor]} ✓`);
  }

  async function savePin() {
    if (!hole) return;
    const pt = await dotCoord(); if (!pt) return;
    // Save to all three pin fields so the pin works regardless of selected pin colour in rounds
    await updateHolePinColor(hole.id, 'yellow', pt.lat, pt.lon);
    await updateHolePinColor(hole.id, 'red',    pt.lat, pt.lon);
    await updateHolePinColor(hole.id, 'blue',   pt.lat, pt.lon);
    reloadAll(); showFlash('Pin guardado ✓');
  }

  // ── Detect helpers ────────────────────────────────────────────────────────
  function mergeResults(existing: OsmAreaFeature[], incoming: OsmAreaFeature[]): OsmAreaFeature[] {
    const avg = (pts: { lat: number; lon: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    });
    const unique = incoming.filter(nf => {
      const nc = avg(nf.points);
      return !existing.some(ef => {
        if (ef.golfType !== nf.golfType) return false;
        const ec = avg(ef.points);
        return haversineM(nc.lat, nc.lon, ec.lat, ec.lon) < 15;
      });
    });
    return [...existing, ...unique];
  }

  function enterDetect() {
    const anyTee = hole ? getAnyTeePos(hole) : null;
    const center = hole && hole.centerLat !== 0 ? { lat: hole.centerLat, lon: hole.centerLon }
      : anyTee ?? liveCenter;
    setDetectCenter(center ?? null);
    const r = hole && hole.distanceMeters > 0
      ? Math.max(80, Math.min(500, Math.round(hole.distanceMeters * 0.6))) : 200;
    setDetectRadius(r);
    setDetectShape('circle'); setDetectPts([]); setDetectResults([]);
    setShowDetect(true);
  }

  async function runDetect() {
    setDetecting(true);
    try {
      let found: OsmAreaFeature[] = [];
      if (detectShape === 'polygon') {
        if (detectPts.length < 3) { Alert.alert('Dibuja más', 'Necesitas al menos 3 puntos.'); return; }
        found = await fetchOsmFeaturesInPolygon(detectPts);
      } else {
        if (!detectCenter) return;
        found = await fetchOsmFeaturesInArea(detectCenter.lat, detectCenter.lon, detectRadius);
      }
      if (found.length === 0) { Alert.alert('Sin datos', 'No se encontraron elementos.\nAmplía el área o muévela.'); return; }
      setDetectResults(prev => mergeResults(prev, found));
      setDetectPts([]);
    } catch (err) {
      Alert.alert('Error de conexión', String(err));
    } finally { setDetecting(false); }
  }

  async function saveDetected() {
    if (!hole || detectResults.length === 0) return;
    await deleteZonesForHole(hole.id);
    const avg = (pts: { lat: number; lon: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    });
    const greens   = detectResults.filter(f => f.golfType === 'green'        && f.points.length >= 3);
    const fairways = detectResults.filter(f => f.golfType === 'fairway'      && f.points.length >= 3);
    const bunkers  = detectResults.filter(f => f.golfType === 'bunker'       && f.points.length >= 3);
    const waters   = detectResults.filter(f => f.golfType === 'water_hazard' && f.points.length >= 3);
    const tees     = detectResults.filter(f => f.golfType === 'tee');
    const bySize   = (a: OsmAreaFeature, b: OsmAreaFeature) => b.points.length - a.points.length;
    let nG = 0, nT = 0, nF = 0, nB = 0, nW = 0;
    if (greens.length > 0) {
      const g = greens.sort(bySize)[0]; await insertZone(hole.id, 'green', g.points);
      const c = avg(g.points);
      await updateHoleGPS(hole.id, { pinLat: c.lat, pinLon: c.lon, frontLat: c.lat, frontLon: c.lon, centerLat: c.lat, centerLon: c.lon, backLat: c.lat, backLon: c.lon });
      nG++;
    }
    if (fairways.length > 0) { await insertZone(hole.id, 'calle', fairways.sort(bySize)[0].points); nF++; }
    for (const b of bunkers) { await insertZone(hole.id, 'bunker', b.points); nB++; }
    for (const w of waters)  { await insertZone(hole.id, 'agua',   w.points); nW++; }
    if (tees.length > 0) {
      // Use the tee farthest from the green (= championship/black tee)
      const greenCentre = greens.length > 0 ? avg(greens[0].points) : null;
      const teeCentres = tees.map(f => avg(f.points));
      const chosen = greenCentre
        ? teeCentres.reduce((best, t) =>
            haversineM(t.lat, t.lon, greenCentre.lat, greenCentre.lon) >
            haversineM(best.lat, best.lon, greenCentre.lat, greenCentre.lon) ? t : best
          )
        : teeCentres[0];
      // Save as black (championship) tee and estimate the rest
      await updateHoleTeeColor(hole.id, 'black', chosen.lat, chosen.lon);
      await updateHoleTee(hole.id, chosen.lat, chosen.lon);
      const gc = greens.length > 0 ? avg(greens[0].points) : null;
      if (gc) {
        const estimates = estimateTeePositions('black', chosen, gc);
        for (const [color, pos] of Object.entries(estimates) as [TeeColor, { lat: number; lon: number }][]) {
          await updateHoleTeeColor(hole.id, color, pos.lat, pos.lon);
        }
      }
      nT++;
    }
    reloadAll(); setShowDetect(false); setDetectResults([]);
    showFlash(`H${hole.number}: ${nG}g · ${nT}tee · ${nF}c · ${nB}b · ${nW}w`);
  }

  function handleMapPress(e: MapPressEvent) {
    if (!showDetect) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    if (detectShape === 'polygon') setDetectPts(prev => [...prev, { lat: latitude, lon: longitude }]);
    else setDetectCenter({ lat: latitude, lon: longitude });
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const holeZones = zones.filter(z => z.holeId === hole?.id);
  const hasTee = !!hole && getAnyTeePos(hole) !== null;
  const hasPin = !!hole && hole.centerLat !== 0;
  const doneCount = [hasTee, hasPin].filter(Boolean).length;

  const initialRegion = (() => {
    if (initialCenter) return { latitude: initialCenter.lat, longitude: initialCenter.lon, latitudeDelta: 0.015, longitudeDelta: 0.015 };
    return { latitude: 39.5872, longitude: -0.4669, latitudeDelta: 0.015, longitudeDelta: 0.015 };
  })();

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>

        {/* Map */}
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          mapType={'satelliteFlyover' as any}
          initialRegion={initialRegion}
          onPress={handleMapPress}
          onRegionChangeComplete={(r: Region) => setLiveCenter({ lat: r.latitude, lon: r.longitude })}
          showsCompass={false}
          moveOnMarkerPress={false}
        >
          {/* Tee markers for current hole (all set colors) */}
          {hole && TEE_COLORS.map(color => {
            const pos = getTeePos(hole, color);
            if (!pos) return null;
            return (
              <Marker key={`tee-${color}`}
                coordinate={{ latitude: pos.lat, longitude: pos.lon }}
                anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
              >
                <View style={[styles.teeMarker, { backgroundColor: TEE_HEX[color], borderColor: color === activeTeeColor ? '#fff' : 'rgba(255,255,255,0.5)', borderWidth: color === activeTeeColor ? 2.5 : 1.5 }]}>
                  <Text style={styles.teeMarkerTxt}>{TEE_LABELS[color][0]}</Text>
                </View>
              </Marker>
            );
          })}

          {/* Saved zones for current hole */}
          {holeZones.map(z => z.points.length >= 3 && (
            <Polygon key={z.id}
              coordinates={z.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
              fillColor={ZONE_FILL[z.type]} strokeColor="rgba(255,255,255,0.7)" strokeWidth={1}
            />
          ))}

          {/* Detect: circle */}
          {showDetect && detectShape === 'circle' && detectCenter && (
            <>
              <Circle
                center={{ latitude: detectCenter.lat, longitude: detectCenter.lon }}
                radius={detectRadius}
                strokeColor="rgba(155,89,182,0.9)" strokeWidth={2}
                fillColor="rgba(155,89,182,0.12)"
              />
              <Marker
                coordinate={{ latitude: detectCenter.lat, longitude: detectCenter.lon }}
                draggable
                onDragEnd={e => setDetectCenter({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.detectDot} />
              </Marker>
            </>
          )}

          {/* Detect: polygon draw */}
          {showDetect && detectShape === 'polygon' && detectPts.length >= 2 && (
            <Polygon
              coordinates={detectPts.map(p => ({ latitude: p.lat, longitude: p.lon }))}
              fillColor="rgba(155,89,182,0.18)" strokeColor="rgba(155,89,182,0.9)" strokeWidth={2}
            />
          )}
          {showDetect && detectShape === 'polygon' && detectPts.map((p, i) => (
            <Marker key={`dpt-${i}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.detectDot} />
            </Marker>
          ))}

          {/* Detect: results preview */}
          {detectResults.map((feat, i) => feat.points.length >= 3 && (
            <Polygon key={`det-${i}`}
              coordinates={feat.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
              fillColor={
                feat.golfType === 'green'       ? 'rgba(46,204,113,0.6)'  :
                feat.golfType === 'bunker'       ? 'rgba(212,160,23,0.6)'  :
                feat.golfType === 'fairway'      ? 'rgba(39,174,96,0.5)'   :
                feat.golfType === 'water_hazard' ? 'rgba(41,128,185,0.6)'  :
                                                   'rgba(230,126,34,0.5)'
              }
              strokeColor="rgba(255,255,255,0.9)" strokeWidth={2}
            />
          ))}
        </MapView>

        {/* Crosshair dot (hidden in detect mode) */}
        {!showDetect && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={styles.reticleBox}>
                <View style={[styles.rArm, styles.rTop]} />
                <View style={[styles.rArm, styles.rBottom]} />
                <View style={[styles.rArm, styles.rLeft]} />
                <View style={[styles.rArm, styles.rRight]} />
                <View style={styles.rDot} />
              </View>
            </View>
          </View>
        )}

        {/* Flash confirmation */}
        {flash && (
          <Animated.View pointerEvents="none" style={[styles.flashBadge, { opacity: flashOpacity }]}>
            <Text style={styles.flashTxt}>{flash}</Text>
          </Animated.View>
        )}

        {/* ── Top bar ── */}
        {!showDetect && (
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="arrow-down" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.courseName} numberOfLines={1}>{courseName ?? 'Campo'}</Text>
              <Text style={styles.holeLabel}>H{hole?.number ?? '—'} · Par {hole?.par ?? '—'} · {hole?.distanceMeters ?? 0}m</Text>
            </View>
            <View style={styles.progress}>
              <View style={[styles.progressDot, hasTee && styles.progressDotTee]} />
              <View style={[styles.progressDot, hasPin && { backgroundColor: '#d4ac0d' }]} />
            </View>
            <Text style={styles.progressTxt}>{holeIdx + 1}/{holes.length}</Text>
          </View>
        )}

        {/* ── Detect mode UI ── */}
        {showDetect && (
          <>
            {/* Detect header */}
            <View style={styles.detectHeader}>
              <Text style={styles.detectHeaderTxt} numberOfLines={1}>
                H{hole?.number} · {detectResults.length > 0 ? `${detectResults.length} elementos` : 'dibuja el área'}
              </Text>
              <View style={styles.shapeToggle}>
                {(['circle', 'polygon'] as const).map(s => (
                  <TouchableOpacity key={s} style={[styles.shapeBtn, detectShape === s && styles.shapeBtnOn]}
                    onPress={() => { setDetectShape(s); setDetectPts([]); }}>
                    <Ionicons name={s === 'circle' ? 'radio-button-off' : 'shapes-outline'} size={14}
                      color={detectShape === s ? '#6c3483' : '#fff'} />
                    <Text style={[styles.shapeTxt, detectShape === s && { color: '#6c3483' }]}>
                      {s === 'circle' ? 'Círculo' : 'Polígono'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity onPress={() => { setShowDetect(false); setDetectResults([]); setDetectPts([]); }}>
                <Text style={styles.detectCancelTxt}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Detect controls */}
            <View style={styles.detectControls}>
              {detectShape === 'circle' ? (
                <>
                  <TouchableOpacity style={styles.detectSmBtn} onPress={() => setDetectRadius(r => Math.max(50, r - 25))}>
                    <Ionicons name="remove" size={18} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.detectRadTxt}>Radio: {detectRadius}m</Text>
                  <TouchableOpacity style={styles.detectSmBtn} onPress={() => setDetectRadius(r => Math.min(600, r + 25))}>
                    <Ionicons name="add" size={18} color="#fff" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.detectRadTxt}>{detectPts.length} puntos · toca el mapa</Text>
                  <TouchableOpacity style={styles.detectSmBtn} onPress={() => setDetectPts(p => p.slice(0, -1))} disabled={detectPts.length === 0}>
                    <Ionicons name="arrow-undo" size={16} color={detectPts.length === 0 ? 'rgba(255,255,255,0.3)' : '#fff'} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.detectSmBtn} onPress={() => setDetectPts([])} disabled={detectPts.length === 0}>
                    <Ionicons name="trash-outline" size={16} color={detectPts.length === 0 ? 'rgba(255,255,255,0.3)' : '#fff'} />
                  </TouchableOpacity>
                </>
              )}
              <View style={{ flex: 1 }} />
              {detectResults.length > 0 && (
                <TouchableOpacity style={styles.detectActionBtn} onPress={() => setDetectResults([])}>
                  <Text style={styles.detectActionTxt}>Limpiar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.detectActionBtn, styles.detectSearchBtn]}
                onPress={runDetect}
                disabled={detecting || (detectShape === 'circle' ? !detectCenter : detectPts.length < 3)}
              >
                {detecting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Ionicons name="search" size={14} color="#fff" /><Text style={styles.detectActionTxt}>{detectResults.length > 0 ? 'Añadir más' : 'Buscar'}</Text></>}
              </TouchableOpacity>
              {detectResults.length > 0 && (
                <TouchableOpacity style={[styles.detectActionBtn, styles.detectSaveBtn]} onPress={saveDetected}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                  <Text style={styles.detectActionTxt}>Guardar ({detectResults.length})</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* ── Bottom panel (normal mode) ── */}
        {!showDetect && (
          <View style={styles.bottomPanel}>
            {/* Hole navigation */}
            <View style={styles.navRow}>
              <TouchableOpacity style={[styles.navBtn, holeIdx === 0 && styles.navBtnDisabled]}
                onPress={() => setHoleIdx(i => Math.max(0, i - 1))} disabled={holeIdx === 0}>
                <Ionicons name="chevron-back" size={22} color={holeIdx === 0 ? COLORS.textTertiary : COLORS.textPrimary} />
                <Text style={[styles.navTxt, holeIdx === 0 && { color: COLORS.textTertiary }]}>Anterior</Text>
              </TouchableOpacity>
              <View style={styles.navCenter}>
                <Text style={styles.navHoleNum}>{hole?.number ?? '—'}</Text>
                <Text style={styles.navSaved}>{doneCount}/2 guardados</Text>
              </View>
              <TouchableOpacity style={[styles.navBtn, styles.navBtnRight, holeIdx === holes.length - 1 && styles.navBtnDisabled]}
                onPress={() => setHoleIdx(i => Math.min(holes.length - 1, i + 1))} disabled={holeIdx === holes.length - 1}>
                <Text style={[styles.navTxt, holeIdx === holes.length - 1 && { color: COLORS.textTertiary }]}>Siguiente</Text>
                <Ionicons name="chevron-forward" size={22} color={holeIdx === holes.length - 1 ? COLORS.textTertiary : COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Tee color selector */}
            <View style={styles.teeColorRow}>
              {TEE_COLORS.map(color => {
                const isSet    = !!hole && getTeePos(hole, color) !== null;
                const isActive = color === activeTeeColor;
                return (
                  <TouchableOpacity
                    key={color}
                    style={[styles.teeColorPill, { borderColor: TEE_HEX[color] }, isActive && { backgroundColor: TEE_HEX[color] }]}
                    onPress={() => setActiveTeeColor(color)}
                  >
                    {isSet && <View style={[styles.teeColorDot, { backgroundColor: isActive ? '#fff' : TEE_HEX[color] }]} />}
                    <Text style={[styles.teeColorTxt, { color: isActive ? '#fff' : TEE_HEX[color] }]} numberOfLines={1}>
                      {TEE_LABELS[color]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Detect + save buttons */}
            <View style={styles.saveRow}>
              <TouchableOpacity style={styles.detectModeBtn} onPress={enterDetect}>
                <Ionicons name="search" size={16} color="#fff" />
                <Text style={styles.detectModeBtnTxt}>Detectar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { borderColor: TEE_HEX[activeTeeColor], flex: 2 }]} onPress={saveTee}>
                <View style={[styles.saveDot, hasTee && { backgroundColor: TEE_HEX[activeTeeColor] }]} />
                <Text style={[styles.saveBtnTxt, { color: TEE_HEX[activeTeeColor] }]}>
                  {TEE_LABELS[activeTeeColor]}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { borderColor: '#d4ac0d', flex: 2 }]} onPress={savePin}>
                <View style={[styles.saveDot, hasPin && { backgroundColor: '#d4ac0d' }]} />
                <Text style={[styles.saveBtnTxt, { color: '#d4ac0d' }]}>Pin</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Crosshair ─────────────────────────────────────────────────────────────
  reticleBox: { width: 70, height: 70, alignItems: 'center', justifyContent: 'center' },
  rArm:    { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.9)' },
  rTop:    { width: 2, height: 22, top: 0,    left: 34 },
  rBottom: { width: 2, height: 22, bottom: 0, left: 34 },
  rLeft:   { height: 2, width: 22, left: 0,   top: 34 },
  rRight:  { height: 2, width: 22, right: 0,  top: 34 },
  rDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(0,0,0,0.35)' },

  // ── Flash ─────────────────────────────────────────────────────────────────
  flashBadge: {
    position: 'absolute', top: '50%', alignSelf: 'center', marginTop: 52,
    backgroundColor: 'rgba(26,71,42,0.92)', borderRadius: 22,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  flashTxt: { color: '#fff', fontSize: 15, fontFamily: FONT.bodySemiBold },

  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingTop: 54, paddingBottom: 12, paddingHorizontal: 14,
  },
  closeBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  courseName: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: '#fff' },
  holeLabel:  { fontSize: 11, fontFamily: FONT.body, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  progress:   { flexDirection: 'row', gap: 4 },
  progressDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)' },
  progressDotTee: { backgroundColor: COLORS.warning },
  progressTxt: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: FONT.bodySemiBold, minWidth: 30, textAlign: 'right' },

  // ── Detect UI ─────────────────────────────────────────────────────────────
  detectHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#6c3483', paddingTop: 54, paddingBottom: 10, paddingHorizontal: 14,
  },
  detectHeaderTxt: { fontSize: 13, color: '#fff', fontFamily: FONT.bodyMedium, flex: 1 },
  shapeToggle: { flexDirection: 'row', gap: 6 },
  shapeBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
  shapeBtnOn:  { backgroundColor: '#e8d5f5' },
  shapeTxt:    { fontSize: 12, fontFamily: FONT.bodySemiBold, color: '#fff' },
  detectCancelTxt: { fontSize: 14, color: '#e8d5f5', fontFamily: FONT.bodySemiBold, paddingLeft: 12 },
  detectControls: {
    position: 'absolute', top: 110, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#4a235a', paddingHorizontal: 12, paddingVertical: 8,
  },
  detectSmBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  detectRadTxt: { fontSize: 13, color: '#e8d5f5', fontFamily: FONT.bodySemiBold },
  detectActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.18)' },
  detectSearchBtn: { backgroundColor: 'rgba(255,255,255,0.22)' },
  detectSaveBtn:   { backgroundColor: COLORS.success },
  detectActionTxt: { fontSize: 12, color: '#fff', fontFamily: FONT.bodySemiBold },
  detectDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(155,89,182,0.9)', borderWidth: 2, borderColor: '#fff' },

  // ── Bottom panel ──────────────────────────────────────────────────────────
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.card,
    paddingBottom: 34, paddingTop: 12, paddingHorizontal: 14,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    shadowColor: COLORS.shadow, shadowOpacity: 0.15, shadowRadius: 10, elevation: 8,
    gap: 10,
  },
  navRow:        { flexDirection: 'row', alignItems: 'center' },
  navBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  navBtnRight:   { justifyContent: 'flex-end' },
  navBtnDisabled:{ opacity: 0.4 },
  navTxt:        { fontSize: 14, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary },
  navCenter:     { flex: 1, alignItems: 'center' },
  navHoleNum:    { fontSize: 26, fontFamily: FONT.headingExtraBold, color: COLORS.primary },
  navSaved:      { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: -2 },

  saveRow: { flexDirection: 'row', gap: 6 },
  detectModeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#6c3483', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 10,
  },
  detectModeBtnTxt: { color: '#fff', fontSize: 12, fontFamily: FONT.bodySemiBold },
  saveBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3,
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 2, backgroundColor: '#f8f9fa',
  },
  saveDot:    { width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.12)' },
  saveBtnTxt: { fontSize: 11, fontFamily: FONT.bodySemiBold },

  // ── Tee color selector ────────────────────────────────────────────────────
  teeColorRow: { flexDirection: 'row', gap: 4 },
  teeColorPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    paddingVertical: 5, paddingHorizontal: 3, borderRadius: 8, borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  teeColorDot: { width: 6, height: 6, borderRadius: 3 },
  teeColorTxt: { fontSize: 9, fontFamily: FONT.bodySemiBold },

  // ── Tee map markers ───────────────────────────────────────────────────────
  teeMarker: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2, elevation: 3,
  },
  teeMarkerTxt: { fontSize: 10, fontFamily: FONT.headingExtraBold, color: '#fff' },
});
