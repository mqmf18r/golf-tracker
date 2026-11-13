import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import MapView, {
  Marker, Polygon, Polyline, Circle,
  MapPressEvent, MarkerDragStartEndEvent, Region,
} from 'react-native-maps';
import {
  getShotMeasurements, insertShotMeasurement, deleteShotMeasurement, getZonesForHole, getCourseHazards,
  updateShotPosition, updateShotDistance, updateHolePinColor, updateHoleTeeColor, updateShotType, updateShotClub, updateShotAim,
  getTeePos, getClubProfiles, ClubProfile,
} from '../lib/api';
import { Hole, ShotMeasurement, CourseZone, ZoneType, CourseHazard, TeeColor } from '../types';
import {
  haversineM, detectZone, midpoint, distanceToPolygonM, ZONE_LABELS, bearing,
} from '../services/geo';
import { useLocation } from '../services/location';
import { fetchWind, WindData, degToCompass, windArrowDeg } from '../services/weather';
import { recommendClubRange, ClubRecommendation } from '../services/clubRecommendation';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT } from '../theme';

const CLUBS = ['D', '3W', '5W', '4H', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'P'];

const ZONES: { key: Exclude<import('../types').ShotZone, '' | 'tee'>; label: string; color: string }[] = [
  { key: 'calle',  label: 'Calle',  color: '#27ae60' },
  { key: 'rough',  label: 'Rough',  color: '#7f8c4f' },
  { key: 'bunker', label: 'Búnker', color: '#d4a017' },
  { key: 'green',  label: 'Green',  color: '#2ecc71' },
  { key: 'agua',   label: 'Agua',   color: '#2980b9' },
];

const ZONE_FILL: Record<ZoneType, string> = {
  green:  'rgba(46,204,113,0.45)',
  calle:  'rgba(39,174,96,0.30)',
  bunker: 'rgba(212,160,23,0.45)',
  agua:   'rgba(41,128,185,0.45)',
};

const PIN_COORDS: Record<'red' | 'yellow' | 'blue', (h: Hole) => { lat: number; lon: number }> = {
  red:    h => ({ lat: h.frontLat,  lon: h.frontLon  }),
  yellow: h => ({ lat: h.centerLat, lon: h.centerLon }),
  blue:   h => ({ lat: h.backLat,   lon: h.backLon   }),
};
const PIN_NATIVE: Record<string, string> = { red: 'red', yellow: 'yellow', blue: 'blue' };

const TEE_RADII  = [40, 50, 60, 70] as const;
const APPR_RADII = [8, 10, 12, 14]  as const;

interface Props {
  visible: boolean;
  hole: Hole;
  holeNumber: number;
  holeScoreId: string;
  pinColor: 'red' | 'yellow' | 'blue';
  teeColor?: TeeColor;
  pinOverride?: { lat: number; lon: number } | null;
  teeOverride?: { lat: number; lon: number } | null;
  onClose: () => void;
  onPinMoved?: (pos: { lat: number; lon: number }) => void;
  onTeeMoved?: (pos: { lat: number; lon: number }) => void;
}

