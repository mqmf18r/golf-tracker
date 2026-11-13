import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Polygon, Circle, LongPressEvent, MapPressEvent, MarkerDragStartEndEvent } from 'react-native-maps';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import {
  getCourse, getHoles, updateHoleTee, updateHoleTeeColor, updateHolePinColor, updateHoleGPS,
  getZonesForCourse, insertZone, deleteZone, deleteZonesForHole,
  getCourseHazards, insertCourseHazard, deleteCourseHazard, updateCourse,
} from '../../src/lib/api';
import { CountryPicker } from '../../src/components/CountryPicker';
import { ALL_COUNTRIES } from '../../src/data/worldMap';
import { fetchOsmGolfHoles, fetchOsmFeaturesInArea, fetchOsmFeaturesInPolygon, OsmAreaFeature, fetchOsmCourseHazards, OsmHazardResult, applyOsmHolesToDb } from '../../src/services/osmGolf';
import { Hole, CourseZone, ZoneType, CourseHazard, HazardType, TeeColor } from '../../src/types';
import { CoursePreviewModal } from '../../src/components/CoursePreviewModal';
import { FieldMappingModal } from '../../src/components/FieldMappingModal';
import { circlePolygon, haversineM, bearing } from '../../src/services/geo';
import { useLocation } from '../../src/services/location';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';

