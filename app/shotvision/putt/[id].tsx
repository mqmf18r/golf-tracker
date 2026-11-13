// Putt mode — the first ShotVision screen wired to a REAL camera + real
// detection, not synthetic demo data.
//
// Setup (locked with the user, 2026-09-24): phone HORIZONTAL (landscape),
// face-on, 0.5–1.2 m from the ball. A square guide box sits in the
// bottom-left of the frame — place the ball there, tap "Grabar". The ball
// is expected to roll RIGHT across the frame when struck (fixed geometry,
// no corner picker like the full swing — this mode only supports the one
// setup the user described).
//
// v1 (2026-09-24) used a LIVE polling loop — takePictureAsync in a tight
// cycle, trying to catch the ball mid-roll. On a real device this came back
// 0 mph / 0 yd: every real-world source on camera-based ball tracking (even
// the professional DIY ones — PiTrac uses an IR strobe + global-shutter
// camera specifically to avoid this) confirms a JS `takePicture → decode →
// detect → repeat` loop just cannot keep up with a moving golf ball reliably
// — encode/decode overhead alone likely burns more time than the ball takes
// to cross the frame. So: RECORD instead, THEN analyze — the same
// record-then-analyze approach `calibrate.tsx` already proves works for the
// full swing (`expo-video-thumbnails` frame-by-frame extraction), just
// automated instead of manual-tap, and far more forgiving here since a putt
// rolls over hundreds of milliseconds, not tens.
//
// v2 (2026-09-25) had a separate still-photo "Detectar" step before
// recording, switching the CameraView's `mode` between 'picture' and
// 'video'. That caused a SECOND real-device failure ("Camera is not ready
// yet") — mode switches force iOS/Android to reconfigure the whole capture
// session, and recordAsync() was firing before that finished. Fixed by never
// switching modes: see the comment on `startRecording()` below.
//
// v3 (2026-09-26): fully-automatic detection (no human check at all) kept
// failing in new ways on a real device — a JS-only pipeline genuinely can't
// tell a real ball from noise/shadows/a stale artifact with 100% reliability,
// and expo-camera has no live-frame API to do better (confirmed: no way
// around that within Expo Go — real-time frame access only exists through
// react-native-vision-camera's native frame processors, which need a paid
// Apple Developer Program + custom dev-client build, decided against for
// now). So: keep the automatic guess, but add one human confirmation tap —
// same pattern real phone-based golf apps (e.g. FairwayFX) and this
// project's own calibrate.tsx already use. The alternative to "the app
// might guess wrong silently" isn't "no automation," it's "the app guesses,
// you just confirm before it commits to measuring."
//
// State machine: 'ready' (camera up, box empty, waiting for "Grabar") →
// 'recording' (starts immediately on tap; up to MAX_RECORD_SEC, or the user
// taps "Ya golpeé" to stop early) → 'confirming' (shows the recording's own
// first frame with the auto-detected ball marked — tap "Sí, es la bola" to
// proceed, or tap elsewhere on the image to correct it, before anything is
// measured) → 'analyzing' (find where the confirmed ball started moving,
// measure it — this is the "automatic distance detection": see putting.ts)
// → 'result'.
//
// There's no live "does it see the ball yet" preview before you hit — that
// would need a photo capture before recording, which is exactly the mode-
// switch bug from v2. The confirmation happens right after the whole putt
// is recorded, using that recording's own first frame, so it costs nothing
// extra (no second capture) and stays on the single-capture-call design.
//
// Beta, unverified end-to-end from this environment (no camera hardware
// here) — thresholds below are starting points, not tuned against real
// footage (same honest framing as every other SHOTVISION_PLAN.md milestone).
// `recordAsync`/video-thumbnail extraction are native-only (iOS/Android) —
// this screen degrades gracefully on the web preview (shows the camera and
// UI, but can't actually record).
//
// Detection (2026-09-25): primary signal is HSV colour thresholding
// (`findBlobByColor` in pixelblob.ts) — ported from the user's own
// companion Python CV prototype (HSV threshold + contour + minEnclosingCircle,
// no YOLO/ML). A golf ball's colour is a much stronger, lighting-independent
// cue than "whatever differs from a reference frame": no clean background
// frame needed (works on the very first photo), and isn't thrown by the
// background itself changing (a hand or putter entering frame). Falls back
// to the original background-subtraction blob detector when colour
// thresholding finds nothing (unusual ball colour/lighting).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image, Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as VideoThumbnails from 'expo-video-thumbnails';
import Svg, { Line } from 'react-native-svg';

import { PuttSession, PuttShot, measurePuttFromDetections, predictPuttRoll } from '../../../src/shotvision/putting';
import {
  getPuttSession, updatePuttSession, deletePuttSession, listPuttShots, addPuttShot,
} from '../../../src/shotvision/puttStore';
import { decodeJpegFile, findBlob, findBlobByColor, DecodedImage, BlobResult } from '../../../src/shotvision/pixelblob';
import { BallDetectionFrame } from '../../../src/shotvision/types';
import { useSettings } from '../../../src/shotvision/useSettings';
import { dist, speed } from '../../../src/shotvision/format';
import { SV } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

type Phase = 'ready' | 'recording' | 'confirming' | 'analyzing' | 'result';

