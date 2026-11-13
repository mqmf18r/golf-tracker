// Pure-JS on-device blob detection — no OpenCV / native module, so it runs in
// Expo Go. Standard practice for isolating a moving ball is background
// subtraction against a reference frame (not colour-contrast within a single
// frame) — confirmed against OpenCV ball-tracking references, and matches
// what actually worked in this project's own Python prototyping earlier.
// A single-frame "contrast vs this frame's own dominant colour" fallback
// remains for when no background is available, but it's the weaker path —
// it kept latching onto whatever static feature (shadow, mat seam, texture)
// was most different from the frame's average colour, regardless of the
// ball's real position. Background subtraction fixes that: a static feature
// looks identical in both frames and cancels out, leaving only what moved.

// jpeg-js's package root is `module.exports = { encode, decode }` (a plain
// object, not the function itself) — go through `require` and pull `.decode`
// out explicitly, sidestepping ESM-interop ambiguity entirely.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jpegjsMod = require('jpeg-js');
const jpegDecode: (data: Uint8Array, opts?: Record<string, unknown>) =>
  { width: number; height: number; data: Uint8Array } =
  jpegjsMod.decode ?? jpegjsMod.default?.decode ?? jpegjsMod;

export interface DecodedImage { width: number; height: number; data: Uint8Array; }

// React Native's built-in fetch reads local file:// URIs directly, so this
// needs no filesystem package at all (expo-file-system's SDK 57 export map
// doesn't resolve cleanly under Metro in this project — avoided entirely).
export async function decodeJpegFile(uri: string): Promise<DecodedImage> {
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  const raw = jpegDecode(new Uint8Array(buf), { useTArray: true, formatAsRGBA: true });
  return { width: raw.width, height: raw.height, data: raw.data as Uint8Array };
}

export interface BlobResult {
  cx: number; cy: number;         // centroid, in this image's own pixel space
  length: number; width: number;  // PCA-based major/minor extents (rough)
  angleRad: number;               // major-axis orientation
  pixelCount: number;
}

function buildMaskFromBackground(cur: DecodedImage, bg: DecodedImage): Uint8Array {
  const { width: W, height: H, data } = cur;
  const bd = bg.data;
  const n = W * H;
  const STEP = 3;
  let sd = 0, sdSq = 0, sampleN = 0;
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const i = (y * W + x) * 4;
      const dr = data[i] - bd[i], dg = data[i + 1] - bd[i + 1], db = data[i + 2] - bd[i + 2];
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      sd += d; sdSq += d * d; sampleN++;
    }
  }
  const meanD = sd / sampleN;
  const varD = Math.max(0, sdSq / sampleN - meanD * meanD);
  // background diff is normally near-zero (same scene, minor compression/
  // lighting noise), so this floor comfortably clears that noise floor while
  // still catching a real moving object.
  const threshold = meanD + 2.2 * Math.sqrt(varD) + 14;

  const mask = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dr = data[i] - bd[i], dg = data[i + 1] - bd[i + 1], db = data[i + 2] - bd[i + 2];
      mask[y * W + x] = Math.sqrt(dr * dr + dg * dg + db * db) > threshold ? 1 : 0;
    }
  }
  return mask;
}

function buildMaskFromOwnColour(img: DecodedImage): Uint8Array {
  const { width: W, height: H, data } = img;
  const n = W * H;
  const STEP = 3;
  let sr = 0, sg = 0, sb = 0, sampleN = 0;
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const i = (y * W + x) * 4;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
      sampleN++;
    }
  }
  const mr = sr / sampleN, mg = sg / sampleN, mb = sb / sampleN;

  let sd = 0, sdSq = 0;
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const i = (y * W + x) * 4;
      const dr = data[i] - mr, dg = data[i + 1] - mg, db = data[i + 2] - mb;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      sd += d; sdSq += d * d;
    }
  }
  const meanD = sd / sampleN;
  const varD = Math.max(0, sdSq / sampleN - meanD * meanD);
  const threshold = meanD + 1.6 * Math.sqrt(varD) + 8;

  const mask = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dr = data[i] - mr, dg = data[i + 1] - mg, db = data[i + 2] - mb;
      mask[y * W + x] = Math.sqrt(dr * dr + dg * dg + db * db) > threshold ? 1 : 0;
    }
  }
  return mask;
}

