# ShotVision — camera-only launch monitor

A ShotVision-style launch monitor built into GolfTracker. Film a shot in the
iPhone's **Slo-Mo mode (240 fps)**, import the clip, and get ball speed, launch
angle, carry, total and apex — with club speed / smash / spin / direction to
follow.

## Two modes (2026-09-09)

ShotVision landing = two cards:
1. **Practicar ahora** — the launch monitor. `practice/setup.tsx` wizard
   (indoor/outdoor → ball type → phone placement diagram → "place a ball") →
   `practice/[id].tsx` capture flow → **Salir** prompts save/discard →
   `summary/[id]`. Club selectable + changeable mid-session.
2. **Simulador de golf** — connect to **GSPro** (Open Connect, TCP :921) or
   **E6 Connect** (:2483) and play rounds. `sim/setup.tsx` (platform →
   connection test → **alignment** calibration) → `sim/[id]` shows each shot's
   payload (Ball/VLA/HLA/Spin/Axis) "sent to" the sim + "Calibrar con este
   golpe" to zero the alignment offset. **TCP socket needs the dev build** —
   the connection test currently fails on purpose with that message.

Alignment: `SimConfig.alignmentOffsetDeg` is added to the measured launch
direction before it becomes HLA. Face-on phone capture is weak on absolute
direction, so the workflow is: hit a few you know are straight → "assume
straight" sets the offset.

Sessions carry `mode`, `venue`, `ballType`, `sim`, `saved`. Practice sessions
start `saved:false` and only appear on the dashboard after the user confirms
save; sim sessions auto-save.

## Scope decisions (locked)

| Question | Decision |
|---|---|
| Capture | Record-then-analyze. User films with the **native iOS Camera app** in Slo-Mo; app imports the clip. In-app live capture is Phase 5. |
| Metrics v1 | Ball speed, launch angle, carry, total, apex, descent angle |
| Metrics later | Launch direction, club speed, smash factor, angle of attack, spin rate + axis |
| Use case | Indoor into a net |
| Ball | Marked (alignment line / dots) — required for spin in Phase 4 |
| Devices | iPhone with 240 fps Slo-Mo or better (iPhone 11+). No iPad, no Android. |
| Handedness | Right-handed only for now |
| Dev build | **EAS Build** (cloud, no Mac). Needed from Phase 2 on. |
| Frame extraction | Small local Expo module (Swift `AVAssetReader`) — frame-exact, fast |

## Camera setup (what the user does)

- Tripod, **25–35 cm high**, phone **landscape**, lens pointed at the ball,
  **tilted up ~10°**.
- **1.2–1.5 m** from the ball, **perpendicular to the target line** (face-on).
  Order along the lens axis: phone · ball · golfer.
- **Ball rests in the bottom corner of the frame** (default bottom-right → ball
  travels up-and-left across the whole frame = most frames of flight). Corner +
  distance are `SVSettings.ballCorner` / `cameraDistanceM`, shown in the capture
  viewfinder and driving `CaptureConfig` + the synthetic detections.
- Plain background, white/yellow ball with a drawn line.
- Bright, flicker-free light. Record in Slo-Mo (**true 240 fps**).
- Capture screen: a small box in that corner turns **green when a ball is
  detected & stable** ("Bola detectada"), grey/dashed while "Esperando bola…".

> Distance: at 60 cm a driver ball is only in frame ~12 ms (≈3 frames). At
> **120 cm it's ~24 ms (≈6 frames)** — the ball image is smaller so scale
> calibration is a bit noisier, but the extra frames improve the velocity fit
> more than that costs. Confirm/tune against real footage in Phase 2.

## Architecture

