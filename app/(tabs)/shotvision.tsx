import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ShotSession, ShotVisionShot } from '../../src/shotvision/types';
import { listSessions, listShots } from '../../src/shotvision/store';
import { summariseSession } from '../../src/shotvision/aggregate';
import { PuttSession, PuttShot, summarisePutts } from '../../src/shotvision/putting';
import { listPuttSessions, listPuttShots } from '../../src/shotvision/puttStore';
import { useConditions } from '../../src/shotvision/useConditions';
import { useSettings } from '../../src/shotvision/useSettings';
import { dist } from '../../src/shotvision/format';
import { SV } from '../../src/shotvision/ui';
import { FONT } from '../../src/theme';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const t = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Hoy · ${t}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Ayer · ${t}`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function ShotVisionDashboard() {
  const router = useRouter();
  const { cond } = useConditions();
  const { settings } = useSettings();
  const [sessions, setSessions] = useState<ShotSession[]>([]);
  const [shots, setShots] = useState<ShotVisionShot[]>([]);
  const [puttSessions, setPuttSessions] = useState<PuttSession[]>([]);
  const [puttShots, setPuttShots] = useState<PuttShot[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const [se, sh, pse, psh] = await Promise.all([
        listSessions(), listShots(), listPuttSessions(), listPuttShots(),
      ]);
      if (!alive) return;
      setSessions(se); setShots(sh); setPuttSessions(pse); setPuttShots(psh); setLoading(false);
    })();
    return () => { alive = false; };
  }, []));

  const lifetime = summariseSession(shots.filter(s => sessions.some(se => se.id === s.sessionId)));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>ShotVision</Text>
          <Text style={styles.subtitle}>Monitor de lanzamiento con la cámara</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/shotvision/settings')} hitSlop={8} style={styles.gear}>
          <Ionicons name="options-outline" size={22} color={SV.ink} />
        </TouchableOpacity>
      </View>

      {/* Mode cards */}
      <TouchableOpacity style={styles.modeCard} activeOpacity={0.85}
        onPress={() => router.push('/shotvision/practice/setup')}>
        <View style={styles.modeIcon}><Ionicons name="golf" size={22} color="#06210f" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.modeTitle}>Practicar ahora</Text>
          <Text style={styles.modeDesc}>Monitor de lanzamiento · seguimiento y feedback de tus golpes</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={SV.faint} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.modeCard} activeOpacity={0.85}
        onPress={() => router.push('/shotvision/putt/setup')}>
        <View style={[styles.modeIcon, { backgroundColor: SV.ink }]}>
          <Ionicons name="ellipse-outline" size={20} color={SV.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.modeTitle}>Putt</Text>
          <Text style={styles.modeDesc}>Cámara real · detecta la bola sola y mide cuánto rodó</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={SV.faint} />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.modeCard, styles.modeCardAlt]} activeOpacity={0.85}
        onPress={() => router.push('/shotvision/sim/setup')}>
        <View style={[styles.modeIcon, { backgroundColor: SV.accent }]}>
          <Ionicons name="tv-outline" size={20} color="#2a1000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.modeTitle}>Simulador de golf</Text>
          <Text style={styles.modeDesc}>Conecta con GSPro o E6 y juega rondas completas</Text>
        </View>
        <View style={styles.betaTag}><Text style={styles.betaTagTxt}>PRONTO</Text></View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.calRow} activeOpacity={0.7}
        onPress={() => router.push('/shotvision/calibrate')}>
        <Ionicons name="analytics-outline" size={16} color={SV.green} />
        <Text style={styles.calTxt}>Calibrar con un vídeo importado</Text>
        <Ionicons name="chevron-forward" size={14} color={SV.faint} />
      </TouchableOpacity>

      <View style={styles.betaPill}>
        <Ionicons name="flask-outline" size={12} color={SV.accent} />
        <Text style={styles.betaTxt}>Beta · números de demo hasta activar la cámara</Text>
      </View>

      {shots.length > 0 && (
        <View style={styles.statRow}>
          <Stat big={String(shots.length)} label="golpes" />
          <Stat big={String(sessions.length)} label={sessions.length === 1 ? 'sesión' : 'sesiones'} />
          <Stat big={dist(lifetime.longestCarryMeters, settings).split(' ')[0]} label={`mejor carry (${settings.distanceUnit})`} />
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 16 }} color={SV.green} />
      ) : sessions.length === 0 ? null : (
        <View style={{ gap: 10 }}>
          <Text style={styles.sectionLabel}>Sesiones guardadas</Text>
          {sessions.map(se => {
            const sShots = shots.filter(x => x.sessionId === se.id);
            const sum = summariseSession(sShots);
            const clubs = sum.byClub.map(c => c.club).slice(0, 5);
            return (
              <TouchableOpacity key={se.id} style={styles.card} activeOpacity={0.85}
                onPress={() => router.push(`/shotvision/session/${se.id}`)}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>{se.label || fmtDate(se.createdAt)}</Text>
                  <View style={styles.tagRow}>
                    {se.mode === 'sim' && <Tag t={se.sim?.platform === 'e6' ? 'E6' : 'GSPro'} />}
                    {se.venue && <Tag t={se.venue === 'indoor' ? 'Indoor' : 'Outdoor'} />}
                    <Ionicons name="chevron-forward" size={18} color={SV.faint} />
                  </View>
                </View>
                <View style={styles.cardStats}>
                  <Text style={styles.cardStat}>{sShots.length} golpe{sShots.length === 1 ? '' : 's'}</Text>
                  {sShots.length > 0 && (
                    <>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.cardStat}>{clubs.join(' ')}{sum.byClub.length > 5 ? '…' : ''}</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.cardStat}>best {dist(sum.longestCarryMeters, settings)}</Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {puttSessions.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={styles.sectionLabel}>Sesiones de putt</Text>
          {puttSessions.map(se => {
            const sShots = puttShots.filter(x => x.sessionId === se.id);
            const sum = summarisePutts(sShots);
            return (
              <TouchableOpacity key={se.id} style={styles.card} activeOpacity={0.85}
                onPress={() => router.push(`/shotvision/putt/summary/${se.id}`)}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>{se.label || fmtDate(se.createdAt)}</Text>
                  <Ionicons name="chevron-forward" size={18} color={SV.faint} />
                </View>
                <View style={styles.cardStats}>
                  <Text style={styles.cardStat}>{sShots.length} putt{sShots.length === 1 ? '' : 's'}</Text>
                  {sShots.length > 0 && (
                    <>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.cardStat}>media {dist(sum.avgDistanceM, settings)}</Text>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.cardStat}>consist. {sum.consistency}</Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Condiciones</Text>
        <Text style={styles.condTxt}>
          {cond
            ? `${cond.tempC.toFixed(0)}°C · ${cond.pressureHpa.toFixed(0)} hPa · ${cond.relHumidity.toFixed(0)}% HR  →  densidad ${cond.airDensity.toFixed(3)} kg/m³`
            : 'Atmósfera estándar (1.225 kg/m³) — activa la ubicación para las condiciones reales.'}
        </Text>
      </View>
    </ScrollView>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statBig}>{big}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function Tag({ t }: { t: string }) {
  return <View style={styles.tag}><Text style={styles.tagTxt}>{t}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 24, fontFamily: FONT.headingSemiBold, color: SV.ink },
  subtitle: { fontSize: 13, fontFamily: FONT.body, color: SV.sub, marginTop: 2 },
  gear: { padding: 4 },

  modeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SV.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: SV.line,
  },
  modeCardAlt: { opacity: 0.9 },
  modeIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: SV.green, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { fontSize: 16, fontFamily: FONT.headingSemiBold, color: SV.ink },
  modeDesc: { fontSize: 12, fontFamily: FONT.body, color: SV.sub, marginTop: 2, lineHeight: 16 },
  betaTag: { backgroundColor: SV.surfaceAlt, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  betaTagTxt: { fontSize: 9, fontFamily: FONT.bodySemiBold, color: SV.sub, letterSpacing: 0.5 },

  calRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SV.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: SV.line,
  },
  calTxt: { flex: 1, fontSize: 13, fontFamily: FONT.bodySemiBold, color: SV.ink },
  betaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: SV.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  betaTxt: { fontSize: 11, color: SV.sub, fontFamily: FONT.bodyMedium },

  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: SV.surface, borderRadius: 12, padding: 12, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: SV.line },
  statBig: { fontSize: 20, fontFamily: FONT.headingExtraBold, color: SV.green },
  statLabel: { fontSize: 10, color: SV.sub, fontFamily: FONT.bodyMedium, textTransform: 'uppercase' },

  sectionLabel: { fontSize: 11, fontFamily: FONT.bodySemiBold, color: SV.sub, textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: SV.surface, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: SV.line },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: SV.ink, flex: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardStats: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cardStat: { fontSize: 12, color: SV.sub, fontFamily: FONT.bodyMedium },
  dot: { color: SV.faint },
  tag: { backgroundColor: SV.surfaceAlt, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagTxt: { fontSize: 9, fontFamily: FONT.bodySemiBold, color: SV.sub },

  condTxt: { fontSize: 12, color: SV.sub, lineHeight: 18 },
});
