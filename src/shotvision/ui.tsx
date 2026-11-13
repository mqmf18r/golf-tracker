import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Path as SvgPath, Line, Circle, Defs, LinearGradient, Stop, Rect, Text as SvgText, G,
} from 'react-native-svg';

import { FlightResult, LaunchMeasurement, M_TO_YARDS } from './types';
import { SVSettings, DEFAULT_SETTINGS, MetricKey, METRIC_LABELS, METRIC_PENDING } from './settings';
import { dist, distNum, distUnit, speedNum, speedUnit } from './format';
import { FONT } from '../theme';

// ── Dark "TrackMan" palette ────────────────────────────────────────────────
export const SV = {
  bg: '#0a1420',
  surface: '#12212f',
  surfaceAlt: '#1a2c3c',
  line: '#263a4c',
  ink: '#eef4f8',
  sub: '#8fa6b8',
  faint: '#5c7488',
  green: '#37d67a',      // flight arc / positive
  accent: '#ff8a3d',     // target line / markers
  danger: '#ff5d6c',
};

export const CLUB_NAMES: Record<string, string> = {
  D: 'Driver', '3M': 'Madera 3', '5M': 'Madera 5', Hib: 'Híbrido',
  '3i': 'Hierro 3', '4i': 'Hierro 4', '5i': 'Hierro 5', '6i': 'Hierro 6',
  '7i': 'Hierro 7', '8i': 'Hierro 8', '9i': 'Hierro 9',
  PW: 'Pitching W.', GW: 'Gap W.', SW: 'Sand W.', LW: 'Lob W.', P: 'Putter',
};
export const SV_CLUBS = ['D', '3M', '5M', 'Hib', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];

// ── Metric values for the numbers panel ────────────────────────────────────

export interface MetricCell { key: MetricKey; label: string; value: string; pending: boolean; }

export function metricCells(
  m: LaunchMeasurement, f: FlightResult, s: SVSettings,
): MetricCell[] {
  const mk = (key: MetricKey, value: string): MetricCell =>
    ({ key, label: METRIC_LABELS[key], value: METRIC_PENDING[key] ? '—' : value, pending: METRIC_PENDING[key] });

  const all: MetricCell[] = [
    mk('ballSpeed', `${speedNum(m.ballSpeedMs, s)}`),
    mk('clubSpeed', '—'),
    mk('smash', '—'),
    mk('launchAngle', `${m.launchAngleDeg.toFixed(1)}°`),
    mk('launchDirection', m.launchDirectionDeg == null ? '—' : `${m.launchDirectionDeg > 0 ? '+' : ''}${m.launchDirectionDeg.toFixed(1)}°`),
    mk('spinRate', m.backspinRpm == null ? '—' : `${Math.round(m.backspinRpm)}`),
    mk('spinAxis', m.sidespinRpm == null ? '—' : `${m.sidespinRpm > 0 ? '+' : ''}${Math.round(m.sidespinRpm)}`),
    mk('carry', `${distNum(f.carryMeters, s)}`),
    mk('total', `${distNum(f.totalMeters, s)}`),
    mk('apex', `${distNum(f.apexMeters, s)}`),
    mk('descentAngle', `${f.descentAngleDeg.toFixed(0)}°`),
    mk('hangTime', `${f.flightTimeSec.toFixed(1)} s`),
    mk('offline', `${f.sideMeters >= 0 ? 'D' : 'I'} ${distNum(Math.abs(f.sideMeters), s)}`),
  ];
  return all.filter(c => s.show[c.key]);
}

export function NumbersPanel({
  m, f, s = DEFAULT_SETTINGS,
}: { m: LaunchMeasurement; f: FlightResult; s?: SVSettings }) {
  const cells = metricCells(m, f, s);
  return (
    <View style={st.grid}>
      {cells.map(c => (
        <View key={c.key} style={st.cell}>
          <Text style={st.cellLabel}>{c.label.toUpperCase()}</Text>
          <Text style={[st.cellValue, c.pending && { color: SV.faint }]}>{c.value}</Text>
          {c.pending
            ? <Text style={st.cellUnit}>próximamente</Text>
            : <Text style={st.cellUnit}>{unitFor(c.key, s)}</Text>}
        </View>
      ))}
    </View>
  );
}

function unitFor(k: MetricKey, s: SVSettings): string {
  if (k === 'ballSpeed' || k === 'clubSpeed') return speedUnit(s);
  if (k === 'carry' || k === 'total' || k === 'apex' || k === 'offline') return distUnit(s);
  if (k === 'spinRate' || k === 'spinAxis') return 'rpm';
  return '';
}