// 2026-09-26: buildMaskFromOwnColour compares each pixel to the WHOLE
// frame's average colour — which fails exactly when a large region (a
// bright wall, a window) differs from that average even MORE than the ball
// does, and wins on sheer size (confirmed against two real photos from a
// Logitech webcam plugged into the dev machine specifically to get real
// data: a wall and, separately, a foot in frame both beat the actual ball).
// Researched "white top-hat" (local-neighbourhood contrast instead of
// whole-frame) as used by production golf-ball trackers (GolfTrace), and
// prototyped it — but real-photo testing found the actual fix lay
// elsewhere: blobFromMask's size filter was being applied AFTER picking the
// single best-scoring blob, which can only turn "wrong" into "not found",
// not recover the smaller real ball. Passing `maxAreaFrac` into the search
// itself (see blobFromMask below) fixed both real test photos at every
// resolution using the existing colour/whole-frame-contrast detectors —
// the local-contrast detector added no further benefit once that was fixed,
// so it isn't part of this file; the technique is documented here in case a
// future real-photo failure needs it after all.

/**
 * `mode: 'round'` favours a compact, ball-shaped blob (address/rest frame).
 * `mode: 'elongated'` favours a streaky, motion-blurred blob.
 * `bg`, when given (same pixel dimensions as `img`, cropped from a frame
 * where the ball was elsewhere/at rest), switches to background subtraction —
 * the reliable path. Without it, falls back to same-frame colour contrast.
 * `expected`, when given (same pixel space as this crop — caller extrapolates
 * from the last couple of tracked points), heavily favours whatever blob is
 * closest to it instead of just "biggest/roundest near the crop centre" —
 * this is what tells a moving ball apart from the body/club also entering
 * frame, which background subtraction alone can't distinguish.
 */
export function findBlob(
  img: DecodedImage,
  mode: 'round' | 'elongated',
  bg?: DecodedImage,
  expected?: { x: number; y: number },
  maxAreaFrac?: number,
): BlobResult | null {
  const useBg = !!bg && bg.width === img.width && bg.height === img.height;
  const mask = useBg ? buildMaskFromBackground(img, bg!) : buildMaskFromOwnColour(img);
  return blobFromMask(mask, img.width, img.height, mode, expected, maxAreaFrac);
}

// Same idea, transplanted from a companion OpenCV/Python golf-ball tracker
// prototype (HSV colour thresholding + contour/minEnclosingCircle) into this
// project's pure-JS pipeline: a golf ball's colour (white, or optic yellow
// for range balls) is a much stronger, lighting-independent signal than
// "whatever differs from a reference frame" — doesn't need a clean
// background frame at all, so it works even on the very first photo (no
// prior "the ball wasn't here yet" reference required) and isn't confused by
// a shifting background subject the way diffing can be. Used as the primary
// ball-at-rest / motion detector for Putt mode; background subtraction
// remains available as a fallback for anything colour thresholding misses.
export type BallColor = 'white' | 'yellow';

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/** Loose, real-world-lighting-tolerant HSV bands for a golf ball's surface —
 *  not the ball's paint colour in isolation (bright highlights and dim
 *  shadow both throw the naive reading off), so `s`/`v` bounds are generous
 *  rather than tight. Starting point, expected to need tuning against real
 *  footage (same as every other threshold in this file). */
function matchesBallColor(h: number, s: number, v: number, color: BallColor): boolean {
  // Widened 2026-09-26: the original bounds were tuned against a clean
  // synthetic render (crisp, evenly-lit RGB) — real camera auto-exposure
  // can plausibly read a real white ball dimmer/less saturated than that,
  // and a threshold that's too tight just finds nothing on real footage.
  // Starting point, still expected to need tuning against real footage.
  if (color === 'white') return s < 0.45 && v > 0.35;
  return h >= 35 && h <= 70 && s > 0.2 && v > 0.25;   // optic/practice-ball yellow
}

function buildMaskFromColor(img: DecodedImage, color: BallColor): Uint8Array {
  const { width: W, height: H, data } = img;
  const n = W * H;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const { h, s, v } = rgbToHsv(data[o], data[o + 1], data[o + 2]);
    mask[i] = matchesBallColor(h, s, v, color) ? 1 : 0;
  }
  return mask;
}

/** Colour-thresholding sibling of `findBlob` — see `buildMaskFromColor`.
 *  Tries `colors` in order and returns the first frame that yields a
 *  plausible blob (round mode's scoring, `expected` bias if given). */
