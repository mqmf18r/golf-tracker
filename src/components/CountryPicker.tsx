import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../theme';
import { ALL_COUNTRIES } from '../data/worldMap';

interface CountryPickerProps {
  visible: boolean;
  selected?: string | null;
  onClose: () => void;
  onSelect: (cca2: string) => void;
}

export function CountryPicker({ visible, selected, onClose, onSelect }: CountryPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length > 0
      ? ALL_COUNTRIES.filter(c => c.nameEs.toLowerCase().includes(q))
      : ALL_COUNTRIES;
  }, [query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Text style={styles.title}>Elegir país</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.search}
          placeholder="Buscar país..."
          placeholderTextColor={COLORS.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingTop: SPACING.sm, gap: SPACING.xs + 2 }} keyboardShouldPersistTaps="handled">
          {filtered.map(c => {
            const isSelected = c.cca2 === selected;
            return (
              <TouchableOpacity
                key={c.cca2}
                style={[styles.row, isSelected && styles.rowActive]}
                onPress={() => onSelect(c.cca2)}
              >
                <Text style={styles.flag}>{c.flag}</Text>
                <Text style={[styles.name, isSelected && styles.nameActive]}>{c.nameEs}</Text>
                {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.textOnPrimary} />}
              </TouchableOpacity>
            );
          })}
          {filtered.length === 0 && (
            <Text style={styles.empty}>Ningún país coincide.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, paddingBottom: 0 },
  title: { fontSize: 20, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  search: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md, backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 4, fontSize: 15,
    fontFamily: FONT.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e9ecef',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4, backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm + 6, paddingVertical: SPACING.sm + 4,
    ...CARD_SHADOW,
  },
  rowActive: { backgroundColor: COLORS.primary },
  flag: { fontSize: 22 },
  name: { flex: 1, fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  nameActive: { color: COLORS.textOnPrimary },
  empty: { textAlign: 'center', fontFamily: FONT.body, color: COLORS.textSecondary, fontSize: 14, marginTop: 30 },
});