const MAX_RECORD_SEC = 4;          // generous — the user needs a moment to set up their stroke
// "Probar encuadre" — a real check-the-setup-first option, requested after
// repeated wrong markers made it clear a full record→confirm round trip is
// too slow to iterate on framing/lighting. A live pre-flight preview isn't
// possible (expo-camera's native session literally has no photo output
// configured while `mode="video"` — confirmed in CameraSessionManager.swift's
// setCameraMode(), not just assumed — so a live photo check would need the
// same mode-switch that caused the original "Camera is not ready" crash).
// This reuses the exact same safe record→confirm pipeline, just for under a
// second, so it costs nothing new and can't reintroduce that bug.
const TEST_RECORD_SEC = 1.0;

// 2026-09-26: a real-device run took ~1 minute at the old settings (coarse
// step 50ms scanning up to a blind 4000ms ceiling = up to 80 frame
// extractions, each apparently costing far more than assumed — video
// thumbnail extraction on a real phone is nowhere near as cheap as the
// synthetic tests that validated the *math* could suggest) and still came
// back 0/0. Two separate fixes:
//  1. Speed: a 3-tier funnel (cheap net pass → narrow the one bracket that
//     moved → dense measurement only in that ~150ms window) bounds total
//     extractions to ~25–40 regardless of clip length, instead of up to
//     ~100. Also bounded by the ACTUAL recorded length (`recDurationMsRef`,
//     not a blind MAX_RECORD_SEC ceiling) — stopping the moment "Ya golpeé"
//     was tapped saves scanning dead air.
//  2. Correctness: SETTLE_MS skips the first moment of the recording before
//     motion-scanning starts at all. Auto-exposure/auto-focus visibly
//     shifts a frame's brightness/colour for a beat right after a capture
//     session starts recording — exactly the kind of change the motion
//     detector is built to catch — and a false trigger there is the leading
//     suspect for "found *something*, ran the whole measurement on it,
//     result was ~0": if the fine pass's whole window lands on camera
//     settling instead of the real putt, near-zero net motion is exactly
//     what a linear fit on jitter looks like. The user needs a moment after
//     tapping Grabar to get back into their stance anyway, so skipping this
//     window costs nothing real.
const SETTLE_MS = 300;
const COARSE_STEP_MS = 180;        // pass 1: cheap net across the (bounded) clip
const REFINE_STEP_MS = 30;         // pass 2: narrows the one coarse bracket that moved
const FINE_STEP_MS = 35;           // pass 3: the actual measurement
const FINE_WINDOW_MS = 450;        // how far past the refined onset to keep sampling
const MOTION_THRESHOLD_RATIO = 1.3; // ball must move > this × its own diameter to count as "struck"

// 2026-09-26: used to bias the VERY FIRST ball guess toward an assumed
// bottom-left corner (matching the placement box), on top of everything
// else this box constant documented at the time. Testing against a real
// photo (a Logitech webcam, see stillAtRest's comment) showed that bias
// actively picks the WRONG object whenever the ball isn't exactly there —
// it out-weighs being the real ball. Removed: the first guess is now
// unbiased (see prepareConfirmation). Only BOX_W_FRAC survives, as a rough
// ball-size fallback when a confirmation tap doesn't land on a colour
// match at all (see onConfirmTap).
const BOX_W_FRAC = 0.22;

// 2026-09-26: tested against TWO real photos (a Logitech webcam, plugged
// into the dev machine specifically to get real data instead of guessing
// blind) — one dim, one bright after the camera's auto-exposure adjusted.
// In BOTH, an unbiased search occasionally latched onto something else in
// the room entirely (a bright wall/window: colour thresholding; a foot in
// frame: contrast fallback) rather than the ball — and that wrong blob was
// consistently much LARGER than the real ball (12,850–79,476px vs the real
// ball's ~1,518px, in a 1280×720 frame). A golf ball at this setup's
// close range (0.5–1.2 m) only ever occupies a small fraction of the frame,
// so anything much bigger than that is almost certainly NOT the ball.
// Swept several cap values against real photos (0.02 down to 0.003 of frame
// area); 0.008 rejected every false positive seen while never rejecting the
// real ball.
//
// 2026-09-26 (later same day): originally this was applied AFTER picking the
// single best-scoring blob (a `withinPlausibleSize` wrapper around the
// result) — which can only turn a wrong answer into "not found", because by
// the time it runs every other candidate has already been discarded. On a
// real "bright room" test photo, both colour and contrast search confidently
// picked an oversized false positive (a wall, a foot) that outscored the
// real ball, so post-hoc rejection just meant "never detects in that room".
// Moving the cap INSIDE the connected-components search itself (so oversized
// components are skipped, not just the final winner) lets the smaller, real
// ball win instead — confirmed against both real test photos (dim + bright
// rooms) at every resolution from 220px up to the original 1280px: exact
// hit (<12px error) every time, where the post-hoc version failed the bright
// photo entirely.
const MAX_BALL_AREA_FRAC = 0.008;

/** Colour thresholding first (works with no background reference, robust to
 *  a changing background), background-subtraction as the fallback. Used for
 *  the fine (measurement) pass, where the `expected`-distance plausibility
 *  gate in analyzeRecording() already guards against the failure mode below. */
function detectBall(
  img: DecodedImage, bg: DecodedImage | undefined, expected?: { x: number; y: number },
): BlobResult | null {
  return findBlobByColor(img, ['white', 'yellow'], expected, MAX_BALL_AREA_FRAC)
    ?? findBlob(img, 'round', bg, expected, MAX_BALL_AREA_FRAC);
}