export function findBlobByColor(
  img: DecodedImage,
  colors: BallColor[],
  expected?: { x: number; y: number },
  maxAreaFrac?: number,
): BlobResult | null {
  for (const color of colors) {
    const mask = buildMaskFromColor(img, color);
    const found = blobFromMask(mask, img.width, img.height, 'round', expected, maxAreaFrac);
    if (found) return found;
  }
  return null;
}

// 2026-09-26: a size cap applied AFTER picking the single best-scoring blob
// (the old `withinPlausibleSize` wrapper in the putt screen) can only turn a
// wrong answer into "not found" — it can't recover a smaller, correct blob
// that scored slightly lower than an oversized false positive, because by
// the time it runs, every other candidate has already been discarded. The
// fix is to exclude oversized components from the search itself, so a
// plausibly-sized real ball can still win. `maxAreaFrac` defaults to the
// old generous 0.55 (fraction of frame area) for callers (calibrate.tsx's
// full-swing tracking) that rely on that headroom; the putt screen passes
// its own tight ball-sized cap instead.
function blobFromMask(
  mask: Uint8Array, W: number, H: number,
  mode: 'round' | 'elongated',
  expected?: { x: number; y: number },
  maxAreaFrac: number = 0.55,
): BlobResult | null {
  const n = W * H;
  if (n < 100) return null;

  // connected components — iterative 4-connected flood fill
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const minArea = Math.max(15, Math.round(n * 0.0015));
  const maxArea = Math.round(n * maxAreaFrac);
  const cx0 = W / 2, cy0 = H / 2;
  const diag = Math.hypot(cx0, cy0) || 1;

  let best: BlobResult | null = null;
  let bestScore = -Infinity;

  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || labels[start] !== -1) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = start;
    let count = 0;
    let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;

    while (sp > 0) {
      const p = stack[--sp];
      const px = p % W, py = (p - px) / W;
      count++;
      sumX += px; sumY += py; sumXX += px * px; sumYY += py * py; sumXY += px * py;

      if (px > 0) { const q = p - 1; if (mask[q] === 1 && labels[q] === -1) { labels[q] = start; stack[sp++] = q; } }
      if (px < W - 1) { const q = p + 1; if (mask[q] === 1 && labels[q] === -1) { labels[q] = start; stack[sp++] = q; } }
      if (py > 0) { const q = p - W; if (mask[q] === 1 && labels[q] === -1) { labels[q] = start; stack[sp++] = q; } }
      if (py < H - 1) { const q = p + W; if (mask[q] === 1 && labels[q] === -1) { labels[q] = start; stack[sp++] = q; } }
    }

    if (count < minArea || count > maxArea) continue;

    const meanX = sumX / count, meanY = sumY / count;
    const cxx = sumXX / count - meanX * meanX;
    const cyy = sumYY / count - meanY * meanY;
    const cxy = sumXY / count - meanX * meanY;
    const common = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
    const lambda1 = (cxx + cyy + common) / 2;
    const lambda2 = Math.max(0, (cxx + cyy - common) / 2);
    const angleRad = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    // sqrt(12) matches a uniform/rectangular extent (a motion-blur streak's
    // shape) — the case that actually feeds the speed maths in 'elongated'
    // mode. It underestimates a round ball's diameter by ~13% (should be 4x),
    // but 'round' mode only uses the centroid (exact in testing), not the size.
    const length = Math.sqrt(12) * Math.sqrt(Math.max(lambda1, 0.01));
    const widthPx = Math.sqrt(12) * Math.sqrt(Math.max(lambda2, 0.01));
    const aspect = length / Math.max(widthPx, 1);

    // once we trust where the ball should be, that beats "biggest/roundest
    // near the crop centre" — a distractor (club, body) can easily win on
    // shape/size/centrality alone, but it won't be where the ball was headed.
    const EXPECT_WEIGHT = 6;
    const locality = expected
      ? EXPECT_WEIGHT * (1 - Math.min(1, Math.hypot(meanX - expected.x, meanY - expected.y) / diag))
      : (1 - Math.hypot(meanX - cx0, meanY - cy0) / diag) * 2;

    const score = mode === 'elongated'
      ? aspect * 3 + locality + Math.log(count)
      : (1 / Math.max(aspect, 1)) * 3 + locality + Math.log(count);

    if (score > bestScore) {
      bestScore = score;
      best = { cx: meanX, cy: meanY, length, width: widthPx, angleRad, pixelCount: count };
    }
  }

  return best;
}
