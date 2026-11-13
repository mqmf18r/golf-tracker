import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal, Clipboard, ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getCourses, deleteCourse, getHoles, mergeCourses } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import {
  uploadCourse, downloadByCode, downloadById,
  listPublicCourses, formatCode, SearchResult,
} from '../../src/services/cloudCourses';
import { Course } from '../../src/types';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';
import { ALL_COUNTRIES } from '../../src/data/worldMap';

const FLAG_BY_CCA2 = new Map(ALL_COUNTRIES.map(c => [c.cca2, c.flag]));

export default function CoursesScreen() {
  const router = useRouter();
  const { isDeveloper } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudTab, setCloudTab] = useState<'upload' | 'code' | 'search'>('upload');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [uploadedCode, setUploadedCode] = useState<string | null>(null);
  const [downloadCode, setDownloadCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [publicCourses, setPublicCourses] = useState<SearchResult[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Merge state ─────────────────────────────────────────────────────────────
  const [mergeA,    setMergeA]    = useState<Course | null>(null); // goes first (holes 1-N)
  const [mergeB,    setMergeB]    = useState<Course | null>(null); // goes second (holes N+1-end)
  const [showMerge, setShowMerge] = useState(false);
  const [mergeName, setMergeName] = useState('');
  const [pickingSlot, setPickingSlot] = useState<'A' | 'B' | null>(null);

  const [holesA, setHolesA] = useState<import('../../src/types').Hole[]>([]);
  const [holesB, setHolesB] = useState<import('../../src/types').Hole[]>([]);
  const [holeCounts, setHoleCounts] = useState<Record<string, { count: number; par: number }>>({});

  useEffect(() => { mergeA ? getHoles(mergeA.id).then(setHolesA) : setHolesA([]); }, [mergeA?.id]);
  useEffect(() => { mergeB ? getHoles(mergeB.id).then(setHolesB) : setHolesB([]); }, [mergeB?.id]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    (async () => {
      const c = await getCourses();
      if (!mounted) return;
      setCourses(c);
      const counts: Record<string, { count: number; par: number }> = {};
      await Promise.all(c.map(async course => {
        const h = await getHoles(course.id);
        counts[course.id] = { count: h.length, par: h.reduce((a, x) => a + x.par, 0) };
      }));
      if (mounted) setHoleCounts(counts);
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, []));

  useEffect(() => {
    if (cloudTab !== 'search' || !showCloud) return;
    let mounted = true;
    setLoadingPublic(true);
    listPublicCourses().then(list => { if (mounted) setPublicCourses(list); })
      .catch(() => { if (mounted) setPublicCourses([]); })
      .finally(() => { if (mounted) setLoadingPublic(false); });
    return () => { mounted = false; };
  }, [cloudTab, showCloud]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  function handleLongPress(course: Course) {
    Alert.alert(course.name, '¿Qué quieres hacer?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Fusionar con otro campo…',
        onPress: () => {
          setMergeA(course);
          setMergeB(null);
          setMergeName(course.name);
          setPickingSlot(null);
          setShowMerge(true);
        },
      },
      {
        text: 'Eliminar', style: 'destructive', onPress: () => {
          Alert.alert(`Eliminar "${course.name}"`, 'Se eliminarán también todos sus datos.', [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Eliminar', style: 'destructive', onPress: async () => {
                await deleteCourse(course.id);
                setCourses(c => c.filter(x => x.id !== course.id));
              },
            },
          ]);
        },
      },
    ]);
  }

  function swapMerge() {
    const tmp = mergeA;
    setMergeA(mergeB);
    setMergeB(tmp);
    if (mergeB) setMergeName(mergeB.name + (mergeA ? ' + ' + mergeA.name : ''));
  }

  async function executeMerge() {
    if (!mergeA || !mergeB) return;
    const name = mergeName.trim() || `${mergeA.name} + ${mergeB.name}`;
    await mergeCourses(mergeA.id, mergeB.id, name);
    setCourses(await getCourses());
    setShowMerge(false);
    Alert.alert(
      '¡Listo!',
      `"${name}" ahora tiene ${holesA.length + holesB.length} hoyos.\n"${mergeB.name}" sigue sin cambios.`,
    );
  }

  function openCloud() {
    setCloudTab(isDeveloper ? 'upload' : 'search');
    setUploadedCode(null);
    setDownloadCode('');
    setSearchQuery('');
    if (!selectedCourseId && courses.length === 1) setSelectedCourseId(courses[0].id);
    setShowCloud(true);
  }

  async function handleUpload() {
    if (!selectedCourseId) return;
    setBusy(true);
    try {
      const raw = await uploadCourse(selectedCourseId);
      setUploadedCode(raw);
    } catch (err) {
      Alert.alert('Error al subir', String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadCode() {
    if (!downloadCode.trim()) return;
    setBusy(true);
    try {
      const n = await downloadByCode(downloadCode);
      setCourses(await getCourses());
      setDownloadCode('');
      Alert.alert('¡Descargado!', `${n} hoyos importados correctamente.`);
    } catch (err) {
      Alert.alert('Error', String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadResult(result: SearchResult) {
    Alert.alert(
      `Descargar "${result.name}"`,
      `${result.city ? result.city + ' · ' : ''}${result.holes_count} hoyos\n\n¿Importar este campo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descargar', onPress: async () => {
            setBusy(true);
            try {
              const n = await downloadById(result.id);
              setCourses(await getCourses());
              setShowCloud(false);
              Alert.alert('¡Descargado!', `${n} hoyos importados correctamente.`);
            } catch (err) {
              Alert.alert('Error', String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={courses}
        keyExtractor={(c) => c.id}
        contentContainerStyle={courses.length === 0 ? styles.empty : { padding: SPACING.md, gap: SPACING.sm, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={styles.emptyContent}>
            <Ionicons name="flag-outline" size={60} color={COLORS.emptyIcon} />
            <Text style={styles.emptyText}>Sin campos</Text>
            <Text style={styles.emptyHint}>Pulsa + para añadir tu primer campo</Text>
          </View>
        }
        renderItem={({ item }) => {
          const { count: holeCount, par } = holeCounts[item.id] ?? { count: 0, par: 0 };
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/courses/${item.id}`)}
              onLongPress={isDeveloper ? () => handleLongPress(item) : undefined}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.courseName}>{item.name}</Text>
                <Text style={styles.parBadge}>Par {par || '—'}</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.city}>
                  {item.country && FLAG_BY_CCA2.get(item.country) ? `${FLAG_BY_CCA2.get(item.country)} ` : ''}
                  {item.city || 'Sin ciudad'}
                </Text>
                <Text style={styles.holesText}>{holeCount} hoyos</Text>
              </View>
              <View style={styles.ratingRow}>
                <Text style={styles.rating}>CR {item.courseRating.toFixed(1)}</Text>
                <Text style={styles.ratingDot}> · </Text>
                <Text style={styles.rating}>Slope {item.slopeRating}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* World map button */}
      <TouchableOpacity style={styles.worldBtn} onPress={() => router.push('/courses/world')}>
        <Ionicons name="earth-outline" size={22} color={COLORS.textOnPrimary} />
      </TouchableOpacity>

      {/* Cloud sharing button */}
      <TouchableOpacity style={styles.backupBtn} onPress={openCloud}>
        <Ionicons name="cloud-outline" size={22} color={COLORS.textOnPrimary} />
      </TouchableOpacity>

      {isDeveloper && (
        <TouchableOpacity style={styles.osmBtn} onPress={() => router.push('/courses/import-osm')}>
          <Ionicons name="download-outline" size={20} color={COLORS.textOnPrimary} />
        </TouchableOpacity>
      )}

      {isDeveloper && (
        <TouchableOpacity style={styles.fab} onPress={() => router.push('/courses/add')}>
          <Ionicons name="add" size={30} color={COLORS.textOnPrimary} />
        </TouchableOpacity>
      )}

      {/* Merge modal */}
      <Modal visible={showMerge} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowMerge(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Fusionar campos</Text>
            <TouchableOpacity onPress={() => setShowMerge(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md + 2 }}>
            <Text style={styles.sectionDesc}>
              Elige qué campo va primero (hoyos 1-N) y cuál va segundo (continúa la numeración). Usa el botón central para intercambiarlos.
            </Text>

            {/* Two slot row */}
            <View style={styles.mergeSlotsRow}>
              {/* Slot A */}
              <TouchableOpacity
                style={[styles.mergeSlotBox, mergeA && styles.mergeSlotBoxFilled]}
                onPress={() => setPickingSlot(pickingSlot === 'A' ? null : 'A')}
              >
                <Text style={styles.mergeSlotBoxLabel}>PRIMERO{'\n'}hoyos 1–{holesA.length || '?'}</Text>
                {mergeA ? (
                  <>
                    <Text style={styles.mergeSlotBoxName} numberOfLines={2}>{mergeA.name}</Text>
                    <Text style={styles.mergeSlotBoxMeta}>{holesA.length} hoyos</Text>
                  </>
                ) : (
                  <Text style={styles.mergeSlotBoxEmpty}>Tap para elegir</Text>
                )}
                <Ionicons name="chevron-down" size={14} color={mergeA ? COLORS.primaryMuted : COLORS.textTertiary} style={{ marginTop: 4 }} />
              </TouchableOpacity>

              {/* Swap button */}
              <TouchableOpacity style={styles.swapBtn} onPress={swapMerge} accessibilityRole="button" accessibilityLabel="Intercambiar">
                <Ionicons name="swap-vertical" size={20} color={COLORS.textPrimary} />
              </TouchableOpacity>

              {/* Slot B */}
              <TouchableOpacity
                style={[styles.mergeSlotBox, mergeB && styles.mergeSlotBoxFilled]}
                onPress={() => setPickingSlot(pickingSlot === 'B' ? null : 'B')}
              >
                <Text style={styles.mergeSlotBoxLabel}>SEGUNDO{'\n'}hoyos {holesA.length + 1}–{mergeB ? holesA.length + holesB.length : '?'}</Text>
                {mergeB ? (
                  <>
                    <Text style={styles.mergeSlotBoxName} numberOfLines={2}>{mergeB.name}</Text>
                    <Text style={styles.mergeSlotBoxMeta}>{holesB.length} hoyos</Text>
                  </>
                ) : (
                  <Text style={styles.mergeSlotBoxEmpty}>Tap para elegir</Text>
                )}
                <Ionicons name="chevron-down" size={14} color={mergeB ? COLORS.primaryMuted : COLORS.textTertiary} style={{ marginTop: 4 }} />
              </TouchableOpacity>
            </View>

            {/* Course picker dropdown */}
            {pickingSlot && (
              <View style={styles.mergeDropdown}>
                <Text style={styles.mergeSlotLabel}>
                  Eligiendo para {pickingSlot === 'A' ? 'PRIMERO' : 'SEGUNDO'}
                </Text>
                {courses.map(c => {
                  const hh = holeCounts[c.id]?.count ?? 0;
                  const isOtherSlot = (pickingSlot === 'A' ? mergeB : mergeA)?.id === c.id;
                  const isCurrent   = (pickingSlot === 'A' ? mergeA : mergeB)?.id === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.coursePickerBtn, isCurrent && styles.coursePickerBtnActive, { marginBottom: 6, opacity: isOtherSlot ? 0.4 : 1 }]}
                      disabled={isOtherSlot}
                      onPress={() => {
                        if (pickingSlot === 'A') {
                          setMergeA(c);
                          if (!mergeName || mergeName === mergeA?.name) setMergeName(c.name);
                        } else {
                          setMergeB(c);
                        }
                        setPickingSlot(null);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.coursePickerName, isCurrent && { color: COLORS.textOnPrimary }]}>{c.name}</Text>
                        <Text style={[styles.coursePickerMeta, isCurrent && { color: 'rgba(255,255,255,0.7)' }]}>
                          {hh} hoyos
                        </Text>
                      </View>
                      {isCurrent && <Ionicons name="checkmark-circle" size={20} color={COLORS.textOnPrimary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Name + confirm */}
            {mergeA && mergeB && (
              <>
                <View style={styles.mergeSlot}>
                  <Text style={styles.mergeSlotLabel}>NOMBRE DEL CAMPO RESULTANTE</Text>
                  <TextInput
                    style={styles.codeInput}
                    value={mergeName}
                    onChangeText={setMergeName}
                    placeholder={`${mergeA.name} + ${mergeB.name}`}
                    placeholderTextColor={COLORS.textTertiary}
                    autoCorrect={false}
                  />
                </View>

                <TouchableOpacity style={styles.actionBtn} onPress={executeMerge}>
                  <Ionicons name="git-merge-outline" size={18} color={COLORS.textOnPrimary} />
                  <Text style={styles.actionBtnTxt}>
                    Fusionar en {holesA.length + holesB.length} hoyos
                  </Text>
                </TouchableOpacity>
                <Text style={styles.sectionDesc}>
                  "{mergeB.name}" desaparecerá. Las rondas jugadas siguen vinculadas correctamente.
                </Text>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Cloud sharing modal */}
      <Modal visible={showCloud} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCloud(false)}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Campos en la nube</Text>
            <TouchableOpacity onPress={() => setShowCloud(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Tab bar */}
          <View style={styles.tabBar}>
            {([
              { id: 'search', label: 'Explorar', icon: 'compass-outline'      },
              { id: 'upload', label: 'Subir',     icon: 'cloud-upload-outline' },
              { id: 'code',   label: 'Código',    icon: 'key-outline'          },
            ] as const).filter(t => isDeveloper || t.id !== 'upload').map(t => (
              <TouchableOpacity
                key={t.id}
                style={[styles.tabBtn, cloudTab === t.id && styles.tabBtnActive]}
                onPress={() => setCloudTab(t.id)}
              >
                <Ionicons name={t.icon} size={16} color={cloudTab === t.id ? COLORS.textOnPrimary : COLORS.textSecondary} />
                <Text style={[styles.tabTxt, cloudTab === t.id && styles.tabTxtActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>

            {/* ── SUBIR TAB ── */}
            {cloudTab === 'upload' && (
              <>
                <Text style={styles.sectionDesc}>
                  Elige un campo local para subirlo. Recibirás un código de 8 caracteres para compartir con otros.
                </Text>

                {/* Course picker */}
                <View style={{ gap: 8 }}>
                  {courses.map(c => {
                    const hh = holeCounts[c.id] ?? { count: 0, par: 0 };
                    const isSelected = selectedCourseId === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.coursePickerBtn, isSelected && styles.coursePickerBtnActive]}
                        onPress={() => { setSelectedCourseId(c.id); setUploadedCode(null); }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.coursePickerName, isSelected && { color: COLORS.textOnPrimary }]}>{c.name}</Text>
                          <Text style={[styles.coursePickerMeta, isSelected && { color: 'rgba(255,255,255,0.7)' }]}>
                            {c.city || 'Sin ciudad'} · {hh.count} hoyos
                          </Text>
                        </View>
                        {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.textOnPrimary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Result code */}
                {uploadedCode && (
                  <View style={styles.codeBox}>
                    <Text style={styles.codeLabel}>Código del campo</Text>
                    <Text style={styles.codeText}>{formatCode(uploadedCode)}</Text>
                    <TouchableOpacity
                      style={styles.copyBtn}
                      onPress={() => {
                        Clipboard.setString(formatCode(uploadedCode));
                        Alert.alert('Copiado', 'Código copiado al portapapeles.');
                      }}
                    >
                      <Ionicons name="copy-outline" size={16} color={COLORS.info} />
                      <Text style={styles.copyTxt}>Copiar código</Text>
                    </TouchableOpacity>
                    <Text style={styles.codeNote}>Comparte este código para que otros puedan descargar el campo.</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.actionBtn, (!selectedCourseId || busy) && { opacity: 0.4 }]}
                  onPress={handleUpload}
                  disabled={!selectedCourseId || busy}
                >
                  {busy ? <ActivityIndicator color={COLORS.textOnPrimary} /> : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={18} color={COLORS.textOnPrimary} />
                      <Text style={styles.actionBtnTxt}>Subir campo</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* ── CÓDIGO TAB ── */}
            {cloudTab === 'code' && (
              <>
                <Text style={styles.sectionDesc}>
                  Introduce el código de 8 caracteres que alguien compartió contigo para descargar su campo.
                </Text>
                <TextInput
                  style={styles.codeInput}
                  placeholder="Ej: A3F8-C201"
                  placeholderTextColor={COLORS.textTertiary}
                  value={downloadCode}
                  onChangeText={t => setDownloadCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={9}
                />
                <TouchableOpacity
                  style={[styles.actionBtn, styles.downloadBtn, (!downloadCode.trim() || busy) && { opacity: 0.4 }]}
                  onPress={handleDownloadCode}
                  disabled={!downloadCode.trim() || busy}
                >
                  {busy ? <ActivityIndicator color={COLORS.textOnPrimary} /> : (
                    <>
                      <Ionicons name="cloud-download-outline" size={18} color={COLORS.textOnPrimary} />
                      <Text style={styles.actionBtnTxt}>Descargar campo</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* ── EXPLORAR TAB ── */}
            {cloudTab === 'search' && (() => {
              const haveNames = new Set(courses.map(c => c.name.trim().toLowerCase()));
              const q = searchQuery.trim().toLowerCase();
              const filtered = q.length > 0
                ? publicCourses.filter(r => r.name.toLowerCase().includes(q))
                : publicCourses;
              return (
                <>
                  <Text style={styles.sectionDesc}>
                    Campos que ya están en el servidor — tócalo para añadirlo a los tuyos, sin códigos.
                  </Text>
                  <TextInput
                    style={styles.codeInput}
                    placeholder="Filtrar por nombre..."
                    placeholderTextColor={COLORS.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCorrect={false}
                  />
                  {loadingPublic && <ActivityIndicator color={COLORS.primary} style={{ alignSelf: 'center' }} />}
                  {!loadingPublic && filtered.length > 0 && (
                    <View style={{ gap: 8 }}>
                      {filtered.map(r => {
                        const already = haveNames.has(r.name.trim().toLowerCase());
                        return (
                          <TouchableOpacity
                            key={r.id}
                            style={[styles.searchResult, already && { opacity: 0.5 }]}
                            onPress={() => !already && handleDownloadResult(r)}
                            disabled={already}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.searchResultName}>{r.name}</Text>
                              <Text style={styles.searchResultMeta}>
                                {r.city || 'Sin ciudad'} · {r.holes_count} hoyos
                              </Text>
                            </View>
                            {already ? (
                              <Text style={styles.alreadyHaveTxt}>Ya la tienes</Text>
                            ) : (
                              <Ionicons name="add-circle-outline" size={22} color={COLORS.info} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  {!loadingPublic && filtered.length === 0 && (
                    <View style={styles.noResults}>
                      <Ionicons name="search-outline" size={40} color={COLORS.emptyIcon} />
                      <Text style={styles.noResultsText}>
                        {publicCourses.length === 0 ? 'Aún no hay campos compartidos en el servidor.' : 'Ningún campo coincide con ese nombre.'}
                      </Text>
                    </View>
                  )}
                </>
              );
            })()}

          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1 },
  emptyContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyText: { fontSize: 18, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary, marginTop: SPACING.md },
  emptyHint: { fontSize: 14, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: SPACING.sm },
  card: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, ...CARD_SHADOW },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  courseName: { fontSize: 17, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  parBadge: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.primary, backgroundColor: COLORS.primaryTint, paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.md },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs + 2 },
  city: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary },
  holesText: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary },
  ratingRow: { flexDirection: 'row', marginTop: SPACING.xs },
  rating: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textTertiary },
  ratingDot: { color: COLORS.textTertiary },
  fab: { position: 'absolute', right: SPACING.lg - 4, bottom: 28, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  backupBtn: { position: 'absolute', right: SPACING.lg - 4, bottom: 96, width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.info, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.2, shadowRadius: 6, elevation: 5 },
  worldBtn: { position: 'absolute', right: SPACING.lg - 4, bottom: 156, width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.2, shadowRadius: 6, elevation: 5 },
  osmBtn: { position: 'absolute', right: SPACING.lg - 4, bottom: 216, width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.warning, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.shadow, shadowOpacity: 0.2, shadowRadius: 6, elevation: 5 },

  modal:       { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, paddingBottom: 0 },
  modalTitle:  { fontSize: 20, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },

  tabBar:        { flexDirection: 'row', gap: SPACING.xs + 2, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  tabBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: SPACING.sm + 1, borderRadius: RADIUS.md, backgroundColor: '#e9ecef' },
  tabBtnActive:  { backgroundColor: COLORS.primary },
  tabTxt:        { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  tabTxtActive:  { color: COLORS.textOnPrimary },

  sectionDesc: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textSecondary, lineHeight: 19 },

  coursePickerBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 2, borderColor: '#e9ecef',
    ...CARD_SHADOW,
  },
  coursePickerBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  coursePickerName: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  coursePickerMeta: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },

  codeBox:   { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.xs + 2 },
  codeLabel: { fontSize: 11, color: COLORS.primaryMuted, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.4 },
  codeText:  { fontSize: 28, fontFamily: FONT.headingExtraBold, color: COLORS.textOnPrimary, letterSpacing: 4 },
  codeNote:  { fontSize: 11, fontFamily: FONT.body, color: COLORS.primaryMuted, marginTop: SPACING.xs },
  copyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2 },
  copyTxt:   { fontSize: 13, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  actionBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md - 2 },
  downloadBtn:   { backgroundColor: COLORS.info },
  actionBtnTxt:  { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },

  codeInput: { backgroundColor: COLORS.card, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md - 2, fontSize: 18, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e9ecef', letterSpacing: 2 },

  searchResult: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.sm + 4,
    ...CARD_SHADOW,
  },
  searchResultName: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  searchResultMeta: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.xs },
  alreadyHaveTxt: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: COLORS.textTertiary },
  noResults: { alignItems: 'center', gap: SPACING.sm, paddingTop: 30 },
  noResultsText: { textAlign: 'center', color: COLORS.textSecondary, fontFamily: FONT.body, fontSize: 14 },

  mergeSlot:      { gap: SPACING.sm },
  mergeSlotLabel: { fontSize: 11, fontFamily: FONT.headingSemiBold, color: COLORS.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },

  mergeSlotsRow:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2 },
  mergeSlotBox: {
    flex: 1, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: '#e9ecef',
    backgroundColor: '#f8f9fa', padding: SPACING.sm, gap: 3, alignItems: 'center',
  },
  mergeSlotBoxFilled: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  mergeSlotBoxLabel:  { fontSize: 10, fontFamily: FONT.headingSemiBold, color: COLORS.textTertiary, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 },
  mergeSlotBoxName:   { fontSize: 14, fontFamily: FONT.headingSemiBold, color: COLORS.textOnPrimary, textAlign: 'center' },
  mergeSlotBoxMeta:   { fontSize: 11, fontFamily: FONT.body, color: COLORS.primaryMuted, textAlign: 'center' },
  mergeSlotBoxEmpty:  { fontSize: 13, fontFamily: FONT.body, color: COLORS.textTertiary, textAlign: 'center', marginVertical: SPACING.xs },
  swapBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e9ecef', alignItems: 'center', justifyContent: 'center' },
  mergeDropdown: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.sm + 2, gap: SPACING.xs + 2, borderWidth: 1, borderColor: '#e9ecef' },
});