export function ShotMapModal({
  visible, hole, holeNumber, holeScoreId, pinColor, teeColor = 'yellow',
  pinOverride, teeOverride, onClose, onPinMoved, onTeeMoved,
}: Props) {
  const mapRef      = useRef<MapView>(null);
  const mapReadyRef = useRef(false);
  const { location, permission } = useLocation();

  // ── Core shot state ────────────────────────────────────────────────────────
  const [shots,    setShots]   = useState<ShotMeasurement[]>([]);
  const [zones,    setZones]   = useState<CourseZone[]>([]);
  const [courseHazards, setCourseHazards] = useState<CourseHazard[]>([]);
  const [pending,  setPending] = useState<{ lat: number; lon: number } | null>(null);
  const [club,     setClub]    = useState('');
  const [shotType, setShotType] = useState<'normal' | 'punch' | 'poor'>('normal');
  const [zone,     setZone]    = useState<string>('');
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);

  // ── Placement modes ───────────────────────────────────────────────────────
  const [placing,      setPlacing]      = useState<'none' | 'pin' | 'tee'>('none');
  const [localPinPos,  setLocalPinPos]  = useState<{ lat: number; lon: number } | null>(null);
  const [localTeePos,  setLocalTeePos]  = useState<{ lat: number; lon: number } | null>(null);
  const [mapLayout,    setMapLayout]    = useState({ width: 300, height: 500 });

  // ── Other feature state ────────────────────────────────────────────────────
  // Accuracy circles
  const [circleMode,   setCircleMode]   = useState<'none' | 'tee' | 'appr'>('none');
  const [circleCenter, setCircleCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [teeRadius,    setTeeRadius]    = useState<typeof TEE_RADII[number]>(50);
  const [apprRadius,   setApprRadius]   = useState<typeof APPR_RADII[number]>(10);
  // 3D perspective toggle
  const [is3D, setIs3D] = useState(false);
  // Selected existing shot for editing
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  // Aim direction for current pending shot
  const [aimPoint, setAimPoint]     = useState<{ lat: number; lon: number } | null>(null);
  const [aimPlacing, setAimPlacing] = useState(false);
  // Aim editing for an already-saved shot
  const [editAimPlacing, setEditAimPlacing] = useState(false);
  // Wind data
  const [wind, setWind] = useState<WindData | null>(null);
  const [windLoading, setWindLoading] = useState(false);
  // Club recommendation
  const [clubProfiles, setClubProfiles] = useState<ClubProfile[]>([]);

  useEffect(() => {
    if (visible) getClubProfiles().then(setClubProfiles).catch(() => {});
  }, [visible]);

  const pin    = localPinPos ?? PIN_COORDS[pinColor](hole);
  const hasPin = pin.lat !== 0;
  const teePos = localTeePos ?? (getTeePos(hole, teeColor) ?? null);
  const hasTee = teePos !== null;

  useEffect(() => {
    if (!visible) return;
    // Clear immediately so stale data from the previous hole doesn't show
    setShots([]); setZones([]); setCourseHazards([]);
    let mounted = true;
    (async () => {
      const [shots, zones, hazards] = await Promise.all([
        getShotMeasurements(holeScoreId),
        getZonesForHole(hole.id),
        getCourseHazards(hole.courseId),
      ]);
      if (!mounted) return;
      setShots(shots);
      setZones(zones);
      setCourseHazards(hazards);
    })();
    setPending(null); setClub(''); setZone(''); setShowZonePicker(false); setShotType('normal');
    setPlacing('none');
    setLocalPinPos(pinOverride ?? null);
    setLocalTeePos(teeOverride ?? null);
    setCircleMode('none'); setCircleCenter(null); setIs3D(false);
    setSelectedShotId(null);
    setAimPoint(null); setAimPlacing(false); setEditAimPlacing(false);
      // Fetch wind for the hole (tee → pin → skip)
      const wLat = hasTee ? teePos!.lat : hasPin ? pin.lat : 0;
      const wLon = hasTee ? teePos!.lon : hasPin ? pin.lon : 0;
      if (wLat !== 0) {
        setWindLoading(true);
        fetchWind(wLat, wLon).then(w => { setWind(w); setWindLoading(false); });
      }
      if (hasTee) setMapCenter({ lat: teePos!.lat, lon: teePos!.lon });
      else if (hasPin) setMapCenter({ lat: pin.lat, lon: pin.lon });
      else setMapCenter(null);
    // Focus only if map is already mounted; if not, onMapReady handles it
    if (mapReadyRef.current) focusHole();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, holeScoreId, hole.id]);

  const prevPos = shots.length > 0
    ? { lat: shots[shots.length - 1].lat, lon: shots[shots.length - 1].lon }
    : hasTee ? { lat: teePos!.lat, lon: teePos!.lon }
    : hasPin ? pin : null;

  const region = useMemo(() => {
    const pts: { lat: number; lon: number }[] = [];
    if (hasTee) pts.push({ lat: teePos!.lat, lon: teePos!.lon });
    if (hasPin) pts.push(pin);
    shots.forEach(s => { if (s.lat !== 0) pts.push({ lat: s.lat, lon: s.lon }); });
    if (pts.length === 0) return { latitude: 39.5872, longitude: -0.4669, latitudeDelta: 0.004, longitudeDelta: 0.004 };
    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    return {
      latitude:  (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta:  Math.max(maxLat - minLat, 0.002) * 1.4,
      longitudeDelta: Math.max(maxLon - minLon, 0.002) * 1.4,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hole.id]);

  // ── Camera helpers ─────────────────────────────────────────────────────────
  function focusHole() {
    if (hasTee && hasPin) {
      const tee = teePos!;
      const dist = haversineM(tee.lat, tee.lon, pin.lat, pin.lon) || 130;
      const zoom = Math.max(14.5, Math.min(17, 16 - Math.log2(dist / 130)));
      mapRef.current?.animateCamera({
        center: { latitude: (tee.lat + pin.lat) / 2, longitude: (tee.lon + pin.lon) / 2 },
        heading: bearing(tee, pin),
        pitch: 0,
        zoom,
      }, { duration: 650 });
    } else {
      mapRef.current?.animateToRegion(region, 650);
    }
  }

  function toggle3D() {
    const next = !is3D;
    setIs3D(next);
    if (next && hasTee && hasPin) {
      const tee = teePos!;
      const d = haversineM(tee.lat, tee.lon, pin.lat, pin.lon) || 130;
      const zoom = Math.max(13, Math.min(17, 15 - Math.log2(d / 130)));
      mapRef.current?.animateCamera({
        center: {
          latitude:  tee.lat + (pin.lat - tee.lat) * 0.3,
          longitude: tee.lon + (pin.lon - tee.lon) * 0.3,
        },
        heading: bearing(tee, pin),
        pitch: 55,
        zoom,
      }, { duration: 900 });
    } else {
      focusHole();
    }
  }

  // ── Quick pin placement ────────────────────────────────────────────────────
// ── Accuracy circles ───────────────────────────────────────────────────────
  function toggleCircle(m: 'tee' | 'appr') {
    if (circleMode === m) { setCircleMode('none'); setCircleCenter(null); return; }
    setCircleMode(m);
    if (m === 'tee') setCircleCenter(prevPos ?? (hasPin ? pin : null));
    else             setCircleCenter(hasPin ? pin : prevPos ?? null);
  }

  // ── Map interaction ────────────────────────────────────────────────────────
  async function handlePress(e: MapPressEvent) {
    const coord = e.nativeEvent?.coordinate;
    if (!coord) return;
    const { latitude, longitude } = coord;
    if (aimPlacing) {
      setAimPoint({ lat: latitude, lon: longitude });
      setAimPlacing(false);
      return;
    }
    if (editAimPlacing && selectedShotId) {
      await updateShotAim(selectedShotId, latitude, longitude);
      setShots(await getShotMeasurements(holeScoreId));
      setEditAimPlacing(false);
      return;
    }
    setSelectedShotId(null);
    if (circleMode !== 'none') {
      setCircleCenter({ lat: latitude, lon: longitude });
      return;
    }
  }

  async function dotCoord(): Promise<{ lat: number; lon: number } | null> {
    if (!mapRef.current) return null;
    const c = await mapRef.current.coordinateForPoint({
      x: mapLayout.width / 2,
      y: mapLayout.height / 2,
    });
    return { lat: c.latitude, lon: c.longitude };
  }

  function enterPlacing(mode: 'pin' | 'tee') {
    setPending(null); setSelectedShotId(null); setEditAimPlacing(false);
    setPlacing(mode);
  }

  async function confirmPlacement() {
    const pt = await dotCoord();
    if (!pt) return;
    if (placing === 'pin') {
      setLocalPinPos(pt);
      onPinMoved?.(pt);
    } else if (placing === 'tee') {
      setLocalTeePos(pt);
      onTeeMoved?.(pt);
    }
    setPlacing('none');
  }

  async function placeAtCenter() {
    const pt = await dotCoord();
    if (!pt) return;
    setSelectedShotId(null); setEditAimPlacing(false);
    setPending(pt);
    setClub('');
    setZone(detectZone(pt, zones));
    setShowZonePicker(false);
  }

  function captureGPS() {
    if (!permission || !location) {
      Alert.alert('GPS no disponible', 'Activa la ubicación para marcar tu posición real.');
      return;
    }
    const lat = location.coords.latitude, lon = location.coords.longitude;
    setSelectedShotId(null);
    setPending({ lat, lon });
    setClub('');
    setZone(detectZone({ lat, lon }, zones));
    setShowZonePicker(false);
    mapRef.current?.animateCamera({ center: { latitude: lat, longitude: lon }, zoom: 17 }, { duration: 450 });
  }

async function recomputeDistances() {
    const list = await getShotMeasurements(holeScoreId);
    let prev = hasTee ? teePos! : hasPin ? pin : null;
    for (const s of list) {
      const d = prev ? haversineM(prev.lat, prev.lon, s.lat, s.lon) : 0;
      if (d !== s.distanceMeters) await updateShotDistance(s.id, d);
      prev = { lat: s.lat, lon: s.lon };
    }
    setShots(await getShotMeasurements(holeScoreId));
  }

  async function saveShot() {
    if (!pending) return;
    if (!club) { Alert.alert('Falta el palo', 'Selecciona con qué palo golpeaste.'); return; }
    const dist = prevPos ? haversineM(prevPos.lat, prevPos.lon, pending.lat, pending.lon) : 0;
    await insertShotMeasurement(holeScoreId, dist, {
      lat: pending.lat, lon: pending.lon, club, zone, shotType,
      aimLat: aimPoint?.lat ?? 0, aimLon: aimPoint?.lon ?? 0,
      originLat: prevPos?.lat ?? 0, originLon: prevPos?.lon ?? 0,
      windSpeed: wind?.speed ?? 0, windDir: wind?.direction ?? 0, windGusts: wind?.gusts ?? 0,
    });
    setShots(await getShotMeasurements(holeScoreId));
    setPending(null); setClub(''); setZone(''); setShowZonePicker(false); setShotType('normal');
    setAimPoint(null); setAimPlacing(false);
  }

  function onPendingDrag(e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPending({ lat: latitude, lon: longitude });
    setZone(detectZone({ lat: latitude, lon: longitude }, zones));
    setShowZonePicker(false);
  }

  async function onShotDragEnd(id: string, e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    await updateShotPosition(id, latitude, longitude);
    recomputeDistances();
  }

  function deleteShot(id: string) {
    Alert.alert('Eliminar golpe', '¿Borrar este golpe?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteShotMeasurement(id); recomputeDistances(); } },
    ]);
  }

  function cancelPending() {
    setPending(null); setClub(''); setZone(''); setShowZonePicker(false); setShotType('normal');
    setAimPoint(null); setAimPlacing(false);
  }

  // ── Aim lateral deviation ─────────────────────────────────────────────────
  function lateralDeviation(origin: { lat: number; lon: number }, aim: { lat: number; lon: number }, landing: { lat: number; lon: number }): { meters: number; side: 'L' | 'R' | 'center' } | null {
    const cosLat = Math.cos(origin.lat * Math.PI / 180);
    const kLon = 111320 * cosLat, kLat = 110540;
    const oaX = (aim.lon - origin.lon) * kLon, oaY = (aim.lat - origin.lat) * kLat;
    const olX = (landing.lon - origin.lon) * kLon, olY = (landing.lat - origin.lat) * kLat;
    const lenOA = Math.sqrt(oaX * oaX + oaY * oaY);
    if (lenOA < 1) return null;
    const cross = oaX * olY - oaY * olX;
    const meters = Math.round(Math.abs(cross) / lenOA);
    const side: 'L' | 'R' | 'center' = meters < 1 ? 'center' : cross > 0 ? 'L' : 'R';
    return { meters, side };
  }

  // ── Computed values ────────────────────────────────────────────────────────
  const pendingDist    = pending && prevPos ? haversineM(prevPos.lat, prevPos.lon, pending.lat, pending.lon) : null;
  const distToPin      = pending && hasPin  ? haversineM(pending.lat, pending.lon, pin.lat, pin.lon) : null;
  const pendingLateral = pending && prevPos && aimPoint ? lateralDeviation(prevPos, aimPoint, pending) : null;

  // Aim segments for already-saved shots that have aim data
  const aimSegments = useMemo(() => {
    const segs: { origin: { lat: number; lon: number }; aim: { lat: number; lon: number } }[] = [];
    const vs = shots.filter(s => s.lat !== 0);
    let prev: { lat: number; lon: number } | null = hasTee ? teePos! : null;
    for (const s of vs) {
      if (prev && s.aimLat && s.aimLon && (s.aimLat !== 0 || s.aimLon !== 0)) {
        segs.push({ origin: prev, aim: { lat: s.aimLat, lon: s.aimLon } });
      }
      prev = { lat: s.lat, lon: s.lon };
    }
    return segs;
  }, [shots, hasTee, teePos?.lat, teePos?.lon]);
  const crosshairDist  = !pending && mapCenter && prevPos ? haversineM(prevPos.lat, prevPos.lon, mapCenter.lat, mapCenter.lon) : null;
  const crosshairToPin = !pending && mapCenter && hasPin  ? haversineM(mapCenter.lat, mapCenter.lon, pin.lat, pin.lon) : null;
  // Recommended club for the shot about to be hit — driven by the crosshair's
  // live distance-to-pin (same value already shown as "Xm pin" below), so it
  // updates automatically as the crosshair follows the player's real GPS
  // position (or as they pan/aim manually).
  const clubRange = useMemo(
    () => (crosshairToPin !== null ? recommendClubRange(crosshairToPin, clubProfiles) : null),
    [crosshairToPin, clubProfiles],
  );

  const shotSegments = useMemo(() => {
    const segs: { from: { lat: number; lon: number }; to: { lat: number; lon: number }; dist: number }[] = [];
    const vs = shots.filter(s => s.lat !== 0);
    if (hasTee && vs.length > 0) segs.push({ from: teePos!, to: { lat: vs[0].lat, lon: vs[0].lon }, dist: vs[0].distanceMeters });
    for (let i = 0; i < vs.length - 1; i++) segs.push({ from: { lat: vs[i].lat, lon: vs[i].lon }, to: { lat: vs[i + 1].lat, lon: vs[i + 1].lon }, dist: vs[i + 1].distanceMeters });
    return segs;
  }, [shots, hasTee, teePos?.lat, teePos?.lon]);

  const lastShot = shots.filter(s => s.lat !== 0).slice(-1)[0] ?? null;
  const toPin = lastShot && hasPin ? {
    from: { lat: lastShot.lat, lon: lastShot.lon }, to: pin,
    dist: haversineM(lastShot.lat, lastShot.lon, pin.lat, pin.lon),
  } : null;

  const zoneColor = ZONES.find(z => z.key === zone)?.color ?? '#8e9aaf';
  const showCrosshair = !pending;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Ionicons name="chevron-down" size={26} color={COLORS.textOnPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Hoyo {holeNumber} · Par {hole.par}</Text>
            <Text style={styles.headerSub}>
              {shots.length} {shots.length === 1 ? 'golpe' : 'golpes'}
              {hasPin ? ` · bandera ${pinColor}` : ''}
            </Text>
          </View>

          {/* 3D toggle */}
          <TouchableOpacity style={[styles.iconBtn, is3D && styles.iconBtnOn]} onPress={toggle3D}>
            <Ionicons name="cube-outline" size={17} color={is3D ? COLORS.primary : COLORS.textOnPrimary} />
          </TouchableOpacity>

          {/* Move pin */}
          <TouchableOpacity
            style={[styles.iconBtn, placing === 'pin' && styles.iconBtnOn]}
            onPress={() => placing === 'pin' ? setPlacing('none') : enterPlacing('pin')}
          >
            <Ionicons name="flag" size={17} color={placing === 'pin' ? COLORS.primary : COLORS.textOnPrimary} />
          </TouchableOpacity>

          {/* Move tee */}
          <TouchableOpacity
            style={[styles.iconBtn, placing === 'tee' && styles.iconBtnOn]}
            onPress={() => placing === 'tee' ? setPlacing('none') : enterPlacing('tee')}
          >
            <Ionicons name="golf" size={17} color={placing === 'tee' ? COLORS.primary : COLORS.textOnPrimary} />
          </TouchableOpacity>

          {/* Wind badge */}
          {(wind || windLoading) && (
            <TouchableOpacity
              style={styles.windBadge}
              onPress={() => {
                const wLat = hasTee ? teePos!.lat : hasPin ? pin.lat : 0;
                const wLon = hasTee ? teePos!.lon : hasPin ? pin.lon : 0;
                if (wLat !== 0) { setWindLoading(true); fetchWind(wLat, wLon).then(w => { setWind(w); setWindLoading(false); }); }
              }}
            >
              {windLoading ? (
                <Text style={styles.windTxt}>…</Text>
              ) : wind ? (
                <>
                  <Ionicons
                    name="arrow-forward"
                    size={13} color={COLORS.textOnPrimary}
                    style={{ transform: [{ rotate: windArrowDeg(wind.direction) }] }}
                  />
                  <Text style={styles.windTxt}>{wind.speed}</Text>
                  <Text style={styles.windUnit}>km/h {wind.compass}</Text>
                </>
              ) : null}
            </TouchableOpacity>
          )}

        </View>

        {/* ── Map ── */}
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            mapType={'satelliteFlyover' as any}
            initialRegion={region}
            onLayout={(e) => setMapLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            onMapReady={() => { mapReadyRef.current = true; if (visible) focusHole(); }}
            onPress={handlePress}
            onRegionChange={(r: Region) => setMapCenter({ lat: r.latitude, lon: r.longitude })}
            moveOnMarkerPress={false}
            showsUserLocation
            showsCompass={false}
            maxZoomLevel={22}
          >
            {/* Zone polygons */}
            {zones.map(z => z.points.length >= 3 && (
              <Polygon key={z.id}
                coordinates={z.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={ZONE_FILL[z.type]} strokeColor="rgba(255,255,255,0.5)" strokeWidth={1}
              />
            ))}
            {/* Course-wide hazards */}
            {courseHazards.map(h => h.points.length >= 3 && (
              <Polygon key={h.id}
                coordinates={h.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={h.type === 'agua' ? 'rgba(41,128,185,0.40)' : 'transparent'}
                strokeColor={h.type === 'agua' ? 'rgba(41,128,185,0.90)' : 'rgba(220,38,38,1)'}
                strokeWidth={h.type === 'ob' ? 3.5 : 2}
              />
            ))}

            {/* Tee & pin markers */}
            {hasTee && <Marker coordinate={{ latitude: teePos!.lat, longitude: teePos!.lon }} title="Tee" pinColor="orange" anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} />}
            {hasPin  && <Marker coordinate={{ latitude: pin.lat, longitude: pin.lon }} title="Pin" pinColor={PIN_NATIVE[pinColor]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} />}

            {/* Shot path lines */}
            {shotSegments.map((seg, i) => (
              <Polyline key={`seg-${i}`}
                coordinates={[{ latitude: seg.from.lat, longitude: seg.from.lon }, { latitude: seg.to.lat, longitude: seg.to.lon }]}
                strokeColor="rgba(255,255,255,0.8)" strokeWidth={2}
              />
            ))}
            {toPin && (
              <Polyline
                coordinates={[{ latitude: toPin.from.lat, longitude: toPin.from.lon }, { latitude: toPin.to.lat, longitude: toPin.to.lon }]}
                strokeColor="rgba(255,210,0,0.85)" strokeWidth={2} lineDashPattern={[6, 5]}
              />
            )}

            {/* Distance labels at segment midpoints */}
            {shotSegments.map((seg, i) => {
              const mid = midpoint(seg.from, seg.to);
              return (
                <Marker key={`lbl-${i}`} coordinate={{ latitude: mid.lat, longitude: mid.lon }}
                  anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
                  <View style={styles.distLabel}><Text style={styles.distLabelTxt}>{seg.dist}m</Text></View>
                </Marker>
              );
            })}
            {toPin && (() => {
              const mid = midpoint(toPin.from, toPin.to);
              return (
                <Marker coordinate={{ latitude: mid.lat, longitude: mid.lon }}
                  anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
                  <View style={[styles.distLabel, styles.distLabelPin]}>
                    <Text style={[styles.distLabelTxt, { color: '#ffe066' }]}>{toPin.dist}m</Text>
                  </View>
                </Marker>
              );
            })()}

            {/* Shot markers */}
            {shots.map((s, i) => (
              <Marker key={s.id}
                coordinate={{ latitude: s.lat, longitude: s.lon }}
                title={`Golpe ${i + 1}${s.club ? ` · ${s.club}` : ''}`}
                draggable onDragEnd={(e) => onShotDragEnd(s.id, e)} anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => { setPending(null); setEditAimPlacing(false); setSelectedShotId(p => p === s.id ? null : s.id); }}>
                <View style={[styles.shotPin, selectedShotId === s.id && styles.shotPinSelected]}>
                  <Text style={styles.shotPinTxt}>{i + 1}</Text>
                </View>
              </Marker>
            ))}

            {/* Pending marker */}
            {pending && (
              <Marker coordinate={{ latitude: pending.lat, longitude: pending.lon }}
                draggable onDragEnd={onPendingDrag} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.pendingPin}><Ionicons name="golf" size={16} color={COLORS.textOnPrimary} /></View>
              </Marker>
            )}

            {/* ── Aim direction lines for saved shots ── */}
            {aimSegments.map((seg, i) => (
              <Polyline key={`aim-${i}`}
                coordinates={[{ latitude: seg.origin.lat, longitude: seg.origin.lon }, { latitude: seg.aim.lat, longitude: seg.aim.lon }]}
                strokeColor="rgba(41,182,246,0.75)" strokeWidth={2} lineDashPattern={[8, 5]}
              />
            ))}
            {aimSegments.map((seg, i) => (
              <Marker key={`aimdot-${i}`} coordinate={{ latitude: seg.aim.lat, longitude: seg.aim.lon }}
                anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
                <View style={styles.aimDot} />
              </Marker>
            ))}

            {/* ── Preview aim line while editing aim for existing shot ── */}
            {editAimPlacing && selectedShotId && mapCenter && (() => {
              const sel = shots.find(s => s.id === selectedShotId);
              if (!sel) return null;
              const origin = (sel.originLat && sel.originLat !== 0)
                ? { lat: sel.originLat, lon: sel.originLon! }
                : { lat: sel.lat, lon: sel.lon };
              return (
                <Polyline
                  coordinates={[{ latitude: origin.lat, longitude: origin.lon }, { latitude: mapCenter.lat, longitude: mapCenter.lon }]}
                  strokeColor="rgba(41,182,246,0.80)" strokeWidth={2.5} lineDashPattern={[10, 6]}
                />
              );
            })()}

            {/* ── Pending aim direction ── */}
            {pending && prevPos && aimPoint && (
              <>
                <Polyline
                  coordinates={[{ latitude: prevPos.lat, longitude: prevPos.lon }, { latitude: aimPoint.lat, longitude: aimPoint.lon }]}
                  strokeColor="rgba(41,182,246,0.9)" strokeWidth={2.5} lineDashPattern={[10, 6]}
                />
                <Marker coordinate={{ latitude: aimPoint.lat, longitude: aimPoint.lon }}
                  draggable onDragEnd={e => setAimPoint({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
                  anchor={{ x: 0.5, y: 0.5 }}>
                  <View style={styles.aimMarker} />
                </Marker>
              </>
            )}


            {/* ── Accuracy circles ── */}
            {circleMode !== 'none' && circleCenter && (
              <>
                <Circle
                  center={{ latitude: circleCenter.lat, longitude: circleCenter.lon }}
                  radius={circleMode === 'tee' ? teeRadius : apprRadius}
                  strokeColor={circleMode === 'tee' ? 'rgba(230,126,34,0.9)' : 'rgba(46,204,113,0.9)'}
                  strokeWidth={2}
                  fillColor={circleMode === 'tee' ? 'rgba(230,126,34,0.08)' : 'rgba(46,204,113,0.08)'}
                />
                <Marker
                  coordinate={{ latitude: circleCenter.lat, longitude: circleCenter.lon }}
                  draggable
                  onDragEnd={e => setCircleCenter({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={[styles.circleMarker, { backgroundColor: circleMode === 'tee' ? COLORS.warning : COLORS.success }]}>
                    <Ionicons name={circleMode === 'tee' ? 'golf' : 'flag-outline'} size={11} color={COLORS.textOnPrimary} />
                  </View>
                </Marker>
              </>
            )}
          </MapView>

          {/* ── Crosshair (shot mode / pin-placing mode) ── */}
          {showCrosshair && (
            <>
              <View pointerEvents="none" style={styles.reticleOverlay}>
                <View style={styles.reticleBox}>
                  <View style={[styles.reticleArm, styles.reticleTop]} />
                  <View style={[styles.reticleArm, styles.reticleBottom]} />
                  <View style={[styles.reticleArm, styles.reticleLeft]} />
                  <View style={[styles.reticleArm, styles.reticleRight]} />
                  <View style={[styles.reticleDot, placing === 'pin' && { backgroundColor: COLORS.success }, placing === 'tee' && { backgroundColor: COLORS.warning }]} />
                </View>
                {placing !== 'none' ? (
                  <View style={styles.reticleBadge}>
                    <Text style={styles.reticleBadgeTxt}>
                      {placing === 'pin' ? 'Mueve el mapa al pin · confirma abajo' : 'Mueve el mapa al tee · confirma abajo'}
                    </Text>
                  </View>
                ) : (crosshairDist !== null || crosshairToPin !== null) && (
                  <View style={styles.reticleBadge}>
                    <View style={styles.reticleBadgeRow}>
                      {crosshairDist  !== null && <Text style={styles.reticleBadgeTxt}>{crosshairDist}m golpe</Text>}
                      {crosshairToPin !== null && <Text style={[styles.reticleBadgeTxt, styles.reticleBadgePin]}>{crosshairToPin}m pin</Text>}
                    </View>
                    {crosshairToPin !== null && (
                      clubRange ? (
                        <View style={styles.reticleClubRange}>
                          <ClubPick rec={clubRange.less} muted />
                          <ClubPick rec={clubRange.best} />
                          <ClubPick rec={clubRange.more} muted />
                        </View>
                      ) : (
                        <View style={styles.reticleClubRow}>
                          <Ionicons name="golf-outline" size={13} color="rgba(255,255,255,0.6)" />
                          <Text style={styles.reticleClubTxt}>
                            {clubProfiles.length === 0
                              ? 'Sin datos de palos aún'
                              : 'Necesitas ≥2 golpes de algún palo'}
                          </Text>
                        </View>
                      )
                    )}
                  </View>
                )}
              </View>

              <View style={styles.actionRow}>
                {placing !== 'none' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.placeBtn, { backgroundColor: placing === 'pin' ? COLORS.success : COLORS.warning }]}
                      onPress={confirmPlacement}
                    >
                      <Ionicons name={placing === 'pin' ? 'flag' : 'golf'} size={18} color={COLORS.textOnPrimary} />
                      <Text style={styles.placeBtnTxt}>
                        {placing === 'pin' ? 'Guardar posición del pin' : 'Guardar posición del tee'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.gpsBtnSmall, { backgroundColor: '#6c757d' }]} onPress={() => setPlacing('none')}>
                      <Ionicons name="close" size={22} color={COLORS.textOnPrimary} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.placeBtn} onPress={placeAtCenter}>
                      <Ionicons name="pin" size={18} color={COLORS.textOnPrimary} />
                      <Text style={styles.placeBtnTxt}>Poner bola aquí</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.gpsBtnSmall} onPress={captureGPS}>
                      <Ionicons name="navigate" size={20} color={COLORS.textOnPrimary} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </>
          )}

          {/* ── Shot summary overlay (top-right) ── */}
          {shots.length > 0 && !pending && (
            <View style={styles.shotSummary} pointerEvents="box-none">
              {shots.map((s, i) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.shotChip, selectedShotId === s.id && styles.shotChipSelected]}
                  onPress={() => setSelectedShotId(p => p === s.id ? null : s.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.shotChipNum}><Text style={styles.shotChipNumTxt}>{i + 1}</Text></View>
                  <Text style={styles.shotChipClub}>{s.club || '—'}</Text>
                  <Text style={styles.shotChipDist}>{s.distanceMeters}m</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {(aimPlacing || editAimPlacing) && (
            <View style={styles.tapHint}>
              <Ionicons name="navigate-outline" size={14} color="#1a472a" />
              <Text style={styles.tapHintTxt}>
                {editAimPlacing
                  ? 'Toca el mapa donde apuntabas al hacer este golpe'
                  : 'Toca el mapa donde apuntabas · arrastra el marcador azul para ajustar'}
              </Text>
            </View>
          )}

        </View>

        {/* ── Bottom sheet ── */}
        {(() => {
          if (!selectedShotId || pending) return null;
          const editShot = shots.find(s => s.id === selectedShotId);
          if (!editShot) return null;
          const idx = shots.indexOf(editShot);
          const type = editShot.shotType ?? 'normal';
          return (
            <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 14, paddingBottom: 28 }}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>Editar golpe {idx + 1}</Text>
                <TouchableOpacity onPress={() => setSelectedShotId(null)}>
                  <Ionicons name="close" size={20} color="#6c757d" />
                </TouchableOpacity>
              </View>

              <Text style={styles.sheetLabel}>Palo</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                {CLUBS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.clubChip, editShot.club === c && styles.clubChipActive]}
                    onPress={async () => { await updateShotClub(editShot.id, c); setShots(await getShotMeasurements(holeScoreId)); }}
                  >
                    <Text style={[styles.clubChipTxt, editShot.club === c && styles.clubChipTxtActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.sheetLabel}>Tipo de golpe</Text>
              <View style={styles.shotTypeRow}>
                {([
                  { key: 'normal', label: 'Normal',       icon: 'checkmark-circle-outline',     color: COLORS.success },
                  { key: 'punch',  label: 'Recuperación', icon: 'arrow-forward-circle-outline',  color: COLORS.warning },
                  { key: 'poor',   label: 'Mal golpe',    icon: 'close-circle-outline',          color: COLORS.danger },
                ] as const).map(({ key, label, icon, color }) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.shotTypeBtn, type === key && { borderColor: color, backgroundColor: color + '18' }]}
                    onPress={async () => { await updateShotType(editShot.id, key); setShots(await getShotMeasurements(holeScoreId)); }}
                  >
                    <Ionicons name={icon} size={16} color={type === key ? color : COLORS.textTertiary} />
                    <Text style={[styles.shotTypeTxt, type === key && { color }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Aim direction ── */}
              <View style={styles.aimRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetLabel}>Dirección de apunte</Text>
                  {(editShot.aimLat !== 0 || editShot.aimLon !== 0) ? (() => {
                    const hasOrigin = editShot.originLat !== 0 || editShot.originLon !== 0;
                    const lDev = hasOrigin ? lateralDeviation(
                      { lat: editShot.originLat!, lon: editShot.originLon! },
                      { lat: editShot.aimLat!,    lon: editShot.aimLon!    },
                      { lat: editShot.lat,        lon: editShot.lon       },
                    ) : null;
                    return (
                      <View style={styles.lateralBadge}>
                        {lDev ? (
                          <>
                            <Ionicons name="arrow-forward" size={13} color="#29b6f6"
                              style={{ transform: [{ rotate: lDev.side === 'L' ? '-90deg' : lDev.side === 'R' ? '90deg' : '0deg' }] }} />
                            <Text style={styles.lateralTxt}>
                              {lDev.side === 'center' ? 'Directo' : `${lDev.meters}m ${lDev.side === 'L' ? 'izquierda' : 'derecha'}`}
                            </Text>
                          </>
                        ) : (
                          <Text style={styles.lateralTxt}>Objetivo marcado</Text>
                        )}
                      </View>
                    );
                  })() : (
                    <Text style={styles.aimHintTxt}>Sin objetivo marcado</Text>
                  )}
                </View>
                <View style={styles.aimBtns}>
                  {(editShot.aimLat !== 0 || editShot.aimLon !== 0) && (
                    <TouchableOpacity style={styles.aimClearBtn}
                      onPress={async () => { await updateShotAim(editShot.id, 0, 0); setShots(await getShotMeasurements(holeScoreId)); setEditAimPlacing(false); }}>
                      <Ionicons name="close" size={14} color="#e74c3c" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.aimSetBtn, editAimPlacing && styles.aimSetBtnActive]}
                    onPress={() => setEditAimPlacing(p => !p)}
                  >
                    <Ionicons name="navigate-outline" size={15} color={editAimPlacing ? COLORS.textOnPrimary : '#29b6f6'} />
                    <Text style={[styles.aimSetTxt, editAimPlacing && { color: COLORS.textOnPrimary }]}>
                      {editAimPlacing ? 'Cancelar' : (editShot.aimLat !== 0 || editShot.aimLon !== 0) ? 'Cambiar' : 'Marcar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={styles.editDeleteBtn}
                onPress={() => { setSelectedShotId(null); setEditAimPlacing(false); deleteShot(editShot.id); }}
              >
                <Ionicons name="trash-outline" size={15} color="#e74c3c" />
                <Text style={styles.editDeleteTxt}>Borrar golpe</Text>
              </TouchableOpacity>
            </ScrollView>
          );
        })()}

        {pending ? (
          <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 14, paddingBottom: 28 }}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Golpe Nº {shots.length + 1}</Text>
              <View style={styles.distRow}>
                {pendingDist !== null && <Text style={styles.distBadge}>{pendingDist} m</Text>}
                {distToPin   !== null && <Text style={[styles.distBadge, styles.distBadgePin]}>{distToPin} m al pin</Text>}
              </View>
            </View>

            {wind && (
              <View style={styles.windRow}>
                <Ionicons name="arrow-forward" size={14} color="#29b6f6"
                  style={{ transform: [{ rotate: windArrowDeg(wind.direction) }] }} />
                <Text style={styles.windRowTxt}>
                  {wind.speed} km/h {wind.compass}
                  {wind.gusts > wind.speed + 3 ? `  ·  Ráfagas ${wind.gusts} km/h` : ''}
                </Text>
              </View>
            )}

            <Text style={styles.sheetLabel}>Palo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {CLUBS.map(c => (
                <TouchableOpacity key={c} style={[styles.clubChip, club === c && styles.clubChipActive]} onPress={() => setClub(c)}>
                  <Text style={[styles.clubChipTxt, club === c && styles.clubChipTxtActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.zoneLine}>
              <Text style={styles.sheetLabel}>Cayó en</Text>
              <TouchableOpacity style={[styles.zoneBadge, { backgroundColor: zoneColor + '22', borderColor: zoneColor }]} onPress={() => setShowZonePicker(!showZonePicker)}>
                <Text style={[styles.zoneBadgeTxt, { color: zoneColor }]}>{zone ? (ZONE_LABELS as Record<string, string>)[zone] ?? zone : 'Desconocida'}</Text>
                <Ionicons name={showZonePicker ? 'chevron-up' : 'pencil'} size={12} color={zoneColor} />
              </TouchableOpacity>
            </View>
            {showZonePicker && (
              <View style={styles.zoneRow}>
                {ZONES.map(z => (
                  <TouchableOpacity key={z.key}
                    style={[styles.zoneChip, zone === z.key && { backgroundColor: z.color, borderColor: z.color }]}
                    onPress={() => { setZone(zone === z.key ? '' : z.key); setShowZonePicker(false); }}>
                    <Text style={[styles.zoneTxt, zone === z.key && { color: COLORS.textOnPrimary }]}>{z.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Shot type toggle */}
            {shotType !== 'normal' && (
              <Text style={styles.shotTypeNote}>
                Recuperación / mal golpe — no cuenta en distancias de palo
              </Text>
            )}
            <View style={styles.shotTypeRow}>
              {([
                { key: 'normal', label: 'Normal',    icon: 'checkmark-circle-outline', color: COLORS.success },
                { key: 'punch',  label: 'Recuperación', icon: 'arrow-forward-circle-outline', color: COLORS.warning },
                { key: 'poor',   label: 'Mal golpe', icon: 'close-circle-outline',     color: COLORS.danger },
              ] as const).map(({ key, label, icon, color }) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.shotTypeBtn, shotType === key && { borderColor: color, backgroundColor: color + '18' }]}
                  onPress={() => setShotType(key)}
                >
                  <Ionicons name={icon} size={16} color={shotType === key ? color : COLORS.textTertiary} />
                  <Text style={[styles.shotTypeTxt, shotType === key && { color }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Aim direction ── */}
            <View style={styles.aimRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetLabel}>Dirección de apunte</Text>
                {pendingLateral ? (
                  <View style={styles.lateralBadge}>
                    <Ionicons name="arrow-forward" size={13} color="#29b6f6"
                      style={{ transform: [{ rotate: pendingLateral.side === 'L' ? '-90deg' : pendingLateral.side === 'R' ? '90deg' : '0deg' }] }} />
                    <Text style={styles.lateralTxt}>
                      {pendingLateral.side === 'center' ? 'Directo' : `${pendingLateral.meters}m ${pendingLateral.side === 'L' ? 'izquierda' : 'derecha'}`}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.aimHintTxt}>Sin objetivo marcado</Text>
                )}
              </View>
              <View style={styles.aimBtns}>
                {aimPoint && (
                  <TouchableOpacity style={styles.aimClearBtn} onPress={() => setAimPoint(null)}>
                    <Ionicons name="close" size={14} color="#e74c3c" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.aimSetBtn, aimPlacing && styles.aimSetBtnActive]}
                  onPress={() => setAimPlacing(p => !p)}
                >
                  <Ionicons name="navigate-outline" size={15} color={aimPlacing ? COLORS.textOnPrimary : '#29b6f6'} />
                  <Text style={[styles.aimSetTxt, aimPlacing && { color: COLORS.textOnPrimary }]}>
                    {aimPlacing ? 'Cancelar' : aimPoint ? 'Mover' : 'Marcar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={cancelPending}>
                <Text style={styles.cancelTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveShot}>
                <Ionicons name="checkmark" size={18} color={COLORS.textOnPrimary} />
                <Text style={styles.saveTxt}>Guardar golpe</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

        ) : null}

      </View>
    </Modal>
  );
}

function ClubPick({ rec, muted }: { rec: ClubRecommendation | null; muted?: boolean }) {
  if (!rec) return <View style={styles.clubPick} />;
  return (
    <View style={styles.clubPick}>
      <View style={[styles.clubPickChip, muted ? styles.clubPickChipMuted : styles.clubPickChipMain]}>
        <Text style={styles.clubPickChipTxt}>{rec.club}</Text>
      </View>
      <Text style={[styles.clubPickDist, muted && styles.clubPickDistMuted]}>{rec.avgDist}m{rec.source === 'manual' ? '*' : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.shadow },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingHorizontal: 10,
    paddingTop: 50, paddingBottom: 12,
  },
  headerBtn: { padding: 2 },
  headerTitle: { fontSize: 16, fontFamily: FONT.headingSemiBold, color: COLORS.textOnPrimary },
  headerSub:   { fontSize: 11, color: '#a8d5a2', fontFamily: FONT.body, marginTop: 1 },

  iconBtn:   { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  iconBtnOn: { backgroundColor: COLORS.card },

  aimBtn:       { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  aimBtnActive: { backgroundColor: COLORS.card },
  aimBtnTxt:    { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  // ── Shot path labels ─────────────────────────────────────────────────────────
  distLabel:    { backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  distLabelPin: { backgroundColor: 'rgba(0,0,0,0.7)' },
  distLabelTxt: { color: COLORS.textOnPrimary, fontSize: 12, fontFamily: FONT.bodySemiBold },

  // ── Reticle crosshair ────────────────────────────────────────────────────────
  reticleOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12 },
  reticleBox:     { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  reticleArm:     { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.9)' },
  reticleTop:     { width: 2, height: 24, top: 0,    left: 39 },
  reticleBottom:  { width: 2, height: 24, bottom: 0, left: 39 },
  reticleLeft:    { height: 2, width: 24, left: 0,   top: 39  },
  reticleRight:   { height: 2, width: 24, right: 0,  top: 39  },
  reticleDot:     { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.warning, borderWidth: 2.5, borderColor: COLORS.textOnPrimary, shadowColor: COLORS.shadow, shadowOpacity: 0.5, shadowRadius: 4, elevation: 4 },
  reticleBadge:   { flexDirection: 'column', gap: 4, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  reticleBadgeRow: { flexDirection: 'row', gap: 8 },
  reticleBadgeTxt: { color: COLORS.textOnPrimary, fontFamily: FONT.bodySemiBold, fontSize: 13 },
  reticleBadgePin: { color: '#ffe066' },
  reticleClubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 4 },
  reticleClubTxt: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: FONT.bodyMedium },
  reticleClubRange: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 6, marginTop: 2,
  },
  clubPick: { alignItems: 'center', minWidth: 30, gap: 2 },
  clubPickChip: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  clubPickChipMain: { backgroundColor: COLORS.primary },
  clubPickChipMuted: { backgroundColor: 'rgba(255,255,255,0.12)' },
  clubPickChipTxt: { color: '#fff', fontSize: 12, fontFamily: FONT.bodySemiBold },
  clubPickDist: { color: '#fff', fontSize: 10, fontFamily: FONT.bodySemiBold },
  clubPickDistMuted: { color: 'rgba(255,255,255,0.55)', fontFamily: FONT.bodyMedium },

  // ── Place + GPS buttons ──────────────────────────────────────────────────────
  actionRow: { position: 'absolute', bottom: 14, left: 14, right: 14, flexDirection: 'row', gap: 10, alignItems: 'center' },
  placeBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 24, paddingVertical: 14, shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 6, elevation: 5 },
  placeBtnDisabled: { backgroundColor: COLORS.textSecondary },
  placeBtnTxt:      { color: COLORS.textOnPrimary, fontSize: 15, fontFamily: FONT.bodySemiBold },
  gpsBtnSmall:      { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.info, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },

  // ── Shot summary (top-right) ─────────────────────────────────────────────────
  shotSummary:    { position: 'absolute', top: 12, right: 12, gap: 5 },
  shotChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  shotChipNum:    { width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  shotChipNumTxt: { color: COLORS.textOnPrimary, fontSize: 10, fontFamily: FONT.bodySemiBold },
  shotChipClub:   { color: COLORS.textOnPrimary, fontSize: 13, fontFamily: FONT.bodySemiBold, minWidth: 24 },
  shotChipDist:   { color: 'rgba(255,255,255,0.65)', fontSize: 12 },

  tapHint:    { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  tapHintTxt: { fontSize: 11, fontFamily: FONT.bodyMedium, color: COLORS.primary },

  // ── Map markers ─────────────────────────────────────────────────────────────
  shotPin:    { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: COLORS.textOnPrimary, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.4, shadowRadius: 3, elevation: 3 },
  shotPinTxt: { color: COLORS.textOnPrimary, fontSize: 13, fontFamily: FONT.bodySemiBold },
  pendingPin: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.warning, borderWidth: 2.5, borderColor: COLORS.textOnPrimary, alignItems: 'center', justifyContent: 'center' },
  targetPin:  { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.25)', borderWidth: 2, borderColor: COLORS.textOnPrimary, alignItems: 'center', justifyContent: 'center' },
  targetInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.card },
  circleMarker: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.textOnPrimary },

  // ── Bottom sheet ─────────────────────────────────────────────────────────────
  sheet:      { maxHeight: 360, backgroundColor: COLORS.card, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  sheetHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { fontSize: 16, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  distRow:    { flexDirection: 'row', gap: 6 },
  distBadge:    { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.primary, backgroundColor: COLORS.primaryTint, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  distBadgePin: { color: '#b9770e', backgroundColor: '#fdf3e0' },
  sheetLabel: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12, marginBottom: 6 },

  clubChip:        { minWidth: 44, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11, backgroundColor: '#f0f2f5' },
  clubChipActive:  { backgroundColor: COLORS.primary },
  clubChipTxt:     { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  clubChipTxtActive: { color: COLORS.textOnPrimary },

  zoneLine:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  zoneBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  zoneBadgeTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold },
  zoneRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  zoneChip:    { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: COLORS.card, borderWidth: 1.5, borderColor: '#dfe4ea' },
  zoneTxt:     { fontSize: 13, fontFamily: FONT.bodyMedium, color: COLORS.textSecondary },

  actions:   { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: '#f0f2f5' },
  cancelTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  saveBtn:   { flex: 2, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: COLORS.primary },
  saveTxt:   { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  aimFromTxt: { fontSize: 12, color: COLORS.textSecondary, fontFamily: FONT.bodyMedium },
  measRow:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  measBox:    { flex: 1, alignItems: 'center', backgroundColor: COLORS.primaryTint, borderRadius: 12, paddingVertical: 12 },
  measBoxPin: { backgroundColor: '#fdf3e0' },
  measNum:    { fontSize: 28, fontFamily: FONT.heading, color: COLORS.primary },
  measLbl:    { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 1 },
  hazardRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  hazardChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.bg, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  hazardDot:  { width: 9, height: 9, borderRadius: 5 },
  hazardTxt:  { fontSize: 12, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary },

  // ── Accuracy circles controls ────────────────────────────────────────────────
  circleToggleRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  circleToggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: '#f0f2f5' },
  circleToggleBtnOn: { backgroundColor: COLORS.primary },
  circleToggleTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  radiusRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  radiusLabel: { fontSize: 12, color: COLORS.textSecondary, fontFamily: FONT.bodyMedium, marginRight: 2 },
  radiusBtn:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: '#f0f2f5' },
  radiusBtnOn: { backgroundColor: COLORS.primary },
  radiusBtnTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },

  shotTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: 4 },
  shotTypeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e9ecef', backgroundColor: '#f8f9fa',
  },
  shotTypeTxt:  { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textTertiary },
  shotTypeNote: { fontSize: 11, color: COLORS.warning, fontFamily: FONT.bodyMedium, textAlign: 'center', marginBottom: 4 },

  shotPinSelected: { backgroundColor: COLORS.warning, borderWidth: 3 },
  shotChipSelected: { backgroundColor: 'rgba(230,126,34,0.85)' },

  editDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: '#fff5f5',
  },
  editDeleteTxt: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.danger },

  // ── Aim direction ────────────────────────────────────────────────────────────
  aimDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#29b6f6', borderWidth: 2, borderColor: COLORS.textOnPrimary,
  },
  aimMarker: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#29b6f6', borderWidth: 2.5, borderColor: COLORS.textOnPrimary,
    shadowColor: COLORS.shadow, shadowOpacity: 0.4, shadowRadius: 3, elevation: 3,
  },
  aimRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  aimBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aimClearBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff5f5',
    alignItems: 'center', justifyContent: 'center',
  },
  aimSetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#29b6f6', backgroundColor: '#e8f7fd',
  },
  aimSetBtnActive: { backgroundColor: '#29b6f6', borderColor: '#29b6f6' },
  aimSetTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: '#29b6f6' },
  aimHintTxt: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: 2 },
  lateralBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3,
    backgroundColor: '#e8f7fd', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  lateralTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: '#29b6f6' },

  // ── Wind ─────────────────────────────────────────────────────────────────────
  windBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(41,182,246,0.22)', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  windTxt:  { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  windUnit: { fontSize: 11, fontFamily: FONT.bodyMedium, color: 'rgba(255,255,255,0.75)' },
  windRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#e8f7fd', borderRadius: 9,
    paddingHorizontal: 10, paddingVertical: 7, marginBottom: 4,
  },
  windRowTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: '#0288d1' },
});
