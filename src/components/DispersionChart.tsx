// TrackMan-style shot dispersion chart — carry distance vs. lateral
// deviation from the aim line, for one club's shot history. Shared between
// the Clubs tab (inline, per-card) and the Stats tab (full-width, in the
// club drill-down modal) so both show the same visual language instead of
// two different one-off dispersion widgets for the same underlying data.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Ellipse, Path, Text as SvgText } from 'react-native-svg';
import { ShotRecord } from '../lib/api';
import { COLORS, FONT } from '../theme';
import { lateralDeviationM as lateralM } from '../services/geo';

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function DispersionChart({ shots, width }: { shots: ShotRecord[]; width: number }) {
  if (shots.length === 0) return null;

  const CW = width;
  const CH = Math.round(CW * 0.52);

  const data = shots.map(s => {
    const hasAim    = s.aimLat !== 0 || s.aimLon !== 0;
    const hasOrigin = s.originLat !== 0 || s.originLon !== 0;
    const lateral   = hasAim && hasOrigin
      ? lateralM({ lat: s.originLat, lon: s.originLon }, { lat: s.aimLat, lon: s.aimLon }, { lat: s.lat, lon: s.lon })
      : 0;
    return { carry: s.dist, lateral, type: s.shotType };
  });

  const carries  = data.map(d => d.carry);
  const lats     = data.map(d => d.lateral);
  const avgCarry = avg(carries);
  const avgLat   = avg(lats);
  const sdCarry  = Math.sqrt(avg(carries.map(c => (c - avgCarry) ** 2)));
  const sdLat    = Math.sqrt(avg(lats.map(l => (l - avgLat) ** 2)));
  const hasAim   = lats.some(l => l !== 0);

  const maxC = Math.max(...carries), minC = Math.min(...carries);
  const carryPad = Math.max((maxC - minC) * 0.28, 8);
  const yMax     = maxC + carryPad;
  const yMin     = Math.max(0, minC - carryPad);
  const absLat   = Math.max(Math.max(...lats.map(Math.abs)) * 1.8, 12);

  // Scale: fit both axes into the chart, keep aspect ratio
  const scale = Math.min(CW / (2 * absLat), CH / (yMax - yMin));
  const usedW = 2 * absLat * scale;
  const usedH = (yMax - yMin) * scale;
  const offX  = (CW - usedW) / 2;
  const offY  = (CH - usedH) / 2;

  // SVG coordinate helpers
  const toSX = (l: number) => offX + (l + absLat) * scale;
  const toSY = (c: number) => offY + (yMax - c) * scale;

  // Golfer origin (below visible chart — gives gentle arc curvature)
  const cx = toSX(0);
  const oy = offY + yMax * scale; // = toSY(0), always below chart

  // Distance arc grid values
  const span    = yMax - yMin;
  const arcStep = span <= 20 ? 5 : span <= 50 ? 10 : span <= 120 ? 20 : 50;
  const arcVals: number[] = [];
  for (let v = Math.ceil(yMin / arcStep) * arcStep; v <= yMax; v += arcStep) arcVals.push(v);

  // Build SVG arc path for a carry-distance ring D
  function arcPath(D: number): string | null {
    const R   = D * scale;
    const xL  = offX, xR = offX + usedW;
    const dxL = xL - cx, dxR = xR - cx;
    const a1  = R * R - dxL * dxL, a2 = R * R - dxR * dxR;
    if (a1 < 0 || a2 < 0) return null;
    const yL = oy - Math.sqrt(a1), yR = oy - Math.sqrt(a2);
    if (yL > CH + 10 && yR > CH + 10) return null;
    return `M ${xL.toFixed(1)} ${yL.toFixed(1)} A ${R.toFixed(1)} ${R.toFixed(1)} 0 0 0 ${xR.toFixed(1)} ${yR.toFixed(1)}`;
  }

  const avgSX  = toSX(avgLat);
  const avgSY  = toSY(avgCarry);
  const ellRx  = Math.max((hasAim ? sdLat : 4) * scale * 2.2, 8);
  const ellRy  = Math.max(sdCarry * scale * 2.2, 8);

  return (
    <View style={styles.dispWrap}>
      <View style={{ borderRadius: 14, overflow: 'hidden' }}>
        <Svg width={CW} height={CH} style={{ backgroundColor: '#2d5016' }}>

          {/* Distance arcs + labels */}
          {arcVals.map(v => {
            const path  = arcPath(v);
            if (!path) return null;
            const labelY = Math.max(toSY(v) - 7, 14);
            return (
              <React.Fragment key={v}>
                <Path d={path} stroke="rgba(255,255,255,0.48)" strokeWidth={1.5} fill="none" />
                <SvgText x={cx} y={labelY} textAnchor="middle" fill="white" fontSize={13} fontWeight="bold">{v}</SvgText>
              </React.Fragment>
            );
          })}

          {/* Center / target line */}
          <Line x1={cx} y1={0} x2={cx} y2={CH} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />

          {/* Dispersion ellipse */}
          {data.length >= 3 && (
            <Ellipse
              cx={avgSX} cy={avgSY}
              rx={ellRx} ry={ellRy}
              stroke="#ffd700" strokeWidth={1.8}
              fill="rgba(255,215,0,0.07)"
            />
          )}

          {/* Shot dots — all yellow like TrackMan */}
          {data.map((d, i) => (
            <Circle key={i}
              cx={toSX(d.lateral)} cy={toSY(d.carry)}
              r={5.5} fill="#ffd700" opacity={0.88}
            />
          ))}

          {/* Average marker */}
          <SvgText x={avgSX} y={avgSY + 6} textAnchor="middle" fill="#ffd700" fontSize={16} fontWeight="bold">✕</SvgText>

          {/* L / D edge labels */}
          {hasAim && (
            <>
              <SvgText x={offX + 8}  y={CH - 8} fill="rgba(255,255,255,0.55)" fontSize={11} fontWeight="bold">Izq.</SvgText>
              <SvgText x={offX + usedW - 8} y={CH - 8} textAnchor="end" fill="rgba(255,255,255,0.55)" fontSize={11} fontWeight="bold">Der.</SvgText>
            </>
          )}
        </Svg>
      </View>

      {/* Stats row */}
      <View style={styles.dispStats}>
        <View style={styles.dispStat}>
          <Text style={styles.dispStatN}>{Math.round(avgCarry)}m</Text>
          <Text style={styles.dispStatL}>Media</Text>
        </View>
        <View style={[styles.dispStat, styles.dispStatBorder]}>
          <Text style={styles.dispStatN}>±{Math.round(sdCarry)}m</Text>
          <Text style={styles.dispStatL}>Dispersión</Text>
        </View>
        {hasAim ? (
          <View style={[styles.dispStat, styles.dispStatBorder]}>
            <Text style={[styles.dispStatN, {
              color: Math.abs(avgLat) < 2 ? COLORS.success : avgLat > 0 ? COLORS.danger : COLORS.warning,
            }]}>
              {Math.abs(Math.round(avgLat)) < 1
                ? 'Recto'
                : `${Math.abs(Math.round(avgLat))}m ${avgLat > 0 ? 'Der.' : 'Izq.'}`}
            </Text>
            <Text style={styles.dispStatL}>Tendencia</Text>
          </View>
        ) : (
          <View style={[styles.dispStat, styles.dispStatBorder]}>
            <Text style={styles.dispStatN}>{Math.round(maxC - minC)}m</Text>
            <Text style={styles.dispStatL}>Rango</Text>
          </View>
        )}
      </View>

      {!hasAim && (
        <Text style={styles.dispHint}>Marca la dirección de apunte al registrar golpes para ver desviación lateral</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dispWrap:       { marginBottom: 14, gap: 10 },
  dispStats:      { flexDirection: 'row', backgroundColor: COLORS.card, borderRadius: 12, overflow: 'hidden' },
  dispStat:       { flex: 1, alignItems: 'center', paddingVertical: 10 },
  dispStatBorder: { borderLeftWidth: 1, borderColor: '#e9ecef' },
  dispStatN:      { fontSize: 18, fontFamily: FONT.heading, color: COLORS.textPrimary },
  dispStatL:      { fontSize: 10, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 2 },
  dispHint:       { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, textAlign: 'center', fontStyle: 'italic' },
});
