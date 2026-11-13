import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path as SvgPath } from 'react-native-svg';

import { ShotSession, ShotVisionShot } from '../../../src/shotvision/types';
import { getSession, addShot, updateSession, deleteSession, listShots } from '../../../src/shotvision/store';
import { analyzeDemoShot, captureConfig } from '../../../src/shotvision/analyze';
import { useConditions } from '../../../src/shotvision/useConditions';
import { useSettings } from '../../../src/shotvision/useSettings';
import { SV, SV_CLUBS, CLUB_NAMES } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';
import { ShotResult } from '../shot/[id]';

type Phase = 'searching' | 'detected' | 'recording' | 'result';

// Phase 5: the camera feed replaces the timers. `searching→detected` = ball
// found & stable in the corner box; `detected→recording` = launch spike;
// `torchSignal` toggles the real camera LED instead of the screen flash.

export default function PracticeCapture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { env } = useConditions();
  const { settings } = useSettings();

  const [session, setSession] = useState<ShotSession | null | undefined>(undefined);
  const [club, setClub] = useState('7i');
  const [phase, setPhase] = useState<Phase>('searching');
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<ShotVisionShot | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const flash = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const lock = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const after = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  const rightSide = settings.ballCorner === 'bottomRight';

  useFocusEffect(useCallback(() => {
    (async () => {
      const s = await getSession(id);
      setSession(s);
      const existing = await listShots(id);
      setCount(existing.length);
    })();
    return clearTimers;
  }, [id]));

  useEffect(() => {
    clearTimers();
    setCountdown(null);
    if (phase === 'searching') {
      Animated.loop(Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(scan, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])).start();
      after(1400, () => setPhase('detected'));
    } else if (phase === 'detected') {
      scan.stopAnimation(); scan.setValue(0);
      Animated.spring(lock, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
      if (settings.torchSignal) {
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 110, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 280, useNativeDriver: true }),
        ]).start();
      }
      if (settings.handsFree) {
        let n = settings.autoAdvanceSec;
        setCountdown(n);
        const tick = () => {
          n -= 1;
          if (n <= 0) { setCountdown(null); setPhase('recording'); }
          else { setCountdown(n); after(1000, tick); }
        };
        after(1000, tick);
      }
    } else if (phase === 'recording') {
      lock.setValue(0);
      after(650, commit);
    } else if (phase === 'result') {
      if (settings.handsFree) after(Math.max(3, settings.autoAdvanceSec - 1) * 1000, () => setPhase('searching'));
    }
    return clearTimers;
  }, [phase, club, settings.handsFree, settings.autoAdvanceSec, settings.torchSignal]);

  async function commit() {
    const res = analyzeDemoShot(club, env, captureConfig(settings));
    if (!res) { setPhase('searching'); return; }
    const saved = await addShot({ sessionId: id, club, measure: res.measure, flight: res.flight });
    setLast(saved);
    setCount(c => c + 1);
    setPhase('result');
  }

  function exit() {
    clearTimers();
    if (count === 0) { deleteSession(id).then(() => router.replace('/shotvision')); return; }
    Alert.alert('Salir', `¿Guardar esta sesión? (${count} golpe${count === 1 ? '' : 's'})`, [
      { text: 'Descartar', style: 'destructive', onPress: async () => { await deleteSession(id); router.replace('/shotvision'); } },
      { text: 'Guardar', onPress: async () => { await updateSession(id, { saved: true }); router.replace(`/shotvision/summary/${id}`); } },
    ]);
  }

  if (session === undefined) return <View style={styles.center}><ActivityIndicator color={SV.green} /></View>;
  if (session === null) return <View style={styles.center}><Text style={styles.dim}>Sesión no encontrada.</Text></View>;

  return (
    <>
      <Stack.Screen options={{
        title: 'Practicar', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
        headerBackVisible: false,
        headerRight: () => (
          <TouchableOpacity onPress={exit} hitSlop={8}>
            <Text style={styles.doneTxt}>Salir</Text>
          </TouchableOpacity>
        ),
      }} />
      <View style={styles.container}>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, padding: 12 }} style={styles.clubStrip}>
          {SV_CLUBS.map(c => (
            <TouchableOpacity key={c} style={[styles.chip, club === c && styles.chipOn]} onPress={() => setClub(c)}>
              <Text style={[styles.chipTxt, club === c && styles.chipTxtOn]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {phase === 'result' && last ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}>
            <Text style={styles.shotCount}>Golpe {count} · {CLUB_NAMES[club] ?? club}</Text>
            <ShotResult shot={last} />
          </ScrollView>
        ) : (
          <View style={styles.stage}>
            <View style={styles.vf}>
              <View style={styles.placeholder} pointerEvents="none">
                <Ionicons name="videocam-off-outline" size={22} color={SV.faint} />
                <Text style={styles.placeholderTxt}>Vista de cámara · modo demo</Text>
              </View>
              <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                viewBox="0 0 100 56" preserveAspectRatio="none" pointerEvents="none">
                <SvgPath d={rightSide ? 'M 88 48 Q 60 22 6 8' : 'M 12 48 Q 40 22 94 8'}
                  stroke={SV.line} strokeWidth={0.8} strokeDasharray="2 3" fill="none" />
              </Svg>
              <Animated.View style={[
                styles.ballBox,
                rightSide ? { right: 16, bottom: 16 } : { left: 16, bottom: 16 },
                phase === 'searching' && { borderColor: SV.faint, borderStyle: 'dashed', opacity: scan.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                phase === 'detected' && { borderColor: SV.green, backgroundColor: 'rgba(55,214,122,0.14)', transform: [{ scale: lock.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) }] },
                phase === 'recording' && { borderColor: SV.accent },
              ]}>
                <View style={styles.crossH} />
                <View style={styles.crossV} />
                {phase === 'detected' && (
                  <View style={styles.checkPill}><Ionicons name="checkmark" size={12} color="#06210f" /></View>
                )}
              </Animated.View>
              <Text style={styles.vfHint}>
                {settings.cameraDistanceM.toFixed(2)} m · esquina {rightSide ? 'inf. derecha' : 'inf. izquierda'} · inclina ~10°
              </Text>
            </View>

            <View style={styles.statusWrap}>
              <View style={[styles.dot, { backgroundColor: phase === 'detected' ? SV.green : phase === 'recording' ? SV.accent : SV.faint }]} />
              <Text style={styles.status}>
                {phase === 'searching' && 'Esperando bola…'}
                {phase === 'detected' && (countdown != null ? `Bola detectada · golpe en ${countdown}` : 'Bola detectada · listo')}
                {phase === 'recording' && 'Grabando golpe…'}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.bottom}>
          {phase === 'detected' && !settings.handsFree && (
            <TouchableOpacity style={styles.btn} onPress={() => setPhase('recording')}>
              <Ionicons name="radio-button-on" size={18} color="#06210f" />
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
              <Text style={styles.hint}>{settings.handsFree ? 'Manos libres — no toques el móvil' : 'Preparando…'}</Text>
            </View>
          )}
        </View>

        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
      </View>
    </>
  );
}

const BOX = 74;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SV.bg },
  dim: { color: SV.sub, fontSize: 13 },
  doneTxt: { color: SV.accent, fontFamily: FONT.headingSemiBold, fontSize: 14 },

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
  checkPill: { position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: 10, backgroundColor: SV.green, alignItems: 'center', justifyContent: 'center' },
  vfHint: { position: 'absolute', top: 10, left: 12, color: SV.sub, fontSize: 10, fontFamily: FONT.bodyMedium },

  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  status: { color: SV.ink, fontSize: 15, fontFamily: FONT.bodySemiBold },

  shotCount: { color: SV.sub, fontSize: 12, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 },

  bottom: { padding: 16, gap: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15 },
  btnTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  hint: { color: SV.sub, fontSize: 12 },

  flash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 6, borderColor: SV.green, borderRadius: 2, backgroundColor: 'rgba(55,214,122,0.06)' },
});
