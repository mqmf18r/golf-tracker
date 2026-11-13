import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { scoreLabel, stablefordPoints } from '../types';
import { COLORS, FONT } from '../theme';

interface Props {
  holeNumber: number;
  par: number;
  strokes: number;
  putts: number;
  fairwayHit: number | null;
  gir: number;
  penaltyStrokes: number;
  firstPuttDist?: number | null;
  onChange: (field: 'strokes' | 'putts' | 'penaltyStrokes' | 'fairwayHit' | 'gir' | 'firstPuttDist', value: number | null) => void;
}

export function ScorePad({ holeNumber, par, strokes, putts, fairwayHit, gir, penaltyStrokes, firstPuttDist, onChange }: Props) {
  const played = strokes > 0;
  const diff = strokes - par;
  const scoreColor = !played ? COLORS.textTertiary : diff < 0 ? COLORS.danger : diff === 0 ? COLORS.success : diff === 1 ? COLORS.textPrimary : COLORS.warning;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.holeTitle}>Hoyo {holeNumber}</Text>
          <Text style={styles.parText}>Par {par}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={[styles.scoreLabelText, { color: scoreColor }]}>{played ? scoreLabel(strokes, par) : 'Sin jugar'}</Text>
          {played && <Text style={styles.stablefordText}>{stablefordPoints(strokes, par)} pts</Text>}
        </View>
      </View>

      <View style={styles.divider} />

      {/* Golpes — tap the score circle to open the quick-select grid; picking a
          number sets it and closes the grid again, so it stays out of the way
          the rest of the time. */}
      <GolpesField par={par} value={strokes} onSelect={(n) => onChange('strokes', n)} />

      <View style={styles.divider} />

      {/* Putts */}
      <CounterRow label="Putts" value={putts} min={0} max={10} color={COLORS.info}
        onInc={() => onChange('putts', putts + 1)}
        onDec={() => onChange('putts', Math.max(0, putts - 1))} />

      {/* First putt distance (proximity to hole) */}
      <CounterRow label="1er putt (m)" value={firstPuttDist ?? 0} min={0} max={40} color="#8e44ad"
        onInc={() => onChange('firstPuttDist', (firstPuttDist ?? 0) + 1)}
        onDec={() => onChange('firstPuttDist', Math.max(0, (firstPuttDist ?? 0) - 1) || null)} />

      {/* Penalty */}
      <CounterRow label="Penalty" value={penaltyStrokes} min={0} max={10} color="#c0392b"
        onInc={() => onChange('penaltyStrokes', penaltyStrokes + 1)}
        onDec={() => onChange('penaltyStrokes', Math.max(0, penaltyStrokes - 1))} />

      <View style={styles.divider} />

      {/* Toggles */}
      <View style={styles.toggleRow}>
        {fairwayHit !== null && (
          <ToggleChip
            label="Fairway"
            active={fairwayHit === 1}
            color={COLORS.success}
            onPress={() => onChange('fairwayHit', fairwayHit === 1 ? 0 : 1)}
          />
        )}
        <ToggleChip
          label="GIR"
          active={gir === 1}
          color={COLORS.info}
          onPress={() => onChange('gir', gir === 1 ? 0 : 1)}
        />
      </View>
    </View>
  );
}

// "Named" results only (Albatross..Doble) — extreme scores show just the
// number, same as GolfGameBook leaves 7/8/9 unlabeled for a par 4.
const NAMED = new Set(['Albatross', 'Eagle', 'Birdie', 'Par', 'Bogey', 'Doble']);

