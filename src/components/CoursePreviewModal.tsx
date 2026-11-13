import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import MapView, {
  Marker, Polygon, Polyline,
  Region, MarkerDragStartEndEvent, MapPressEvent,
} from 'react-native-maps';
import { getHoles, getZonesForCourse, getGPSShotsForRound, getCourseHazards, getTeePos, getClubProfiles, ClubProfile } from '../lib/api';
import { Hole, CourseZone, ZoneType, ShotMeasurement, CourseHazard, TeeColor, TEE_COLORS, TEE_LABELS, TEE_HEX } from '../types';
import { haversineM, bearing, midpoint, destinationPoint, LatLon } from '../services/geo';
import { recommendClub } from '../services/clubRecommendation';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT } from '../theme';

const PIN_COORDS: Record<'red' | 'yellow' | 'blue', (h: Hole) => LatLon> = {
  red:    h => ({ lat: h.frontLat,  lon: h.frontLon  }),
  yellow: h => ({ lat: h.centerLat, lon: h.centerLon }),
  blue:   h => ({ lat: h.backLat,   lon: h.backLon   }),
};

const ZONE_FILL: Record<ZoneType, string> = {
  green:  'rgba(46,204,113,0.45)',
  calle:  'rgba(39,174,96,0.30)',
  bunker: 'rgba(212,160,23,0.45)',
  agua:   'rgba(41,128,185,0.45)',
};

const TEE_RADII  = [70, 60, 50, 40] as const;
const APPR_RADII = [14, 12, 10, 8]  as const;

function arcPoints(center: LatLon, radiusM: number, startBearing: number, endBearing: number, steps = 40): LatLon[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const b = startBearing + (endBearing - startBearing) * (i / steps);
    return destinationPoint(center, radiusM, b);
  });
}

const TEE_DESCS: Record<TeeColor, string> = {
  black: 'Más largo', brown: 'Largo', blue: 'Medio-largo',
  yellow: 'Medio', orange: 'Medio-corto', red: 'Corto', silver: 'Más corto',
};
const TEE_OPTIONS = TEE_COLORS.map(c => ({
  color: c,
  label: TEE_LABELS[c],
  desc:  TEE_DESCS[c],
  dot:   TEE_HEX[c],
}));


interface Props {
  visible: boolean;
  courseId: string;
  courseName?: string;
  roundId?: string;
  initialPinColor?: 'red' | 'yellow' | 'blue';
  initialTeeColor?: TeeColor;
  initialHoleId?: string;
  onClose: () => void;
}