```
app/(tabs)/shotvision.tsx      new tab: setup guide, club picker, analyze, results
src/shotvision/
  types.ts        data model + constants
  ballflight.ts   RK4 trajectory (drag + Magnus) -> carry/total/apex/descent
  kinematics.ts   ball track -> ball speed + launch angle (self-calibrated
                  from the 42.67 mm ball; least-squares on the first ~45 ms)
  demo.ts         Phase-1 synthetic detections so the chain runs in Expo Go
  detect.ts       (Phase 2) per-frame ball detection on green background
  impact.ts       (Phase 2) find the impact frame (audio peak + motion onset)
  frames.ts       (Phase 2) JS wrapper around the native frame extractor
  spin.ts         (Phase 4) marked-ball line tracking -> spin rate + axis
modules/shotvision-frames/     (Phase 2) local Expo native module, Swift
```

Physics coefficients in `ballflight.ts` (`dragCoeff`, `liftCoeff`,
`SPIN_DECAY_PER_SEC`, `rollDistance`) are fitted to TrackMan PGA-Tour averages —
carry within ~3 % for the long/mid bag, wedges run a touch short & shallow.
**Re-tune these once we can compare against a real launch monitor.**

## Roadmap

- **Phase 1 — DONE.** Data model, physics model, kinematics math, screen scaffold
  running the full chain on synthetic detections. Works in Expo Go.
- **UI flow — DONE (2026-09-09).** Full session loop on a local (AsyncStorage)
  store, **dark TrackMan-style theme**, ready for real numbers to drop in:
  - `app/(tabs)/shotvision.tsx` — dark dashboard: lifetime stats, new session,
    session list, conditions, settings gear
  - `app/shotvision/session/[id].tsx` — club picker, **Modo captura** (primary)
    + Golpe rápido (demo), shot list, summary link
  - `app/shotvision/capture/[id].tsx` — **hands-free capture flow**: state
    machine arming→ready→recording→result, screen-edge flash between shots
    (torch signal), auto-advance. Camera feed replaces the timers in Phase 5
    (marked in the file).
  - `app/shotvision/shot/[id].tsx` — result screen (`ShotResult` component,
    reused by capture): ball-speed hero + **3D perspective flight** +
    side trajectory + **numbers panel** (all driven by the settings checklist)
  - `app/shotvision/summary/[id].tsx` — per-club aggregates: carry spread bars,
    consistency score, best-shot link
  - `app/shotvision/settings.tsx` — units, ball/environment, capture behaviour,
    and a **checklist** of which views + metrics show on the result screen
  - `src/shotvision/`: `store.ts` (local CRUD, mirrors the Supabase schema),
    `settings.ts` + `useSettings.ts`, `format.ts` (unit formatting),
    `aggregate.ts`, `analyze.ts`, `ui.tsx` (dark shared components +
    `PerspectiveFlight`), `useConditions.ts`
  - `demo.ts` now generates launch direction + sidespin so the 3D view shows
    shot shape.
  - TODO: settings overrides (altitude/temp/ballType) aren't fed into
    `useConditions`/the model yet. Migrate store to Supabase later.
- **Phase 2.** EAS dev build. Native frame extractor. Ball detection + tracking
  on the green background, tuned against the user's sample clips in `videos/`.
  Impact detection. Video import (`expo-image-picker`). → real ball speed +
  launch angle.
- **Phase 3.** `shot_vision_shots` + `shot_vision_sessions` tables in Supabase,
  `api.ts` CRUD, session summary, per-club breakdown, history/trends. Optionally
  auto-append carry to `club_settings` for the matching club.
- **Phase 4.** Launch direction (depth cues / second camera), club-head tracking
  → club speed + smash + AoA, spin rate + axis from the ball's line.
- **Phase 5.** In-app live capture with `react-native-vision-camera`, alignment
  guide, auto-impact detection (no manual trigger).

## Supabase schema (Phase 3)

