import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator,
  Alert, PanResponder, TextInput,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';

import { ShotVisionShot } from '../../src/shotvision/types';
import {
  fitLaunchFromMarks, ManualMark, computeStreak, summariseStreaks, StreakSample,
  angleOnlyFromMarks,
} from '../../src/shotvision/calibration';
import { decodeJpegFile, findBlob } from '../../src/shotvision/pixelblob';
import { simulateFlight, solveSpeedForCarry } from '../../src/shotvision/ballflight';
import { demoPreset } from '../../src/shotvision/demo';
import { useConditions } from '../../src/shotvision/useConditions';
import { useSettings } from '../../src/shotvision/useSettings';
import { SV, SV_CLUBS, CLUB_NAMES } from '../../src/shotvision/ui';
import { FONT } from '../../src/theme';
import { ShotResult } from './shot/[id]';

const FPS_OPTIONS = [240, 120];
const LOUPE_SIZE = 140;
const LOUPE_ZOOM = 3.2;

export default function CalibrateScreen() {
  const { env } = useConditions();
  const { settings, update } = useSettings();

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [fps, setFps] = useState(240);
  const [club, setClub] = useState('7i');

  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameW, setFrameW] = useState(1920);
  const [frameH, setFrameH] = useState(1080);
  const [timeMs, setTimeMs] = useState(0);
  const [loadingFrame, setLoadingFrame] = useState(false);

  const [mode, setMode] = useState<'mark' | 'scale' | 'streak'>('mark');
  const [scaleP1, setScaleP1] = useState<{ x: number; y: number } | null>(null);
  const [ballDiameterPx, setBallDiameterPx] = useState<number | null>(null);
  const [calFactor, setCalFactor] = useState(1);
  const [marks, setMarks] = useState<ManualMark[]>([]);
  const [streakP1, setStreakP1] = useState<{ x: number; y: number } | null>(null);
  const [streaks, setStreaks] = useState<StreakSample[]>([]);
  const [dutyCycle, setDutyCycle] = useState(0.9);
  const effectiveDiameterPx = ballDiameterPx != null ? ballDiameterPx * calFactor : null;

  const [result, setResult] = useState<{ measure: any; flight: any; source: 'marks' | 'streak' | 'carry' } | null>(null);
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);
  const [autoBusy, setAutoBusy] = useState<'mark' | 'streak' | null>(null);
  // reference background for auto-detect: a frame where the ball is at rest
  // (defaults to the very start of the clip). Override with "Fijar fondo
  // aquí" if that doesn't work well for a particular video.
  const [bgTimeMs, setBgTimeMs] = useState(0);
  const [bgFrameUri, setBgFrameUri] = useState<string | null>(null);

  // recommended method: known carry + measured (scale-free) angle, instead
  // of trusting a pixel-scale speed measurement
  const [knownCarryText, setKnownCarryText] = useState('');
  const layoutRef = useRef({ w: 1, h: 1 });

  // zoom into a sub-rectangle of the frame (native pixel coords) so the target
  // is bigger on screen before you even use the loupe to fine-tune
  const [zoomRect, setZoomRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [zoomedUri, setZoomedUri] = useState<string | null>(null);

  const rightSide = settings.ballCorner === 'bottomRight';
  const step = 1000 / fps;
  const dispRect = zoomRect ?? { x: 0, y: 0, w: frameW, h: frameH };
  const displayUri = zoomedUri ?? frameUri;
  const zoomFactor = frameW / dispRect.w;

  useEffect(() => {
    if (!frameUri) return;
    if (!zoomRect) { setZoomedUri(null); return; }
    let cancelled = false;
    ImageManipulator.manipulateAsync(
      frameUri,
      [
        { crop: {
          originX: Math.round(zoomRect.x), originY: Math.round(zoomRect.y),
          width: Math.round(zoomRect.w), height: Math.round(zoomRect.h),
        } },
        { resize: { width: 900 } },
      ],
      { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
    ).then(r => { if (!cancelled) setZoomedUri(r.uri); })
      .catch(() => { if (!cancelled) setZoomedUri(null); });
    return () => { cancelled = true; };
  }, [frameUri, zoomRect]);

  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

  function zoomIn() {
    setZoomRect(r => {
      const base = r ?? { x: 0, y: 0, w: frameW, h: frameH };
      const w = Math.max(80, base.w * 0.55);
      const h = Math.max(60, base.h * 0.55);
      const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
      return {
        x: clamp(cx - w / 2, 0, frameW - w),
        y: clamp(cy - h / 2, 0, frameH - h),
        w, h,
      };
    });
  }
  function zoomOut() {
    setZoomRect(r => {
      if (!r) return null;
      const w = r.w / 0.55, h = r.h / 0.55;
      if (w >= frameW * 0.98 || h >= frameH * 0.98) return null;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      return {
        x: clamp(cx - w / 2, 0, frameW - w),
        y: clamp(cy - h / 2, 0, frameH - h),
        w, h,
      };
    });
  }
  function zoomReset() { setZoomRect(null); }
  function pan(dxFrac: number, dyFrac: number) {
    setZoomRect(r => {
      if (!r) return r;
      return {
        ...r,
        x: clamp(r.x + dxFrac * r.w, 0, frameW - r.w),
        y: clamp(r.y + dyFrac * r.h, 0, frameH - r.h),
      };
    });
  }

  /** native (full-frame) coords -> current display box, or null if off-screen while zoomed */
  function toDisp(nx: number, ny: number): { x: number; y: number } | null {
    const { w, h } = layoutRef.current;
    if (nx < dispRect.x || nx > dispRect.x + dispRect.w || ny < dispRect.y || ny > dispRect.y + dispRect.h) return null;
    return { x: ((nx - dispRect.x) / dispRect.w) * w, y: ((ny - dispRect.y) / dispRect.h) * h };
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso necesario', 'Activa el acceso a fotos/vídeos para importar la grabación.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setVideoUri(a.uri);
    setDurationMs(a.duration ?? 4000);
    setFrameW(a.width || 1920);
    setFrameH(a.height || 1080);
    setMarks([]); setStreaks([]); setBallDiameterPx(null); setCalFactor(1); setResult(null); setMode('mark');
    setZoomRect(null); setZoomedUri(null);
    setBgTimeMs(0); setBgFrameUri(null);
    loadFrame(a.uri, 0);
  }

  async function loadFrame(uri: string, ms: number) {
    setLoadingFrame(true);
    try {
      const t = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, Math.round(ms)) });
      setFrameUri(t.uri);
      setFrameW(t.width); setFrameH(t.height);
      setTimeMs(ms);
    } catch {
      Alert.alert('No se pudo leer ese fotograma', 'Prueba a moverte a otro punto del vídeo.');
    }
    setLoadingFrame(false);
  }

  function seek(deltaMs: number) {
    if (!videoUri) return;
    const next = Math.max(0, Math.min(durationMs, timeMs + deltaMs));
    loadFrame(videoUri, next);
  }
  function seekTo(fraction: number) {
    if (!videoUri) return;
    loadFrame(videoUri, fraction * durationMs);
  }

  function commitTap(locationX: number, locationY: number) {
    if (!frameUri) return;
    const { w, h } = layoutRef.current;
    const nx = dispRect.x + (locationX / w) * dispRect.w;
    const ny = dispRect.y + (locationY / h) * dispRect.h;

    if (mode === 'scale') {
      if (!scaleP1) {
        setScaleP1({ x: nx, y: ny });
      } else {
        const d = Math.hypot(nx - scaleP1.x, ny - scaleP1.y);
        setBallDiameterPx(d);
        setScaleP1(null);
        setMode('mark');
      }
      return;
    }
    if (mode === 'streak') {
      if (!streakP1) {
        setStreakP1({ x: nx, y: ny });
        return;
      }
      if (!ballDiameterPx) {
        Alert.alert('Falta la escala', 'Marca primero el diámetro de la bola (2 toques).');
        setStreakP1(null);
        return;
      }
      const s = computeStreak(timeMs, streakP1, { x: nx, y: ny }, effectiveDiameterPx!, dutyCycle, fps);
      setStreaks(arr => [...arr, s]);
      setStreakP1(null);
      return;
    }
    setMarks(m => [...m, { timeMs, x: nx, y: ny }]);
  }

  // drag to fine-position (loupe follows), release to confirm the tap
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => setTouchPos({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }),
    onPanResponderMove: e => setTouchPos({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }),
    onPanResponderRelease: e => {
      commitTap(e.nativeEvent.locationX, e.nativeEvent.locationY);
      setTouchPos(null);
    },
    onPanResponderTerminate: () => setTouchPos(null),
  });

  function undoMark() { setMarks(m => m.slice(0, -1)); }
  function undoStreak() { setStreaks(s => s.slice(0, -1)); }

  // auto-detect (beta): analyses whatever region is currently zoomed/panned
  // into — no separate background frame needed, it just contrasts against
  // that crop's own dominant colour. Drops a normal mark/streak, same as a
  // manual tap, so it's just as reviewable/undoable if it gets it wrong.
  async function ensureBgFrame(): Promise<string | null> {
    if (bgFrameUri) return bgFrameUri;
    if (!videoUri) return null;
    try {
      const t = await VideoThumbnails.getThumbnailAsync(videoUri, { time: Math.max(0, Math.round(bgTimeMs)) });
      setBgFrameUri(t.uri);
      return t.uri;
    } catch {
      return null;
    }
  }

  // Linear extrapolation from the last two tracked points (marks or streak
  // far-ends), in native frame coords. Needs 2+ points with real motion
  // between them — with 0-1 points there's no velocity to trust yet (e.g.
  // right after impact, when the ball just left a static address position),
  // so auto-detect falls back to shape/centrality alone for that first jump.
  function predictPosition(atMs: number): { x: number; y: number } | null {
    const pts = [
      ...marks.map(m => ({ t: m.timeMs, x: m.x, y: m.y })),
      ...streaks.map(s => ({ t: s.timeMs, x: s.x2, y: s.y2 })),
    ].sort((a, b) => a.t - b.t);
    if (pts.length < 2) return null;
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return null;
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    const ahead = atMs - b.t;
    return { x: b.x + vx * ahead, y: b.y + vy * ahead };
  }

  async function cropAndDecode(sourceUri: string, rect: { x: number; y: number; w: number; h: number }) {
    const manip = await ImageManipulator.manipulateAsync(
      sourceUri,
      [
        { crop: {
          originX: Math.round(rect.x), originY: Math.round(rect.y),
          width: Math.round(rect.w), height: Math.round(rect.h),
        } },
        { resize: { width: 260 } },
      ],
      { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
    );
    return decodeJpegFile(manip.uri);
  }

  async function runAutoDetect(kind: 'mark' | 'streak') {
    if (!frameUri) return;
    if (kind === 'streak' && !ballDiameterPx) {
      Alert.alert('Falta la escala', 'Marca primero el diámetro de la bola (2 toques).');
      return;
    }
    setAutoBusy(kind);
    try {
      const rect = dispRect;
      const img = await cropAndDecode(frameUri, rect);

      // background subtraction is the reliable path — a static feature
      // (shadow, mat seam, tripod) looks the same in both frames and cancels
      // out; only what actually moved (the ball) survives the diff.
      const bgUri = await ensureBgFrame();
      const bgImg = bgUri ? await cropAndDecode(bgUri, rect) : undefined;

      const sx = rect.w / img.width, sy = rect.h / img.height;
      const predicted = predictPosition(timeMs);
      const expected = predicted
        ? { x: (predicted.x - rect.x) / sx, y: (predicted.y - rect.y) / sy }
        : undefined;

      const blob = findBlob(img, kind === 'streak' ? 'elongated' : 'round', bgImg, expected);
      if (!blob) {
        Alert.alert('No se detectó nada claro', 'Encuadra mejor con el zoom o marca a mano.');
        return;
      }
      const ncx = rect.x + blob.cx * sx, ncy = rect.y + blob.cy * sy;

      if (expected) {
        const diag = Math.hypot(rect.w, rect.h);
        const dist = Math.hypot(ncx - predicted!.x, ncy - predicted!.y);
        if (dist > diag * 0.35) {
          Alert.alert(
            'Lejos de lo esperado',
            'Lo detectado está bastante lejos de donde debería seguir la bola según el movimiento anterior — puede ser el cuerpo/palo. Revísalo y corrige a mano si hace falta.',
          );
        }
      }

      if (kind === 'mark') {
        setMarks(m => [...m, { timeMs, x: ncx, y: ncy }]);
        return;
      }

      const halfLen = (blob.length * sx) / 2;
      const dx = Math.cos(blob.angleRad), dy = Math.sin(blob.angleRad);
      const a = { x: ncx - dx * halfLen, y: ncy - dy * halfLen };
      const b = { x: ncx + dx * halfLen, y: ncy + dy * halfLen };

      const lastStreak = streaks[streaks.length - 1];
      const lastMark = marks[marks.length - 1];
      const lastPoint = lastStreak ? { x: lastStreak.x2, y: lastStreak.y2 }
        : lastMark ? { x: lastMark.x, y: lastMark.y } : null;

      let near = a, far = b;
      if (lastPoint) {
        const da = Math.hypot(a.x - lastPoint.x, a.y - lastPoint.y);
        const db = Math.hypot(b.x - lastPoint.x, b.y - lastPoint.y);
        if (db < da) { near = b; far = a; }
      } else if (settings.ballCorner === 'bottomRight' ? b.x > a.x : a.x > b.x) {
        near = b; far = a;
      }

      const s = computeStreak(timeMs, near, far, effectiveDiameterPx!, dutyCycle, fps);
      setStreaks(arr => [...arr, s]);
    } catch (e) {
      Alert.alert('Error al analizar', String(e));
    } finally {
      setAutoBusy(null);
    }
  }

  function compute() {
    if (!ballDiameterPx) { Alert.alert('Falta la escala', 'Primero marca el diámetro de la bola (2 toques).'); return; }

    let measure = null as ReturnType<typeof fitLaunchFromMarks>;
    let source: 'marks' | 'streak' = 'marks';
    const streakSum = summariseStreaks(streaks);
    if (streakSum) {
      measure = {
        ballSpeedMs: streakSum.speedMean,
        launchAngleDeg: streakSum.launchMean,
        launchDirectionDeg: null,
        backspinRpm: null,
        sidespinRpm: null,
        confidence: Math.min(1, streakSum.n / 4),
        framesTracked: streakSum.n,
      };
      source = 'streak';
    } else {
      measure = fitLaunchFromMarks(marks, effectiveDiameterPx!);
    }
    if (!measure) { Alert.alert('Faltan datos', 'Marca al menos 2 fotogramas de la bola, o una racha en un fotograma.'); return; }

    const preset = demoPreset(club);
    const flight = simulateFlight(
      {
        ballSpeedMs: measure.ballSpeedMs,
        launchAngleDeg: measure.launchAngleDeg,
        backspinRpm: preset.backspinRpm,
      },
      env,
      { collectPath: true },
    );
    setResult({ measure, flight, source });
  }

  // scale-free angle: whatever ball-size error exists, it cancels out of
  // this ratio identically top and bottom — trust this even when the pixel
  // speed above looks wrong.
  const streakSumForAngle = summariseStreaks(streaks);
  const measuredAngleDeg = streakSumForAngle ? streakSumForAngle.launchMean : angleOnlyFromMarks(marks);

  function computeFromCarry() {
    const carryM = parseFloat(knownCarryText.replace(',', '.'));
    if (!carryM || carryM <= 0) { Alert.alert('Carry no válido', 'Introduce la distancia en metros.'); return; }
    if (measuredAngleDeg == null) { Alert.alert('Falta el ángulo', 'Marca la bola en 2+ fotogramas o una racha primero.'); return; }

    const preset = demoPreset(club);
    const ballSpeedMs = solveSpeedForCarry(measuredAngleDeg, carryM, preset.backspinRpm, env);
    const measure = {
      ballSpeedMs, launchAngleDeg: measuredAngleDeg, launchDirectionDeg: null,
      backspinRpm: preset.backspinRpm, sidespinRpm: null,
      confidence: 0.8, framesTracked: streaks.length || marks.length,
    };
    const flight = simulateFlight(
      { ballSpeedMs, launchAngleDeg: measuredAngleDeg, backspinRpm: preset.backspinRpm },
      env,
      { collectPath: true },
    );
    setResult({ measure, flight, source: 'carry' });
  }

  const marksHere = marks.filter(m => m.timeMs === timeMs);
  const streaksHere = streaks.filter(s => s.timeMs === timeMs);
  const spanMs = marks.length >= 2 ? Math.max(...marks.map(m => m.timeMs)) - Math.min(...marks.map(m => m.timeMs)) : 0;
  const streakSummary = summariseStreaks(streaks);

  const fakeShot: ShotVisionShot | null = result ? {
    id: 'cal', sessionId: 'cal', club, createdAt: new Date().toISOString(),
    measure: result.measure, flight: result.flight,
  } : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Calibrar', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}>

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={16} color={SV.accent} />
          <Text style={styles.noticeTxt}>
            Asume vista frontal (face-on). Si grabaste desde atrás (down-the-line),
            usa esto solo para revisar el encuadre — la velocidad no será fiable.
          </Text>
        </View>

        {!videoUri ? (
          <TouchableOpacity style={styles.btnPrimary} onPress={pickVideo}>
            <Ionicons name="videocam-outline" size={18} color="#06210f" />
            <Text style={styles.btnPrimaryTxt}>Importar vídeo</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.btnSecondary} onPress={pickVideo}>
              <Ionicons name="swap-horizontal" size={16} color={SV.green} />
              <Text style={styles.btnSecondaryTxt}>Cambiar vídeo</Text>
            </TouchableOpacity>

            {/* frame viewer */}
            <View
              style={[styles.frameBox, { aspectRatio: dispRect.w / dispRect.h }]}
              onLayout={e => { layoutRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
            >
              {displayUri && (
                <View {...responder.panHandlers} style={StyleSheet.absoluteFill}>
                  <Image source={{ uri: displayUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
                </View>
              )}
              {loadingFrame && <View style={styles.loadingOverlay}><ActivityIndicator color={SV.green} /></View>}

              {/* configured corner guide — only meaningful at full zoom; tap to flip sides */}
              {!zoomRect && (
                <TouchableOpacity
                  style={[
                    styles.cornerGuide,
                    rightSide ? { right: '4%', bottom: '4%' } : { left: '4%', bottom: '4%' },
                  ]}
                  onPress={() => update({ ballCorner: rightSide ? 'bottomLeft' : 'bottomRight' })}
                >
                  <Ionicons name="swap-horizontal" size={16} color={SV.accent} />
                </TouchableOpacity>
              )}

              {/* marks on this exact frame */}
              {marksHere.map((m, i) => {
                const p = toDisp(m.x, m.y);
                return p && <View key={i} pointerEvents="none" style={[styles.markDot, { left: p.x - 6, top: p.y - 6 }]} />;
              })}
              {mode === 'scale' && scaleP1 && (() => {
                const p = toDisp(scaleP1.x, scaleP1.y);
                return p && <View pointerEvents="none" style={[styles.markDot, { backgroundColor: SV.accent, left: p.x - 6, top: p.y - 6 }]} />;
              })()}

              {/* streak samples on this exact frame — the line IS what got measured */}
              <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
                {streaksHere.map((s, i) => {
                  const p1 = toDisp(s.x1, s.y1), p2 = toDisp(s.x2, s.y2);
                  return p1 && p2 && <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={SV.accent} strokeWidth={2.5} />;
                })}
              </Svg>
              {streaksHere.map((s, i) => {
                const p1 = toDisp(s.x1, s.y1), p2 = toDisp(s.x2, s.y2);
                return (
                  <React.Fragment key={i}>
                    {p1 && <View pointerEvents="none" style={[styles.markDot, { backgroundColor: SV.accent, left: p1.x - 6, top: p1.y - 6 }]} />}
                    {p2 && <View pointerEvents="none" style={[styles.markDot, { backgroundColor: SV.accent, left: p2.x - 6, top: p2.y - 6 }]} />}
                  </React.Fragment>
                );
              })}
              {mode === 'streak' && streakP1 && (() => {
                const p = toDisp(streakP1.x, streakP1.y);
                return p && <View pointerEvents="none" style={[styles.markDot, { backgroundColor: '#5ab4ff', left: p.x - 6, top: p.y - 6 }]} />;
              })()}

              {/* magnifying loupe — follows the finger while dragging, tap commits on release */}
              {touchPos && displayUri && (() => {
                const { w: lw, h: lh } = layoutRef.current;
                const above = touchPos.y - LOUPE_SIZE - 20;
                const top = above > 0 ? above : Math.min(Math.max(0, lh - LOUPE_SIZE), touchPos.y + 20);
                const left = Math.max(0, Math.min(lw - LOUPE_SIZE, touchPos.x - LOUPE_SIZE / 2));
                const imgLeft = LOUPE_SIZE / 2 - touchPos.x * LOUPE_ZOOM;
                const imgTop = LOUPE_SIZE / 2 - touchPos.y * LOUPE_ZOOM;
                return (
                  <View pointerEvents="none" style={[styles.loupe, { top, left }]}>
                    <Image
                      source={{ uri: displayUri }}
                      style={{ position: 'absolute', width: lw * LOUPE_ZOOM, height: lh * LOUPE_ZOOM, left: imgLeft, top: imgTop }}
                      resizeMode="stretch"
                    />
                    <View style={styles.loupeCrossH} />
                    <View style={styles.loupeCrossV} />
                  </View>
                );
              })()}
            </View>

            {/* zoom controls */}
            <View style={styles.seekRow}>
              <SeekBtn label="Zoom −" onPress={zoomOut} />
              <View style={styles.zoomLabel}><Text style={styles.zoomLabelTxt}>{zoomFactor.toFixed(1)}×</Text></View>
              <SeekBtn label="Zoom +" onPress={zoomIn} />
              {zoomRect && <SeekBtn label="1×" onPress={zoomReset} />}
            </View>
            {zoomRect && (
              <View style={styles.panPad}>
                <View style={styles.panRow}>
                  <View style={styles.panSpacer} />
                  <PanBtn icon="chevron-up" onPress={() => pan(0, -0.3)} />
                  <View style={styles.panSpacer} />
                </View>
                <View style={styles.panRow}>
                  <PanBtn icon="chevron-back" onPress={() => pan(-0.3, 0)} />
                  <View style={styles.panSpacer} />
                  <PanBtn icon="chevron-forward" onPress={() => pan(0.3, 0)} />
                </View>
                <View style={styles.panRow}>
                  <View style={styles.panSpacer} />
                  <PanBtn icon="chevron-down" onPress={() => pan(0, 0.3)} />
                  <View style={styles.panSpacer} />
                </View>
              </View>
            )}

            <Text style={styles.timeTxt}>
              t = {(timeMs / 1000).toFixed(3)} s / {(durationMs / 1000).toFixed(2)} s
            </Text>
            <Text style={styles.hint}>
              Usa Zoom + para acercarte, las flechas para moverte, y arrastra sobre la imagen
              (aparece una lupa) para afinar — suelta para confirmar el punto. "Auto-detectar"
              analiza justo la zona a la que has hecho zoom, así que acércate a la bola primero.
            </Text>
            <Text style={styles.warnTxt}>
              ⚠ Antes de marcar, comprueba que la bola se ha movido de verdad respecto al
              fotograma anterior. Si se ve igual, "+1" probablemente no cambió de fotograma
              real (limitación de iOS) — salta con "+2" o "+5" en su lugar.
            </Text>

            {/* seek */}
            <View style={styles.seekRow}>
              <SeekBtn label="-10" onPress={() => seek(-10 * step)} />
              <SeekBtn label="-5" onPress={() => seek(-5 * step)} />
              <SeekBtn label="-2" onPress={() => seek(-2 * step)} />
              <SeekBtn label="-1" onPress={() => seek(-step)} />
              <SeekBtn label="+1" onPress={() => seek(step)} />
              <SeekBtn label="+2" onPress={() => seek(2 * step)} />
              <SeekBtn label="+5" onPress={() => seek(5 * step)} />
              <SeekBtn label="+10" onPress={() => seek(10 * step)} />
            </View>
            <View style={styles.seekRow}>
              {[0, 0.25, 0.5, 0.75, 1].map(f => (
                <TouchableOpacity key={f} style={styles.jumpChip} onPress={() => seekTo(f)}>
                  <Text style={styles.jumpTxt}>{Math.round(f * 100)}%</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.fpsRow}>
              <Text style={styles.hint}>fps del paso:</Text>
              {FPS_OPTIONS.map(f => (
                <TouchableOpacity key={f} style={[styles.chip, fps === f && styles.chipOn]} onPress={() => setFps(f)}>
                  <Text style={[styles.chipTxt, fps === f && styles.chipTxtOn]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* scale + marks */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>1 · Escala de la bola</Text>
              <Text style={styles.hint}>
                Ve a un fotograma donde la bola esté en reposo. Toca un borde de la bola y luego el borde opuesto.
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btnSmall, mode === 'scale' && styles.btnSmallOn]}
                  onPress={() => { setMode(m => m === 'scale' ? 'mark' : 'scale'); setScaleP1(null); setStreakP1(null); }}
                >
                  <Text style={[styles.btnSmallTxt, mode === 'scale' && styles.btnSmallTxtOn]}>
                    {mode === 'scale' ? 'Tocando bordes…' : 'Marcar diámetro'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.diaTxt}>
                  {ballDiameterPx ? `${ballDiameterPx.toFixed(0)} px tocado` : 'sin marcar'}
                </Text>
              </View>

              {ballDiameterPx != null && (
                <>
                  <View style={styles.stepperBlock}>
                    <Text style={styles.hint}>Factor de calibración (cámara no del todo perpendicular):</Text>
                    <View style={styles.stepperRow}>
                      <TouchableOpacity style={styles.stepBtnSm} onPress={() => setCalFactor(f => Math.max(0.5, +(f - 0.02).toFixed(2)))}>
                        <Ionicons name="remove" size={18} color={SV.ink} />
                      </TouchableOpacity>
                      <Text style={styles.dutyVal}>{calFactor.toFixed(2)}×</Text>
                      <TouchableOpacity style={styles.stepBtnSm} onPress={() => setCalFactor(f => Math.min(1.5, +(f + 0.02).toFixed(2)))}>
                        <Ionicons name="add" size={18} color={SV.ink} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={styles.hint}>
                    Diámetro efectivo usado en el cálculo: {effectiveDiameterPx!.toFixed(0)} px.{' '}
                    {calFactor !== 1
                      ? 'Esto NO es el tamaño real de la bola — es un ajuste temporal para este vídeo. Búscalo con un golpe de carry conocido; si mejoras el ángulo de la cámara la próxima vez, debería acercarse a 1.00.'
                      : 'Sin ajustar (1.00) — si la velocidad sale sistemáticamente baja, prueba a bajarlo con un golpe de referencia.'}
                  </Text>
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Fondo de referencia (para Auto-detectar)</Text>
              <Text style={styles.hint}>
                El auto-detectar compara el fotograma actual contra este fondo — así ignora
                lo que no se mueve (sombras, la esterilla, el trípode) y solo encuentra lo que
                cambió. Por defecto usa el principio del vídeo; si ahí ya hay movimiento
                (preparación, etc.), ve a un fotograma limpio con la bola en reposo y fíjalo aquí.
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.btnSmall}
                  onPress={() => { setBgTimeMs(timeMs); setBgFrameUri(null); }}
                >
                  <Text style={styles.btnSmallTxt}>Fijar fondo aquí</Text>
                </TouchableOpacity>
                <Text style={styles.diaTxt}>fondo: t={(bgTimeMs / 1000).toFixed(3)}s</Text>
                <TouchableOpacity
                  style={styles.btnSmall}
                  onPress={() => { setBgTimeMs(0); setBgFrameUri(null); }}
                  disabled={bgTimeMs === 0}
                >
                  <Text style={styles.btnSmallTxt}>Volver a t=0</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>2A · Varios fotogramas</Text>
              <Text style={styles.hint}>
                Avanza fotograma a fotograma y toca el centro de la bola en 4–8 fotogramas seguidos.
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btnSmall, mode === 'mark' && styles.btnSmallOn]}
                  onPress={() => { setMode('mark'); setScaleP1(null); setStreakP1(null); }}
                >
                  <Text style={[styles.btnSmallTxt, mode === 'mark' && styles.btnSmallTxtOn]}>
                    {mode === 'mark' ? 'Tocando bola…' : 'Marcar bola'}
                  </Text>
                </TouchableOpacity>
                <View style={styles.diaTxtWrap}><Text style={styles.diaTxt}>{marks.length} marcas · {spanMs.toFixed(0)} ms</Text></View>
                <TouchableOpacity style={styles.btnSmall} onPress={undoMark} disabled={marks.length === 0}>
                  <Text style={styles.btnSmallTxt}>Deshacer</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.autoBtn} onPress={() => runAutoDetect('mark')} disabled={autoBusy !== null}>
                {autoBusy === 'mark'
                  ? <ActivityIndicator size="small" color={SV.accent} />
                  : <Ionicons name="sparkles-outline" size={14} color={SV.accent} />}
                <Text style={styles.autoBtnTxt}>Auto-detectar en esta zona (beta)</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>2B · Racha en un solo fotograma (más rápido)</Text>
              <Text style={styles.hint}>
                En un fotograma con la bola desenfocada, toca el extremo de la racha más cercano
                al reposo, luego el más lejano. Repite en varios fotogramas borrosos — si los
                resultados coinciden, puedes fiarte del número aunque solo tengas 1-2 fotogramas buenos.
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btnSmall, mode === 'streak' && styles.btnSmallOn]}
                  onPress={() => { setMode(m => m === 'streak' ? 'mark' : 'streak'); setStreakP1(null); }}
                >
                  <Text style={[styles.btnSmallTxt, mode === 'streak' && styles.btnSmallTxtOn]}>
                    {mode === 'streak' ? (streakP1 ? 'Toca el extremo lejano…' : 'Toca el extremo cercano…') : 'Marcar racha'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSmall} onPress={undoStreak} disabled={streaks.length === 0}>
                  <Text style={styles.btnSmallTxt}>Deshacer</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.autoBtn} onPress={() => runAutoDetect('streak')} disabled={autoBusy !== null}>
                {autoBusy === 'streak'
                  ? <ActivityIndicator size="small" color={SV.accent} />
                  : <Ionicons name="sparkles-outline" size={14} color={SV.accent} />}
                <Text style={styles.autoBtnTxt}>Auto-detectar racha en esta zona (beta)</Text>
              </TouchableOpacity>

              <View style={styles.stepperBlock}>
                <Text style={styles.hint}>Ciclo de exposición (obturador ÷ fotograma):</Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity style={styles.stepBtnSm} onPress={() => setDutyCycle(d => Math.max(0.3, +(d - 0.05).toFixed(2)))}>
                    <Ionicons name="remove" size={18} color={SV.ink} />
                  </TouchableOpacity>
                  <Text style={styles.dutyVal}>{dutyCycle.toFixed(2)}</Text>
                  <TouchableOpacity style={styles.stepBtnSm} onPress={() => setDutyCycle(d => Math.min(1, +(d + 0.05).toFixed(2)))}>
                    <Ionicons name="add" size={18} color={SV.ink} />
                  </TouchableOpacity>
                </View>
              </View>

              {streaks.length > 0 && (
                <View style={{ gap: 4 }}>
                  {streaks.map((s, i) => (
                    <Text key={i} style={styles.streakTxt}>
                      t={(s.timeMs / 1000).toFixed(3)}s · {Math.round(s.lengthPx)}px
                      {'  →  '}{Math.round(s.speedMs * 2.2369362920544)} mph · {s.launchAngleDeg.toFixed(0)}°
                    </Text>
                  ))}
                  {streakSummary && (
                    <Text style={styles.streakSummary}>
                      media: {Math.round(streakSummary.speedMean * 2.2369362920544)} mph
                      {' '}(±{Math.round(streakSummary.speedStd * 2.2369362920544)}) ·{' '}
                      {streakSummary.launchMean.toFixed(0)}° (±{streakSummary.launchStd.toFixed(1)}) · n={streakSummary.n}
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* club (for spin assumption) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Palo (asume el spin típico)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {SV_CLUBS.map(c => (
                  <TouchableOpacity key={c} style={[styles.chip, club === c && styles.chipOn]} onPress={() => setClub(c)}>
                    <Text style={[styles.chipTxt, club === c && styles.chipTxtOn]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.hint}>{CLUB_NAMES[club] ?? club}</Text>
            </View>

            <View style={[styles.card, styles.cardHighlight]}>
              <Text style={styles.cardTitle}>3 · A partir del carry conocido (recomendado)</Text>
              <Text style={styles.hint}>
                El ángulo medido no depende del tamaño de bola marcado — cualquier error de escala
                se cancela en la proporción. Dinos el carry que ya sabes (paso a paso, GPS, marca
                del campo) y resolvemos qué velocidad lo produce, sin usar el factor de calibración.
              </Text>
              <Text style={styles.diaTxt}>
                Ángulo medido: {measuredAngleDeg != null ? `${measuredAngleDeg.toFixed(1)}°` : 'marca la bola primero'}
              </Text>
              <View style={styles.row}>
                <TextInput
                  style={styles.carryInput}
                  value={knownCarryText}
                  onChangeText={setKnownCarryText}
                  placeholder="carry en m, ej. 83"
                  placeholderTextColor={SV.faint}
                  keyboardType="numbers-and-punctuation"
                />
                <TouchableOpacity style={styles.btnPrimarySm} onPress={computeFromCarry} disabled={measuredAngleDeg == null}>
                  <Text style={styles.btnPrimarySmTxt}>Calcular</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.btnSecondary2} onPress={compute}>
              <Ionicons name="calculator-outline" size={16} color={SV.sub} />
              <Text style={styles.btnSecondary2Txt}>Calcular a partir del tamaño de bola (menos fiable)</Text>
            </TouchableOpacity>

            {fakeShot && result && (
              <View style={{ gap: 12 }}>
                <Text style={styles.cardTitle}>
                  Resultado · fuente: {
                    result.source === 'carry' ? 'carry conocido + ángulo medido'
                    : result.source === 'streak' ? `racha (n=${streaks.length})`
                    : `puntos (n=${marks.length})`
                  }
                </Text>
                <ShotResult shot={fakeShot} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function SeekBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.seekBtn} onPress={onPress}>
      <Text style={styles.seekTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

function PanBtn({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.panBtn} onPress={onPress}>
      <Ionicons name={icon} size={18} color={SV.ink} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  notice: { flexDirection: 'row', gap: 8, backgroundColor: SV.surfaceAlt, borderRadius: 12, padding: 12 },
  noticeTxt: { flex: 1, fontSize: 12, color: SV.sub, lineHeight: 17 },

  btnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15 },
  btnPrimaryTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
  btnSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  btnSecondaryTxt: { color: SV.green, fontSize: 13, fontFamily: FONT.bodySemiBold },

  frameBox: { width: '100%', backgroundColor: '#050b12', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: SV.line },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  cornerGuide: { position: 'absolute', width: '16%', aspectRatio: 1, borderWidth: 2, borderColor: SV.accent, borderRadius: 8, opacity: 0.85, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,138,61,0.12)' },
  markDot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: SV.green, borderWidth: 1.5, borderColor: '#fff' },
  loupe: {
    position: 'absolute', width: LOUPE_SIZE, height: LOUPE_SIZE, borderRadius: LOUPE_SIZE / 2,
    overflow: 'hidden', borderWidth: 2.5, borderColor: SV.accent, backgroundColor: '#000',
  },
  loupeCrossH: { position: 'absolute', top: LOUPE_SIZE / 2 - 0.75, left: 0, right: 0, height: 1.5, backgroundColor: SV.accent },
  loupeCrossV: { position: 'absolute', left: LOUPE_SIZE / 2 - 0.75, top: 0, bottom: 0, width: 1.5, backgroundColor: SV.accent },

  zoomLabel: { minWidth: 52, backgroundColor: SV.surfaceAlt, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  zoomLabelTxt: { color: SV.ink, fontSize: 13, fontFamily: FONT.headingSemiBold },
  panPad: { alignItems: 'center', gap: 6 },
  panRow: { flexDirection: 'row', gap: 6 },
  panSpacer: { width: 44, height: 44 },
  panBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  timeTxt: { fontSize: 12, color: SV.sub, textAlign: 'center', fontFamily: FONT.bodyMedium },

  seekRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  seekBtn: { minWidth: 52, backgroundColor: SV.surfaceAlt, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  seekTxt: { color: SV.ink, fontSize: 13, fontFamily: FONT.headingSemiBold },
  warnTxt: { fontSize: 11, color: SV.accent, lineHeight: 15 },
  jumpChip: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: SV.surface, borderRadius: 8, borderWidth: 1, borderColor: SV.line },
  jumpTxt: { color: SV.sub, fontSize: 11, fontFamily: FONT.bodySemiBold },

  fpsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { fontSize: 12, color: SV.sub, lineHeight: 17 },

  card: { backgroundColor: SV.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: SV.line },
  cardTitle: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },

  chip: { minWidth: 40, height: 36, paddingHorizontal: 8, borderRadius: 8, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: SV.green },
  chipTxt: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.sub },
  chipTxtOn: { color: '#06210f' },

  btnSmall: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, backgroundColor: SV.surfaceAlt },
  btnSmallOn: { backgroundColor: SV.accent },
  btnSmallTxt: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.sub },
  btnSmallTxtOn: { color: '#2a1000' },
  diaTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: SV.ink },
  diaTxtWrap: { flex: 1 },

  stepperBlock: { gap: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'center' },
  stepBtnSm: { width: 38, height: 38, borderRadius: 10, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  dutyVal: { fontSize: 15, fontFamily: FONT.headingSemiBold, color: SV.ink, minWidth: 44, textAlign: 'center' },
  streakTxt: { fontSize: 11, color: SV.sub, fontFamily: FONT.bodyMedium },
  streakSummary: { fontSize: 12, color: SV.accent, fontFamily: FONT.headingSemiBold, marginTop: 2 },

  autoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: SV.accent, borderRadius: 10, paddingVertical: 9,
  },
  autoBtnTxt: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.accent },

  cardHighlight: { borderColor: SV.green, borderWidth: 1.5 },
  carryInput: {
    flex: 1, backgroundColor: SV.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: SV.ink, fontSize: 15, fontFamily: FONT.bodySemiBold,
  },
  btnPrimarySm: { backgroundColor: SV.green, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11 },
  btnPrimarySmTxt: { color: '#06210f', fontSize: 13, fontFamily: FONT.headingSemiBold },
  btnSecondary2: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
  },
  btnSecondary2Txt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: SV.sub },
});
