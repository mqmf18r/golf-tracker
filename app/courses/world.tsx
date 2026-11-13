import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCourses, getVisitedCountries, updateCourse } from '../../src/lib/api';
import { Course } from '../../src/types';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';
import { WorldMapView } from '../../src/components/WorldMapView';
import { CountryPicker } from '../../src/components/CountryPicker';
import { ALL_COUNTRIES } from '../../src/data/worldMap';

const CONTINENT_ORDER = ['Europa', 'Américas', 'Asia', 'África', 'Oceanía'];
const MAP_WIDTH = Math.min(Dimensions.get('window').width - SPACING.md * 2, 520);

export default function WorldMapScreen() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [assigningCourseId, setAssigningCourseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, v] = await Promise.all([getCourses(), getVisitedCountries()]);
    setCourses(c);
    setVisited(new Set(v));
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function assignCountry(courseId: string, cca2: string) {
    await updateCourse(courseId, { country: cca2 });
    setAssigningCourseId(null);
    await load();
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const unassigned = courses.filter(c => !c.country);
  const visitedContinents = new Set(
    ALL_COUNTRIES.filter(c => visited.has(c.cca2)).map(c => c.continent),
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl }}>
      <View style={styles.statsRow}>
        <View style={[styles.statPill, { backgroundColor: COLORS.primaryTint }]}>
          <Text style={[styles.statValue, { color: COLORS.primary }]}>{visited.size}</Text>
          <Text style={styles.statLabel}>países</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#eaf3fa' }]}>
          <Text style={[styles.statValue, { color: COLORS.info }]}>{visitedContinents.size}</Text>
          <Text style={styles.statLabel}>continentes</Text>
        </View>
      </View>

      <WorldMapView visited={visited} width={MAP_WIDTH} />

      {unassigned.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sin país asignado</Text>
          <Text style={styles.sectionDesc}>
            Asigna un país a estos campos para que cuenten en tu mapa.
          </Text>
          <View style={{ gap: SPACING.sm }}>
            {unassigned.map(c => (
              <TouchableOpacity
                key={c.id}
                style={styles.unassignedRow}
                onPress={() => setAssigningCourseId(c.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.unassignedName}>{c.name}</Text>
                  <Text style={styles.unassignedCity}>{c.city || 'Sin ciudad'}</Text>
                </View>
                <View style={styles.assignBtn}>
                  <Ionicons name="flag-outline" size={14} color={COLORS.textOnPrimary} />
                  <Text style={styles.assignBtnTxt}>Asignar país</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {CONTINENT_ORDER.map(continent => {
        const countries = ALL_COUNTRIES.filter(c => c.continent === continent);
        const visitedCount = countries.filter(c => visited.has(c.cca2)).length;
        return (
          <View key={continent} style={styles.section}>
            <View style={styles.continentHeader}>
              <Text style={styles.sectionTitle}>{continent}</Text>
              <Text style={styles.continentCount}>{visitedCount}/{countries.length}</Text>
            </View>
            <View style={styles.chipWrap}>
              {countries.map(c => {
                const isVisited = visited.has(c.cca2);
                return (
                  <View key={c.cca2} style={[styles.chip, isVisited && styles.chipVisited]}>
                    <Text style={[styles.chipFlag, !isVisited && styles.chipFlagMuted]}>{c.flag}</Text>
                    <Text style={[styles.chipName, isVisited && styles.chipNameVisited]}>{c.nameEs}</Text>
                    {isVisited && <Ionicons name="checkmark-circle" size={13} color={COLORS.success} />}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}

      <CountryPicker
        visible={!!assigningCourseId}
        onClose={() => setAssigningCourseId(null)}
        onSelect={(cca2) => assigningCourseId && assignCountry(assigningCourseId, cca2)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  statsRow: { flexDirection: 'row', gap: SPACING.sm + 2 },
  statPill: { flex: 1, borderRadius: RADIUS.lg, paddingVertical: SPACING.md - 2, alignItems: 'center' },
  statValue: { fontSize: 26, fontFamily: FONT.heading },
  statLabel: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary, marginTop: 1 },

  section: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm, ...CARD_SHADOW },
  sectionTitle: { fontSize: 16, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  sectionDesc: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: -6 },

  unassignedRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f9fa',
    borderRadius: RADIUS.md, padding: SPACING.sm + 4, gap: SPACING.sm,
  },
  unassignedName: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  unassignedCity: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 1 },
  assignBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary,
    borderRadius: 20, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2,
  },
  assignBtnTxt: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  continentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  continentCount: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f1f3f1',
    borderRadius: 20, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 1,
  },
  chipVisited: { backgroundColor: COLORS.primaryTint },
  chipFlag: { fontSize: 13 },
  chipFlagMuted: { opacity: 0.4 },
  chipName: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textTertiary },
  chipNameVisited: { color: COLORS.primary, fontFamily: FONT.bodySemiBold },
});
