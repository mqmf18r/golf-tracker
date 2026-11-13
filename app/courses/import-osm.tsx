import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { getCourses, insertCourse, insertHole, deleteCourse } from '../../src/lib/api';
import { DEFAULT_PARS_18, DEFAULT_HI_18 } from '../../src/data/defaultCourse';
import { fetchOsmGolfHolesWithConfidence, applyOsmHolesToDb } from '../../src/services/osmGolf';
import { geocodePlace, findGolfCoursesInBbox, bboxFromRegion, GeocodeResult, DiscoveredCourse } from '../../src/services/osmDiscovery';
import { uploadCourse, listPublicCourses } from '../../src/services/cloudCourses';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';

type RowStatus = 'idle' | 'importing' | 'done' | 'error' | 'skipped';

function regionFromBoundingBox(bb: { south: number; north: number; west: number; east: number }): Region {
  return {
    latitude: (bb.south + bb.north) / 2,
    longitude: (bb.west + bb.east) / 2,
    latitudeDelta: Math.max(bb.north - bb.south, 0.02) * 1.3,
    longitudeDelta: Math.max(bb.east - bb.west, 0.02) * 1.3,
  };
}

function pinColorFor(already: boolean, isSelected: boolean, rowStatus: RowStatus): string {
  if (rowStatus === 'done') return COLORS.success;
  if (rowStatus === 'error') return COLORS.danger;
  if (rowStatus === 'skipped') return COLORS.warning;
  if (already) return '#c0ccc0';
  if (isSelected) return COLORS.primary;
  return '#8e9aaf';
}

function CourseMarker({ c, color, onPress }: { c: DiscoveredCourse; color: string; onPress: () => void }) {
  return (
    <Marker
      coordinate={{ latitude: c.lat, longitude: c.lon }}
      title={c.name}
      description={c.city ?? undefined}
      onPress={onPress}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[markerStyles.pin, { backgroundColor: color }]}>
        <Ionicons name="golf" size={13} color="#fff" />
      </View>
    </Marker>
  );
}

const markerStyles = StyleSheet.create({
  pin: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, elevation: 3,
  },
});