// ── Side trajectory profile ───────────────────────────────────────────────

export function TrajectoryChart({
  flight, s = DEFAULT_SETTINGS, height = 150,
}: { flight: FlightResult; s?: SVSettings; height?: number }) {
  const W = 320, H = height, pad = 14;

  const d = useMemo(() => {
    const pts = flight.path ?? [];
    if (pts.length < 2) return null;
    const maxX = Math.max(...pts.map(p => p.x), 1);
    const maxZ = Math.max(...pts.map(p => p.z), 1);
    const sx = (W - pad * 2) / maxX;
    const sz = (H - pad * 2) / (maxZ * 1.15);
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(pad + p.x * sx).toFixed(1)} ${(H - pad - p.z * sz).toFixed(1)}`)
      .join(' ');
  }, [flight.path, H]);

  return (
    <View style={st.card}>
      <Text style={st.cardTitle}>Perfil de vuelo</Text>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke={SV.line} strokeWidth={1} />
        {d && <SvgPath d={d} stroke={SV.green} strokeWidth={6} strokeOpacity={0.18} fill="none" strokeLinecap="round" />}
        {d && <SvgPath d={d} stroke={SV.green} strokeWidth={2.5} fill="none" strokeLinecap="round" />}
        {d && <Circle cx={W - pad} cy={H - pad} r={3.5} fill={SV.accent} />}
      </Svg>
      <View style={st.chartLabels}>
        <Text style={st.chartLabel}>Carry {dist(flight.carryMeters, s)}</Text>
        <Text style={st.chartLabel}>Apex {dist(flight.apexMeters, s)}</Text>
      </View>
    </View>
  );
}

// ── 3D perspective flight ─────────────────────────────────────────────────

export function PerspectiveFlight({
  flight, s = DEFAULT_SETTINGS, height = 240,
}: { flight: FlightResult; s?: SVSettings; height?: number }) {
  const W = 340, H = height;

  const scene = useMemo(() => {
    const path = flight.path ?? [];
    if (path.length < 2) return null;

    // pinhole camera behind/above the tee, looking down the target line
    const CAM_BACK = 7, CAM_H = 1.7, F = W * 1.15, Z_EXAG = 2.6;
    const project = (down: number, side: number, up: number) => {
      const Z = down + CAM_BACK;
      const X = side;
      const Y = up * Z_EXAG - CAM_H;
      return { x: (F * X) / Z, y: -(F * Y) / Z };
    };

    const maxD = Math.max(
      flight.totalMeters,
      s.targetDistanceM ?? 0,
      ...path.map(p => p.x),
    ) * 1.08;
    const halfW = Math.max(14, Math.abs(flight.sideMeters) * 2.2 + 8);

    // gather everything to auto-fit
    const raw: { x: number; y: number }[] = [];
    const arc = path.map(p => { const q = project(p.x, p.y, p.z); raw.push(q); return q; });

    const step = maxD <= 60 ? 10 : maxD <= 140 ? 25 : 50;
    const grid: { a: { x: number; y: number }; b: { x: number; y: number }; d: number }[] = [];
    for (let dd = step; dd <= maxD; dd += step) {
      const a = project(dd, -halfW, 0), b = project(dd, halfW, 0);
      raw.push(a, b); grid.push({ a, b, d: dd });
    }
    const tA = project(0, 0, 0), tB = project(maxD, 0, 0);
    raw.push(tA, tB);
    const land = project(flight.totalMeters, flight.sideMeters, 0);
    const apexIdx = arc.reduce((bi, _, i) => (path[i].z > path[bi].z ? i : bi), 0);
    raw.push(land);

    const minX = Math.min(...raw.map(p => p.x)), maxX = Math.max(...raw.map(p => p.x));
    const minY = Math.min(...raw.map(p => p.y)), maxY = Math.max(...raw.map(p => p.y));
    const pad = 16;
    const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
    const ox = pad + (W - pad * 2 - (maxX - minX) * sc) / 2 - minX * sc;
    const oy = pad + (H - pad * 2 - (maxY - minY) * sc) / 2 - minY * sc;
    const T = (p: { x: number; y: number }) => ({ x: p.x * sc + ox, y: p.y * sc + oy });

    const toPath = (pts: { x: number; y: number }[]) =>
      pts.map((p, i) => { const q = T(p); return `${i === 0 ? 'M' : 'L'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join(' ');

    return {
      arcD: toPath(arc),
      grid: grid.map(g => ({ a: T(g.a), b: T(g.b), d: g.d })),
      target: { a: T(tA), b: T(tB) },
      land: T(land),
      apex: T(arc[apexIdx]),
    };
  }, [flight, s, H]);

  return (
    <View style={st.card}>
      <Text style={st.cardTitle}>Vuelo 3D</Text>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0a1420" />
            <Stop offset="1" stopColor="#14283a" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#sky)" rx={12} />
        {scene && (
          <G>
            {scene.grid.map((g, i) => (
              <G key={i}>
                <Line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={SV.line} strokeWidth={1} />
                <SvgText x={g.b.x + 3} y={g.b.y + 3} fill={SV.faint} fontSize={8}>
                  {distNum(g.d, s)}
                </SvgText>
              </G>
            ))}
            <Line
              x1={scene.target.a.x} y1={scene.target.a.y}
              x2={scene.target.b.x} y2={scene.target.b.y}
              stroke={SV.accent} strokeWidth={1.5} strokeDasharray="5 5" strokeOpacity={0.7}
            />
            <SvgPath d={scene.arcD} stroke={SV.green} strokeWidth={7} strokeOpacity={0.16} fill="none" strokeLinecap="round" />
            <SvgPath d={scene.arcD} stroke={SV.green} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            <Circle cx={scene.apex.x} cy={scene.apex.y} r={2.5} fill={SV.ink} fillOpacity={0.6} />
            <Line x1={scene.land.x} y1={scene.land.y} x2={scene.land.x} y2={scene.land.y - 10} stroke={SV.accent} strokeWidth={1} />
            <Circle cx={scene.land.x} cy={scene.land.y} r={4} fill={SV.accent} />
          </G>
        )}
      </Svg>
      <View style={st.chartLabels}>
        <Text style={st.chartLabel}>
          Total {dist(flight.totalMeters, s)} · {flight.sideMeters >= 0 ? 'derecha' : 'izquierda'} {dist(Math.abs(flight.sideMeters), s)}
        </Text>
        <Text style={st.chartLabel}>Caída {flight.descentAngleDeg.toFixed(0)}°</Text>
      </View>
    </View>
  );
}

