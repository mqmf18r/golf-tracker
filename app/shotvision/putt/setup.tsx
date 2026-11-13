import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Circle, Rect, Text as SvgText } from 'react-native-svg';

import { createPuttSession } from '../../../src/shotvision/puttStore';
import { useSettings } from '../../../src/shotvision/useSettings';
import { SV } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

export default function PuttSetup() {
  const router = useRouter();
  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    const s = await createPuttSession({
      targetDistanceMeters: settings.puttTargetDistanceM,
      decelMs2: settings.puttDecelMs2,
      saved: false,
    });
    router.replace(`/shotvision/putt/${s.id}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Putt', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 120 }}>

        <Step n={1} title="Coloca el móvil">
          <View style={styles.diagram}>
            <Svg width="100%" height={110} viewBox="0 0 300 110">
              <Line x1={10} y1={90} x2={290} y2={90} stroke={SV.line} strokeWidth={2} />
              <Line x1={60} y1={90} x2={60} y2={62} stroke={SV.faint} strokeWidth={2} />
              <Rect x={53} y={48} width={14} height={22} rx={3} fill={SV.surfaceAlt} stroke={SV.green} />
              <SvgText x={60} y={106} fill={SV.sub} fontSize={9} textAnchor="middle">cámara</SvgText>
              <Circle cx={150} cy={86} r={5} fill={SV.ink} />
              <SvgText x={150} y={106} fill={SV.sub} fontSize={9} textAnchor="middle">bola</SvgText>
              <Line x1={150} y1={86} x2={270} y2={86} stroke={SV.line} strokeWidth={1} strokeDasharray="2 4" />
              <SvgText x={270} y={80} fill={SV.faint} fontSize={9} textAnchor="end">hoyo →</SvgText>
              <Line x1={60} y1={70} x2={144} y2={83} stroke={SV.green} strokeWidth={1} strokeDasharray="3 3" />
              <SvgText x={100} y={64} fill={SV.sub} fontSize={9} textAnchor="middle">
                {settings.puttCameraDistanceM.toFixed(1)} m
              </SvgText>
            </Svg>
          </View>
          <Bullet t="De cara, perpendicular a la línea de tiro (como para un golpe normal)." />
          <Bullet t={`A ${settings.puttCameraDistanceM.toFixed(1)} m de la bola — la app detecta la distancia sola, no hace falta medir.`} />
          <Bullet t="Trípode o suelo a ~30 cm de altura." />
          <TouchableOpacity style={styles.adjust} onPress={() => router.push('/shotvision/settings')}>
            <Ionicons name="options-outline" size={14} color={SV.green} />
            <Text style={styles.adjustTxt}>Ajustar distancia / velocidad de green</Text>
          </TouchableOpacity>
        </Step>

        <Step n={2} title="¿A qué distancia está el hoyo? (opcional)">
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              keyboardType="numbers-and-punctuation"
              placeholder="p. ej. 4.5"
              placeholderTextColor={SV.faint}
              defaultValue={settings.puttTargetDistanceM != null ? String(settings.puttTargetDistanceM) : ''}
              onEndEditing={e => {
                const t = e.nativeEvent.text.trim().replace(',', '.');
                update({ puttTargetDistanceM: t === '' ? null : Number(t) });
              }}
            />
            <Text style={styles.unit}>m</Text>
          </View>
          <Text style={styles.hint}>
            Si la das, cada putt te dirá si se quedó corto o se pasó, y por cuánto.
          </Text>
        </Step>

        <Step n={3} title="Coloca una bola y golpea">
          <Text style={styles.hint}>
            La app detecta la bola sola y mide el golpe mientras ruedas — no hace falta tocar el móvil durante el putt.
          </Text>
        </Step>

        <View style={styles.betaPill}>
          <Ionicons name="flask-outline" size={12} color={SV.accent} />
          <Text style={styles.betaTxt}>Beta — primera versión con cámara real, sin datos de demostración</Text>
        </View>
      </ScrollView>

      <View style={styles.bottom}>
        <TouchableOpacity style={styles.btn} onPress={start} disabled={busy}>
          <Text style={styles.btnTxt}>Empezar</Text>
          <Ionicons name="arrow-forward" size={18} color="#06210f" />
        </TouchableOpacity>
      </View>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.stepHead}>
        <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{n}</Text></View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}
function Bullet({ t }: { t: string }) {
  return (
    <View style={styles.bullet}>
      <Ionicons name="ellipse" size={5} color={SV.green} style={{ marginTop: 6 }} />
      <Text style={styles.bulletTxt}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontSize: 11, fontFamily: FONT.headingExtraBold, color: SV.green },
  stepTitle: { fontSize: 14, fontFamily: FONT.headingSemiBold, color: SV.ink },
  card: { backgroundColor: SV.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: SV.line },
  hint: { fontSize: 12, color: SV.sub, lineHeight: 17 },

  diagram: { backgroundColor: '#0d1a26', borderRadius: 10, padding: 6 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletTxt: { flex: 1, fontSize: 12.5, color: '#c7d4de', lineHeight: 18 },
  adjust: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  adjustTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: SV.green },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, backgroundColor: SV.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: SV.ink, fontSize: 15, fontFamily: FONT.bodySemiBold,
  },
  unit: { color: SV.sub, fontSize: 13, fontFamily: FONT.bodyMedium },

  betaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: SV.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  betaTxt: { fontSize: 11, color: SV.sub, fontFamily: FONT.bodyMedium },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: SV.bg, borderTopWidth: 1, borderColor: SV.line },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15,
  },
  btnTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
});
