import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { insertCourse, insertHole } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, RADIUS, SPACING, FONT } from '../../src/theme';
import { CountryPicker } from '../../src/components/CountryPicker';
import { ALL_COUNTRIES } from '../../src/data/worldMap';
import { DEFAULT_PARS_18, DEFAULT_HI_18 } from '../../src/data/defaultCourse';
import { Ionicons } from '@expo/vector-icons';

export default function AddCourseScreen() {
  const router = useRouter();
  const { isDeveloper } = useAuth();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [courseRating, setCourseRating] = useState('72.0');
  const [slopeRating, setSlopeRating] = useState('113');
  const [holes, setHoles] = useState(18);
  const [pars, setPars] = useState<number[]>([...DEFAULT_PARS_18]);
  const [his, setHis] = useState<number[]>([...DEFAULT_HI_18]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isDeveloper) router.replace('/(tabs)/courses');
  }, [isDeveloper]);

  if (!isDeveloper) return null;

  function setPar(i: number, val: number) {
    setPars((p) => p.map((v, idx) => (idx === i ? val : v)));
  }

  async function save() {
    if (!name.trim()) { Alert.alert('Falta el nombre'); return; }
    const cr = parseFloat(courseRating);
    const sr = parseInt(slopeRating);
    if (isNaN(cr) || isNaN(sr)) { Alert.alert('Course/Slope rating inválido'); return; }
    setSaving(true);
    try {
      const courseId = await insertCourse({ name: name.trim(), city: city.trim(), country: country ?? undefined, courseRating: cr, slopeRating: sr });
      for (let i = 0; i < holes; i++) {
        await insertHole({ courseId, number: i + 1, par: pars[i], handicapIndex: his[i] });
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Error guardando', e?.message ?? 'Error desconocido');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.md, gap: 0 }} keyboardShouldPersistTaps="handled">
      <Section title="Información">
        <Field label="Nombre del campo" value={name} onChangeText={setName} placeholder="Real Club de Golf..." />
        <Field label="Ciudad" value={city} onChangeText={setCity} placeholder="Madrid" />
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>País</Text>
          <TouchableOpacity style={styles.countryBtn} onPress={() => setShowCountryPicker(true)}>
            <Text style={styles.countryBtnText}>
              {country
                ? `${ALL_COUNTRIES.find(c => c.cca2 === country)?.flag ?? ''} ${ALL_COUNTRIES.find(c => c.cca2 === country)?.nameEs ?? country}`
                : 'Sin asignar'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Course Rating" value={courseRating} onChangeText={setCourseRating} keyboardType="decimal-pad" />
          </View>
          <View style={{ width: SPACING.sm }} />
          <View style={{ flex: 1 }}>
            <Field label="Slope Rating" value={slopeRating} onChangeText={setSlopeRating} keyboardType="number-pad" />
          </View>
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.label}>Hoyos</Text>
          <View style={styles.holesPicker}>
            {[9, 18].map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.holesBtn, holes === n && styles.holesBtnActive]}
                onPress={() => setHoles(n)}
              >
                <Text style={[styles.holesBtnText, holes === n && styles.holesBtnTextActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Section>

      <Section title="Configuración de hoyos">
        {Array.from({ length: holes }, (_, i) => (
          <View key={i} style={styles.holeRow}>
            <Text style={styles.holeNum}>H{i + 1}</Text>
            <View style={styles.parBtns}>
              {[3, 4, 5].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.parBtn, pars[i] === p && styles.parBtnActive]}
                  onPress={() => setPar(i, p)}
                >
                  <Text style={[styles.parBtnText, pars[i] === p && styles.parBtnTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.hiPicker}>
              <TouchableOpacity onPress={() => setHis((h) => h.map((v, idx) => idx === i ? Math.max(1, v - 1) : v))}>
                <Text style={styles.hiBtn}>−</Text>
              </TouchableOpacity>
              <Text style={styles.hiVal}>HI {his[i]}</Text>
              <TouchableOpacity onPress={() => setHis((h) => h.map((v, idx) => idx === i ? Math.min(18, v + 1) : v))}>
                <Text style={styles.hiBtn}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </Section>

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Text style={styles.saveBtnText}>{saving ? 'Guardando…' : 'Guardar campo'}</Text>
      </TouchableOpacity>

      <CountryPicker
        visible={showCountryPicker}
        selected={country}
        onClose={() => setShowCountryPicker(false)}
        onSelect={(cca2) => { setCountry(cca2); setShowCountryPicker(false); }}
      />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType ?? 'default'}
        placeholderTextColor="#c0ccc0"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  section: { marginBottom: SPACING.md },
  sectionTitle: { fontSize: 13, fontFamily: FONT.headingSemiBold, color: COLORS.primary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs },
  sectionBody: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm + 4 },
  row: { flexDirection: 'row' },
  fieldWrap: { gap: SPACING.xs },
  label: { fontSize: 13, fontFamily: FONT.bodyMedium, color: COLORS.textSecondary },
  input: { backgroundColor: '#f8faf8', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm + 2, fontSize: 16, fontFamily: FONT.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e0e8e0' },
  countryBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8faf8', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm + 2, borderWidth: 1, borderColor: '#e0e8e0' },
  countryBtnText: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  holesPicker: { flexDirection: 'row', gap: SPACING.sm },
  holesBtn: { width: 44, height: 36, borderRadius: RADIUS.sm, backgroundColor: '#f0f4f0', alignItems: 'center', justifyContent: 'center' },
  holesBtnActive: { backgroundColor: COLORS.primary },
  holesBtnText: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.primary },
  holesBtnTextActive: { color: COLORS.textOnPrimary },
  holeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs + 2, borderTopWidth: 1, borderColor: '#f0f2f5', gap: SPACING.sm },
  holeNum: { fontSize: 13, fontFamily: FONT.headingSemiBold, color: COLORS.primary, width: 28 },
  parBtns: { flexDirection: 'row', gap: 6 },
  parBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: '#f0f4f0', alignItems: 'center', justifyContent: 'center' },
  parBtnActive: { backgroundColor: COLORS.primary },
  parBtnText: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.primary },
  parBtnTextActive: { color: COLORS.textOnPrimary },
  hiPicker: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: SPACING.sm },
  hiBtn: { fontSize: 20, fontFamily: FONT.body, color: COLORS.primary, paddingHorizontal: SPACING.xs + 2 },
  hiVal: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary, width: 44, textAlign: 'center' },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center', marginBottom: SPACING.xl },
  saveBtnText: { color: COLORS.textOnPrimary, fontSize: 17, fontFamily: FONT.bodySemiBold },
});
