import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ShotSession, ShotVisionShot, MS_TO_MPH } from '../../../src/shotvision/types';
import { getSession, addShot, updateSession, listShots } from '../../../src/shotvision/store';
import { analyzeDemoShot, captureConfig } from '../../../src/shotvision/analyze';
import { useConditions } from '../../../src/shotvision/useConditions';
import { useSettings } from '../../../src/shotvision/useSettings';
import { SV, SV_CLUBS, CLUB_NAMES } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';
import { ShotResult } from '../shot/[id]';

type Phase = 'searching' | 'detected' | 'recording' | 'result';

export default function SimSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { env } = useConditions();
  const { settings } = useSettings();

  const [session, setSession] = useState<ShotSession | null | undefined>(undefined);
  const [club, setClub] = useState('7i');
  const [phase, setPhase] = useState<Phase>('searching');
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<ShotVisionShot | null>(null);
  const [align, setAlign] = useState(0);

  const scan = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const after = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  useFocusEffect(useCallback(() => {
    (async () => {
      const s = await getSession(id);
      setSession(s);
      setAlign(s?.sim?.alignmentOffsetDeg ?? 0);
      setCount((await listShots(id)).length);
    })();
    return clearTimers;
  }, [id]));

  useEffect(() => {
    clearTimers();
    if (phase === 'searching') {
      Animated.loop(Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(scan, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])).start();
      after(1400, () => setPhase('detected'));
    } else if (phase === 'detected') {
      scan.stopAnimation(); scan.setValue(0);
      if (settings.handsFree) after(settings.autoAdvanceSec * 1000, () => setPhase('recording'));
    } else if (phase === 'recording') {
      after(650, commit);
    } else if (phase === 'result') {
      if (settings.handsFree) after(Math.max(3, settings.autoAdvanceSec - 1) * 1000, () => setPhase('searching'));
    }
    return clearTimers;
  }, [phase, club, settings.handsFree, settings.autoAdvanceSec]);

  async function commit() {
    const res = analyzeDemoShot(club, env, captureConfig(settings));
    if (!res) { setPhase('searching'); return; }
    const saved = await addShot({ sessionId: id, club, measure: res.measure, flight: res.flight });
    setLast(saved);
    setCount(c => c + 1);
    setPhase('result');
  }

  function calibrateFromLast() {
    if (!session?.sim || last?.measure.launchDirectionDeg == null) return;
    const off = +(-last.measure.launchDirectionDeg).toFixed(1);
    setAlign(off);
    updateSession(id, { sim: { ...session.sim, alignmentOffsetDeg: off } });
  }

  if (session === undefined) return <View style={styles.center}><ActivityIndicator color={SV.green} /></View>;
  if (session === null || !session.sim) return <View style={styles.center}><Text style={styles.dim}>Sesión no encontrada.</Text></View>;

  const plat = session.sim.platform === 'e6' ? 'E6' : 'GSPro';

  const payload = last ? {
    ballMph: (last.measure.ballSpeedMs * MS_TO_MPH).toFixed(1),
    vla: last.measure.launchAngleDeg.toFixed(1),
    hla: ((last.measure.launchDirectionDeg ?? 0) + align).toFixed(1),
    spin: last.measure.backspinRpm != null ? Math.round(Math.hypot(last.measure.backspinRpm, last.measure.sidespinRpm ?? 0)) : null,
    axis: last.measure.sidespinRpm != null ? ((Math.atan2(last.measure.sidespinRpm, last.measure.backspinRpm ?? 1) * 180 / Math.PI)).toFixed(1) : null,
  } : null;

  return (
    <>
      <Stack.Screen options={{
        title: `Simulador · ${plat}`, headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
        headerBackVisible: false,
        headerRight: () => (
          <TouchableOpacity onPress={() => router.replace('/shotvision')} hitSlop={8}>
            <Text style={styles.doneTxt}>Salir</Text>
          </TouchableOpacity>
        ),
      }} />
      <View style={styles.container}>

        {/* connection bar */}
        <View style={styles.connBar}>
          <View style={[styles.connDot, { backgroundColor: SV.accent }]} />
          <Text style={styles.connTxt}>{plat} · {session.sim.host}:{session.sim.port} · simulado</Text>
          <Text style={styles.alignTxt}>alin. {align > 0 ? '+' : ''}{align.toFixed(1)}°</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, padding: 12 }} style={styles.clubStrip}>
          {SV_CLUBS.map(c => (
            <TouchableOpacity key={c} style={[styles.chip, club === c && styles.chipOn]} onPress={() => setClub(c)}>
              <Text style={[styles.chipTxt, club === c && styles.chipTxtOn]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {phase === 'result' && last && payload ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}>
            <Text style={styles.shotCount}>Golpe {count} · {CLUB_NAMES[club] ?? club}</Text>

            <View style={styles.sendCard}>
              <View style={styles.sendHead}>
                <Ionicons name="paper-plane" size={14} color={SV.green} />
                <Text style={styles.sendTitle}>Enviado a {plat}</Text>
              </View>
              <View style={styles.sendGrid}>
                <Send k="Ball" v={`${payload.ballMph} mph`} />
                <Send k="VLA" v={`${payload.vla}°`} />
                <Send k="HLA" v={`${payload.hla}°`} />
                <Send k="Spin" v={payload.spin != null ? `${payload.spin} rpm` : '—'} />
                <Send k="Axis" v={payload.axis != null ? `${payload.axis}°` : '—'} />
              </View>
              <TouchableOpacity style={styles.calBtn} onPress={calibrateFromLast}>
                <Ionicons name="compass-outline" size={14} color={SV.green} />
                <Text style={styles.calTxt}>Calibrar alineación con este golpe (asumir recto)</Text>
              </TouchableOpacity>
            </View>

            <ShotResult shot={last} />
          </ScrollView>
        ) : (
          <View style={styles.stage}>
            <View style={styles.vf}>
              <View style={styles.placeholder} pointerEvents="none">
                <Ionicons name="videocam-off-outline" size={22} color={SV.faint} />
                <Text style={styles.placeholderTxt}>Vista de cámara · modo demo</Text>
              </View>
              <Animated.View style={[
                styles.ballBox,
                settings.ballCorner === 'bottomRight' ? { right: 16, bottom: 16 } : { left: 16, bottom: 16 },
                phase === 'searching' && { borderColor: SV.faint, borderStyle: 'dashed', opacity: scan.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                phase === 'detected' && { borderColor: SV.green, backgroundColor: 'rgba(55,214,122,0.14)' },
                phase === 'recording' && { borderColor: SV.accent },
              ]}>
                <View style={styles.crossH} /><View style={styles.crossV} />
              </Animated.View>
            </View>
            <View style={styles.statusWrap}>
              <View style={[styles.dot, { backgroundColor: phase === 'detected' ? SV.green : phase === 'recording' ? SV.accent : SV.faint }]} />
              <Text style={styles.status}>
                {phase === 'searching' && 'Esperando bola…'}
                {phase === 'detected' && 'Bola detectada · listo'}
                {phase === 'recording' && 'Grabando…'}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.bottom}>
          {phase === 'detected' && !settings.handsFree && (
            <TouchableOpacity style={styles.btn} onPress={() => setPhase('recording')}>
              <Text style={styles.btnTxt}>Registrar golpe</Text>
            </TouchableOpacity>
          )}
          {phase === 'result' && (
            <TouchableOpacity style={styles.btn} onPress={() => setPhase('searching')}>
              <Text style={styles.btnTxt}>Siguiente golpe</Text>
              <Ionicons name="arrow-forward" size={18} color="#06210f" />
            </TouchableOpacity>
          )}
          {(phase === 'searching' || phase === 'recording') && (
            <View style={styles.hintRow}>
              <ActivityIndicator color={SV.sub} size="small" />
              <Text style={styles.hint}>{settings.handsFree ? 'Manos libres' : 'Preparando…'}</Text>
            </View>
          )}
        </View>
      </View>
    </>
  );
}

function Send({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.send}>
      <Text style={styles.sendK}>{k}</Text>
      <Text style={styles.sendV}>{v}</Text>
    </View>
  );
}

const BOX = 74;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SV.bg },
  dim: { color: SV.sub, fontSize: 13 },
  doneTxt: { color: SV.accent, fontFamily: FONT.headingSemiBold, fontSize: 14 },

  connBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: SV.surfaceAlt },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connTxt: { flex: 1, fontSize: 11, color: SV.sub, fontFamily: FONT.bodyMedium },
  alignTxt: { fontSize: 11, color: SV.green, fontFamily: FONT.headingSemiBold },

  clubStrip: { flexGrow: 0, backgroundColor: SV.surface, borderBottomWidth: 1, borderColor: SV.line },
  chip: { minWidth: 42, height: 42, paddingHorizontal: 8, borderRadius: 10, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: SV.green },
  chipTxt: { fontSize: 13, fontFamily: FONT.headingSemiBold, color: SV.sub },
  chipTxtOn: { color: '#06210f' },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, padding: 16 },
  vf: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: '#0d1a26', borderWidth: 1, borderColor: SV.line, overflow: 'hidden' },
  placeholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 6 },
  placeholderTxt: { color: SV.faint, fontSize: 11, fontFamily: FONT.bodyMedium },
  ballBox: { position: 'absolute', width: BOX, height: BOX, borderRadius: 10, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 22, height: 1.5, backgroundColor: SV.sub },
  crossV: { position: 'absolute', width: 1.5, height: 22, backgroundColor: SV.sub },

  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  status: { color: SV.ink, fontSize: 15, fontFamily: FONT.bodySemiBold },

  shotCount: { color: SV.sub, fontSize: 12, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 },

  sendCard: { backgroundColor: SV.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: SV.green },
  sendHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sendTitle: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.ink },
  sendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  send: { backgroundColor: SV.surfaceAlt, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, minWidth: 74 },
  sendK: { fontSize: 9, fontFamily: FONT.headingSemiBold, color: SV.sub },
  sendV: { fontSize: 15, fontFamily: FONT.headingExtraBold, color: SV.ink },
  calBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderColor: SV.line, paddingTop: 8 },
  calTxt: { flex: 1, fontSize: 11, fontFamily: FONT.bodySemiBold, color: SV.green },

  bottom: { padding: 16, gap: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15 },
  btnTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  hint: { color: SV.sub, fontSize: 12 },
});