```sql
create table shot_vision_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  label text,
  created_at timestamptz default now()
);

create table shot_vision_shots (
  id uuid primary key,
  session_id uuid not null references shot_vision_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  club text not null,
  ball_speed_ms real,
  launch_angle_deg real,
  launch_direction_deg real,
  backspin_rpm real,
  sidespin_rpm real,
  carry_m real,
  total_m real,
  apex_m real,
  descent_angle_deg real,
  confidence real,
  video_path text,
  created_at timestamptz default now()
);

alter table shot_vision_sessions enable row level security;
alter table shot_vision_shots    enable row level security;
create policy own_sessions on shot_vision_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_shots on shot_vision_shots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## Phase 2 progress (2026-09-08)

First real-ball footage analysed (`videos/wedge*_570*.mov`, 4 SW range-ball
shots). Prototype tracker: `shotvision-lab/track_ball.py`.

- **iPhone slo-mo `.mov` is 1920×1080 @ true 240 fps.** `cv2.CAP_PROP_FPS`
  misreports it as 206–228 — read per-frame `POS_MSEC` instead, or hardcode 240.
  (This was a ~15 % speed error until caught.)
- Yellow ball on the green mat tracks well via frame-differencing on the yellow
  channel. Scale self-calibrates from the ball (≈60 px diameter at 120 cm).
- **The ball leaves the top of the frame in 5–7 frames** on steep wedge shots →
  tilt the camera up ~10°, or zoom out, for 12–15 points and a tighter fit.
- Results: 5708 → 78 mph / 34°, 5709 → 73 mph / 33° (two SW swings agree ~7 %);
  5706 bladed → 68 mph / 13°; 5707 (thin, into bright background) → ball lost.
- **Carry not yet validated**: model predicts ~75–85 m, user reported ~62 m for
  the SW shots. Gap = limited-flight range balls + model tuned for premium balls.
  Need a calibration shot (known distance + a scale reference object in frame).

## Calibration attempt 2 (2026-09-10) — on-course clips, KEY FINDINGS

13 clips with stated carries (`videos/long*_57*.mov`, 5727–5736; wedge 83 m,
rest 6–7 irons 150–175 m). White + yellow balls, off grass.

**Blockers found — the setup, not the code:**
1. **Camera NOT square to the target line.** The ball *shrinks* as it flies
   (74→30 px in 8 frames on the wedge clip) — impossible if truly face-on.
   Effect: ball speed reads **~1.5–1.6× too low**, launch angle **too high**.
   The camera is angled partly down-the-line. → Must be exactly 90° to the
   target line. Test: ball size constant across the frame.
2. **Ball-size detection unreliable** — motion blur makes the measured radius
   swing (same ball read as 50–72 px across clips) → scale swings 40% → speed
   estimates inconsistent (67/85/107 mph for 175/153/151 m carries). Need a
   **physical scale reference in frame** (ruler / two markers 50 cm apart).
3. **White ball on grass** = defeated by grass highlights + divot spray
   (spray flies ~10–15 m/s and dominates every detector). Yellow only.
4. Fast balls (6-iron+, 55–60 m/s) still give only 4–12 frames at ~1.3 m.
5. Divot spray on grass — hit off a **mat**.

**What worked:** wedge clip 5734 (yellow, ~35 m/s) → 9 clean tracked points.
Method is sound for slow-enough yellow balls; everything else compounds error.

**Re-shoot spec for a usable calibration set:** yellow ball · off a mat ·
camera EXACTLY 90° to target line (alignment stick) · ~2 m back · PW/9i/8i only ·
a 50 cm scale marker in frame · known carry each · 5–6 clips.

## Speed from known carry, not ball size (2026-09-11) — the recommended method

Real-world test: calibration factor needed **0.72 (wedge), 0.92 (7-iron),
1.02 (another 7-iron)** — no consistent value. That's not a camera-angle
constant, it's measurement noise (manual tap precision on a ~50px ball,
iOS frame-snap timing) dominating over any single geometric correction.
Chasing a per-clip fudge factor was overfitting noise.

**Key insight:** `launchAngleDeg = atan2(vy_px, vx_px)` is a ratio — any
ball-size/scale error multiplies both terms identically and cancels out.
The angle from `fitLaunchFromMarks`/`computeStreak` (and the new
`angleOnlyFromMarks`, which skips the diameter requirement entirely) has
**never** been affected by the calibration-factor mess; only speed was.

So: measure the trustworthy thing (angle) and combine it with the other
trustworthy thing (the carry distance the user already knows) via physics
inversion, instead of trusting pixel-scale speed.
- `solveSpeedForCarry()` in `ballflight.ts` — bisection search over ball speed
  (carry is monotonic in speed for fixed angle/spin) to match a target carry.
- New card "3 · A partir del carry conocido (recomendado)" in Calibrate:
  shows the measured (scale-free) angle, takes a known carry in metres, solves
  for speed. The old pixel-scale method demoted to a secondary "menos fiable"
  button.
- Validated against real numbers: wedge (34°, 83m) → 78 mph (physically
  correct range, ±stable across ±6° angle error); 7-iron (17°, 170m) → 125 mph
  (sane PGA-Tour-level number). Both far more stable than the pixel method's
  67/85/107 mph spread on similar shots.

## Manual calibration tool (2026-09-11)

`app/shotvision/calibrate.tsx` — works today in **Expo Go**, no dev build, so
it's usable live at the range on a laptop + phone hotspot:
- Imports a picked video (`expo-image-picker`) and steps through it via
  `expo-video-thumbnails` stills (±1/±10 "frames" at 240 or 120 fps step size —
  iOS thumbnail seeking isn't guaranteed frame-exact, so this is a framing/sanity
  check + rough measurement, not the final pipeline)
- User taps the ball's diameter (2 taps, self-calibrates scale) on a resting
  frame, then taps the ball's centre on 4–8 frames after impact
- `src/shotvision/calibration.ts` (`fitLaunchFromMarks`) does the same
  least-squares fit as the automatic kinematics, reusing `linFit` (now exported
  from `kinematics.ts`)
- Shows the configured corner guide overlaid on the frame, so framing can be
  checked by eye before ever tapping anything
- Feeds the result through the normal `ballflight.ts` + `ShotResult`, using a
  club-selected spin preset (spin isn't measured manually)
- **Assumes face-on capture** — if filmed down-the-line, only useful for
  checking the ball stays in frame, not for speed/launch numbers
- Entry point: "Calibrar con un vídeo importado" row on the ShotVision
  dashboard. New deps: `expo-image-picker`, `expo-video-thumbnails` (photo
  library permission added to `app.json`).
- **Streak mode (2B)**: tap the two ends of a single blurred frame instead of
  tapping across many frames — `computeStreak()` in `calibration.ts`, with an
  adjustable duty-cycle (exposure ÷ frame interval, default 0.90, found by
  comparing a single streak to a trusted multi-frame track on the wedge clip).
  Multiple streak samples show a live mean/std so agreement is visible before
  trusting the number. `compute()` prefers streak samples over multi-frame
  marks when both exist.
- **Magnifying loupe + tap-and-zoom**: tap-to-mark became press-and-drag
  (`PanResponder`), with a 3.2× loupe that follows the finger and confirms on
  release. Layered under that: a button-driven zoom/pan (`expo-image-manipulator`
  crop) so the target is bigger on screen before the loupe even kicks in —
  `zoomRect` in native pixel coords, regenerated via `manipulateAsync` crop+resize,
  with a `toDisp()`/`dispRect` helper so every overlay (marks, streak lines, the
  corner guide) maps correctly whether zoomed or not.
- **Background-subtraction fix (2026-09-11)**: first auto-detect version used
  "contrast vs this frame's own dominant colour," which kept latching onto a
  static scene feature (mat seam / shadow / tripod) at a FIXED position —
  reported as "always the same place." Reproduced with a synthetic test
  (static dark band + moving ball): old approach detected the band at a fixed
  x regardless of where the ball was; confirmed against standard OpenCV
  ball-tracking references (background subtraction vs a reference frame is
  the standard approach, not same-frame contrast). Fixed by adding a
  **reference background frame** (`bgTimeMs`/`bgFrameUri`, defaults to t=0,
  overridable via "Fijar fondo aquí") — `findBlob()` now diffs the current
  crop against the SAME crop region from that background frame; a static
  feature cancels out, only what moved survives. Re-tested synthetically:
  correctly ignores the distractor and finds the true target.
- **Calibration factor** (2026-09-11 finding): user found that shrinking the
  tapped ball-diameter (67px measured → ~48px) made speed/carry match reality.
  This is the same camera-not-square error as before, showing up as a scale
  error (ratio ~1.4×, consistent with the earlier ~1.6× speed gap). Rather than
  faking the diameter tap, added an explicit **`calFactor`** multiplier (default
  1.0, stepper ±0.02) applied as `effectiveDiameterPx = ballDiameterPx * calFactor`
  before it reaches either math path. Tap stays honest; the fudge is visible,
  labeled as session-specific (not a ball property), and resets to 1.0 per new
  video. Should trend toward 1.0 as camera-squaring improves — if it doesn't,
  something else is wrong.

- **Motion-gated auto-detect (2026-09-11)**: the "confuses body/club with the
  ball" issue (parked above) was actually fixable without native code —
  `findBlob()` only scored blobs by shape + closeness to the crop's *centre*,
  so a bigger/rounder distractor near the middle of the zoomed crop always
  won. Added an optional `expected` point: once 2+ points are tracked (marks
  or streak far-ends), `calibrate.tsx` linearly extrapolates where the ball
  should be next and `findBlob` heavily favours whatever blob is closest to
  that, replacing the centrality term. Deliberately requires 2+ points first —
  right after impact there's no velocity yet to trust, so that first jump
  still falls back to shape/centrality (the hard case stays hard; it just
  doesn't get worse). Also surfaces a warning if the winning blob still ends
  up far from the prediction, so a bad pick is visible instead of silent.
  Validated synthetically (`tsx` one-off script, not checked in): a big
  centred distractor blob (24×24, mimicking a body/club silhouette) vs a
  small ball blob at the predicted position — old scoring picked the
  distractor, new scoring correctly followed the ball.

### Next
- Camera tilt-up; darker backdrop behind the flight zone for thin shots.
- Sub-pixel / streak-aware centroid (motion blur = 3–6 ball-diameters/frame).
- A premium-ball clip or two to separate ball-flight-model error from range-ball
  behaviour.
- Then port `track_ball.py` logic to TS behind the native frame extractor.
- User has 5 outstanding items from the review of 5722–5724 to send over.

## EAS dev build (started 2026-09-11)

Decision: the manual Calibrate tool (Expo Go) hit a structural ceiling —
`expo-video-thumbnails` frame seeking isn't frame-exact, and there's no way to
get real automatic ball detection without native camera/frame access. User
chose to commit to the EAS dev build now rather than keep tuning the
Expo-Go-only workflow.

Groundwork done (by Claude, in-repo):
- `eas-cli` (devDependency) + `expo-dev-client` (`~57.0.19`) installed.
- User already had an EAS/Expo account (`mqmf`, jecb18r@yahoo.com) — no login
  step needed.
- `react-native-vision-camera@4.7.3` installed — **v4, not v5**: v5 requires
  the brand-new "Nitro Modules" stack (`react-native-nitro-modules`,
  `react-native-nitro-image`), too new/unproven for a project that's already
  hit several fragile-dependency issues. v4's `react-native-reanimated` /
  `@shopify/react-native-skia` / `react-native-worklets-core` peers are all
  **optional** (confirmed via `npm view ... peerDependenciesMeta`) — only
  needed for real-time worklet frame processors with overlay drawing. Since
  the plan is record-then-analyze (not live detection), none of those are
  installed; core `Camera` + video recording works without them.
- `npx expo install` auto-added the vision-camera config plugin to `app.json`;
  added `cameraPermissionText` config (`enableMicrophonePermission: false`,
  no audio needed for ball tracking). `expo prebuild` normalized this into
  `NSCameraUsageDescription` (iOS) and `RECORD_AUDIO`/`CAMERA` (Android,
  the plugin adds `RECORD_AUDIO` regardless — harmless, unused).
- `eas.json` created: `development` profile (`developmentClient: true`,
  `distribution: "internal"`), plus `preview`/`production` stubs.
- `npx eas init --force` linked the project: `@mqmf/golf-tracker`,
  `extra.eas.projectId` set in `app.json`
  (https://expo.dev/accounts/mqmf/projects/golf-tracker).
- `npx tsc --noEmit` — no new errors from any of the above (pre-existing
  unrelated errors in `stats.tsx`/`ShotMapModal.tsx` only).

**What's left — needs the user directly (Apple ID/2FA, can't be done for
them):**
1. Decide free vs paid ($99/yr) Apple Developer account. Free = 7-day
   provisioning-profile expiry (rebuild weekly); paid = 1-year certs, no
   nagging. Not yet decided.
2. Run `eas build --platform ios --profile development` from a terminal —
   this prompts for Apple ID login (2FA) and creates/selects the
   provisioning profile + device registration interactively.
3. Install the resulting `.ipa` on the iPhone (EAS gives a QR/link for
   internal distribution) and open it — replaces Expo Go from here on for
   ShotVision work (`npx expo start --dev-client`).

**Still to do in code, once the dev client is running:**
- Wire a `Camera` screen (`useCameraDevice`, pick the 240fps slow-mo format)
  into the practice capture flow, replacing the demo-data placeholder.
- Native Swift frame extractor (local Expo module,
  `modules/shotvision-frames/` per the Phase 2 plan above) to pull exact
  frames from the recorded file for analysis — vision-camera itself only
  records; it doesn't do after-the-fact frame-exact seeking into a saved file.
- Port the validated `pixelblob.ts` / `track_ball.py` detection logic to run
  against real extracted frames once that pipeline exists.

## Weather / air density (done 2026-09-09)

`src/services/weather.ts` extended: `fetchConditions()` now pulls temperature,
surface pressure and humidity from Open-Meteo alongside wind, and computes
humid-air density (`airDensityHumid`, Tetens). `windToShotFrame()` resolves the
met. wind into head/cross components for a given target bearing.

ShotVision screen fetches conditions on focus (only if location permission is
already granted — never prompts) and feeds `airDensity` into `simulateFlight`.
Wind stays **off** by default: indoor/net has none, and outdoors we'd need the
target bearing. Toggle in the "Condiciones" card switches between real air
density and ICAO standard (1.225).

## Reference: open-source camera launch monitors

- **PiTrac** (github.com/PiTracLM/PiTrac, **GPL v2**, C++/Python + OpenCV).
  Method is *different* from ours — IR strobe + global-shutter camera, one long
  exposure with 2–3 strobe flashes, not high-fps video. Two cameras for 3D.
  Ball detection: `cv2.HoughCircles` for the teed ball, strobed flight images,
  and spin-analysis ball selection. **Spin**: detect dimples (bright/shadow
  filters sized to the ball), match dimple pairs between the two strobe images
  with a coarse+fine rotational search → spin rate + 3-axis axis.
  - GPL v2 is copyleft — we can **study the technique, not copy the code** into
    a closed app. The transferable ideas: Hough-circle ball refinement, and
    "match a surface feature (our alignment line, not dimples) between two
    frames → rotation → spin".
- **ronheywood/opencv** (github) — Python/OpenCV, SkyTrak-style, camera-only;
  lighter-weight reference for the video approach.

## Putt mode (2026-09-24) — first REAL camera pipeline, no demo data

A third ShotVision mode, alongside Practicar/Simulador: face-on capture,
0.5–1.2 m from the ball, ~30 cm high (locked with the user, same geometry
as the full-swing setup but closer). Unlike Practicar ahora, this is wired
to an actual camera from day one — no `demo.ts` placeholder — because
putting speeds (~1–4 m/s) are slow enough that periodic still-photo
capture + the existing pure-JS blob detector can track it, no native
frame processor or 240fps needed. Uses **`expo-camera`**, not
`react-native-vision-camera` — vision-camera needs the EAS dev build this
project hasn't finished (see below); `expo-camera` works today in Expo Go
and even partially on web.

**Files**: `src/shotvision/putting.ts` (types + self-calibrated speed fit,
reusing `linFit`/`BALL_RADIUS_M` from kinematics.ts + types.ts + rolling-
friction distance model), `src/shotvision/puttStore.ts` (AsyncStorage CRUD,
mirrors store.ts), `app/shotvision/putt/{setup,[id],summary/[id]}.tsx`.
Settings extended with `puttCameraDistanceM` / `puttDecelMs2` /
`puttTargetDistanceM` (new "Putt" section in `app/shotvision/settings.tsx`).

**"Automatic distance detection" = the same trick as everywhere else in
ShotVision**: a golf ball has a fixed, known diameter (42.67 mm), so its
apparent pixel size in one photo gives real-world scale directly — no
LiDAR, no manual "stand at exactly Xm" step. `[id].tsx`'s `calibrate()`
snaps one still of the ball at rest, runs `findBlob('round')`
(pixelblob.ts, already proven in calibrate.tsx), and derives
`ballDiameterPx = 2·√(pixelCount/π)` — area-based, not the PCA `length`
field (that one's documented in pixelblob.ts as tuned for motion-blur
streaks, not resting round blobs). That frame doubles as the background-
subtraction reference for `armLoop()`, which polls for the ball moving off
its rest position (putt struck) → `trackLoop()` bursts frames with the
same "extrapolate + favour the blob nearest the predicted position" trick
`calibrate.tsx`'s manual auto-detect already uses, so a static distractor
doesn't hijack tracking.

**What's deliberately NOT measured**: push/pull (`startLineDeg` stays
`null`, same shape as `LaunchMeasurement.launchDirectionDeg`). A single
face-on camera can't reliably separate "rolled dead straight" from
"drifted slightly toward/away from the lens" — chasing that via apparent-
radius change reproduces the exact scale-noise problem documented above
under "Calibration attempt 2." Speed is measured (self-calibrated, same
math family as the validated full-swing pipeline); total distance is
*extrapolated* via a simple constant-deceleration roll model
(`predictPuttRoll`, `v²/(2a)`) — `a` is a "green speed" knob
(`solveDecelForDistance` lets a session self-calibrate it from one putt of
known result), not a measured physical quantity.

**Verified this session** (no physical device available): `predictPuttRoll`
math sanity-checked against believable real-world numbers (scratch script,
not checked in) and `measurePuttFromDetections` round-trips a synthetic
track's known speed exactly. Every screen live-verified via Playwright on
the web build — dashboard card, setup wizard, the graceful "no camera
access" fallback (expected in headless Chromium), and the summary/
aggregate screen (fed via injected fixture data, since headless Chromium
has no camera to actually produce a real track) — zero console errors.
**Not verified**: real ball detection/tracking against actual footage,
capture-loop timing on a real phone (`ARM_POLL_MS`/`TRACK_POLL_MS`/
`MOTION_THRESHOLD_RATIO` in `[id].tsx` are starting points), or whether
`expo-camera`'s JS-loop still-capture rate is actually fast enough to
catch a firm putt in 0.5–1.2 m of frame. Same "needs real footage to tune"
status as every other milestone in this doc.

**Metro fix needed**: `expo-camera`'s web build does a dynamic
`import('barcode-detector')` inside its (unused here) barcode-scanner path;
that package's `exports` map doesn't resolve under this project's Metro
(same class of issue as expo-file-system's SDK 57 export map, noted in
pixelblob.ts) — and Metro resolves every `import()` statically, so an
unresolvable target crashed the *entire* web bundle, not just barcode
scanning. Fixed the same way as the `react-native-maps` web problem:
`metro.config.js` aliases `barcode-detector` to a tiny stub
(`src/web-stubs/barcode-detector.ts`) on web only; native builds are
untouched.

## Sample footage (needed for Phase 2)

Drop 240 fps Slo-Mo clips of real shots into a `videos/` folder (many angles,
clubs, repeats). Face-on, the setup above. The more the better — the CV pipeline
is tuned against these.