function GolpesField({ par, value, onSelect }: { par: number; value: number; onSelect: (n: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<'lo' | 'hi' | 'stepper'>('lo');
  const [stepperVal, setStepperVal] = useState(19);

  function open() {
    setPage(value >= 10 ? 'hi' : 'lo');
    setExpanded(true);
  }
  function pick(n: number) {
    onSelect(n);
    setExpanded(false);
  }
  function openStepper() {
    setStepperVal(value > 18 ? value : 19);
    setPage('stepper');
  }

  return (
    <View>
      <View style={styles.golpesRow}>
        <Text style={styles.gridLabel}>Golpes</Text>
        <TouchableOpacity style={styles.golpesCircle} onPress={expanded ? () => setExpanded(false) : open}>
          <Text style={styles.golpesCircleTxt}>{value > 0 ? value : '—'}</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        page === 'lo' ? (
          <LoGrid par={par} value={value} onPick={pick} onMore={() => setPage('hi')} onClear={() => pick(0)} />
        ) : page === 'hi' ? (
          <HiGrid value={value} onPick={pick} onBack={() => setPage('lo')} onClear={() => pick(0)} onMore={openStepper} />
        ) : (
          <StepperPage
            value={stepperVal}
            onChange={setStepperVal}
            onCancel={() => setPage('hi')}
            onConfirm={() => pick(stepperVal)}
          />
        )
      )}
    </View>
  );
}

