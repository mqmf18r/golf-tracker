import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Circle, Path as SvgPath } from 'react-native-svg';

import { SimPlatform } from '../../../src/shotvision/types';
import { createSession } from '../../../src/shotvision/store';
import { SV } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

const DEFAULT_PORT: Record<SimPlatform, number> = { gspro: 921, e6: 2483 };

export default function SimSetup() {
  const router = useRouter();
  const [platform, setPlatform] = useState<SimPlatform>('gspro');
  const [host, setHost] = useState('192.168.1.');
  const [port, setPort] = useState(String(DEFAULT_PORT.gspro));
  const [conn, setConn] = useState<'idle' | 'connecting' | 'ok' | 'fail'>('idle');
  const [align, setAlign] = useState(0);   // degrees, − left / + right

  function connect() {
    setConn('connecting');
    setTimeout(() => setConn('fail'), 1400);   // networking needs the dev build
  }

  function pickPlatform(p: SimPlatform) {
    setPlatform(p);
    setPort(String(DEFAULT_PORT[p]));
    setConn('idle');
  }

  async function start() {
    const s = await createSession({
      mode: 'sim',
      sim: { platform, host, port: Number(port) || DEFAULT_PORT[platform], alignmentOffsetDeg: align },
      saved: true,
    });
    router.replace(`/shotvision/sim/${s.id}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Simulador', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 120 }}>

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={16} color={SV.accent} />
          <Text style={styles.noticeTxt}>
            La conexión con GSPro / E6 necesita la compilación de desarrollo (red TCP).
            Aquí puedes preparar y calibrar todo; el envío real llega con la cámara.
          </Text>
        </View>

        <Step n={1} title="Plataforma">
          <Seg options={[['gspro', 'GSPro'], ['e6', 'E6 Connect']]}
            value={platform} onChange={v => pickPlatform(v as SimPlatform)} />
          <Text style={styles.hint}>
            {platform === 'gspro'
              ? 'GSPro Open Connect — API de datos de bola por socket TCP (puerto 921 por defecto).'
              : 'E6 Connect — API de datos de bola (puerto 2483 por defecto).'}
          </Text>
        </Step>

        <Step n={2} title="Conexión">
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>IP del PC del simulador</Text>
            <TextInput style={styles.input} value={host} onChangeText={setHost}
              placeholder="192.168.1.50" placeholderTextColor={SV.faint} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Puerto</Text>
            <TextInput style={styles.input} value={port} onChangeText={setPort}
              keyboardType="number-pad" placeholderTextColor={SV.faint} />
          </View>
          <TouchableOpacity style={styles.connectBtn} onPress={connect} disabled={conn === 'connecting'}>
            <Text style={styles.connectTxt}>
              {conn === 'connecting' ? 'Conectando…'
                : conn === 'fail' ? 'Reintentar'
                : 'Probar conexión'}
            </Text>
          </TouchableOpacity>
          {conn === 'fail' && (
            <Text style={styles.connFail}>
              No disponible en esta versión (Expo Go). Llegará con la compilación de desarrollo.
            </Text>
          )}
        </Step>

        <Step n={3} title="Alineación">
          <Text style={styles.hint}>
            El simulador coloca el golpe según tu <Text style={{ fontFamily: FONT.headingSemiBold, color: SV.ink }}>línea de tiro</Text>.
            Ajusta el desfase para que el "recto" de la cámara coincida con el "recto" del simulador.
          </Text>
          <View style={styles.diagram}>
            <Svg width="100%" height={110} viewBox="0 0 260 110">
              {/* target line */}
              <Line x1={130} y1={100} x2={130} y2={12} stroke={SV.accent} strokeWidth={1.5} strokeDasharray="4 4" />
              <Circle cx={130} cy={100} r={4} fill={SV.ink} />
              {/* camera "straight" line, rotated by align */}
              {(() => {
                const rad = (align * Math.PI) / 180;
                const x2 = 130 + Math.sin(rad) * 88;
                const y2 = 100 - Math.cos(rad) * 88;
                return <Line x1={130} y1={100} x2={x2} y2={y2} stroke={SV.green} strokeWidth={2} />;
              })()}
            </Svg>
          </View>
          <View style={styles.alignRow}>
            <TouchableOpacity style={styles.alignBtn} onPress={() => setAlign(a => Math.max(-15, +(a - 0.5).toFixed(1)))}>
              <Ionicons name="remove" size={16} color={SV.ink} />
            </TouchableOpacity>
            <Text style={styles.alignVal}>{align > 0 ? '+' : ''}{align.toFixed(1)}°</Text>
            <TouchableOpacity style={styles.alignBtn} onPress={() => setAlign(a => Math.min(15, +(a + 0.5).toFixed(1)))}>
              <Ionicons name="add" size={16} color={SV.ink} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.zeroBtn} onPress={() => setAlign(0)}>
              <Text style={styles.zeroTxt}>0°</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Consejo: en la sesión, pega unos golpes que sepas rectos y usa "Calibrar con este golpe"
            para fijar el desfase automáticamente.
          </Text>
        </Step>
      </ScrollView>

      <View style={styles.bottom}>
        <TouchableOpacity style={styles.btn} onPress={start}>
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
function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.seg}>
      {options.map(([v, l]) => (
        <TouchableOpacity key={v} style={[styles.segItem, value === v && styles.segItemOn]} onPress={() => onChange(v)}>
          <Text style={[styles.segTxt, value === v && styles.segTxtOn]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  notice: { flexDirection: 'row', gap: 8, backgroundColor: SV.surfaceAlt, borderRadius: 12, padding: 12 },
  noticeTxt: { flex: 1, fontSize: 12, color: SV.sub, lineHeight: 17 },

  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontSize: 11, fontFamily: FONT.headingExtraBold, color: SV.green },
  stepTitle: { fontSize: 14, fontFamily: FONT.headingSemiBold, color: SV.ink },
  card: { backgroundColor: SV.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: SV.line },
  hint: { fontSize: 12, color: SV.sub, lineHeight: 17 },

  seg: { flexDirection: 'row', gap: 6 },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: SV.surfaceAlt, alignItems: 'center' },
  segItemOn: { backgroundColor: SV.green },
  segTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: SV.sub },
  segTxtOn: { color: '#06210f' },

  field: { gap: 4 },
  fieldLabel: { fontSize: 11, color: SV.sub, fontFamily: FONT.bodySemiBold },
  input: { backgroundColor: SV.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: SV.ink, fontSize: 15, fontFamily: FONT.bodyMedium },
  connectBtn: { backgroundColor: SV.surfaceAlt, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 2 },
  connectTxt: { fontSize: 13, fontFamily: FONT.headingSemiBold, color: SV.green },
  connFail: { fontSize: 11, color: SV.accent, lineHeight: 15 },

  diagram: { backgroundColor: '#0d1a26', borderRadius: 10, padding: 6 },
  alignRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alignBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: SV.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  alignVal: { fontSize: 16, fontFamily: FONT.headingExtraBold, color: SV.ink, minWidth: 54, textAlign: 'center' },
  zeroBtn: { marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: SV.surfaceAlt },
  zeroTxt: { fontSize: 12, fontFamily: FONT.headingSemiBold, color: SV.sub },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: SV.bg, borderTopWidth: 1, borderColor: SV.line },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15 },
  btnTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
});
