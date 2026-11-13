# ShotVision lab

Offline CV prototyping for the ShotVision feature, tested against `../videos/`.
Not shipped in the app — this is where the detection/tracking algorithm is
developed before porting behind the native frame extractor (see SHOTVISION_PLAN.md).

## track_ball.py
Python + OpenCV. For each `.mov` in `../videos/`:
1. find the yellow ball at address (densest cluster of ball-sized yellow blobs)
2. detect impact (last frame the ball sits at the address spot)
3. track the ball through the first frames after launch via frame-differencing
   on the yellow channel ("newly appeared yellow" = ball's new position)
4. reject outlier points, least-squares fit → ball speed + launch angle
   (scale self-calibrated from the 42.67 mm ball; **fps forced to 240** — cv2
   misreports iPhone slo-mo container rate as 206–228)

Run: `python track_ball.py`

## Findings (2026-09-08, 4 SW range-ball clips)
- iPhone slo-mo `.mov` = 1920x1080 @ **true 240 fps** (verify via POS_MSEC, not CAP_PROP_FPS)
- Yellow ball on green mat tracks well; **ball exits top of frame in 5–7 frames**
  on steep wedge shots — tilt camera up ~10° for more points
- Clean shot (5708): 78 mph ball, 34° launch, 7 tracked points
- Two normal SW swings agreed within ~7% (73–78 mph, 33–34°)
- Bladed shot (5706): 68 mph, 13° — outlier rejection needed
- Thin shot into bright background (5707): ball lost — needs a darker backdrop
  or a better detector (Hough / learned)
- Carry validation still open: model predicts ~75–85 m, user reported ~62 m —
  range balls fly short + model tuned for premium balls. Need a calibration shot.