export function CoursePreviewModal({ visible, courseId, courseName, roundId, initialPinColor, initialTeeColor, initialHoleId, onClose }: Props) {
  const mapRef = useRef<MapView>(null);

  const [holes,    setHoles]    = useState<Hole[]>([]);
  const [zones,    setZones]    = useState<CourseZone[]>([]);
  const [hazards,  setHazards]  = useState<CourseHazard[]>([]);
  const [holeIdx,  setHoleIdx]  = useState(0);
  const [pinColor, setPinColor] = useState<'red' | 'yellow' | 'blue' | null>(null);
  const [teeColor, setTeeColor] = useState<TeeColor>(initialTeeColor ?? 'yellow');

  const [playerPos, setPlayerPos] = useState<LatLon | null>(null);
  const [flagPos,   setFlagPos]   = useState<LatLon | null>(null);
  const [movingFlag,   setMovingFlag]   = useState(false);
  const [movingPlayer, setMovingPlayer] = useState(false);

  const [is3D,         setIs3D]        = useState(true);
  const [circleMode,   setCircleMode]  = useState<'none' | 'tee' | 'appr'>('none');
  const [teeRadius,    setTeeRadius]   = useState<typeof TEE_RADII[number]>(70);
  const [apprRadius,   setApprRadius]  = useState<typeof APPR_RADII[number]>(14);
  const [mapCenter,     setMapCenter]     = useState<LatLon | null>(null);
  const [roundShots,    setRoundShots]    = useState<(ShotMeasurement & { holeId: string })[]>([]);
  const [crosshairOn,   setCrosshairOn]   = useState(false);
  const [latDelta,      setLatDelta]      = useState(0.005);
  const [teeScreenPt,  setTeeScreenPt]  = useState<{ x: number; y: number } | null>(null);
  const [flagScreenPt, setFlagScreenPt] = useState<{ x: number; y: number } | null>(null);
  const [clubProfiles, setClubProfiles] = useState<ClubProfile[]>([]);

  useEffect(() => {
    if (visible) getClubProfiles().then(setClubProfiles).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    (async () => {
      const [loadedHoles, zones, hazards, shots] = await Promise.all([
        getHoles(courseId),
        getZonesForCourse(courseId),
        getCourseHazards(courseId),
        roundId ? getGPSShotsForRound(roundId) : Promise.resolve([]),
      ]);
      if (!mounted) return;
      setHoles(loadedHoles);
      setZones(zones);
      setHazards(hazards);
      setRoundShots(shots);
      const startIdx = initialHoleId
        ? Math.max(0, loadedHoles.findIndex(h => h.id === initialHoleId))
        : 0;
      setHoleIdx(startIdx);
      setPinColor(initialPinColor ?? null);
      setTeeColor(initialTeeColor ?? 'yellow');
      setMovingFlag(false); setMovingPlayer(false);
      setCircleMode('none');
      setIs3D(false);
      setCrosshairOn(false);
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, courseId, roundId]);

  const currentHole = holes[holeIdx] ?? null;

  useEffect(() => {
    if (!currentHole || !pinColor) return;
    const pin = PIN_COORDS[pinColor](currentHole);
    const tee: LatLon | null = getTeePos(currentHole, teeColor);
    const newPlayer = tee ?? (pin.lat !== 0 ? pin : null);
    const newFlag   = pin.lat !== 0 ? pin : tee;
    setPlayerPos(newPlayer);
    setFlagPos(newFlag);
    setMovingFlag(false); setMovingPlayer(false);
    setShowGreenDists(false);
    focusCamera(currentHole, pin, tee, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIdx, pinColor]);

  async function updateScreenPoints(overrideTee?: LatLon | null, overrideFlag?: LatLon | null) {
    if (!mapRef.current) return;
    const teeCoord  = overrideTee  !== undefined ? overrideTee  : (playerPos ?? (currentHole ? getTeePos(currentHole, teeColor) : null));
    const flagCoord = overrideFlag !== undefined ? overrideFlag : flagPos;
    if (teeCoord)  setTeeScreenPt(await mapRef.current.pointForCoordinate({ latitude: teeCoord.lat, longitude: teeCoord.lon }));
    else           setTeeScreenPt(null);
    if (flagCoord) setFlagScreenPt(await mapRef.current.pointForCoordinate({ latitude: flagCoord.lat, longitude: flagCoord.lon }));
    else           setFlagScreenPt(null);
  }

  function focusCamera(hole: Hole, pin: LatLon, tee: LatLon | null, use3D: boolean) {
    if (!mapRef.current) return;
    if (use3D && tee && pin.lat !== 0) {
      const h = bearing(tee, pin);
      const d = haversineM(tee.lat, tee.lon, pin.lat, pin.lon) || 150;
      const zoom = Math.max(13, Math.min(17.5, 15.5 - Math.log2(d / 130)));
      mapRef.current.animateCamera({
        center: { latitude: tee.lat + (pin.lat - tee.lat) * 0.3, longitude: tee.lon + (pin.lon - tee.lon) * 0.3 },
        heading: h, pitch: 55, zoom,
      }, { duration: 800 });
    } else {
      const pts: LatLon[] = [];
      if (tee) pts.push(tee);
      if (pin.lat !== 0) pts.push(pin);
      if (pts.length === 0) return;
      const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);
      const d = pts.length > 1 ? haversineM(minLat, minLon, maxLat, maxLon) : 0;
      // zoom so tee sits at ~20% from bottom and green at ~80% (hole fills 60% of screen)
      const zoom = d > 0 ? Math.max(13, Math.min(16, 14.3 - Math.log2(d / 130))) : 15.5;
      const h = (tee && pin.lat !== 0) ? bearing(tee, pin) : 0;
      mapRef.current.animateCamera({
        center: { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2 },
        heading: h, pitch: 0, zoom,
      }, { duration: 650 });
    }
  }

  function toggle3D() {
    if (!currentHole || !pinColor) return;
    const next = !is3D;
    setIs3D(next);
    const pin = PIN_COORDS[pinColor](currentHole);
    const tee: LatLon | null = getTeePos(currentHole, teeColor);
    focusCamera(currentHole, pin, tee, next);
  }

  // Returns the exact geographic coordinate at the screen-center dot.
  // coordinateForPoint accounts for pitch/heading, unlike onRegionChange center.
  async function dotCoord(): Promise<LatLon | null> {
    if (!mapRef.current) return null;
    const { width: sw, height: sh } = Dimensions.get('window');
    const c = await mapRef.current.coordinateForPoint({ x: sw / 2, y: sh / 2 });
    return { lat: c.latitude, lon: c.longitude };
  }

  async function confirmMoving() {
    const pt = await dotCoord();
    if (!pt) return;
    if (movingFlag)   { setFlagPos(pt);   setMovingFlag(false); }
    if (movingPlayer) { setPlayerPos(pt); setMovingPlayer(false); }
  }

  function selectCircleMode(m: 'tee' | 'appr') {
    setCircleMode(prev => prev === m ? 'none' : m);
  }

  function handleMapPress(_e: MapPressEvent) {
    // circles now follow mapCenter — no tap-to-place needed
  }

  const [showGreenDists, setShowGreenDists] = useState(false);

  const playerToPin = playerPos && flagPos
    ? haversineM(playerPos.lat, playerPos.lon, flagPos.lat, flagPos.lon) : null;
  const isMoving = movingFlag || movingPlayer;

  // ── Green front/center/back distances (before early returns for hooks order) ──
  // Front/back must be measured ALONG the line of play (player → flag), not as the
  // straight-line distance to whichever green-boundary vertex happens to be nearest/
  // farthest in a straight line — for anything but a perfectly round green centred
  // dead ahead, a side corner of the polygon can be "closer" than the true front edge,
  // which is exactly what made this wrong on some (irregularly-shaped) holes.
  const greenDists = useMemo(() => {
    if (!playerPos || !currentHole) return null;
    const greenZone = zones.find(z => z.holeId === currentHole.id && z.type === 'green');
    if (!greenZone || greenZone.points.length < 3) return null;
    const aimTarget = flagPos ?? midpoint(greenZone.points[0], greenZone.points[Math.floor(greenZone.points.length / 2)]);
    const aimDist = haversineM(playerPos.lat, playerPos.lon, aimTarget.lat, aimTarget.lon);
    if (aimDist === 0) return null;

    // Local flat-earth projection (fine at green-scale distances): convert every
    // green-boundary point to metres relative to the player, then project onto
    // the unit vector pointing from the player toward the flag.
    const latRef = playerPos.lat * Math.PI / 180;
    const mPerLat = 111320, mPerLon = 111320 * Math.cos(latRef);
    const toXY = (p: LatLon) => ({
      x: (p.lon - playerPos.lon) * mPerLon,
      y: (p.lat - playerPos.lat) * mPerLat,
    });
    const aimXY = toXY(aimTarget);
    const axisLen = Math.hypot(aimXY.x, aimXY.y) || 1;
    const ux = aimXY.x / axisLen, uy = aimXY.y / axisLen;

    const along = greenZone.points.map(p => {
      const { x, y } = toXY(p);
      return x * ux + y * uy;
    });
    const front = Math.round(Math.min(...along));
    const back = Math.round(Math.max(...along));
    const center = Math.round((front + back) / 2);
    return { front, center, back };
  }, [playerPos, flagPos, currentHole?.id, zones]);

  // ── Shot segments (must be before early returns for hooks order) ──
  const shotSegments = useMemo(() => {
    if (!currentHole) return [];
    const holeShots = roundShots.filter(s => s.holeId === currentHole.id && s.lat !== 0);
    const teePt = getTeePos(currentHole, teeColor);
    const segs: { from: LatLon; to: LatLon; dist: number }[] = [];
    if (teePt && holeShots.length > 0)
      segs.push({ from: teePt, to: { lat: holeShots[0].lat, lon: holeShots[0].lon }, dist: holeShots[0].distanceMeters });
    for (let i = 0; i < holeShots.length - 1; i++)
      segs.push({ from: { lat: holeShots[i].lat, lon: holeShots[i].lon }, to: { lat: holeShots[i + 1].lat, lon: holeShots[i + 1].lon }, dist: holeShots[i + 1].distanceMeters });
    return segs;
  }, [roundShots, currentHole?.id, currentHole?.teeLat, currentHole?.teeLon]);

  // Club recommendation from the manually-placed player marker — the same
  // logic the active round's live-GPS card uses, but fed by `playerToPin`
  // (drag the player/flag markers) instead of a real device location. Useful
  // both off-course (testing, planning a round in advance) and on-course as
  // a manual double-check alongside the GPS-driven one.
  const clubRec = useMemo(
    () => (playerToPin !== null ? recommendClub(playerToPin, clubProfiles) : null),
    [playerToPin, clubProfiles],
  );

  // ── Tee selection screen ─────────────────────────────────────────────────
  if (!pinColor) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.teeScreen}>
          <Text style={styles.teeTitle}>{courseName ?? 'Vista previa'}</Text>
          <Text style={styles.teeSub}>Elige desde qué tees juegas</Text>
          <View style={{ gap: 12, marginTop: 8 }}>
            {TEE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.color}
                style={[styles.teeBtn, { borderColor: opt.dot }]}
                onPress={() => {
                  setTeeColor(opt.color);
                  const pin: 'red' | 'yellow' | 'blue' =
                    (opt.color === 'black' || opt.color === 'brown') ? 'blue' :
                    (opt.color === 'orange' || opt.color === 'red' || opt.color === 'silver') ? 'red' :
                    'yellow';
                  setPinColor(pin);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.teeDot, { backgroundColor: opt.dot }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.teeBtnLabel}>{opt.label}</Text>
                  <Text style={styles.teeBtnDesc}>{opt.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={opt.dot} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.teeBackBtn} onPress={onClose}>
            <Ionicons name="chevron-back" size={18} color="#8e9aaf" />
            <Text style={styles.teeBackTxt}>Volver</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  if (!currentHole) return null;

  const pin    = PIN_COORDS[pinColor](currentHole);
  const teePt: LatLon | null = getTeePos(currentHole, teeColor);
  const hasTee = teePt !== null;
  const hasPin = pin.lat !== 0;

  const holeDist = hasTee && hasPin
    ? haversineM(teePt!.lat, teePt!.lon, pin.lat, pin.lon)
    : currentHole.distanceMeters;

  const holeZones = zones.filter(z => z.holeId === currentHole.id);

  const holeShots = roundShots.filter(s => s.holeId === currentHole.id && s.lat !== 0);
  const lastShot = holeShots[holeShots.length - 1] ?? null;
  const toPin = lastShot && hasPin
    ? { from: { lat: lastShot.lat, lon: lastShot.lon }, to: pin, dist: haversineM(lastShot.lat, lastShot.lon, pin.lat, pin.lon) }
    : null;

  const initialRegion = (() => {
    const pts: LatLon[] = [];
    if (hasTee) pts.push(teePt!);
    if (hasPin) pts.push(pin);
    if (pts.length === 0) return { latitude: 39.5872, longitude: -0.4669, latitudeDelta: 0.005, longitudeDelta: 0.005 };
    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    return {
      latitude:  (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
      latitudeDelta:  Math.max(Math.max(...lats) - Math.min(...lats), 0.003) * 1.6,
      longitudeDelta: Math.max(Math.max(...lons) - Math.min(...lons), 0.003) * 1.6,
    };
  })();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        {/* ── Map ── */}
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          mapType={'satelliteFlyover' as any}
          initialRegion={initialRegion}
          onRegionChange={(r: Region) => { setMapCenter({ lat: r.latitude, lon: r.longitude }); setLatDelta(r.latitudeDelta); if (crosshairOn) updateScreenPoints(); }}
          onRegionChangeComplete={async () => {
            const pt = await dotCoord();
            if (pt) setMapCenter(pt);
            if (crosshairOn) updateScreenPoints();
          }}
          onPress={handleMapPress}
          moveOnMarkerPress={false}
          showsCompass={false}
          maxZoomLevel={22}
        >
          {/* Zone polygons */}
          {holeZones.map(z => z.points.length >= 3 && (
            <Polygon key={z.id}
              coordinates={z.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
              fillColor={ZONE_FILL[z.type]} strokeColor="rgba(255,255,255,0.5)" strokeWidth={1}
            />
          ))}
          {/* Course-wide hazards */}
          {hazards.map(h => h.points.length >= 3 && (
            <Polygon key={h.id}
              coordinates={h.points.map(p => ({ latitude: p.lat, longitude: p.lon }))}
              fillColor={h.type === 'agua' ? 'rgba(41,128,185,0.40)' : 'transparent'}
              strokeColor={h.type === 'agua' ? 'rgba(41,128,185,0.90)' : 'rgba(220,38,38,1)'}
              strokeWidth={h.type === 'ob' ? 3.5 : 2}
            />
          ))}


          {/* ── Shot path lines ── */}
          {shotSegments.map((seg, i) => (
            <Polyline key={`ss-${i}`}
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
          {shotSegments.map((seg, i) => {
            const mid = midpoint(seg.from, seg.to);
            return (
              <Marker key={`sl-${i}`} coordinate={{ latitude: mid.lat, longitude: mid.lon }}
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
          {holeShots.map((s, i) => (
            <Marker key={`sm-${s.id}`} coordinate={{ latitude: s.lat, longitude: s.lon }}
              anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
              <View style={styles.shotPin}><Text style={styles.shotPinTxt}>{i + 1}</Text></View>
            </Marker>
          ))}

          {/* Tee reference marker */}
          {hasTee && (
            <Marker
              coordinate={{ latitude: teePt!.lat, longitude: teePt!.lon }}
              anchor={{ x: 0.5, y: 0.5 }} tappable={false} tracksViewChanges={false}
            >
              <View style={styles.teeMarker}><Text style={styles.teeMarkerTxt}>T</Text></View>
            </Marker>
          )}

          {/* Player position — draggable */}
          {playerPos && !isMoving && (
            <Marker
              coordinate={{ latitude: playerPos.lat, longitude: playerPos.lon }}
              draggable
              onDragEnd={(e: MarkerDragStartEndEvent) => { const p = { lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude }; setPlayerPos(p); if (crosshairOn) updateScreenPoints(p, undefined); }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.playerMarker}>
                <Ionicons name="walk" size={16} color="#fff" />
              </View>
            </Marker>
          )}

          {/* Flag/pin — draggable */}
          {flagPos && !isMoving && (
            <Marker
              coordinate={{ latitude: flagPos.lat, longitude: flagPos.lon }}
              draggable
              onDragEnd={(e: MarkerDragStartEndEvent) => { const p = { lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude }; setFlagPos(p); if (crosshairOn) updateScreenPoints(undefined, p); }}
              anchor={{ x: 0.5, y: 1.0 }}
            >
              <View style={styles.flagMarker}>
                <Ionicons name="flag" size={15} color="#fff" />
              </View>
            </Marker>
          )}

          {/* ── Tee arc: centred on playerPos, passes through dot, spans teeRadius m total ── */}
          {circleMode === 'tee' && playerPos && mapCenter && (() => {
            const dist = haversineM(playerPos.lat, playerPos.lon, mapCenter.lat, mapCenter.lon);
            if (dist < 1) return null;
            const aimBearing  = bearing(playerPos, mapCenter);
            const halfAngleDeg = (teeRadius / 2 / dist) * (180 / Math.PI);
            const arc = arcPoints(playerPos, dist, aimBearing - halfAngleDeg, aimBearing + halfAngleDeg);
            return (
              <Polyline
                coordinates={arc.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                strokeColor="rgba(255,255,255,0.9)"
                strokeWidth={1.5}
              />
            );
          })()}
        </MapView>

        {/* ── Top info bar ── */}
        <View style={styles.topBar}>
          {/* To Hole pill — tap to show front/center/back */}
          <TouchableOpacity
            style={[styles.topPill, showGreenDists && styles.topPillActive]}
            onPress={() => setShowGreenDists(v => !v)}
            activeOpacity={0.8}
          >
            {showGreenDists && greenDists ? (
              <>
                <Text style={styles.topPillLabel}>Green</Text>
                <View style={styles.greenDistRow}>
                  <View style={styles.greenDistItem}>
                    <Text style={styles.greenDistLbl}>Delante</Text>
                    <Text style={styles.greenDistNum}>{greenDists.front}m</Text>
                  </View>
                  <View style={styles.greenDistDivider} />
                  <View style={styles.greenDistItem}>
                    <Text style={styles.greenDistLbl}>Centro</Text>
                    <Text style={styles.greenDistNum}>{greenDists.center}m</Text>
                  </View>
                  <View style={styles.greenDistDivider} />
                  <View style={styles.greenDistItem}>
                    <Text style={styles.greenDistLbl}>Detrás</Text>
                    <Text style={styles.greenDistNum}>{greenDists.back}m</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.topPillLabel}>To Hole</Text>
                <Text style={styles.topPillNum}>{playerToPin !== null ? `${playerToPin} m` : '—'}</Text>
                {greenDists && <Text style={styles.topPillHint}>toca para detalles</Text>}
              </>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <View style={styles.topPill} pointerEvents="none">
            <Text style={styles.topPillLabel}>From Tee</Text>
            <Text style={styles.topPillNum}>{holeDist} m</Text>
          </View>
        </View>

        {/* ── Club recommendation from the player marker's distance ── */}
        {!isMoving && clubRec && (
          <View style={styles.clubRecPill} pointerEvents="none">
            <View style={styles.clubRecChip}><Text style={styles.clubRecChipTxt}>{clubRec.club}</Text></View>
            <Text style={styles.clubRecTxt}>tu media {clubRec.avgDist}m</Text>
            {clubRec.avgLateral !== null && Math.abs(clubRec.avgLateral) >= 2 && (
              <Text style={styles.clubRecTendency}>
                · {Math.abs(Math.round(clubRec.avgLateral))}m {clubRec.avgLateral > 0 ? 'der.' : 'izq.'}
              </Text>
            )}
          </View>
        )}

        {/* ── Crosshair when moving ── */}
        {isMoving && (
          <>
            {/* Dot — exactly at map center */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <View style={styles.reticleBox}>
                  <View style={[styles.rArm, styles.rTop]} />
                  <View style={[styles.rArm, styles.rBottom]} />
                  <View style={[styles.rArm, styles.rLeft]} />
                  <View style={[styles.rArm, styles.rRight]} />
                  <View style={[styles.rDot, { backgroundColor: movingFlag ? COLORS.success : COLORS.info }]} />
                </View>
              </View>
            </View>
            {/* Badge — below center, not affecting dot position */}
            <View pointerEvents="none" style={styles.xhBottomLabel}>
              <View style={styles.rBadge}>
                <Text style={styles.rBadgeTxt}>{movingFlag ? 'Coloca el pin' : 'Coloca tu posición'}</Text>
              </View>
            </View>
            <View style={styles.movingBar}>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: movingFlag ? COLORS.success : COLORS.info }]} onPress={confirmMoving}>
                <Ionicons name="checkmark" size={20} color="#fff" />
                <Text style={styles.confirmTxt}>Guardar posición</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setMovingFlag(false); setMovingPlayer(false); }}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Crosshair mode overlay ── */}
        {/* ── Appr circle — screen-space, always centred on dot ── */}
        {circleMode === 'appr' && !isMoving && (() => {
          const { height: sh, width: sw } = Dimensions.get('window');
          const mpp = latDelta > 0 ? (latDelta * 111320) / sh : 1;
          const pr  = Math.round(apprRadius / mpp);
          return (
            <View pointerEvents="none" style={{
              position: 'absolute',
              top:  sh / 2 - pr, left: sw / 2 - pr,
              width: pr * 2, height: pr * 2,
              borderRadius: pr, borderWidth: 2.5,
              borderColor: 'rgba(46,204,113,0.95)',
              backgroundColor: 'rgba(46,204,113,0.07)',
            }} />
          );
        })()}

        {crosshairOn && !isMoving && (() => {
          const { height: sh, width: sw } = Dimensions.get('window');
          const cx = sw / 2, cy = sh / 2;
          const pinEnd = flagPos ?? (hasPin ? pin : null);
          const teeEnd = playerPos ?? teePt;
          const distToPin = mapCenter && pinEnd ? haversineM(mapCenter.lat, mapCenter.lon, pinEnd.lat, pinEnd.lon) : null;
          const distToTee = mapCenter && teeEnd ? haversineM(mapCenter.lat, mapCenter.lon, teeEnd.lat, teeEnd.lon) : null;

          function screenLine(pt: { x: number; y: number }, color: string) {
            const dx = pt.x - cx, dy = pt.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 2) return null;
            const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
            return (
              <View style={{
                position: 'absolute',
                width: 2, height: dist,
                backgroundColor: color,
                top: cy + dy / 2 - dist / 2,
                left: cx + dx / 2 - 1,
                transform: [{ rotate: `${angle}deg` }],
              }} />
            );
          }

          return (
            <>
              {/* Lines stopping exactly at tee/flag screen position */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {teeScreenPt  && screenLine(teeScreenPt,  'rgba(255,255,255,0.85)')}
                {flagScreenPt && screenLine(flagScreenPt, 'rgba(255,200,0,0.9)')}
              </View>
              {/* Dot — exactly at screen center */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={styles.reticleBox}>
                    <View style={[styles.rArm, styles.rTop]} />
                    <View style={[styles.rArm, styles.rBottom]} />
                    <View style={[styles.rArm, styles.rLeft]} />
                    <View style={[styles.rArm, styles.rRight]} />
                    <View style={[styles.rDot, { backgroundColor: '#fff' }]} />
                  </View>
                </View>
              </View>
              {/* Distances above/below center */}
              {distToPin !== null && (
                <View pointerEvents="none" style={styles.xhTopLabel}>
                  <Text style={styles.xhDistTop}>{distToPin} m</Text>
                </View>
              )}
              {distToTee !== null && (
                <View pointerEvents="none" style={styles.xhBottomLabel}>
                  <Text style={styles.xhDistBottom}>{distToTee} m</Text>
                </View>
              )}
              {/* "Fijar aquí" button */}
              {mapCenter && (
                <TouchableOpacity style={styles.xhFixBtn} onPress={async () => { const pt = await dotCoord(); if (pt) setPlayerPos(pt); setCrosshairOn(false); }}>
                  <Ionicons name="pin" size={16} color="#fff" />
                  <Text style={styles.xhFixTxt}>Fijar aquí</Text>
                </TouchableOpacity>
              )}
            </>
          );
        })()}

        {/* ── Left toolbar ── */}
        {!isMoving && (
          <View style={styles.toolbar}>
            <TouchableOpacity style={[styles.tbBtn, is3D && styles.tbBtnOn]} onPress={toggle3D}>
              <Text style={[styles.tbBtnTxt, is3D && { color: COLORS.primary }]}>3D</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tbBtn, crosshairOn && styles.tbBtnOn]}
              onPress={() => { const next = !crosshairOn; setCrosshairOn(next); setCircleMode('none'); if (next) updateScreenPoints(); }}
            >
              <Ionicons name="locate" size={20} color={crosshairOn ? COLORS.primary : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.tbBtn} onPress={() => setMovingFlag(true)}>
              <Ionicons name="flag" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.tbBtn} onPress={() => setMovingPlayer(true)}>
              <Ionicons name="walk" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tbBtn, styles.tbBtnExit]} onPress={onClose}>
              <Ionicons name="arrow-undo" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Right panel: Tee / Appr + radii ── */}
        {!isMoving && (
          <View style={styles.rightPanel}>
            <TouchableOpacity
              style={[styles.rpBtn, circleMode === 'tee' && styles.rpBtnOn]}
              onPress={() => selectCircleMode('tee')}
            >
              <Text style={[styles.rpTxt, circleMode === 'tee' && styles.rpTxtOn]}>Tee</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.rpBtn, circleMode === 'appr' && styles.rpBtnOn]}
              onPress={() => selectCircleMode('appr')}
            >
              <Text style={[styles.rpTxt, circleMode === 'appr' && styles.rpTxtOn]}>Appr</Text>
            </TouchableOpacity>
            {circleMode !== 'none' && (
              <>
                <View style={styles.rpDivider} />
                {(circleMode === 'tee' ? TEE_RADII : APPR_RADII).map(r => {
                  const active = (circleMode === 'tee' ? teeRadius : apprRadius) === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      style={[styles.rpBtn, active && styles.rpBtnOn]}
                      onPress={() => circleMode === 'tee' ? setTeeRadius(r as typeof TEE_RADII[number]) : setApprRadius(r as typeof APPR_RADII[number])}
                    >
                      <Text style={[styles.rpTxt, active && styles.rpTxtOn]}>{r}m</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* ── Hole navigation bar ── */}
        {!isMoving && (
          <View style={styles.holeNav}>
            <TouchableOpacity style={styles.navArrow} onPress={() => setHoleIdx(i => (i - 1 + holes.length) % holes.length)}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.holeInfo}>
              <Text style={styles.holeNum}>Hole {currentHole.number} · Par {currentHole.par}</Text>
              <Text style={styles.holeSub}>{currentHole.distanceMeters} Metres</Text>
            </View>
            <TouchableOpacity style={styles.navArrow} onPress={() => setHoleIdx(i => (i + 1) % holes.length)}>
              <Ionicons name="chevron-forward" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Tee selection ────────────────────────────────────────────────────────────
  teeScreen:   { flex: 1, backgroundColor: COLORS.dark.bg, paddingTop: 80, paddingHorizontal: 24 },
  teeTitle:    { fontSize: 26, fontFamily: FONT.headingExtraBold, color: '#fff', marginBottom: 6 },
  teeSub:      { fontSize: 15, fontFamily: FONT.body, color: COLORS.dark.accent, marginBottom: 20 },
  teeBtn:      { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 18, borderWidth: 1.5 },
  teeDot:      { width: 18, height: 18, borderRadius: 9 },
  teeBtnLabel: { fontSize: 18, fontFamily: FONT.headingSemiBold, color: '#fff' },
  teeBtnDesc:  { fontSize: 13, fontFamily: FONT.body, color: COLORS.dark.muted, marginTop: 2 },
  teeBackBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 28 },
  teeBackTxt:  { fontSize: 15, fontFamily: FONT.body, color: COLORS.dark.muted },

  // ── Top bar (two pills) ──────────────────────────────────────────────────────
  topBar:       { position: 'absolute', top: 50, left: 12, right: 12, flexDirection: 'row' },
  topPill:       { backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', minWidth: 90 },
  topPillActive: { backgroundColor: 'rgba(26,71,42,0.92)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  topPillLabel:  { fontSize: 10, color: '#adb5bd', fontFamily: FONT.bodyMedium, textTransform: 'uppercase', letterSpacing: 0.5 },
  topPillNum:    { fontSize: 19, fontFamily: FONT.headingExtraBold, color: '#fff', marginTop: 1 },
  topPillHint:   { fontSize: 9, fontFamily: FONT.body, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  clubRecPill: {
    position: 'absolute', top: 110, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    justifyContent: 'center',
  },
  clubRecChip: { backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  clubRecChipTxt: { color: '#fff', fontSize: 12, fontFamily: FONT.bodySemiBold },
  clubRecTxt: { color: '#fff', fontSize: 12, fontFamily: FONT.bodyMedium },
  clubRecTendency: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: FONT.body },
  greenDistRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  greenDistItem:    { alignItems: 'center' },
  greenDistLbl:     { fontSize: 9, color: COLORS.dark.accent, fontFamily: FONT.bodyMedium, textTransform: 'uppercase', letterSpacing: 0.3 },
  greenDistNum:     { fontSize: 16, fontFamily: FONT.headingExtraBold, color: '#fff', marginTop: 1 },
  greenDistDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },

// ── Crosshair ────────────────────────────────────────────────────────────────
  reticleWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 14 },
  reticleBox:  { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  rArm:        { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.9)' },
  rTop:        { width: 2, height: 24, top: 0,    left: 39 },
  rBottom:     { width: 2, height: 24, bottom: 0, left: 39 },
  rLeft:       { height: 2, width: 24, left: 0,   top: 39 },
  rRight:      { height: 2, width: 24, right: 0,  top: 39 },
  rDot:        { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 4, elevation: 4 },
  rBadge:      { backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  rBadgeTxt:   { color: '#fff', fontFamily: FONT.bodySemiBold, fontSize: 13 },
  movingBar:   { position: 'absolute', bottom: 20, left: 14, right: 14, flexDirection: 'row', gap: 10 },
  confirmBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, paddingVertical: 14 },
  confirmTxt:  { color: '#fff', fontSize: 16, fontFamily: FONT.bodySemiBold },
  cancelBtn:   { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  // ── Crosshair mode ───────────────────────────────────────────────────────────
  // distance labels: positioned above/below the center independently
  xhTopLabel:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: Dimensions.get('window').height / 2, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 54 },
  xhBottomLabel: { position: 'absolute', top: Dimensions.get('window').height / 2, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 54 },
  xhDistTop:    { fontSize: 34, fontFamily: FONT.headingExtraBold, color: '#ffe066', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 4 },
  xhDistBottom: { fontSize: 34, fontFamily: FONT.headingExtraBold, color: '#fff',    textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 4 },
  xhFixBtn:     { position: 'absolute', bottom: 90, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  xhFixTxt:     { color: '#fff', fontSize: 14, fontFamily: FONT.bodySemiBold },
  // Tee arc labels

  // ── Left toolbar ─────────────────────────────────────────────────────────────
  toolbar:    { position: 'absolute', left: 12, bottom: 90, gap: 8 },
  tbBtn:      { width: 50, height: 50, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  tbBtnOn:    { backgroundColor: '#fff' },
  tbBtnExit:  { backgroundColor: 'rgba(150,30,30,0.72)' },
  tbBtnTxt:   { color: '#fff', fontSize: 14, fontFamily: FONT.bodySemiBold },

  // ── Right panel (Tee / Appr / radii) ────────────────────────────────────────
  rightPanel: { position: 'absolute', right: 10, top: 110, gap: 6 },
  rpBtn:      { width: 52, height: 44, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  rpBtnOn:    { backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1.5, borderColor: '#fff' },
  rpTxt:      { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: FONT.bodySemiBold },
  rpTxtOn:    { color: '#fff' },
  rpDivider:  { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 2 },

  // ── Hole nav bar ─────────────────────────────────────────────────────────────
  holeNav:  { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'rgba(0,0,0,0.78)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  navArrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  holeInfo: { alignItems: 'center', gap: 2 },
  holeNum:  { fontSize: 17, fontFamily: FONT.headingExtraBold, color: '#fff' },
  holeSub:  { fontSize: 13, fontFamily: FONT.body, color: COLORS.dark.accent },

  // ── Shot path labels + markers ───────────────────────────────────────────────
  distLabel:    { backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  distLabelPin: { backgroundColor: 'rgba(0,0,0,0.7)' },
  distLabelTxt: { color: '#fff', fontSize: 12, fontFamily: FONT.bodySemiBold },
  shotPin:      { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shotPinTxt:   { color: '#fff', fontSize: 11, fontFamily: FONT.bodySemiBold },

  // ── Map markers ──────────────────────────────────────────────────────────────
  teeMarker:    { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.warning, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  teeMarkerTxt: { color: '#fff', fontSize: 11, fontFamily: FONT.headingExtraBold },
  playerMarker: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.info, borderWidth: 2.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  flagMarker:   { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.success, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