/** Colour first, own-FRAME contrast as a fallback (2026-09-26: added after
 *  testing against a real photo from a Logitech webcam — see putting.ts's
 *  history — real indoor lighting reads far dimmer than the synthetic test
 *  renders that validated the colour thresholds: a real white golf ball
 *  measured v≈0.08 (8% brightness) against a `v > 0.35` threshold, so colour
 *  detection failed on EVERY frame of that real test, not just some. Own-
 *  frame contrast found the same ball correctly in the same test — no
 *  reference/background frame is passed here, so the "stale hole" artifact
 *  (see detectBall's fine-pass comment) can't occur: that needs a diff
 *  against a SEPARATE reference frame, and this only contrasts the current
 *  frame against itself. No background subtraction, no hole. */
function stillAtRest(img: DecodedImage, restPos: { x: number; y: number }, ballDia: number): boolean {
  const blob = findBlobByColor(img, ['white', 'yellow'], restPos, MAX_BALL_AREA_FRAC)
    ?? findBlob(img, 'round', undefined, restPos, MAX_BALL_AREA_FRAC);
  if (!blob) return false;
  return Math.hypot(blob.cx - restPos.x, blob.cy - restPos.y) <= ballDia * MOTION_THRESHOLD_RATIO;
}

export default function PuttCapture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();

  const [permission, requestPermission] = useCameraPermissions();
  const [session, setSession] = useState<PuttSession | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(0);
  const [lastShot, setLastShot] = useState<PuttShot | null>(null);
  const [lastRoll, setLastRoll] = useState<ReturnType<typeof predictPuttRoll> | null>(null);
  const [busyMsg, setBusyMsg] = useState('');
  const [recElapsedSec, setRecElapsedSec] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [confirmUri, setConfirmUri] = useState<string | null>(null);
  const [marker, setMarker] = useState<{ x: number; y: number; dia: number } | null>(null);
  const [isTestConfirm, setIsTestConfirm] = useState(false);

  const camRef = useRef<CameraView | null>(null);
  const mountedRef = useRef(true);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartedAtRef = useRef(0);
  const confirmImgRef = useRef<DecodedImage | null>(null);
  const confirmVideoRef = useRef<{ uri: string; recordedMs: number } | null>(null);
  const confirmLayoutRef = useRef({ width: 1, height: 1 });

  useFocusEffect(useCallback(() => {
    (async () => {
      const s = await getPuttSession(id);
      setSession(s);
      const existing = await listPuttShots(id);
      setCount(existing.length);
    })();
    return () => { mountedRef.current = false; };
  }, [id]));

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => () => { if (recTimerRef.current) clearInterval(recTimerRef.current); }, []);

  async function extractFrame(uri: string, atMs: number): Promise<DecodedImage | null> {
    const r = await extractFrameWithUri(uri, atMs);
    return r?.img ?? null;
  }

  /** Same as extractFrame, but also keeps the thumbnail's own URI — needed
   *  only for the confirmation screen, which displays the frame as an
   *  <Image> (decoded pixel data alone can't be rendered directly). */
  async function extractFrameWithUri(uri: string, atMs: number): Promise<{ img: DecodedImage; thumbUri: string } | null> {
    try {
      const t = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, Math.round(atMs)) });
      const img = await decodeJpegFile(t.uri);
      return { img, thumbUri: t.uri };
    } catch {
      return null;   // past the end of the clip, or extraction failed for this instant
    }
  }

  /** Record a short clip automatically — no live per-frame timing pressure,
   *  so nothing here needs to "keep up" with the ball in real time.
   *
   *  There used to be a separate still-photo "calibration" step before this
   *  (tap Detectar → takePictureAsync confirms the ball, then switch the
   *  CameraView's `mode` to 'video' and record). That caused a real-device
   *  failure: switching between 'picture' and 'video' mode makes iOS/Android
   *  reconfigure the whole capture session, which isn't instant, and
   *  `recordAsync()` was firing before that finished — the exact iOS error
   *  ("Camera is not ready yet. Wait for 'onCameraReady' callback") lives in
   *  `CameraPhotoCapture.swift` and guards overlapping/racing photo captures,
   *  which is what a mode-switch-then-immediately-record sequence produces.
   *  Fix: never switch modes. The CameraView stays in 'video' mode from the
   *  start, and this records immediately — ball placement is validated from
   *  the recording's own first frame in `analyzeRecording()` instead of a
   *  separate photo, so there's exactly one capture call in this whole flow.
   *
   *  Also needs the CameraView's `mute` prop set: expo-camera's native
   *  recorder refuses to start at all without either microphone permission
   *  or an explicit mute flag (Android: `CameraViewModule.kt` throws
   *  `MissingPermissions(RECORD_AUDIO)` otherwise — the earlier "this device
   *  does not allow recording video" failure). We don't want audio anyway,
   *  so muting is the right fix, not a permission request. */
  async function startRecording() {
    await record(MAX_RECORD_SEC, false);
  }

  /** "Probar encuadre" — see the TEST_RECORD_SEC comment above: same pipeline,
   *  short and automatic (no "Ya golpeé" tap needed, maxDuration alone stops
   *  it), landing on the confirmation screen in test mode (just a "Volver"
   *  button, no analysis) so framing/lighting can be checked and re-checked
   *  quickly without a real putt each time. */
  async function testFraming() {
    await record(TEST_RECORD_SEC, true);
  }

  async function record(maxDurationSec: number, isTest: boolean) {
    if (!camRef.current) return;
    if (!cameraReady) { Alert.alert('Cámara no lista', 'Espera un momento a que la cámara termine de iniciarse e inténtalo de nuevo.'); return; }
    setPhase('recording');
    setRecElapsedSec(0);
    recStartedAtRef.current = Date.now();
    recTimerRef.current = setInterval(() => setRecElapsedSec(s => s + 0.2), 200);
    try {
      const video = await camRef.current.recordAsync({ maxDuration: maxDurationSec });
      const recordedMs = Date.now() - recStartedAtRef.current;
      if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
      if (!mountedRef.current) return;
      if (!video?.uri) {
        Alert.alert('Sin vídeo', 'No se pudo grabar. Inténtalo de nuevo.');
        setPhase('ready');
        return;
      }
      await prepareConfirmation(video.uri, recordedMs, isTest);
    } catch (e) {
      if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
      Alert.alert(
        'Grabación no disponible',
        `No se pudo grabar vídeo desde la app: ${e instanceof Error ? e.message : String(e)}`,
      );
      setPhase('ready');
    }
  }

  function stopRecordingNow() {
    camRef.current?.stopRecording();
  }

  /** Extracts the recording's first (post-settle) frame, runs the same
   *  box-biased auto-detect as before to propose a marker, and hands the
   *  result to the user for a yes/tap-to-correct check instead of trusting
   *  it blindly. This frame doubles as `bg` for the motion passes later —
   *  one extraction call, not a separate one per step. */
  async function prepareConfirmation(uri: string, recordedMs: number, isTest: boolean) {
    setPhase('analyzing');
    setIsTestConfirm(isTest);
    setBusyMsg('Leyendo el vídeo…');
    const extracted = await extractFrameWithUri(uri, SETTLE_MS);
    if (!extracted) { failAnalysis('No se pudo leer el vídeo grabado.'); return; }
    if (!mountedRef.current) return;
    const { img, thumbUri } = extracted;

    // The whole rest of this pipeline (stillAtRest, the fine-pass tracking)
    // assumes a wide (landscape) frame. A portrait-shaped one means the phone
    // wasn't actually recorded landscape (see the CameraView's
    // `responsiveOrientationWhenOrientationLocked` comment) — surface that
    // plainly instead of quietly measuring against the wrong orientation.
    if (img.height > img.width) {
      failAnalysis('El vídeo salió en vertical — revisa que el móvil esté realmente en horizontal (apaisado) antes de grabar, e inténtalo de nuevo.');
      return;
    }

    // No `expected` bias here — unlike every other detectBall() call in this
    // file, this is the very FIRST guess, before anything is actually known
    // about where the ball is. Testing against a real photo (2026-09-26)
    // showed biasing toward the assumed BOX_CX_FRAC/BOX_CY_FRAC corner
    // actively picks the WRONG object when the ball isn't exactly there —
    // the bias out-weighs being the real ball, so it steers the guess
    // toward whatever else happens to sit near that assumed corner instead.
    // An unbiased search (falls back to the frame-centre weighting in
    // pixelblob.ts) found the real ball correctly in that same test.
    const guess = detectBall(img, undefined);

    confirmImgRef.current = img;
    confirmVideoRef.current = { uri, recordedMs };
    setConfirmUri(thumbUri);
    setMarker(guess ? { x: guess.cx, y: guess.cy, dia: 2 * Math.sqrt(guess.pixelCount / Math.PI) } : null);
    setPhase('confirming');
  }

  /** The confirm <Image> uses resizeMode="contain" inside a TALL portrait
   *  container showing a WIDE landscape frame — it gets letterboxed (empty
   *  bars above/below), not stretched to fill the container. A first version
   *  of this screen ignored that and mapped taps/markers straight against
   *  the full container size, so the marker rendered wherever the *screen*
   *  fraction pointed — which, for a landscape image letterboxed into a
   *  portrait box, is almost never where the *image* fraction points. This
   *  computes the actual displayed image rectangle (contain's scale + the
   *  letterbox offset) so both directions (tap→native, native→display) go
   *  through the real visible bounds, not the outer container's. */
  function containRect(imgW: number, imgH: number, containerW: number, containerH: number) {
    const scale = Math.min(containerW / imgW, containerH / imgH);
    const dispW = imgW * scale, dispH = imgH * scale;
    return { scale, offsetX: (containerW - dispW) / 2, offsetY: (containerH - dispH) / 2 };
  }

  /** Tap anywhere on the confirmation frame to place/correct the marker.
   *  Re-runs colour detection centred on the tap so an approximate tap still
   *  snaps to the actual ball — you don't have to be pixel-precise. Falls
   *  back to the raw tap point (with the previous size guess, or a rough
   *  fraction of the box as a last resort) if nothing colour-matches there,
   *  so a tap always does *something* rather than silently failing. */
  function onConfirmTap(displayX: number, displayY: number) {
    const img = confirmImgRef.current;
    if (!img) return;
    const { width: containerW, height: containerH } = confirmLayoutRef.current;
    const { scale, offsetX, offsetY } = containRect(img.width, img.height, containerW, containerH);
    const tapPos = { x: (displayX - offsetX) / scale, y: (displayY - offsetY) / scale };
    const refined = findBlobByColor(img, ['white', 'yellow'], tapPos, MAX_BALL_AREA_FRAC);
    const dia = refined ? 2 * Math.sqrt(refined.pixelCount / Math.PI) : (marker?.dia ?? img.width * BOX_W_FRAC * 0.5);
    setMarker(refined ? { x: refined.cx, y: refined.cy, dia } : { x: tapPos.x, y: tapPos.y, dia });
  }

  function confirmMarker() {
    const video = confirmVideoRef.current;
    const img = confirmImgRef.current;
    if (!video || !img || !marker) return;
    analyzeRecording(video.uri, video.recordedMs, img, { x: marker.x, y: marker.y }, marker.dia);
  }

  function retryFromConfirm() {
    confirmImgRef.current = null;
    confirmVideoRef.current = null;
    setConfirmUri(null);
    setMarker(null);
    setIsTestConfirm(false);
    setPhase('ready');
  }

  /** 3-tier funnel — see the SETTLE_MS/COARSE_STEP_MS block above for why:
   *  pass 1 is a cheap net across the (bounded-by-actual-length) clip, pass
   *  2 narrows down to the one ~180ms bracket where something moved, pass 3
   *  densely re-scans that narrow window to actually measure it —
   *  extrapolating "where it should be next" the same way calibrate.tsx's
   *  auto-detect does, to tell the moving ball apart from anything else that
   *  might enter frame (a hand, the putter). Bounds total extractions to a
   *  small constant regardless of clip length or how long the user takes to
   *  swing. `checked` is just a live counter for the "processing…" text —
   *  this can take a real number of seconds on a real phone, and showing
   *  *something moving* matters so it doesn't read as hung.
   *
   *  `bg`/`restPos`/`ballDia` come from the user-confirmed marker now, not a
   *  fresh auto-detect — the whole point of the confirmation step is that
   *  this part is no longer a guess. */
  async function analyzeRecording(
    uri: string, recordedMs: number,
    bg: DecodedImage, restPos: { x: number; y: number }, ballDia: number,
  ) {
    setPhase('analyzing');
    setBusyMsg('Leyendo el vídeo…');
    let checked = 0;
    const tick = (label: string) => { checked += 1; setBusyMsg(`${label} (${checked})`); };

    const clipEndMs = Math.min(recordedMs, MAX_RECORD_SEC * 1000);

    // Pass 1: cheap net. Skips SETTLE_MS first — auto-exposure/focus visibly
    // shifts a frame right after recording starts, which looks exactly like
    // "motion" to this check; a false trigger there sends passes 2/3 to
    // measure camera settling instead of the real putt (near-zero net
    // motion over that window — a strong suspect for a real "0 mph" result).
    let coarsePrevMs = SETTLE_MS;
    let coarseHitMs: number | null = null;
    for (let t = SETTLE_MS + COARSE_STEP_MS; t <= clipEndMs; t += COARSE_STEP_MS) {
      tick('Buscando el golpe…');
      const img = await extractFrame(uri, t);
      if (!img) break;   // reached the end of the clip
      if (!stillAtRest(img, restPos, ballDia)) { coarseHitMs = t; break; }
      coarsePrevMs = t;
    }
    if (coarseHitMs == null) {
      failAnalysis(`No se detectó que la bola se moviera (grabación de ${(recordedMs / 1000).toFixed(1)}s). Asegúrate de que quede dentro del encuadre al golpear e inténtalo de nuevo.`);
      return;
    }

    // Pass 2: narrow that one bracket down to a precise onset time.
    let onsetMs = coarseHitMs;
    for (let t = coarsePrevMs + REFINE_STEP_MS; t < coarseHitMs; t += REFINE_STEP_MS) {
      tick('Afinando el momento…');
      const img = await extractFrame(uri, t);
      if (!img) continue;
      if (!stillAtRest(img, restPos, ballDia)) { onsetMs = t; break; }
    }

    // Pass 3: dense measurement.
    const fineStart = Math.max(SETTLE_MS, onsetMs - REFINE_STEP_MS);
    const points: BallDetectionFrame[] = [];
    let expected = restPos;
    let i = 0;
    let misses = 0;
    for (let t = fineStart; t <= fineStart + FINE_WINDOW_MS; t += FINE_STEP_MS, i++) {
      tick('Midiendo el golpe…');
      const img = await extractFrame(uri, t);
      if (!img) break;
      const blob = detectBall(img, bg, expected);
      // Once the ball rolls out of the trackable area entirely, the
      // background-subtraction fallback can lock onto the "hole" it left
      // behind at its old resting spot (a real diff — the ball really is
      // gone from there — but not the ball). That hole sits far from where
      // a genuinely still-rolling ball should be by now, so a plausibility
      // gate against `expected` catches it; a slightly-loppy blob still
      // matters more than a phantom one, so this is generous, not tight.
      const plausible = blob && Math.hypot(blob.cx - expected.x, blob.cy - expected.y) < ballDia * (points.length >= 2 ? 2.5 : 4);
      if (plausible) {
        misses = 0;
        const r = Math.sqrt(blob!.pixelCount / Math.PI);
        points.push({ frame: i, timeSec: (t - fineStart) / 1000, cx: blob!.cx, cy: blob!.cy, radiusPx: r, confidence: 0.75 });
        expected = points.length >= 2
          ? extrapolate(points[points.length - 2], points[points.length - 1], (t + FINE_STEP_MS - fineStart) / 1000)
          : { x: blob!.cx, y: blob!.cy };
      } else if (points.length >= 2) {
        // ball already had a track going — it's left the frame, stop here
        misses += 1;
        if (misses >= 2) break;
      }
    }

    // The fine pass starts a little before the coarse-detected onset (safety
    // margin for coarse granularity), so its first few points can still be
    // the ball sitting at rest. Left in, those flat points bias the linear
    // speed fit low — worse the shorter the real trackable window is, i.e.
    // worst for exactly the firm putts that matter most to get right. Trim
    // down to the genuinely-moving segment before fitting.
    const firstMovingIdx = points.findIndex(
      p => Math.hypot(p.cx - restPos.x, p.cy - restPos.y) > ballDia * MOTION_THRESHOLD_RATIO,
    );
    const trimmed = firstMovingIdx > 0 ? points.slice(firstMovingIdx) : points;

    const measure = measurePuttFromDetections(trimmed);
    if (!measure) {
      failAnalysis(`No se pudo medir el golpe con suficiente precisión (${trimmed.length}/${points.length} puntos válidos, inicio a ${onsetMs}ms) — inténtalo de nuevo con más luz.`);
      return;
    }
    const roll = predictPuttRoll(measure.rollSpeedMs, settings.puttDecelMs2);
    const saved = await addPuttShot({
      sessionId: id,
      measure,
      roll,
      targetDistanceMeters: settings.puttTargetDistanceM,
    });
    if (!mountedRef.current) return;
    setLastShot(saved);
    setLastRoll(roll);
    setCount(c => c + 1);
    setPhase('result');
  }

  function failAnalysis(msg: string) {
    if (!mountedRef.current) return;
    Alert.alert('No se pudo medir', msg);
    setPhase('ready');
  }

  function nextPutt() {
    setLastShot(null);
    setLastRoll(null);
    confirmImgRef.current = null;
    confirmVideoRef.current = null;
    setConfirmUri(null);
    setMarker(null);
    setIsTestConfirm(false);
    // The <CameraView> unmounts while the result screen is showing (a
    // ScrollView renders instead) and remounts fresh here — it needs a new
    // onCameraReady before it's actually usable again, same as on first
    // mount, so this must NOT be left true from the previous putt.
    setCameraReady(false);
    setPhase('ready');
  }

  function exit() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (count === 0) { deletePuttSession(id).then(() => router.replace('/shotvision')); return; }
    Alert.alert('Salir', `¿Guardar esta sesión? (${count} putt${count === 1 ? '' : 's'})`, [
      { text: 'Descartar', style: 'destructive', onPress: async () => { await deletePuttSession(id); router.replace('/shotvision'); } },
      { text: 'Guardar', onPress: async () => { await updatePuttSession(id, { saved: true }); router.replace(`/shotvision/putt/summary/${id}`); } },
    ]);
  }

  const header = { title: 'Putt', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink };

  if (session === undefined) {
    return <><Stack.Screen options={header} /><View style={styles.center}><ActivityIndicator color={SV.green} /></View></>;
  }
  if (session === null) {
    return <><Stack.Screen options={header} /><View style={styles.center}><Text style={styles.dim}>Sesión no encontrada.</Text></View></>;
  }

  if (!permission) {
    return <><Stack.Screen options={header} /><View style={styles.center}><ActivityIndicator color={SV.green} /></View></>;
  }
  if (!permission.granted) {
    return (
      <>
        <Stack.Screen options={header} />
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={32} color={SV.faint} />
          <Text style={styles.dim}>Necesitamos acceso a la cámara para medir el putt.</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnTxt}>Permitir cámara</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const target = settings.puttTargetDistanceM;
  const diffM = lastRoll != null && target != null ? lastRoll.distanceMeters - target : null;

  return (
    <>
      <Stack.Screen options={{
        title: 'Putt', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
        headerBackVisible: false,
        headerRight: () => (
          <TouchableOpacity onPress={exit} hitSlop={8}>
            <Text style={styles.doneTxt}>Salir</Text>
          </TouchableOpacity>
        ),
      }} />
      <View style={styles.container}>
        {phase === 'result' && lastShot && lastRoll ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}>
            <Text style={styles.shotCount}>Putt {count}</Text>
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>VELOCIDAD DE RODADA</Text>
              <View style={styles.heroRow}>
                <Text style={styles.heroNum}>{speed(lastShot.measure.rollSpeedMs, settings).split(' ')[0]}</Text>
                <Text style={styles.heroUnit}>{speed(lastShot.measure.rollSpeedMs, settings).split(' ')[1]}</Text>
              </View>
              <Text style={styles.heroSub}>
                confianza {Math.round(lastShot.measure.confidence * 100)}% · {lastShot.measure.framesTracked} puntos · bola ~{Math.round(lastShot.measure.ballDiameterPx)}px
              </Text>
            </View>

            <View style={styles.grid}>
              <Metric label="Distancia estimada" value={dist(lastRoll.distanceMeters, settings)} />
              <Metric label="Tiempo de rodada" value={`${lastRoll.rollTimeSec.toFixed(1)} s`} />
              {diffM != null && (
                <Metric
                  label={Math.abs(diffM) < 0.15 ? 'Al hoyo' : diffM > 0 ? 'Se pasó' : 'Se quedó corto'}
                  value={Math.abs(diffM) < 0.15 ? '≈ 0 m' : dist(Math.abs(diffM), settings)}
                  color={Math.abs(diffM) < 0.15 ? SV.green : SV.accent}
                />
              )}
            </View>

            <Text style={styles.disclaimer}>
              Velocidad medida por cámara (autocalibrada por el tamaño de la bola). Distancia total
              estimada con un modelo de fricción simple — ajusta la velocidad de green en Ajustes si
              no coincide con la realidad.
            </Text>

            <TouchableOpacity style={styles.btn} onPress={nextPutt}>
              <Text style={styles.btnTxt}>Siguiente putt</Text>
              <Ionicons name="arrow-forward" size={18} color="#06210f" />
            </TouchableOpacity>
          </ScrollView>
        ) : (
          // Full-bleed stage — the camera preview (or, during 'confirming',
          // the extracted frame) fills the whole screen like a normal camera
          // app, with the guide box, status pill and buttons floating on top
          // instead of being boxed into a small 16:9 rectangle with empty
          // space around it. `onLayout` here (not on a smaller wrapper) is
          // what `onConfirmTap` uses to map a tap to the image's native
          // pixels, since the confirm <Image> now fills this same container.
          <View
            style={styles.fullStage}
            onLayout={e => {
              confirmLayoutRef.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
            }}
          >
            {phase === 'confirming' && confirmUri ? (
              <>
                {/* "contain", not "cover" — the recording is landscape (wide)
                    inside this tall portrait container, so it gets letterboxed
                    (empty bars above/below), not stretched to fill it. The
                    marker/tap math below accounts for that letterbox via
                    containRect() — a first version didn't, and placed the
                    marker relative to the whole screen instead of the actual
                    visible image, landing it in the empty space above a
                    letterboxed frame every time. */}
                <Image source={{ uri: confirmUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={e => onConfirmTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
                >
                  {marker && confirmImgRef.current && (() => {
                    const img = confirmImgRef.current;
                    const { scale, offsetX, offsetY } = containRect(
                      img.width, img.height, confirmLayoutRef.current.width, confirmLayoutRef.current.height,
                    );
                    return (
                      <View pointerEvents="none" style={[styles.confirmMarker, {
                        left: marker.x * scale + offsetX,
                        top: marker.y * scale + offsetY,
                      }]} />
                    );
                  })()}
                </Pressable>
              </>
            ) : (
              <>
                <CameraView
                  ref={camRef} style={StyleSheet.absoluteFill} facing="back"
                  mode="video"
                  mute
                  // The app's screen orientation is locked to portrait
                  // (app.json), and without this flag the recorded video
                  // inherits that lock — it comes out in PORTRAIT regardless
                  // of how the phone is physically held, even though the user
                  // was told to hold it landscape. That silently broke the
                  // whole detection pipeline downstream (it assumes a wide
                  // frame) — the ball ended up in a completely different part
                  // of a now-tall, narrow image than expected. This tells the
                  // native recorder to follow the phone's actual physical
                  // rotation instead.
                  responsiveOrientationWhenOrientationLocked
                  onCameraReady={() => setCameraReady(true)}
                />
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
                    <Line x1={16} y1={17} x2={92} y2={17} stroke={SV.line} strokeWidth={0.5} strokeDasharray="2 3" />
                  </Svg>
                  <Ionicons name="arrow-forward" size={18} color={SV.faint} style={styles.rightArrow} />
                  <View style={[
                    styles.box,
                    phase === 'ready' && { borderColor: SV.faint, borderStyle: 'dashed' },
                    (phase === 'recording' || phase === 'analyzing') && { borderColor: SV.green, backgroundColor: 'rgba(55,214,122,0.14)' },
                  ]}>
                    <View style={styles.crossH} />
                    <View style={styles.crossV} />
                    {(phase === 'recording' || phase === 'analyzing') && (
                      <View style={styles.checkPill}><Ionicons name="checkmark" size={12} color="#06210f" /></View>
                    )}
                  </View>
                </View>
              </>
            )}

            <View style={styles.statusFloating} pointerEvents="none">
              <View style={[styles.dot, {
                backgroundColor: phase === 'recording' ? SV.accent
                  : phase === 'analyzing' ? SV.green
                    : phase === 'confirming' ? (marker ? SV.green : SV.accent)
                      : SV.faint,
              }]} />
              <Text style={styles.status}>
                {phase === 'ready' && (cameraReady ? 'Coloca la bola en el recuadro' : 'Iniciando cámara…')}
                {phase === 'recording' && `Grabando… golpea cuando quieras (${recElapsedSec.toFixed(1)}s)`}
                {phase === 'analyzing' && busyMsg}
                {phase === 'confirming' && isTestConfirm && (marker ? 'Comprobación de encuadre — ¿detecta la bola?' : 'Comprobación de encuadre — no se detectó, tócala')}
                {phase === 'confirming' && !isTestConfirm && (marker ? '¿Es esta la bola?' : 'No se detectó — tócala en la imagen')}
              </Text>
            </View>

            <View style={styles.bottomFloating}>
              {phase === 'ready' && (
                <View style={{ gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.btn, !cameraReady && styles.btnDisabled]}
                    onPress={startRecording}
                    disabled={!cameraReady}
                  >
                    {cameraReady
                      ? <Ionicons name="videocam" size={18} color="#06210f" />
                      : <ActivityIndicator color="#06210f" size="small" />}
                    <Text style={styles.btnTxt}>{cameraReady ? 'Grabar' : 'Iniciando cámara…'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnGhost, !cameraReady && styles.btnDisabled]}
                    onPress={testFraming}
                    disabled={!cameraReady}
                  >
                    <Text style={styles.btnGhostTxt}>Probar encuadre (sin grabar el putt)</Text>
                  </TouchableOpacity>
                </View>
              )}
              {phase === 'recording' && (
                <TouchableOpacity style={styles.btn} onPress={stopRecordingNow}>
                  <Ionicons name="checkmark-circle" size={18} color="#06210f" />
                  <Text style={styles.btnTxt}>Ya golpeé</Text>
                </TouchableOpacity>
              )}
              {phase === 'confirming' && isTestConfirm && (
                <TouchableOpacity style={styles.btn} onPress={retryFromConfirm}>
                  <Ionicons name="arrow-back" size={18} color="#06210f" />
                  <Text style={styles.btnTxt}>Volver y ajustar</Text>
                </TouchableOpacity>
              )}
              {phase === 'confirming' && !isTestConfirm && (
                <View style={{ gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.btn, !marker && styles.btnDisabled]}
                    onPress={confirmMarker}
                    disabled={!marker}
                  >
                    <Ionicons name="checkmark" size={18} color="#06210f" />
                    <Text style={styles.btnTxt}>Sí, es la bola</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnGhost} onPress={retryFromConfirm}>
                    <Text style={styles.btnGhostTxt}>Grabar de nuevo</Text>
                  </TouchableOpacity>
                </View>
              )}
              {phase === 'analyzing' && (
                <View style={styles.hintRow}>
                  <ActivityIndicator color={SV.sub} size="small" />
                  <Text style={styles.hint}>Procesando…</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function extrapolate(
  a: BallDetectionFrame, b: BallDetectionFrame, atSec: number,
): { x: number; y: number } {
  const dt = b.timeSec - a.timeSec;
  if (dt <= 0) return { x: b.cx, y: b.cy };
  const vx = (b.cx - a.cx) / dt, vy = (b.cy - a.cy) / dt;
  const ahead = atSec - b.timeSec;
  return { x: b.cx + vx * ahead, y: b.cy + vy * ahead };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SV.bg, gap: 12, padding: 24 },
  dim: { color: SV.sub, fontSize: 13, textAlign: 'center' },
  doneTxt: { color: SV.accent, fontFamily: FONT.headingSemiBold, fontSize: 14 },

  // Full-bleed — camera/confirm image fills the entire remaining screen
  // (like a normal camera app) instead of a small boxed-in 16:9 rectangle;
  // the guide box, status pill and buttons float on top of it.
  fullStage: { flex: 1, backgroundColor: '#0d1a26' },
  // top offset clears the statusFloating pill above it (roughly 6-7% of a
  // typical phone screen height) — approximate/by-eye like everything else
  // positioning this box, not computed from a shared measurement.
  rightArrow: { position: 'absolute', right: 14, top: '18%', marginTop: -10 },
  box: {
    position: 'absolute', left: '5%', top: '12%', width: '22%', aspectRatio: 1,
    borderRadius: 10, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
  },
  crossH: { position: 'absolute', width: '55%', height: 1.5, backgroundColor: SV.sub },
  crossV: { position: 'absolute', width: 1.5, height: '55%', backgroundColor: SV.sub },
  checkPill: { position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: 10, backgroundColor: SV.green, alignItems: 'center', justifyContent: 'center' },
  confirmMarker: {
    position: 'absolute', width: 34, height: 34, marginLeft: -17, marginTop: -17,
    borderRadius: 17, borderWidth: 3, borderColor: SV.accent, backgroundColor: 'rgba(255,138,61,0.18)',
  },

  statusFloating: {
    position: 'absolute', top: 16, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(10,20,32,0.6)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  status: { color: SV.ink, fontSize: 14, fontFamily: FONT.bodySemiBold },
  bottomFloating: { position: 'absolute', left: 16, right: 16, bottom: 24 },

  shotCount: { color: SV.sub, fontSize: 12, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 },

  hero: {
    backgroundColor: SV.surface, borderRadius: 16, padding: 18, gap: 4,
    borderWidth: 1, borderColor: SV.line,
  },
  heroLabel: { fontSize: 10, fontFamily: FONT.headingSemiBold, color: SV.sub, letterSpacing: 0.8 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  heroNum: { fontSize: 52, fontFamily: FONT.headingExtraBold, color: SV.ink, lineHeight: 56 },
  heroUnit: { fontSize: 16, fontFamily: FONT.bodySemiBold, color: SV.sub, marginBottom: 8 },
  heroSub: { fontSize: 12, color: SV.sub },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    backgroundColor: SV.surface, borderWidth: 1, borderColor: SV.line,
    borderRadius: 12, padding: 12, gap: 2, flexGrow: 1, minWidth: 100,
  },
  metricLabel: { fontSize: 9, fontFamily: FONT.bodySemiBold, color: SV.sub, letterSpacing: 0.4, textTransform: 'uppercase' },
  metricValue: { fontSize: 18, fontFamily: FONT.headingExtraBold, color: SV.ink },

  disclaimer: { fontSize: 11, color: SV.faint, lineHeight: 16, marginTop: 4 },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15 },
  btnDisabled: { opacity: 0.5 },
  btnTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
  btnGhost: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 14,
    borderWidth: 1, borderColor: SV.line, backgroundColor: 'rgba(10,20,32,0.6)',
  },
  btnGhostTxt: { color: SV.sub, fontSize: 13, fontFamily: FONT.bodySemiBold },
  hintRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(10,20,32,0.6)', borderRadius: 14, paddingVertical: 14,
  },
  hint: { color: SV.sub, fontSize: 12 },
});