// Club de Golf Escorpión, Bétera — fallback center
const DEFAULT_REGION = {
  latitude: 39.5872,
  longitude: -0.4669,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

type PointMode = 'red' | 'yellow' | 'blue' | 'tee';
type MapMode = PointMode | ZoneType;

const MAP_MODES: { key: PointMode; label: string; color: string; desc: string }[] = [
  { key: 'red',    label: 'Rojo',     color: '#e74c3c', desc: 'Pin corto'  },
  { key: 'yellow', label: 'Amarillo', color: '#d4ac0d', desc: 'Pin medio'  },
  { key: 'blue',   label: 'Azul',     color: '#2980b9', desc: 'Pin largo'  },
  { key: 'tee',    label: 'Tee',      color: '#e67e22', desc: 'Salida'     },
];

const ZONE_MODES: { key: ZoneType; label: string; color: string }[] = [
  { key: 'green',  label: 'Green',  color: '#2ecc71' },
  { key: 'calle',  label: 'Calle',  color: '#27ae60' },
  { key: 'bunker', label: 'Búnker', color: '#d4a017' },
  { key: 'agua',   label: 'Agua',   color: '#2980b9' },
];

const ZONE_FILL: Record<ZoneType, string> = {
  green:  'rgba(46,204,113,0.45)',
  calle:  'rgba(39,174,96,0.30)',
  bunker: 'rgba(212,160,23,0.45)',
  agua:   'rgba(41,128,185,0.45)',
};

const POINT_KEYS: PointMode[] = ['red', 'yellow', 'blue', 'tee'];
function isPointMode(m: MapMode): m is PointMode {
  return (POINT_KEYS as string[]).includes(m);
}

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { location } = useLocation();
  const { isDeveloper } = useAuth();

  const [course, setCourse] = useState<import('../../src/types').Course | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [expandedHole, setExpandedHole] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const [showMap, setShowMap] = useState(false);
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('yellow');
  const [zones, setZones] = useState<CourseZone[]>([]);
  const [draftPts, setDraftPts] = useState<{ lat: number; lon: number }[]>([]);
  const [drawTool, setDrawTool] = useState<'vertices' | 'pencil' | 'circle'>('vertices');
  const [circle, setCircle] = useState<{ center: { lat: number; lon: number }; radius: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [liveCenter, setLiveCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [showPreview,  setShowPreview]  = useState(false);
  const [showMapping,  setShowMapping]  = useState(false);

  // Per-hole detect mode
  const [showDetect,    setShowDetect]    = useState(false);
  const [detectShape,   setDetectShape]   = useState<'circle' | 'polygon'>('circle');
  const [detectMode,    setDetectMode]    = useState<'auto' | 'tees'>('auto');
  const [detectCenter,  setDetectCenter]  = useState<{ lat: number; lon: number } | null>(null);
  const [detectRadius,  setDetectRadius]  = useState(200);
  const [detectPts,     setDetectPts]     = useState<{ lat: number; lon: number }[]>([]);
  const [detectResults, setDetectResults] = useState<OsmAreaFeature[]>([]);
  const [detecting,     setDetecting]     = useState(false);

  // Course-wide hazards (agua / OB)
  const [hazards,             setHazards]             = useState<CourseHazard[]>([]);
  const [hazardMode,          setHazardMode]          = useState(false);
  const [hazardType,          setHazardType]          = useState<HazardType>('agua');
  const [hazardDraft,         setHazardDraft]         = useState<{ lat: number; lon: number }[]>([]);
  const [autoHazardResults,   setAutoHazardResults]   = useState<OsmHazardResult[]>([]);
  const [autoDetectingHazard, setAutoDetectingHazard] = useState(false);

  const mapRef = useRef<MapView>(null);

  const isZoneMode = !isPointMode(mapMode);

  function holePin(h: Hole): { lat: number; lon: number } | null {
    if (h.centerLat !== 0) return { lat: h.centerLat, lon: h.centerLon };
    if (h.frontLat !== 0) return { lat: h.frontLat, lon: h.frontLon };
    if (h.backLat !== 0) return { lat: h.backLat, lon: h.backLon };
    return null;
  }

  // Center camera on a hole: at the tee looking toward its pin
  function focusHole(h: Hole) {
    const tee = h.teeLat !== 0 ? { lat: h.teeLat, lon: h.teeLon } : null;
    const pin = holePin(h);
    if (tee && pin) {
      const d = haversineM(tee.lat, tee.lon, pin.lat, pin.lon) || 130;
      const zoom = Math.max(13.5, Math.min(18.5, 15.5 - Math.log2(d / 130)));
      mapRef.current?.animateCamera({
        center: { latitude: (tee.lat + pin.lat) / 2, longitude: (tee.lon + pin.lon) / 2 },
        heading: bearing(tee, pin),
        pitch: 0,
        zoom,
      }, { duration: 650 });
    } else {
      const t = tee ?? pin;
      if (t) mapRef.current?.animateCamera({ center: { latitude: t.lat, longitude: t.lon }, zoom: 16.5 }, { duration: 550 });
    }
  }

  function selectHole(h: Hole) {
    const active = selectedHoleId === h.id;
    setSelectedHoleId(active ? null : h.id);
    setDraftPts([]); setCircle(null);
    if (!active) focusHole(h);
  }

  useEffect(() => {
    (async () => {
      const c = await getCourse(id);
      if (c) {
        setCourse(c);
        navigation.setOptions({ title: c.name });
        setHoles(await getHoles(id));
        setZones(await getZonesForCourse(id));
        setHazards(await getCourseHazards(id));
      }
    })();
  }, [id]);

  function reload() { getHoles(id).then(setHoles); }
  function reloadZones() { getZonesForCourse(id).then(setZones); }
  function reloadHazards() { getCourseHazards(id).then(setHazards); }

  async function saveHazard() {
    if (hazardDraft.length < 3) {
      Alert.alert('Faltan puntos', 'Dibuja al menos 3 puntos para cerrar la zona.');
      return;
    }
    await insertCourseHazard(id, hazardType, hazardDraft);
    setHazardDraft([]);
    reloadHazards();
  }

  async function runAutoDetectHazards() {
    const center = liveCenter ?? (markedCoords.length > 0
      ? { lat: markedCoords.reduce((s, p) => s + p.lat, 0) / markedCoords.length,
          lon: markedCoords.reduce((s, p) => s + p.lon, 0) / markedCoords.length }
      : { lat: DEFAULT_REGION.latitude, lon: DEFAULT_REGION.longitude });
    // Radius = half-diagonal of course bounding box, capped 800–2000m
    let radiusM = 1200;
    if (markedCoords.length >= 2) {
      const lats = markedCoords.map(p => p.lat);
      const lons = markedCoords.map(p => p.lon);
      const diagM = haversineM(Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons));
      radiusM = Math.max(800, Math.min(2000, diagM * 0.6));
    }
    setAutoDetectingHazard(true);
    try {
      const found = await fetchOsmCourseHazards(center.lat, center.lon, radiusM);
      if (found.length === 0) {
        Alert.alert('Sin resultados', 'No se encontraron zonas de agua u OB en OpenStreetMap para este campo.\nPuedes dibujarlas manualmente.');
        return;
      }
      setAutoHazardResults(found);
    } catch (err) {
      Alert.alert('Error de conexión', String(err));
    } finally {
      setAutoDetectingHazard(false);
    }
  }

  async function saveAutoHazards() {
    let saved = 0;
    for (const h of autoHazardResults) {
      if (h.points.length >= 3) { await insertCourseHazard(id, h.type, h.points); saved++; }
    }
    setAutoHazardResults([]);
    reloadHazards();
    Alert.alert('Guardado', `${saved} zona${saved !== 1 ? 's' : ''} de peligro guardadas.`);
  }

  async function saveDetectedTees() {
    if (!selectedHoleId) return;
    const hole = holes.find(h => h.id === selectedHoleId)!;
    const tees = detectResults.filter(f => f.golfType === 'tee');
    if (tees.length === 0) return;
    const avg = (pts: { lat: number; lon: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    });
    const teePts = tees.map(t => avg(t.points));
    const pin = hole.centerLat !== 0 ? { lat: hole.centerLat, lon: hole.centerLon }
      : hole.frontLat !== 0 ? { lat: hole.frontLat, lon: hole.frontLon } : null;
    const sorted = pin
      ? [...teePts].sort((a, b) =>
          haversineM(b.lat, b.lon, pin.lat, pin.lon) - haversineM(a.lat, a.lon, pin.lat, pin.lon))
      : teePts;
    const colors: TeeColor[] = ['black', 'brown', 'blue', 'yellow', 'orange', 'red', 'silver'];
    for (let i = 0; i < Math.min(sorted.length, colors.length); i++) {
      await updateHoleTeeColor(selectedHoleId, colors[i], sorted[i].lat, sorted[i].lon);
    }
    await updateHoleTee(selectedHoleId, sorted[0].lat, sorted[0].lon);
    reload(); setShowDetect(false); setDetectResults([]); setDetectMode('auto');
    Alert.alert(
      'Tees asignados',
      `${sorted.length} tee${sorted.length > 1 ? 's' : ''} guardados por distancia al green.\nNegro = más lejos · Plateado = más cerca`,
    );
  }

  function removeHazard(hazardId: string) {
    Alert.alert('Eliminar zona', '¿Borrar este peligro del campo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteCourseHazard(hazardId); reloadHazards(); } },
    ]);
  }

  // Deduplicate: skip a new feature if same type + centroid within 15m of an existing one
  function mergeResults(existing: OsmAreaFeature[], incoming: OsmAreaFeature[]): OsmAreaFeature[] {
    const avgPt = (pts: { lat: number; lon: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    });
    const unique = incoming.filter(nf => {
      const nc = avgPt(nf.points);
      return !existing.some(ef => {
        if (ef.golfType !== nf.golfType) return false;
        const ec = avgPt(ef.points);
        return haversineM(nc.lat, nc.lon, ec.lat, ec.lon) < 15;
      });
    });
    return [...existing, ...unique];
  }

  function enterDetectMode() {
    if (!selectedHoleId) { Alert.alert('Selecciona un hoyo', 'Elige un hoyo en la fila de abajo.'); return; }
    const hole = holes.find(h => h.id === selectedHoleId);
    const center = hole && hole.centerLat !== 0
      ? { lat: hole.centerLat, lon: hole.centerLon }
      : hole && hole.teeLat !== 0
      ? { lat: hole.teeLat, lon: hole.teeLon }
      : liveCenter;
    setDetectCenter(center);
    const r = hole && hole.distanceMeters > 0
      ? Math.max(80, Math.min(500, Math.round(hole.distanceMeters * 0.6)))
      : 200;
    setDetectRadius(r);
    setDetectShape('circle');
    setDetectMode('auto');
    setDetectPts([]);
    setDetectResults([]);
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
      const filtered = detectMode === 'tees' ? found.filter(f => f.golfType === 'tee') : found;
      if (filtered.length === 0) {
        Alert.alert('Sin datos',
          detectMode === 'tees'
            ? 'No se encontraron tees en esta área.\nAmplía el área o muévela.'
            : 'No se encontraron elementos.\nAmplía el área o muévela.');
        return;
      }
      // Accumulate — don't replace
      setDetectResults(prev => mergeResults(prev, filtered));
      // Reset draw area for next search
      setDetectPts([]);
    } catch (err) {
      Alert.alert('Error de conexión', String(err));
    } finally {
      setDetecting(false);
    }
  }

  async function saveDetected() {
    if (!selectedHoleId || detectResults.length === 0) return;
    const hole = holes.find(h => h.id === selectedHoleId)!;
    await deleteZonesForHole(selectedHoleId);

    const avg = (pts: { lat: number; lon: number }[]) => ({
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    });

    let nGreens = 0, nTees = 0, nBunkers = 0, nFairways = 0, nWater = 0;

    // For greens/fairways: pick the largest polygon if multiple found
    const greens   = detectResults.filter(f => f.golfType === 'green'        && f.points.length >= 3);
    const fairways = detectResults.filter(f => f.golfType === 'fairway'      && f.points.length >= 3);
    const bunkers  = detectResults.filter(f => f.golfType === 'bunker'       && f.points.length >= 3);
    const waters   = detectResults.filter(f => f.golfType === 'water_hazard' && f.points.length >= 3);
    const tees     = detectResults.filter(f => f.golfType === 'tee');

    const bySize = (a: OsmAreaFeature, b: OsmAreaFeature) => b.points.length - a.points.length;

    if (greens.length > 0) {
      const g = greens.sort(bySize)[0];
      await insertZone(selectedHoleId, 'green', g.points);
      const c = avg(g.points);
      await updateHoleGPS(selectedHoleId, { pinLat: c.lat, pinLon: c.lon, frontLat: c.lat, frontLon: c.lon, centerLat: c.lat, centerLon: c.lon, backLat: c.lat, backLon: c.lon });
      nGreens++;
    }
    if (fairways.length > 0) {
      await insertZone(selectedHoleId, 'calle', fairways.sort(bySize)[0].points);
      nFairways++;
    }
    for (const b of bunkers)  { await insertZone(selectedHoleId, 'bunker', b.points); nBunkers++; }
    for (const w of waters)   { await insertZone(selectedHoleId, 'agua',   w.points); nWater++;   }
    if (tees.length > 0) {
      const t = avg(tees[0].points);
      await updateHoleTee(selectedHoleId, t.lat, t.lon);
      nTees++;
    }

    reload(); reloadZones();
    setShowDetect(false); setDetectResults([]);
    Alert.alert('¡Guardado!',
      `Hoyo ${hole.number}: ${nGreens} green · ${nTees} tee · ${nFairways} calle · ${nBunkers} búnkeres · ${nWater} agua`);
  }

  async function importFromOsm() {
    const centerLat = liveCenter?.lat ?? mapRegion.latitude;
    const centerLon = liveCenter?.lon ?? mapRegion.longitude;
    Alert.alert(
      'Importar desde OpenStreetMap',
      'Descargará tees, greens y obstáculos para este campo. Los datos existentes se sobrescribirán. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Importar', onPress: async () => {
            setImporting(true);
            try {
              const osmHoles = await fetchOsmGolfHoles(centerLat, centerLon);
              if (osmHoles.length === 0) {
                Alert.alert('Sin datos', 'No se encontraron datos de este campo en OpenStreetMap.\nPrueba a moverte al centro del campo en el mapa y vuelve a intentarlo.');
                return;
              }
              const counts = await applyOsmHolesToDb(id, osmHoles);
              reload();
              reloadZones();
              Alert.alert(
                '¡Importación completada!',
                `${counts.holes} hoyos · ${counts.greens} greens · ${counts.tees} tees · ${counts.fairways} calles · ${counts.bunkers} búnkeres · ${counts.water} obstáculos de agua`
              );
            } catch (err) {
              Alert.alert('Error de conexión', `No se pudo conectar con OpenStreetMap. Verifica tu conexión a internet.\n\n${String(err)}`);
            } finally {
              setImporting(false);
            }
          },
        },
      ]
    );
  }

  async function handleMapLongPress(e: LongPressEvent) {
    if (!isPointMode(mapMode)) return; // zone modes use tap, not long-press
    if (!selectedHoleId) {
      Alert.alert('Selecciona un hoyo', 'Pulsa un número en la fila de hoyos antes de marcar');
      return;
    }
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const hole = holes.find(h => h.id === selectedHoleId)!;
    if (mapMode === 'tee') {
      await updateHoleTee(selectedHoleId, latitude, longitude);
      Alert.alert('Tee guardado', `Hoyo ${hole.number} — salida marcada`);
    } else {
      await updateHolePinColor(selectedHoleId, mapMode, latitude, longitude);
      const modeLabel = MAP_MODES.find(m => m.key === mapMode)!.label;
      Alert.alert('Pin guardado', `Hoyo ${hole.number} — pin ${modeLabel} marcado`);
    }
    reload();
  }

  function handleMapPress(e: MapPressEvent) {
    if (hazardMode) {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      setHazardDraft(prev => [...prev, { lat: latitude, lon: longitude }]);
      return;
    }
    if (showDetect) {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      if (detectShape === 'polygon') {
        setDetectPts(prev => [...prev, { lat: latitude, lon: longitude }]);
      } else {
        setDetectCenter({ lat: latitude, lon: longitude });
      }
      return;
    }
    if (isPointMode(mapMode)) return; // only draw in zone modes
    if (!selectedHoleId) {
      Alert.alert('Selecciona un hoyo', 'Pulsa un número en la fila de hoyos antes de dibujar');
      return;
    }
    const { latitude, longitude } = e.nativeEvent.coordinate;
    if (drawTool === 'vertices') {
      setDraftPts(prev => [...prev, { lat: latitude, lon: longitude }]);
    } else if (drawTool === 'circle') {
      const center = { lat: latitude, lon: longitude };
      const radius = circle?.radius ?? 12;
      setCircle({ center, radius });
      setDraftPts(circlePolygon(center, radius));
    }
    // pencil: ignore taps, uses onPanDrag
  }

  function handlePanDrag(e: MapPressEvent) {
    if (!isZoneMode || drawTool !== 'pencil' || !selectedHoleId) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setDraftPts(prev => {
      const last = prev[prev.length - 1];
      if (last && haversineM(last.lat, last.lon, latitude, longitude) < 3) return prev; // throttle
      return [...prev, { lat: latitude, lon: longitude }];
    });
  }

  function changeRadius(delta: number) {
    if (!circle) return;
    const radius = Math.max(4, Math.min(80, circle.radius + delta));
    setCircle({ ...circle, radius });
    setDraftPts(circlePolygon(circle.center, radius));
  }

  async function closePolygon() {
    if (!selectedHoleId || !isZoneMode) return;
    if (draftPts.length < 3) {
      Alert.alert('Faltan puntos', 'Dibuja al menos 3 puntos para cerrar la zona.');
      return;
    }
    await insertZone(selectedHoleId, mapMode as ZoneType, draftPts);
    setDraftPts([]);
    setCircle(null);
    reloadZones();
  }

  function removeZone(zoneId: string) {
    Alert.alert('Eliminar zona', '¿Borrar esta zona?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => { await deleteZone(zoneId); reloadZones(); } },
    ]);
  }

  function switchMode(m: MapMode) {
    setMapMode(m);
    setDraftPts([]);
    setCircle(null);
  }

  function switchTool(t: 'vertices' | 'pencil' | 'circle') {
    setDrawTool(t);
    setDraftPts([]);
    setCircle(null);
  }

  // Drag a saved pin/tee marker to nudge it precisely
  async function onPointDragEnd(holeId: string, kind: PointMode, e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    if (kind === 'tee') await updateHoleTee(holeId, latitude, longitude);
    else await updateHolePinColor(holeId, kind, latitude, longitude);
    reload();
  }

  // Drag a draft vertex while drawing a zone
  function onDraftVertexDrag(i: number, e: MarkerDragStartEndEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setDraftPts(prev => prev.map((p, idx) => (idx === i ? { lat: latitude, lon: longitude } : p)));
  }

  // Map region from existing markers
  const markedCoords = holes.flatMap(h => {
    const pts: { lat: number; lon: number }[] = [];
    if (h.frontLat  !== 0) pts.push({ lat: h.frontLat,  lon: h.frontLon  });
    if (h.centerLat !== 0) pts.push({ lat: h.centerLat, lon: h.centerLon });
    if (h.backLat   !== 0) pts.push({ lat: h.backLat,   lon: h.backLon   });
    if (h.teeLat    !== 0) pts.push({ lat: h.teeLat,    lon: h.teeLon    });
    return pts;
  });

  const mapRegion = markedCoords.length > 0
    ? (() => {
        const lats = markedCoords.map(p => p.lat);
        const lons = markedCoords.map(p => p.lon);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        return {
          latitude:  (minLat + maxLat) / 2,
          longitude: (minLon + maxLon) / 2,
          latitudeDelta:  Math.max(maxLat - minLat, 0.003) * 1.6,
          longitudeDelta: Math.max(maxLon - minLon, 0.003) * 1.6,
        };
      })()
    : DEFAULT_REGION;

  if (!course) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, !showMap && styles.tabBtnActive]}
          onPress={() => setShowMap(false)}
        >
          <Ionicons name="list" size={15} color={!showMap ? COLORS.textOnPrimary : '#6c757d'} />
          <Text style={[styles.tabText, !showMap && styles.tabTextActive]}>Lista</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, showMap && styles.tabBtnActive]}
          onPress={() => setShowMap(true)}
        >
          <Ionicons name="map" size={15} color={showMap ? COLORS.textOnPrimary : '#6c757d'} />
          <Text style={[styles.tabText, showMap && styles.tabTextActive]}>Mapa GPS</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, { backgroundColor: COLORS.primary }]}
          onPress={() => setShowPreview(true)}
        >
          <Ionicons name="eye-outline" size={15} color={COLORS.textOnPrimary} />
          <Text style={[styles.tabText, { color: COLORS.textOnPrimary }]}>Vista previa</Text>
        </TouchableOpacity>
        {isDeveloper && (
          <TouchableOpacity
            style={[styles.tabBtn, { backgroundColor: '#6c3483' }]}
            onPress={() => setShowMapping(true)}
          >
            <Ionicons name="map-outline" size={15} color={COLORS.textOnPrimary} />
            <Text style={[styles.tabText, { color: COLORS.textOnPrimary }]}>Mapear</Text>
          </TouchableOpacity>
        )}
      </View>

      <CoursePreviewModal
        visible={showPreview}
        courseId={id}
        courseName={course?.name}
        onClose={() => setShowPreview(false)}
      />
      <FieldMappingModal
        visible={showMapping}
        courseId={id}
        courseName={course?.name}
        initialCenter={liveCenter ?? (markedCoords.length > 0 ? markedCoords[0] : undefined)}
        onClose={() => { setShowMapping(false); reload(); }}
      />
      <CountryPicker
        visible={showCountryPicker}
        selected={course?.country}
        onClose={() => setShowCountryPicker(false)}
        onSelect={async (cca2) => {
          if (!course) return;
          await updateCourse(course.id, { country: cca2 });
          setCourse({ ...course, country: cca2 });
          setShowCountryPicker(false);
        }}
      />

      {showMap ? (
        <View style={{ flex: 1 }}>

          {/* ── Hazard mode UI ── */}
          {isDeveloper && hazardMode && (
            <>
              <View style={styles.detectHeader}>
                <Text style={styles.detectHeaderTxt}>
                  Peligros del campo · {hazardDraft.length} puntos
                </Text>
                <View style={styles.detectShapeToggle}>
                  {(['agua', 'ob'] as HazardType[]).map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.detectShapeBtn, hazardType === t && styles.detectShapeBtnOn]}
                      onPress={() => { setHazardType(t); setHazardDraft([]); }}
                    >
                      <Text style={[styles.detectShapeTxt, hazardType === t && { color: '#6c3483' }]}>
                        {t === 'agua' ? '💧 Agua' : '🚫 OB'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={() => { setHazardMode(false); setHazardDraft([]); }}>
                  <Text style={styles.detectCancelTxt}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.detectControls}>
                <TouchableOpacity
                  style={styles.detectSearchBtn}
                  onPress={runAutoDetectHazards}
                  disabled={autoDetectingHazard}
                >
                  {autoDetectingHazard
                    ? <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
                    : <><Ionicons name="cloud-download-outline" size={14} color={COLORS.textOnPrimary} />
                       <Text style={styles.detectActionTxt}>Auto</Text></>}
                </TouchableOpacity>
                <Text style={styles.detectRadTxt}>
                  {autoHazardResults.length > 0 ? `${autoHazardResults.length} detectados` : `${hazardDraft.length} pts`}
                </Text>
                <TouchableOpacity style={styles.detectRadBtn}
                  onPress={() => setHazardDraft(p => p.slice(0, -1))}
                  disabled={hazardDraft.length === 0}>
                  <Ionicons name="arrow-undo" size={16} color={hazardDraft.length === 0 ? 'rgba(255,255,255,0.3)' : COLORS.textOnPrimary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.detectRadBtn}
                  onPress={() => setHazardDraft([])}
                  disabled={hazardDraft.length === 0}>
                  <Ionicons name="trash-outline" size={16} color={hazardDraft.length === 0 ? 'rgba(255,255,255,0.3)' : COLORS.textOnPrimary} />
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                {autoHazardResults.length > 0 && (
                  <>
                    <TouchableOpacity style={styles.detectClearBtn} onPress={() => setAutoHazardResults([])}>
                      <Text style={styles.detectActionTxt}>Limpiar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.detectSaveBtn} onPress={saveAutoHazards}>
                      <Ionicons name="checkmark" size={15} color={COLORS.textOnPrimary} />
                      <Text style={styles.detectActionTxt}>Guardar ({autoHazardResults.length})</Text>
                    </TouchableOpacity>
                  </>
                )}
                {hazardDraft.length >= 3 && (
                  <TouchableOpacity style={styles.detectSaveBtn} onPress={saveHazard}>
                    <Ionicons name="checkmark" size={15} color={COLORS.textOnPrimary} />
                    <Text style={styles.detectActionTxt}>Guardar zona</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {/* ── Detect mode UI (replaces mode bars) ── */}
          {isDeveloper && showDetect ? (
            <>
              {/* Row 1: title + shape toggle + mode toggle + cancel */}
              <View style={styles.detectHeader}>
                <Text style={styles.detectHeaderTxt} numberOfLines={1}>
                  H{holes.find(h => h.id === selectedHoleId)?.number} · {detectResults.length > 0 ? `${detectResults.length}` : 'dibuja'} · {detectMode === 'tees' ? 'TEES' : 'Auto'}
                </Text>
                <View style={styles.detectShapeToggle}>
                  <TouchableOpacity
                    style={[styles.detectShapeBtn, detectShape === 'circle' && styles.detectShapeBtnOn]}
                    onPress={() => { setDetectShape('circle'); setDetectPts([]); }}
                  >
                    <Ionicons name="radio-button-off" size={14} color={detectShape === 'circle' ? '#6c3483' : COLORS.textOnPrimary} />
                    <Text style={[styles.detectShapeTxt, detectShape === 'circle' && { color: '#6c3483' }]}>Círculo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.detectShapeBtn, detectShape === 'polygon' && styles.detectShapeBtnOn]}
                    onPress={() => { setDetectShape('polygon'); setDetectPts([]); }}
                  >
                    <Ionicons name="shapes-outline" size={14} color={detectShape === 'polygon' ? '#6c3483' : COLORS.textOnPrimary} />
                    <Text style={[styles.detectShapeTxt, detectShape === 'polygon' && { color: '#6c3483' }]}>Polígono</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.detectShapeBtn, detectMode === 'tees' && styles.detectShapeBtnOn]}
                    onPress={() => { setDetectMode(m => m === 'tees' ? 'auto' : 'tees'); setDetectResults([]); }}
                  >
                    <Ionicons name="radio-button-on" size={14} color={detectMode === 'tees' ? '#6c3483' : COLORS.textOnPrimary} />
                    <Text style={[styles.detectShapeTxt, detectMode === 'tees' && { color: '#6c3483' }]}>Tees</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => { setShowDetect(false); setDetectResults([]); setDetectPts([]); setDetectMode('auto'); }}>
                  <Text style={styles.detectCancelTxt}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Row 2: controls */}
              <View style={styles.detectControls}>
                {detectShape === 'circle' ? (
                  <>
                    <TouchableOpacity style={styles.detectRadBtn} onPress={() => setDetectRadius(r => Math.max(50, r - 25))}>
                      <Ionicons name="remove" size={18} color={COLORS.textOnPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.detectRadTxt}>Radio: {detectRadius}m</Text>
                    <TouchableOpacity style={styles.detectRadBtn} onPress={() => setDetectRadius(r => Math.min(600, r + 25))}>
                      <Ionicons name="add" size={18} color={COLORS.textOnPrimary} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.detectRadTxt}>{detectPts.length} puntos · toca el mapa</Text>
                    <TouchableOpacity style={styles.detectRadBtn}
                      onPress={() => setDetectPts(prev => prev.slice(0, -1))}
                      disabled={detectPts.length === 0}
                    >
                      <Ionicons name="arrow-undo" size={16} color={detectPts.length === 0 ? 'rgba(255,255,255,0.3)' : COLORS.textOnPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.detectRadBtn}
                      onPress={() => setDetectPts([])}
                      disabled={detectPts.length === 0}
                    >
                      <Ionicons name="trash-outline" size={16} color={detectPts.length === 0 ? 'rgba(255,255,255,0.3)' : COLORS.textOnPrimary} />
                    </TouchableOpacity>
                  </>
                )}
                <View style={{ flex: 1 }} />
                {detectResults.length > 0 && (
                  <TouchableOpacity style={styles.detectClearBtn} onPress={() => setDetectResults([])}>
                    <Text style={styles.detectActionTxt}>Limpiar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.detectSearchBtn}
                  onPress={runDetect}
                  disabled={detecting || (detectShape === 'circle' ? !detectCenter : detectPts.length < 3)}
                >
                  {detecting
                    ? <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
                    : <><Ionicons name="search" size={15} color={COLORS.textOnPrimary} /><Text style={styles.detectActionTxt}>{detectResults.length > 0 ? 'Añadir más' : 'Buscar'}</Text></>}
                </TouchableOpacity>
                {detectResults.length > 0 && (
                  detectMode === 'tees' ? (
                    <TouchableOpacity style={styles.detectSaveBtn} onPress={saveDetectedTees}
                      disabled={detectResults.filter(f => f.golfType === 'tee').length === 0}>
                      <Ionicons name="checkmark" size={15} color={COLORS.textOnPrimary} />
                      <Text style={styles.detectActionTxt}>
                        Asignar tees ({detectResults.filter(f => f.golfType === 'tee').length})
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.detectSaveBtn} onPress={saveDetected}>
                      <Ionicons name="checkmark" size={15} color={COLORS.textOnPrimary} />
                      <Text style={styles.detectActionTxt}>Guardar ({detectResults.length})</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </>
          ) : (
          <>

          {isDeveloper && (<>
          {/* Point mode selector */}
          <View style={styles.modeBar}>
            {MAP_MODES.map(({ key, label, color }) => (
              <TouchableOpacity
                key={key}
                style={[styles.modeBtn, mapMode === key && { backgroundColor: color }]}
                onPress={() => switchMode(key)}
              >
                <View style={[styles.modeDot, { backgroundColor: mapMode === key ? COLORS.textOnPrimary : color }]} />
                <Text style={[styles.modeTxt, mapMode === key && { color: COLORS.textOnPrimary }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Zone mode selector */}
          <View style={styles.modeBar}>
            {ZONE_MODES.map(({ key, label, color }) => (
              <TouchableOpacity
                key={key}
                style={[styles.modeBtn, mapMode === key && { backgroundColor: color }]}
                onPress={() => switchMode(key)}
              >
                <View style={[styles.modeDot, { backgroundColor: mapMode === key ? COLORS.textOnPrimary : color }]} />
                <Text style={[styles.modeTxt, mapMode === key && { color: COLORS.textOnPrimary }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Hint / polygon controls */}
          {isPointMode(mapMode) ? (
            <View style={styles.hintBar}>
              <Text style={styles.hintTxt} numberOfLines={1}>
                {selectedHoleId
                  ? `H${holes.find(h => h.id === selectedHoleId)?.number} · pulsa para marcar ${MAP_MODES.find(m => m.key === mapMode)!.desc} · arrastra un pin para ajustar`
                  : 'Elige un hoyo abajo → mantén pulsado en el mapa'}
              </Text>
            </View>
          ) : (
            <>
              {/* Draw tool selector */}
              <View style={styles.toolBar}>
                {([
                  { key: 'vertices', label: 'Vértices', icon: 'ellipse-outline' },
                  { key: 'pencil',   label: 'Lápiz',    icon: 'pencil' },
                  { key: 'circle',   label: 'Círculo',  icon: 'radio-button-off' },
                ] as const).map(({ key, label, icon }) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.toolBtn, drawTool === key && styles.toolBtnActive]}
                    onPress={() => switchTool(key)}
                  >
                    <Ionicons name={icon} size={15} color={drawTool === key ? COLORS.primary : COLORS.textSecondary} />
                    <Text style={[styles.toolTxt, drawTool === key && styles.toolTxtActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.polyBar}>
                <Text style={styles.polyTxt} numberOfLines={1}>
                  {!selectedHoleId
                    ? 'Elige un hoyo para dibujar'
                    : drawTool === 'pencil'
                      ? `${ZONE_MODES.find(m => m.key === mapMode)!.label}: arrastra el dedo (${draftPts.length})`
                      : drawTool === 'circle'
                        ? `${ZONE_MODES.find(m => m.key === mapMode)!.label}: toca el centro${circle ? ` · r=${circle.radius}m` : ''}`
                        : `${ZONE_MODES.find(m => m.key === mapMode)!.label}: toca vértices (${draftPts.length})`}
                </Text>

                {drawTool === 'circle' && circle && (
                  <>
                    <TouchableOpacity style={styles.polyMini} onPress={() => changeRadius(-3)}>
                      <Ionicons name="remove" size={18} color={COLORS.textOnPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.polyMini} onPress={() => changeRadius(3)}>
                      <Ionicons name="add" size={18} color={COLORS.textOnPrimary} />
                    </TouchableOpacity>
                  </>
                )}
                {drawTool !== 'circle' && (
                  <TouchableOpacity
                    style={styles.polyMini}
                    onPress={() => setDraftPts(prev => prev.slice(0, -1))}
                    disabled={draftPts.length === 0}
                  >
                    <Ionicons name="arrow-undo" size={16} color={draftPts.length === 0 ? '#7ab87a' : COLORS.textOnPrimary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.polySave} onPress={closePolygon}>
                  <Ionicons name="checkmark" size={15} color={COLORS.textOnPrimary} />
                  <Text style={styles.polySaveTxt}>Guardar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          </>)}

          {/* Hole pills */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={styles.pillScroll}
            contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}
          >
            {holes.map(hole => {
              const hasAny = hole.frontLat !== 0 || hole.centerLat !== 0 || hole.backLat !== 0 || hole.teeLat !== 0;
              const active = selectedHoleId === hole.id;
              return (
                <TouchableOpacity
                  key={hole.id}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => selectHole(hole)}
                >
                  <Text style={[styles.pillNum, active && styles.pillNumActive]}>{hole.number}</Text>
                  {hasAny && <View style={styles.pillIndicator} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          </>
          )}

          {/* ── Detected tees bar ── */}
          {/* Map */}
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            mapType="hybrid"
            maxZoomLevel={22}
            initialRegion={mapRegion}
            onLongPress={isDeveloper ? handleMapLongPress : undefined}
            onPress={handleMapPress}
            onPanDrag={handlePanDrag}
            onRegionChangeComplete={r => setLiveCenter({ lat: r.latitude, lon: r.longitude })}
            scrollEnabled={!(isZoneMode && drawTool === 'pencil')}
            pitchEnabled={false}
            moveOnMarkerPress={false}
            showsUserLocation
            showsCompass
          >
            {/* Saved zones */}
            {zones.map(z => z.points.length >= 3 && (
              <Polygon
                key={z.id}
                coordinates={z.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={ZONE_FILL[z.type]}
                strokeColor="rgba(255,255,255,0.8)"
                strokeWidth={1}
                tappable
                onPress={() => removeZone(z.id)}
              />
            ))}
            {/* Course-wide hazards */}
            {hazards.map(h => h.points.length >= 3 && (
              <Polygon
                key={h.id}
                coordinates={h.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={h.type === 'agua' ? 'rgba(41,128,185,0.40)' : 'transparent'}
                strokeColor={h.type === 'agua' ? 'rgba(41,128,185,0.90)' : 'rgba(220,38,38,1)'}
                strokeWidth={h.type === 'ob' ? 3.5 : 2}
                tappable
                onPress={() => removeHazard(h.id)}
              />
            ))}
            {/* Auto-detected hazards preview */}
            {isDeveloper && autoHazardResults.map((h, i) => h.points.length >= 3 && (
              <Polygon
                key={`auto-h-${i}`}
                coordinates={h.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={h.type === 'agua' ? 'rgba(41,128,185,0.35)' : 'transparent'}
                strokeColor={h.type === 'agua' ? 'rgba(41,128,185,1)' : 'rgba(220,38,38,1)'}
                strokeWidth={h.type === 'ob' ? 3.5 : 2.5}
              />
            ))}
            {/* Hazard draft polygon */}
            {isDeveloper && hazardMode && hazardDraft.length >= 2 && (
              <Polygon
                coordinates={hazardDraft.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={hazardType === 'agua' ? 'rgba(41,128,185,0.25)' : 'rgba(231,76,60,0.15)'}
                strokeColor={hazardType === 'agua' ? 'rgba(41,128,185,0.9)' : 'rgba(231,76,60,0.9)'}
                strokeWidth={2}
              />
            )}
            {/* Draft polygon being drawn */}
            {isDeveloper && draftPts.length >= 2 && (
              <Polygon
                coordinates={draftPts.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor="rgba(255,255,255,0.25)"
                strokeColor={COLORS.textOnPrimary}
                strokeWidth={2}
              />
            )}
            {isDeveloper && draftPts.map((p, i) => (
              <Marker
                key={`draft-${i}`}
                coordinate={{ latitude: p.lat, longitude: p.lon }}
                draggable={drawTool === 'vertices'}
                onDragEnd={(e) => onDraftVertexDrag(i, e)}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.vertexDot} />
              </Marker>
            ))}

            {holes.map(hole => (
              <React.Fragment key={hole.id}>
                {hole.frontLat !== 0 && (
                  <Marker
                    coordinate={{ latitude: hole.frontLat, longitude: hole.frontLon }}
                    title={`H${hole.number} Pin Rojo`} pinColor="red"
                    draggable={isDeveloper}
                    onDragEnd={(e) => onPointDragEnd(hole.id, 'red', e)}
                    onPress={() => selectHole(hole)}
                  />
                )}
                {hole.centerLat !== 0 && (
                  <Marker
                    coordinate={{ latitude: hole.centerLat, longitude: hole.centerLon }}
                    title={`H${hole.number} Pin Amarillo`} pinColor="yellow"
                    draggable={isDeveloper}
                    onDragEnd={(e) => onPointDragEnd(hole.id, 'yellow', e)}
                    onPress={() => selectHole(hole)}
                  />
                )}
                {hole.backLat !== 0 && (
                  <Marker
                    coordinate={{ latitude: hole.backLat, longitude: hole.backLon }}
                    title={`H${hole.number} Pin Azul`} pinColor="blue"
                    draggable={isDeveloper}
                    onDragEnd={(e) => onPointDragEnd(hole.id, 'blue', e)}
                    onPress={() => selectHole(hole)}
                  />
                )}
                {hole.teeLat !== 0 && (
                  <Marker
                    coordinate={{ latitude: hole.teeLat, longitude: hole.teeLon }}
                    title={`H${hole.number} Tee`} pinColor="orange"
                    draggable={isDeveloper}
                    onDragEnd={(e) => onPointDragEnd(hole.id, 'tee', e)}
                    onPress={() => selectHole(hole)}
                  />
                )}
              </React.Fragment>
            ))}
            {/* ── Detect: search circle + polygon draw preview ── */}
            {isDeveloper && showDetect && detectShape === 'circle' && detectCenter && (
              <>
                <Circle
                  center={{ latitude: detectCenter.lat, longitude: detectCenter.lon }}
                  radius={detectRadius}
                  strokeColor="rgba(155,89,182,0.9)"
                  strokeWidth={2}
                  fillColor="rgba(155,89,182,0.12)"
                />
                <Marker
                  coordinate={{ latitude: detectCenter.lat, longitude: detectCenter.lon }}
                  draggable
                  onDragEnd={e => { setDetectCenter({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude }); }}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={styles.detectDot} />
                </Marker>
              </>
            )}
            {isDeveloper && showDetect && detectShape === 'polygon' && detectPts.length >= 2 && (
              <Polygon
                coordinates={detectPts.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor="rgba(155,89,182,0.18)"
                strokeColor="rgba(155,89,182,0.9)"
                strokeWidth={2}
              />
            )}
            {isDeveloper && showDetect && detectShape === 'polygon' && detectPts.map((p, i) => (
              <Marker key={`dpt-${i}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.detectDot} />
              </Marker>
            ))}
            {isDeveloper && detectResults.map((feat, i) => feat.points.length >= 3 && (
              <Polygon
                key={`det-${i}`}
                coordinates={feat.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={
                  feat.golfType === 'green'        ? 'rgba(46,204,113,0.6)' :
                  feat.golfType === 'bunker'        ? 'rgba(212,160,23,0.6)' :
                  feat.golfType === 'fairway'       ? 'rgba(39,174,96,0.5)'  :
                  feat.golfType === 'water_hazard'  ? 'rgba(41,128,185,0.6)' :
                                                      'rgba(230,126,34,0.5)'
                }
                strokeColor="rgba(255,255,255,0.9)"
                strokeWidth={2}
              />
            ))}
          </MapView>

          {/* ── Floating save button (zone drawn, ≥3 pts) ── */}
          {isDeveloper && !showDetect && isZoneMode && draftPts.length >= 3 && (
            <TouchableOpacity style={styles.zoneSaveFloat} onPress={closePolygon}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.textOnPrimary} />
              <Text style={styles.polySaveTxt}>Guardar zona</Text>
            </TouchableOpacity>
          )}

          {/* ── Detect button (shown when hole selected, not in detect mode) ── */}
          {isDeveloper && !showDetect && !hazardMode && selectedHoleId && (
            <TouchableOpacity style={styles.detectBtn} onPress={enterDetectMode}>
              <Ionicons name="search" size={16} color={COLORS.textOnPrimary} />
              <Text style={styles.detectBtnTxt}>Detectar hoyo</Text>
            </TouchableOpacity>
          )}

          {/* ── Peligros del campo button ── */}
          {isDeveloper && !showDetect && !hazardMode && (
            <TouchableOpacity style={styles.hazardBtn} onPress={() => { setHazardMode(true); setHazardDraft([]); }}>
              <Ionicons name="warning-outline" size={16} color={COLORS.textOnPrimary} />
              <Text style={styles.hazardBtnTxt}>Peligros campo</Text>
            </TouchableOpacity>
          )}

          {/* OSM auto-import button */}
          {isDeveloper && <TouchableOpacity
            style={[styles.osmBtn, importing && styles.osmBtnBusy]}
            onPress={importFromOsm}
            disabled={importing}
          >
            {importing
              ? <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
              : <Ionicons name="cloud-download-outline" size={18} color={COLORS.textOnPrimary} />
            }
            <Text style={styles.osmBtnTxt}>{importing ? 'Importando…' : 'Importar del campo'}</Text>
          </TouchableOpacity>}
        </View>

      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm + 4 }}>

          {/* Course info */}
          <View style={styles.infoCard}>
            <TouchableOpacity style={styles.infoRow} onPress={() => setShowCountryPicker(true)}>
              <Text style={styles.infoLabel}>País</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.infoValue}>
                  {course.country
                    ? `${ALL_COUNTRIES.find(c => c.cca2 === course.country)?.flag ?? ''} ${ALL_COUNTRIES.find(c => c.cca2 === course.country)?.nameEs ?? course.country}`
                    : 'Sin asignar'}
                </Text>
                <Ionicons name="pencil" size={14} color={COLORS.textTertiary} />
              </View>
            </TouchableOpacity>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Course Rating</Text>
              <Text style={styles.infoValue}>{course.courseRating.toFixed(1)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Slope Rating</Text>
              <Text style={styles.infoValue}>{course.slopeRating}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Par total</Text>
              <Text style={styles.infoValue}>{holes.reduce((a, h) => a + h.par, 0)}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Hoyos</Text>
          {holes.map((hole) => {
            const hasRed    = hole.frontLat  !== 0;
            const hasYellow = hole.centerLat !== 0;
            const hasBlue   = hole.backLat   !== 0;
            const hasTee    = hole.teeLat    !== 0;
            return (
              <TouchableOpacity
                key={hole.id}
                style={styles.holeCard}
                onPress={isDeveloper ? () => setExpandedHole(expandedHole === hole.id ? null : hole.id) : undefined}
                activeOpacity={isDeveloper ? 0.8 : 1}
              >
                <View style={styles.holeHeader}>
                  <View style={styles.holeNum}>
                    <Text style={styles.holeNumText}>{hole.number}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.holePar}>Par {hole.par}</Text>
                    <Text style={styles.holeMeta}>HI {hole.handicapIndex} · {hole.distanceMeters}m</Text>
                  </View>
                  <View style={styles.badges}>
                    {hasRed    && <View style={[styles.dot, { backgroundColor: '#e74c3c' }]} />}
                    {hasYellow && <View style={[styles.dot, { backgroundColor: '#d4ac0d' }]} />}
                    {hasBlue   && <View style={[styles.dot, { backgroundColor: '#2980b9' }]} />}
                    {hasTee    && <View style={[styles.dot, { backgroundColor: '#e67e22' }]} />}
                  </View>
                  {isDeveloper && (
                    <Ionicons
                      name={expandedHole === hole.id ? 'chevron-up' : 'chevron-down'}
                      size={16} color={COLORS.textSecondary}
                    />
                  )}
                </View>

                {isDeveloper && expandedHole === hole.id && (
                  <View style={styles.holeExpanded}>
                    {/* Quick-mark with device GPS */}
                    <TouchableOpacity
                      style={styles.gpsBtn}
                      onPress={async () => {
                        if (!location) { Alert.alert('GPS no disponible'); return; }
                        const { latitude: lat, longitude: lon } = location.coords;
                        await updateHolePinColor(hole.id, 'yellow', lat, lon);
                        reload();
                        Alert.alert('Pin Amarillo guardado', `Hoyo ${hole.number}`);
                      }}
                    >
                      <Ionicons name="location-outline" size={15} color={COLORS.textOnPrimary} />
                      <Text style={styles.gpsBtnText}>Marcar pin Amarillo aquí (GPS móvil)</Text>
                    </TouchableOpacity>

                    {(hasRed || hasYellow || hasBlue || hasTee) && (
                      <View style={styles.coordsBlock}>
                        {hasRed    && <Text style={styles.coords}>🔴 {hole.frontLat.toFixed(5)}, {hole.frontLon.toFixed(5)}</Text>}
                        {hasYellow && <Text style={styles.coords}>🟡 {hole.centerLat.toFixed(5)}, {hole.centerLon.toFixed(5)}</Text>}
                        {hasBlue   && <Text style={styles.coords}>🔵 {hole.backLat.toFixed(5)}, {hole.backLon.toFixed(5)}</Text>}
                        {hasTee    && <Text style={styles.coords}>🟠 Tee {hole.teeLat.toFixed(5)}, {hole.teeLon.toFixed(5)}</Text>}
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row', backgroundColor: COLORS.card,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2, gap: SPACING.sm,
    borderBottomWidth: 1, borderColor: '#e9ecef',
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: '#f0f2f5',
  },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.textOnPrimary },

  // The bars below (map-mode / draw-tool / detect controls) are dense,
  // precisely-laid-out developer-only map editing tools — only their text
  // styling (font/color) is touched here, not padding/gap/radius, to avoid
  // any risk of shifting already-tuned touch targets on a screen this
  // interaction-heavy.
  modeBar: {
    flexDirection: 'row', backgroundColor: COLORS.card,
    paddingHorizontal: 10, paddingVertical: 8, gap: 6,
    borderBottomWidth: 1, borderColor: '#e9ecef',
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f0f2f5',
  },
  modeDot: { width: 8, height: 8, borderRadius: 4 },
  modeTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },

  hintBar: {
    backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8,
  },
  hintTxt: { fontSize: 12, fontFamily: FONT.body, color: COLORS.primaryMuted },

  polyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 7,
  },
  polyTxt: { flex: 1, fontSize: 12, fontFamily: FONT.body, color: COLORS.primaryMuted },
  toolBar: {
    flexDirection: 'row', backgroundColor: COLORS.card, gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderColor: '#e9ecef',
  },
  toolBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 7, borderRadius: 9, backgroundColor: '#f0f2f5',
  },
  toolBtnActive: { backgroundColor: '#d7ead7' },
  toolTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  toolTxtActive: { color: COLORS.primary },
  polyMini: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  polySave: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.success, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
  },
  polySaveTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  vertexDot: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.card,
    borderWidth: 2, borderColor: COLORS.primary,
  },

  pillScroll: {
    backgroundColor: COLORS.card, paddingVertical: SPACING.sm,
    maxHeight: 52, borderBottomWidth: 1, borderColor: '#e9ecef',
  },
  pill: {
    minWidth: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2,
    backgroundColor: '#f0f2f5',
  },
  pillActive: { backgroundColor: COLORS.primary },
  pillNum: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  pillNumActive: { color: COLORS.textOnPrimary },
  pillIndicator: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: COLORS.success, marginTop: 2,
  },

  infoCard: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm + 2, ...CARD_SHADOW },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 15, fontFamily: FONT.body, color: COLORS.textSecondary },
  infoValue: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  sectionTitle: {
    fontSize: 13, fontFamily: FONT.headingSemiBold, color: COLORS.primary,
    textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: SPACING.xs,
  },
  holeCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md,
    ...CARD_SHADOW,
  },
  holeHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  holeNum: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center',
  },
  holeNumText: { fontSize: 15, fontFamily: FONT.headingSemiBold, color: COLORS.primary },
  holePar: { fontSize: 15, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary },
  holeMeta: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  badges: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  holeExpanded: {
    marginTop: SPACING.sm + 4, gap: SPACING.sm, paddingTop: SPACING.sm + 4,
    borderTopWidth: 1, borderColor: '#f0f2f5',
  },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, padding: SPACING.sm + 2,
  },
  gpsBtnText: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONT.bodyMedium },
  coordsBlock: { gap: 3 },
  coords: { fontSize: 11, color: COLORS.textTertiary, fontFamily: 'monospace' },

  // Detect mode
  detectHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#6c3483', paddingHorizontal: 14, paddingVertical: 9,
  },
  detectHeaderTxt: { fontSize: 13, color: COLORS.textOnPrimary, fontFamily: FONT.bodyMedium, flex: 1 },
  detectCancelTxt: { fontSize: 13, color: '#e8d5f5', fontFamily: FONT.bodySemiBold, paddingLeft: 12 },
  detectControls: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#4a235a', paddingHorizontal: 12, paddingVertical: 8,
  },
  detectRadBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  detectRadTxt: { fontSize: 13, color: '#e8d5f5', fontFamily: FONT.bodySemiBold },
  detectSaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.success, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  detectSearchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  detectActionTxt: { fontSize: 13, color: COLORS.textOnPrimary, fontFamily: FONT.bodySemiBold },
  detectDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: 'rgba(155,89,182,0.8)', borderWidth: 2, borderColor: '#fff',
  },
  detectShapeToggle: { flexDirection: 'row', gap: 6 },
  detectShapeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  detectShapeBtnOn: { backgroundColor: '#e8d5f5' },
  detectShapeTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  detectClearBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  detectBtn: {
    position: 'absolute', bottom: 70, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#6c3483', borderRadius: 22,
    paddingHorizontal: 14, paddingVertical: 11,
    shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  detectBtnTxt: { color: COLORS.textOnPrimary, fontSize: 13, fontFamily: FONT.bodySemiBold },

  zoneSaveFloat: {
    position: 'absolute', bottom: 130, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.success, borderRadius: 28,
    paddingHorizontal: 28, paddingVertical: 14,
    shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 6, elevation: 6,
  },
  hazardBtn: {
    position: 'absolute', bottom: 124, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#c0392b', borderRadius: 22,
    paddingHorizontal: 14, paddingVertical: 11,
    shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  hazardBtnTxt: { color: COLORS.textOnPrimary, fontSize: 13, fontFamily: FONT.bodySemiBold },
  osmBtn: {
    position: 'absolute', bottom: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.info, borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: COLORS.shadow, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  osmBtnBusy: { backgroundColor: '#5d8aa8' },
  osmBtnTxt: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONT.bodySemiBold },

});