// ── Spread bar (session summary) ──────────────────────────────────────────

export function SpreadBar({
  min, max, avg, unit, domainMin, domainMax,
}: { min: number; max: number; avg: number; unit: string; domainMin: number; domainMax: number }) {
  const span = domainMax - domainMin || 1;
  const l = ((min - domainMin) / span) * 100;
  const w = ((max - min) / span) * 100;
  const a = ((avg - domainMin) / span) * 100;
  return (
    <View style={{ gap: 4 }}>
      <View style={st.spreadTrack}>
        <View style={[st.spreadRange, { left: `${l}%`, width: `${Math.max(w, 1.5)}%` }]} />
        <View style={[st.spreadAvg, { left: `${a}%` }]} />
      </View>
      <View style={st.chartLabels}>
        <Text style={st.spreadEdge}>{Math.round(min)}</Text>
        <Text style={st.spreadAvgTxt}>⌀ {Math.round(avg)} {unit}</Text>
        <Text style={st.spreadEdge}>{Math.round(max)}</Text>
      </View>
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

export const st = StyleSheet.create({
  card: {
    backgroundColor: SV.surface, borderRadius: 16, padding: 14, gap: 10,
    borderWidth: 1, borderColor: SV.line,
  },
  cardTitle: {
    fontSize: 11, fontFamily: FONT.bodySemiBold, color: SV.sub,
    textTransform: 'uppercase', letterSpacing: 1,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    backgroundColor: SV.surface, borderWidth: 1, borderColor: SV.line,
    borderRadius: 12, padding: 12, gap: 2, width: '31.5%', minWidth: 100,
  },
  cellLabel: { fontSize: 9, fontFamily: FONT.bodySemiBold, color: SV.sub, letterSpacing: 0.4 },
  cellValue: { fontSize: 22, fontFamily: FONT.headingExtraBold, color: SV.ink },
  cellUnit: { fontSize: 9, fontFamily: FONT.body, color: SV.faint },

  chartLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  chartLabel: { fontSize: 11, color: SV.sub, fontFamily: FONT.bodyMedium },

  spreadTrack: { height: 22, backgroundColor: SV.surfaceAlt, borderRadius: 11, position: 'relative' },
  spreadRange: { position: 'absolute', top: 4, bottom: 4, backgroundColor: 'rgba(55,214,122,0.28)', borderRadius: 7 },
  spreadAvg: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: SV.accent, borderRadius: 1 },
  spreadEdge: { fontSize: 10, color: SV.sub, fontFamily: FONT.bodyMedium },
  spreadAvgTxt: { fontSize: 11, color: SV.accent, fontFamily: FONT.bodySemiBold },
});
