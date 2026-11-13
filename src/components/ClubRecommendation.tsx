import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ClubProfile } from '../lib/api';
import { recommendClubRange } from '../services/clubRecommendation';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../theme';

const CLUB_NAMES: Record<string, string> = {
  D: 'Driver', '3W': 'Madera 3', '5W': 'Madera 5', '4H': 'Híbrido 4',
  '5i': 'Hierro 5', '6i': 'Hierro 6', '7i': 'Hierro 7', '8i': 'Hierro 8', '9i': 'Hierro 9',
  PW: 'Pitching W.', GW: 'Gap W.', SW: 'Sand W.', LW: 'Lob W.', P: 'Putter',
};

export function ClubRecommendation({ distance, profiles }: { distance: number | null; profiles: ClubProfile[] }) {
  const [manualDist, setManualDist] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const usingManual = manualDist !== null;
  const effectiveDistance = usingManual ? manualDist : distance;

  function startEdit() {
    setDraft(distance !== null ? String(distance) : '');
    setEditing(true);
  }
  function confirmEdit() {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0) setManualDist(n);
    setEditing(false);
  }
  function clearManual() {
    setManualDist(null);
    setEditing(false);
  }

  if (effectiveDistance === null && !editing) {
    // No GPS distance yet and no manual override — still offer the manual
    // option (useful off-course, when GPS says you're kilometres away or
    // isn't available at all).
    return (
      <TouchableOpacity style={styles.emptyCard} onPress={startEdit}>
        <Ionicons name="create-outline" size={18} color={COLORS.textTertiary} />
        <Text style={styles.emptyText}>Sin distancia GPS todavía · toca para probar una distancia manualmente</Text>
      </TouchableOpacity>
    );
  }

  const range = effectiveDistance !== null ? recommendClubRange(effectiveDistance, profiles) : null;
  const rec = range?.best ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.labelRow}>
          <Ionicons name="golf-outline" size={13} color={COLORS.textTertiary} />
          <Text style={styles.label}>Palo recomendado</Text>
        </View>
        {!editing && (
          <TouchableOpacity onPress={startEdit} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.editLink}>{usingManual ? 'cambiar distancia' : 'probar otra distancia'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {editing ? (
        <View style={styles.editRow}>
          <TextInput
            style={styles.editInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="metros"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={confirmEdit}
          />
          <Text style={styles.editUnit}>m</Text>
          <TouchableOpacity style={styles.okBtn} onPress={confirmEdit}><Ionicons name="checkmark" size={16} color={COLORS.textOnPrimary} /></TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}><Ionicons name="close" size={16} color={COLORS.textSecondary} /></TouchableOpacity>
        </View>
      ) : !rec ? (
        <Text style={styles.emptyTextInline}>
          {profiles.length === 0
            ? 'Aún no hay datos de tus palos. Usa "Medir golpe" para ir registrando distancias.'
            : 'Necesitas al menos 2 golpes registrados con algún palo para ver una recomendación.'}
        </Text>
      ) : (
        <>
          <View style={styles.row}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{rec.club}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {CLUB_NAMES[rec.club] ?? rec.club} · {rec.source === 'manual' ? 'dist. provisional' : 'tu media'} {rec.avgDist}m
              </Text>
              {rec.avgLateral !== null && Math.abs(rec.avgLateral) >= 2 && (
                <View style={styles.tendencyRow}>
                  <Ionicons name="trending-up-outline" size={12} color={COLORS.textSecondary} />
                  <Text style={styles.tendency}>
                    Tiende {Math.abs(Math.round(rec.avgLateral))}m a la {rec.avgLateral > 0 ? 'derecha' : 'izquierda'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {(range?.less || range?.more) && (
            <View style={styles.altRow}>
              <AltPick label="menos" rec={range?.less ?? null} />
              <View style={styles.altDivider} />
              <AltPick label="más" rec={range?.more ?? null} />
            </View>
          )}

          {usingManual && (
            <View style={styles.manualNote}>
              <Text style={styles.manualNoteText}>Probando a {manualDist}m{distance !== null ? ` · GPS real: ${distance}m` : ''}</Text>
              <TouchableOpacity onPress={clearManual}><Text style={styles.manualNoteClear}>usar GPS</Text></TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

function AltPick({ label, rec }: { label: string; rec: { club: string; avgDist: number } | null }) {
  if (!rec) return <View style={{ flex: 1 }} />;
  return (
    <View style={styles.altPick}>
      <Text style={styles.altPickLabel}>{label}: {rec.club}</Text>
      <Text style={styles.altPickDist}>{rec.avgDist}m</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.sm + 4, marginBottom: SPACING.sm + 4, gap: SPACING.sm,
    ...CARD_SHADOW,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { fontSize: 11, color: COLORS.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: FONT.bodySemiBold },
  editLink: { fontSize: 11, color: COLORS.primary, fontFamily: FONT.bodySemiBold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chip: {
    width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  chipText: { color: COLORS.textOnPrimary, fontSize: 14, fontFamily: FONT.headingSemiBold },
  title: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  tendencyRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tendency: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2,
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.sm + 6, marginBottom: SPACING.sm + 4,
    ...CARD_SHADOW,
  },
  emptyText: { flex: 1, fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, lineHeight: 17 },
  emptyTextInline: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, lineHeight: 17 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  editInput: {
    flex: 1, backgroundColor: '#f8faf8', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm + 4, paddingVertical: SPACING.sm,
    fontSize: 16, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e0e8e0',
  },
  editUnit: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary },
  okBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { padding: 4 },
  manualNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f0f2f5' },
  manualNoteText: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textTertiary },
  manualNoteClear: { fontSize: 11, color: COLORS.primary, fontFamily: FONT.bodySemiBold },
  altRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f2f5' },
  altDivider: { width: 1, height: 24, backgroundColor: '#f0f2f5' },
  altPick: { flex: 1, alignItems: 'center', gap: 1 },
  altPickLabel: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  altPickDist: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textTertiary },
});
