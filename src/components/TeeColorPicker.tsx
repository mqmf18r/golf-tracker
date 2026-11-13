import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TeeColor, TEE_COLORS, TEE_LABELS, TEE_HEX } from '../types';
import { COLORS, FONT } from '../theme';

// Shared tee-color chip row — used at round creation and, just as
// importantly, wherever a wrong tee needs fixing after the fact (active
// round, completed round history). Extracted from app/round/new.tsx so all
// three places stay visually and behaviorally identical.
export function TeeColorPicker({ value, onChange }: { value: TeeColor; onChange: (color: TeeColor) => void }) {
  return (
    <View style={styles.row}>
      {TEE_COLORS.map(color => (
        <TouchableOpacity
          key={color}
          style={[styles.btn, { borderColor: TEE_HEX[color] }, value === color && { backgroundColor: TEE_HEX[color] }]}
          onPress={() => onChange(color)}
          activeOpacity={0.75}
        >
          <Text style={[styles.txt, { color: value === color ? COLORS.textOnPrimary : TEE_HEX[color] }]} numberOfLines={1}>
            {TEE_LABELS[color]}
          </Text>
          {value === color && <Ionicons name="checkmark" size={12} color={COLORS.textOnPrimary} />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, borderWidth: 1.5, paddingVertical: 7, paddingHorizontal: 10 },
  txt: { fontSize: 12, fontFamily: FONT.bodySemiBold },
});
