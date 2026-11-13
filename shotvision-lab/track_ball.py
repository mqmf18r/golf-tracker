import cv2, numpy as np, os, sys, glob

VID = r"C:\Users\34656\Desktop\Mis cosas\GolfTracker\videos"
OUT = r"C:\Users\34656\AppData\Local\Temp\claude\C--Users-34656\351f36bf-1d10-4fed-b03d-d3360f3eac64\scratchpad\wt"
os.makedirs(OUT, exist_ok=True)
BALL_MM = 42.67

def load(p):
    c = cv2.VideoCapture(p)
    # cv2 reports a bogus container rate (206-228) for iPhone slo-mo;
    # true per-frame dt is 4.167 ms = 240 fps exactly (verified via POS_MSEC).
    fps = 240.0
    F = []
    while True:
        ok, fr = c.read()
        if not ok: break
        F.append(fr)
    c.release()
    return F, fps

def yellow_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # yellow ball: H ~20-35, high S, high V
    return cv2.inRange(hsv, (18, 90, 120), (40, 255, 255))

def yellow_blobs(bgr, rmin=6, rmax=70):
    m = yellow_mask(bgr)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        (x, y), r = cv2.minEnclosingCircle(c)
        if r < rmin or r > rmax: continue
        out.append((x, y, r, a / (np.pi * r * r + 1e-6), a))
    return out

def analyse(path):
    F, fps = load(path)
    N = len(F); H, W = F[0].shape[:2]
    name = os.path.basename(path)

    # address ball = densest cluster of ball-sized yellow blobs, lower half.
    # (a persistent orange-tee blob also passes the colour filter — exclude by
    #  size preference + spatial clustering.)
    acc = []
    for i in range(0, int(N * 0.75)):
        for (x, y, r, fill, a) in yellow_blobs(F[i], rmin=18, rmax=46):
            if fill > 0.55 and y > 0.5 * H and 0.15 * W < x < 0.9 * W:
                acc.append((x, y, r, i))
    if len(acc) < 10:
        print(f"{name}: address ball not found ({len(acc)})"); return
    acc = np.array(acc, float)
    from collections import Counter
    vote = Counter((int(x // 20), int(y // 20)) for x, y, r, i in acc)
    (gx, gy), _ = vote.most_common(1)[0]
    cx0, cy0 = gx * 20 + 10, gy * 20 + 10
    d = np.hypot(acc[:, 0] - cx0, acc[:, 1] - cy0)
    k = acc[d < 30]
    ax, ay, ar = k[:, 0].mean(), k[:, 1].mean(), np.median(k[:, 2])
    last_addr = int(k[:, 3].max())

    # frame-diff: yellow pixels that appeared (ball moving through new location)
    pts = []
    px, py = ax, ay
    prev_away = 0.0
    for i in range(last_addr + 1, min(N, last_addr + 45)):
        my = yellow_mask(F[i]).astype(np.int16)
        mp = yellow_mask(F[i - 1]).astype(np.int16)
        appeared = ((my - mp) > 0).astype(np.uint8) * 255
        appeared = cv2.morphologyEx(appeared, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        cnts, _ = cv2.findContours(appeared, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best, bs = None, -1e9
        for c in cnts:
            a = cv2.contourArea(c)
            if a < ar * ar * 0.3: continue
            (ex, ey), r = cv2.minEnclosingCircle(c)
            if r < ar * 0.4 or r > ar * 4.5: continue
            mm = cv2.moments(c)
            x = mm["m10"] / mm["m00"] if mm["m00"] else ex   # streak centroid — stabler
            y = mm["m01"] / mm["m00"] if mm["m00"] else ey
            away = np.hypot(x - ax, y - ay)
            if away < prev_away - ar: continue
            if y > ay + ar * 4: continue
            step = np.hypot(x - px, y - py)
            if step > W * 0.4: continue
            score = a - 2 * step
            if score > bs: bs, best = score, (i, x, y, r, away)
        if best:
            pts.append(best[:4]); px, py = best[1], best[2]; prev_away = best[4]
            misses = 0
        else:
            misses = misses + 1 if "misses" in dir() else 1
            if len(pts) >= 4 and misses >= 2:
                break

    if len(pts) < 3:
        print(f"{name}: only {len(pts)} flight pts"); return
    P = np.array(pts, float)

    # --- reject outliers: keep the longest run of points with a consistent
    #     per-frame x-step (ball speed is ~constant over these few ms) ---
    def dedupe(P):
        steps = []
        for j in range(1, len(P)):
            df = P[j, 0] - P[j - 1, 0]
            steps.append((P[j, 1] - P[j - 1, 1]) / df if df else 1e9)
        med = np.median([s for s in steps if abs(s) < 1e8]) or 1
        keep = [0]
        for j, s in enumerate(steps, start=1):
            if abs(s - med) < 0.5 * abs(med) + 25 and P[j, 1] > P[keep[-1], 1]:
                keep.append(j)
        return P[keep]
    P = dedupe(P)
    if len(P) < 3:
        print(f"{name}: <3 consistent flight pts"); return

    fit_n = min(7, len(P))
    t = (P[:fit_n, 0] - P[0, 0]) / fps
    vx = np.polyfit(t, P[:fit_n, 1], 1)[0]
    vy = np.polyfit(t, P[:fit_n, 2], 1)[0]
    mmpp = BALL_MM / (2 * ar)
    speed = np.hypot(vx, vy) * mmpp / 1000.0
    launch = np.degrees(np.arctan2(-vy, abs(vx)))

    print(f"{name}")
    print(f"  {W}x{H}  fps={fps:.1f}  N={N}  | address ({ax:.0f},{ay:.0f}) r={ar:.1f}px  impact~f{last_addr}")
    print(f"  flight pts: {len(pts)}  fit on {fit_n}   scale={mmpp:.3f} mm/px")
    print(f"  px/frame  dx={vx/fps:+.1f}  dy={vy/fps:+.1f}")
    print(f"  BALL SPEED {speed:.1f} m/s  ({speed*2.237:.0f} mph)     LAUNCH {launch:.1f} deg")
    print("  track: " + " ".join(f"f{int(p[0])}:({p[1]:.0f},{p[2]:.0f})r{p[3]:.0f}" for p in pts))
    # save annotated impact+flight frames
    tag = name.split("_")[-1].replace(".mov", "")
    for (fi, x, y, r) in [(last_addr, ax, ay, ar)] + [tuple(p) for p in pts]:
        fr = F[int(fi)].copy()
        cv2.circle(fr, (int(x), int(y)), int(max(r, 6)), (0, 0, 255), 2)
        cv2.imwrite(os.path.join(OUT, f"{tag}_f{int(fi):03d}.jpg"), fr, [cv2.IMWRITE_JPEG_QUALITY, 80])
    print()

for p in sorted(glob.glob(os.path.join(VID, "*.mov"))):
    try: analyse(p)
    except Exception as e:
        import traceback; print(os.path.basename(p), "ERR", e); traceback.print_exc()