export default function ImportOsmScreen() {
  const router = useRouter();
  const { isDeveloper } = useAuth();

  const [query, setQuery] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [placeOptions, setPlaceOptions] = useState<GeocodeResult[]>([]);
  const [place, setPlace] = useState<GeocodeResult | null>(null);

  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredCourse[]>([]);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [lastPannedRegion, setLastPannedRegion] = useState<Region | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [lastBbox, setLastBbox] = useState<{ south: number; north: number; west: number; east: number } | null>(null);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const [existingPublicNames, setExistingPublicNames] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [statusReason, setStatusReason] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!isDeveloper) router.replace('/(tabs)/courses');
  }, [isDeveloper]);

  useEffect(() => {
    getCourses().then(cs => setExistingNames(new Set(cs.map(c => c.name.trim().toLowerCase()))));
    // The server-shared library (same course_maps table the "Explorar" tab
    // reads from) — checked so a course already published there (by this
    // developer or anyone else who ran this importer before) doesn't get
    // uploaded again, since the whole point is that nobody should need to
    // redo the OSM lookup once it's on the server.
    listPublicCourses().then(cs => setExistingPublicNames(new Set(cs.map(c => c.name.trim().toLowerCase())))).catch(() => {});
  }, []);

  if (!isDeveloper) return null;

  // Errors here used to go through Alert.alert only — invisible on the web
  // build (no native dialog support there) and, even on a real phone, just
  // a passing interrupt with nothing left on screen once dismissed. A
  // failed/empty search and a screen that hasn't been searched yet looked
  // identical. searchError/discoverError below give a persistent inline
  // state instead, with a retry action where retrying can actually help.
  async function search() {
    if (!query.trim()) return;
    setGeocoding(true);
    setPlaceOptions([]);
    setPlace(null);
    setDiscovered([]);
    setSearchError(null);
    setDiscoverError(null);
    try {
      const results = await geocodePlace(query.trim());
      if (results.length === 0) {
        setSearchError('No se encontró ese lugar. Prueba con otro nombre.');
      } else if (results.length === 1) {
        await pickPlace(results[0]);
      } else {
        setPlaceOptions(results);
      }
    } catch (err) {
      setSearchError('Error de búsqueda. Comprueba tu conexión e inténtalo de nuevo.');
    } finally {
      setGeocoding(false);
    }
  }

  async function pickPlace(p: GeocodeResult) {
    setPlace(p);
    setPlaceOptions([]);
    setSearchError(null);
    setMapRegion(regionFromBoundingBox(p.boundingBox));
    setSelected(new Set());
    setStatus({});
    setStatusReason({});
    await discoverIn(p.boundingBox);
  }

  async function discoverIn(bbox: { south: number; north: number; west: number; east: number }) {
    setDiscovering(true);
    setDiscoverError(null);
    setLastBbox(bbox);
    try {
      const found = await findGolfCoursesInBbox(bbox);
      setDiscovered(found);
      if (found.length === 0) {
        setDiscoverError('OpenStreetMap no tiene campos de golf mapeados en esta zona.');
      }
    } catch (err) {
      setDiscoverError('No se pudo conectar con OpenStreetMap. Comprueba tu conexión e inténtalo de nuevo.');
    } finally {
      setDiscovering(false);
    }
  }

  function retryDiscover() {
    if (lastBbox) discoverIn(lastBbox);
  }

  // "Buscar en esta zona" — re-discover using whatever the map is currently
  // showing, without requiring a new text search. Replaces the previous
  // results/selection outright (same behaviour as Google Maps' own "search
  // this area") rather than merging, so a selected course from the old
  // area can't silently vanish from the import queue.
  async function searchThisArea() {
    if (!lastPannedRegion) return;
    setSelected(new Set());
    setStatus({});
    setStatusReason({});
    await discoverIn(bboxFromRegion(lastPannedRegion));
  }

  function toggle(osmId: string) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(osmId)) next.delete(osmId); else next.add(osmId);
      return next;
    });
  }

  function toggleAll() {
    const selectable = discovered.filter(c => !existingNames.has(c.name.trim().toLowerCase()));
    const allSelected = selectable.every(c => selected.has(c.osmId));
    setSelected(allSelected ? new Set() : new Set(selectable.map(c => c.osmId)));
  }

  async function importSelected() {
    const toImport = discovered.filter(c => selected.has(c.osmId));
    if (toImport.length === 0) return;
    setImporting(true);
    let okCount = 0, failCount = 0, skipCount = 0, publishedCount = 0;
    const succeeded = new Set<string>();
    const publishedNames = new Set<string>();

    for (const c of toImport) {
      setStatus(s => ({ ...s, [c.osmId]: 'importing' }));
      let courseId: string | null = null;
      try {
        // Fetch geometry BEFORE creating anything — if OSM's hole numbering
        // for this course isn't trustworthy, skip it outright rather than
        // create a course with a possibly-wrong map (per user's choice).
        const { holes: osmHoles, reliable } = await fetchOsmGolfHolesWithConfidence(c.lat, c.lon);
        if (osmHoles.length === 0 || !reliable) {
          setStatus(s => ({ ...s, [c.osmId]: 'skipped' }));
          setStatusReason(s => ({
            ...s, [c.osmId]: osmHoles.length === 0
              ? 'OSM no tiene datos de hoyos para este campo'
              : 'Numeración de hoyos no fiable en OSM',
          }));
          skipCount++;
          continue;
        }

        const holeCount = Math.max(...osmHoles.map(h => h.holeNumber));
        courseId = await insertCourse({
          name: c.name,
          city: c.city ?? '',
          country: place?.countryCode ? place.countryCode.toUpperCase() : undefined,
          courseRating: 72.0,
          slopeRating: 113,
        });
        for (let i = 0; i < holeCount; i++) {
          await insertHole({
            courseId, number: i + 1,
            par: DEFAULT_PARS_18[i % 18], handicapIndex: DEFAULT_HI_18[i % 18],
          });
        }
        await applyOsmHolesToDb(courseId, osmHoles);

        setStatus(s => ({ ...s, [c.osmId]: 'done' }));
        succeeded.add(c.name.trim().toLowerCase());
        okCount++;

        // Publish to the shared server library too, so the next person who
        // wants this course (this account on another device, or anyone
        // else) can just grab it from "Explorar" instead of re-running the
        // whole OSM lookup — the point of putting it "on the server."
        const nameKey = c.name.trim().toLowerCase();
        if (!existingPublicNames.has(nameKey) && !publishedNames.has(nameKey)) {
          try {
            await uploadCourse(courseId);
            publishedNames.add(nameKey);
            publishedCount++;
          } catch { /* local import already succeeded; publishing is best-effort */ }
        }
      } catch (err) {
        // Don't leave a half-created course behind — a retry would insert a
        // duplicate under the same name instead of cleanly trying again.
        if (courseId) await deleteCourse(courseId).catch(() => {});
        setStatus(s => ({ ...s, [c.osmId]: 'error' }));
        setStatusReason(s => ({ ...s, [c.osmId]: String((err as any)?.message ?? err) }));
        failCount++;
      }
      await new Promise(r => setTimeout(r, 600)); // be a respectful Overpass/Nominatim citizen
    }

    setImporting(false);
    setExistingNames(prev => new Set([...prev, ...succeeded]));
    setExistingPublicNames(prev => new Set([...prev, ...publishedNames]));
    Alert.alert(
      'Importación completada',
      `${okCount} campos importados` +
      (publishedCount > 0 ? ` (${publishedCount} publicados en el servidor)` : '') +
      (skipCount > 0 ? `, ${skipCount} omitidos (datos de OSM no fiables)` : '') +
      (failCount > 0 ? `, ${failCount} fallidos` : '') + '.'
    );
  }

  const selectableCount = discovered.filter(c => !existingNames.has(c.name.trim().toLowerCase())).length;
  const allSelectableChosen = selectableCount > 0 && discovered.filter(c => selected.has(c.osmId)).length === selectableCount;

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Ciudad, región o país (ej: Valencia)"
            placeholderTextColor="#8e9aaf"
            onSubmitEditing={search}
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.searchBtn} onPress={search} disabled={geocoding}
            accessibilityRole="button" accessibilityLabel="Buscar"
          >
            {geocoding ? <ActivityIndicator color={COLORS.textOnPrimary} size="small" /> : <Ionicons name="search" size={18} color={COLORS.textOnPrimary} />}
          </TouchableOpacity>
        </View>

        {searchError && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
            <Text style={styles.errorText}>{searchError}</Text>
          </View>
        )}

        {placeOptions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>¿Cuál de estos?</Text>
            {placeOptions.map((p, i) => (
              <TouchableOpacity key={i} style={styles.placeRow} onPress={() => pickPlace(p)}>
                <Ionicons name="location-outline" size={16} color={COLORS.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeText} numberOfLines={2}>{p.displayName}</Text>
                  {p.placeType && <Text style={styles.placeTypeText}>{p.placeType}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {place && mapRegion && (
        <View style={styles.mapWrap}>
          <MapView
            style={{ flex: 1 }}
            initialRegion={mapRegion}
            onRegionChangeComplete={(r: Region) => setLastPannedRegion(r)}
          >
            {discovered.map(c => (
              <CourseMarker
                key={c.osmId}
                c={c}
                color={pinColorFor(
                  existingNames.has(c.name.trim().toLowerCase()),
                  selected.has(c.osmId),
                  status[c.osmId] ?? 'idle',
                )}
                onPress={() => !existingNames.has(c.name.trim().toLowerCase()) && !importing && toggle(c.osmId)}
              />
            ))}
          </MapView>
          {discovering && (
            <View style={styles.mapOverlayCenter}><ActivityIndicator color={COLORS.primary} /></View>
          )}
          {!discovering && lastPannedRegion && (
            <TouchableOpacity style={styles.searchAreaBtn} onPress={searchThisArea}>
              <Ionicons name="refresh" size={14} color={COLORS.textOnPrimary} />
              <Text style={styles.searchAreaBtnTxt}>Buscar en esta zona</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.md, paddingTop: place ? SPACING.sm + 4 : 0, gap: SPACING.md }} keyboardShouldPersistTaps="handled">
        {place && !discovering && discoverError && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
            <Text style={styles.errorText}>{discoverError}</Text>
            {lastBbox && (
              <TouchableOpacity style={styles.retryBtn} onPress={retryDiscover} accessibilityRole="button" accessibilityLabel="Reintentar">
                <Ionicons name="refresh" size={14} color={COLORS.textOnPrimary} />
                <Text style={styles.retryBtnTxt}>Reintentar</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {place && !discovering && discovered.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{discovered.length} campos encontrados en {place.displayName.split(',')[0]}</Text>
              {selectableCount > 0 && (
                <TouchableOpacity onPress={toggleAll}>
                  <Text style={styles.selectAllTxt}>{allSelectableChosen ? 'Ninguno' : 'Todos'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {discovered.map(c => {
              const already = existingNames.has(c.name.trim().toLowerCase());
              const isSelected = selected.has(c.osmId);
              const rowStatus = status[c.osmId] ?? 'idle';
              return (
                <TouchableOpacity
                  key={c.osmId}
                  style={[styles.courseRow, isSelected && styles.courseRowSelected, already && { opacity: 0.5 }]}
                  onPress={() => !already && !importing && toggle(c.osmId)}
                  disabled={already || importing}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.courseName}>{c.name}</Text>
                    <Text style={styles.courseMeta}>
                      {c.city ?? 'Ciudad desconocida'} · {c.holes ? `${c.holes} hoyos` : 'hoyos desconocidos'}
                    </Text>
                    {(rowStatus === 'error' || rowStatus === 'skipped') && statusReason[c.osmId] && (
                      <Text style={rowStatus === 'error' ? styles.errorReason : styles.skippedReason}>
                        {statusReason[c.osmId]}
                      </Text>
                    )}
                  </View>
                  {already ? (
                    <Text style={styles.alreadyTxt}>Ya la tienes</Text>
                  ) : rowStatus === 'importing' ? (
                    <ActivityIndicator size="small" color={COLORS.primary} />
                  ) : rowStatus === 'done' ? (
                    <Ionicons name="checkmark-circle" size={22} color={COLORS.success} />
                  ) : rowStatus === 'error' ? (
                    <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                  ) : rowStatus === 'skipped' ? (
                    <Ionicons name="warning" size={22} color={COLORS.warning} />
                  ) : (
                    <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={22} color={isSelected ? COLORS.primary : '#c0ccc0'} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {selected.size > 0 && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.importBtn, importing && { opacity: 0.6 }]}
            onPress={importSelected}
            disabled={importing}
          >
            {importing
              ? <ActivityIndicator color={COLORS.textOnPrimary} />
              : <Ionicons name="download-outline" size={18} color={COLORS.textOnPrimary} />
            }
            <Text style={styles.importBtnTxt}>
              {importing ? 'Importando…' : `Importar seleccionados (${selected.size})`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', paddingVertical: SPACING.lg },
  topSection: { padding: SPACING.md, gap: SPACING.sm + 4 },
  searchRow: { flexDirection: 'row', gap: SPACING.sm },
  searchInput: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm + 6,
    paddingVertical: SPACING.sm + 4, fontSize: 15, fontFamily: FONT.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e0e8e0',
  },
  searchBtn: { width: 46, borderRadius: RADIUS.md, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },

  mapWrap: { height: 260, marginHorizontal: SPACING.md, borderRadius: RADIUS.lg + 4, overflow: 'hidden' },
  mapOverlayCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,247,245,0.6)' },
  searchAreaBtn: {
    position: 'absolute', top: SPACING.sm, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: 20, paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.sm,
    shadowColor: COLORS.shadow, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  searchAreaBtnTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  bottomBar: { padding: SPACING.md, paddingTop: SPACING.sm + 2, backgroundColor: COLORS.bg, borderTopWidth: 1, borderTopColor: '#e9ecef' },

  section: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm, ...CARD_SHADOW },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACING.sm },
  sectionTitle: { fontSize: 14, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary, flex: 1 },
  selectAllTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.info },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  placeText: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary },
  placeTypeText: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 1 },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: '#fdecea',
    borderRadius: RADIUS.md, padding: SPACING.sm + 4, borderWidth: 1, borderColor: '#f5c6c0',
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: FONT.body, color: COLORS.danger },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.danger, borderRadius: 20, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2 },
  retryBtnTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  courseRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: '#f8faf8',
    borderRadius: RADIUS.md, padding: SPACING.sm + 4, borderWidth: 1, borderColor: '#e0e8e0',
  },
  courseRowSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  courseName: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  courseMeta: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 1 },
  errorReason: { fontSize: 11, fontFamily: FONT.body, color: COLORS.danger, marginTop: 2 },
  skippedReason: { fontSize: 11, fontFamily: FONT.body, color: COLORS.warning, marginTop: 2 },
  alreadyTxt: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textTertiary },

  importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md - 2 },
  importBtnTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
});