function LoGrid({ par, value, onPick, onMore, onClear }: {
  par: number; value: number; onPick: (n: number) => void; onMore: () => void; onClear: () => void;
}) {
  const cells: { n: number; label: string }[] = [];
  for (let n = 1; n <= 9; n++) {
    const lbl = scoreLabel(n, par);
    cells.push({ n, label: NAMED.has(lbl) ? lbl : '' });
  }
  return (
    <View style={styles.gridRows}>
      {[0, 1, 2].map(row => (
        <View key={row} style={styles.gridRow}>
          {cells.slice(row * 3, row * 3 + 3).map(c => (
            <ScoreCell key={c.n} n={c.n} label={c.label} active={value === c.n} onPress={() => onPick(c.n)} />
          ))}
        </View>
      ))}
      <View style={styles.gridRow}>
        <TouchableOpacity style={styles.textCell} onPress={onClear}>
          <Text style={styles.textCellTxt}>Sin jugar</Text>
        </TouchableOpacity>
        <View style={styles.textCell} />
        <TouchableOpacity style={styles.textCell} onPress={onMore}>
          <Text style={styles.textCellTxt}>10+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function HiGrid({ value, onPick, onBack, onClear, onMore }: {
  value: number; onPick: (n: number) => void; onBack: () => void; onClear: () => void; onMore: () => void;
}) {
  const nums = [10, 11, 12, 13, 14, 15, 16, 17];
  return (
    <View style={styles.gridRows}>
      {[0, 1].map(row => (
        <View key={row} style={styles.gridRow}>
          {nums.slice(row * 3, row * 3 + 3).map(n => (
            <ScoreCell key={n} n={n} label="" active={value === n} onPress={() => onPick(n)} />
          ))}
        </View>
      ))}
      <View style={styles.gridRow}>
        {nums.slice(6).map(n => (
          <ScoreCell key={n} n={n} label="" active={value === n} onPress={() => onPick(n)} />
        ))}
        {/* 18+ opens a +/- stepper (matches GolfGameBook) for the rare hole
            that goes even higher, instead of a 4th flat grid page. */}
        <TouchableOpacity style={[styles.cell, value > 18 && styles.cellActive]} onPress={onMore}>
          <Text style={[styles.cellNum, value > 18 && styles.cellNumActive]}>{value > 18 ? value : '18+'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.gridRow}>
        <TouchableOpacity style={styles.textCell} onPress={onClear}>
          <Text style={styles.textCellTxt}>Sin jugar</Text>
        </TouchableOpacity>
        <View style={styles.textCell} />
        <TouchableOpacity style={styles.textCell} onPress={onBack}>
          <Text style={styles.textCellTxt}>1-9</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StepperPage({ value, onChange, onCancel, onConfirm }: {
  value: number; onChange: (n: number) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <View style={styles.stepperWrap}>
      <View style={styles.stepperRow}>
        <TouchableOpacity style={styles.stepperArrow} onPress={() => onChange(Math.max(19, value - 1))}>
          <Text style={styles.stepperArrowTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.stepperNum}>{value}</Text>
        <TouchableOpacity style={styles.stepperArrow} onPress={() => onChange(value + 1)}>
          <Text style={styles.stepperArrowTxt}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.gridRow}>
        <TouchableOpacity style={styles.stepperCancel} onPress={onCancel}>
          <Text style={styles.stepperCancelTxt}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.stepperConfirm} onPress={onConfirm}>
          <Text style={styles.stepperConfirmTxt}>✓</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ScoreCell({ n, label, active, onPress }: { n: number; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.cell, active && styles.cellActive]} onPress={onPress}>
      <Text style={[styles.cellNum, active && styles.cellNumActive]}>{n}</Text>
      {!!label && <Text style={[styles.cellLabel, active && styles.cellLabelActive]}>{label}</Text>}
    </TouchableOpacity>
  );
}

function CounterRow({ label, value, min, max, color, onInc, onDec }: {
  label: string; value: number; min: number; max: number; color: string;
  onInc: () => void; onDec: () => void;
}) {
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterControls}>
        <TouchableOpacity onPress={onDec} style={[styles.counterBtn, value <= min && styles.disabled]}>
          <Text style={styles.counterBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={[styles.counterValue, { color }]}>{value}</Text>
        <TouchableOpacity onPress={onInc} style={[styles.counterBtn, value >= max && styles.disabled]}>
          <Text style={styles.counterBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ToggleChip({ label, active, color, onPress }: {
  label: string; active: boolean; color: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: color + '22', borderColor: color }]}
    >
      <Text style={[styles.chipText, { color: active ? color : COLORS.textSecondary }]}>
        {active ? '✓ ' : ''}{label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: COLORS.shadow, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  holeTitle: { fontSize: 22, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  parText: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 2 },
  badge: { alignItems: 'flex-end' },
  scoreLabelText: { fontSize: 14, fontFamily: FONT.bodySemiBold },
  stablefordText: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  divider: { height: 1, backgroundColor: '#f0f2f5', marginVertical: 12 },

  golpesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gridLabel: { fontSize: 16, fontFamily: FONT.body, color: COLORS.textPrimary },
  golpesCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  golpesCircleTxt: { fontSize: 20, fontFamily: FONT.heading, color: COLORS.textPrimary },

  gridRows: { gap: 8, marginTop: 12 },
  gridRow: { flexDirection: 'row', gap: 8 },
  cell: {
    flex: 1, backgroundColor: '#f4f6f4', borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: 52,
  },
  cellActive: { backgroundColor: COLORS.success },
  cellNum: { fontSize: 20, fontFamily: FONT.heading, color: COLORS.textPrimary },
  cellNumActive: { color: '#fff' },
  cellLabel: { fontSize: 10, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  cellLabelActive: { color: 'rgba(255,255,255,0.85)' },
  textCell: {
    flex: 1, backgroundColor: '#f4f6f4', borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center', minHeight: 52,
  },
  textCellTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },

  stepperWrap: { gap: 12, marginTop: 12 },
  stepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24,
    backgroundColor: '#f4f6f4', borderRadius: 14, paddingVertical: 16,
  },
  stepperArrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.success, alignItems: 'center', justifyContent: 'center' },
  stepperArrowTxt: { fontSize: 26, fontFamily: FONT.heading, color: '#fff', lineHeight: 28 },
  stepperNum: { fontSize: 32, fontFamily: FONT.heading, color: COLORS.textPrimary, minWidth: 56, textAlign: 'center' },
  stepperCancel: { flex: 1, backgroundColor: '#f0f2f5', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  stepperCancelTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  stepperConfirm: { flex: 1, backgroundColor: COLORS.success, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  stepperConfirmTxt: { fontSize: 17, fontFamily: FONT.heading, color: '#fff' },

  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  counterLabel: { fontSize: 16, fontFamily: FONT.body, color: COLORS.textPrimary, width: 90 },
  counterControls: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  counterBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f2f5', alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { fontSize: 22, color: COLORS.textPrimary, lineHeight: 26 },
  counterValue: { fontSize: 32, fontFamily: FONT.bodySemiBold, minWidth: 48, textAlign: 'center' },
  disabled: { opacity: 0.3 },
  toggleRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: '#e0e4eb', alignItems: 'center' },
  chipText: { fontSize: 15, fontFamily: FONT.bodyMedium },
});
