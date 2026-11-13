import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Circle, Rect, Path as SvgPath, Text as SvgText } from 'react-native-svg';

import { Venue } from '../../../src/shotvision/types';
import { createSession } from '../../../src/shotvision/store';
import { useSettings } from '../../../src/shotvision/useSettings';
import { SV } from '../../../src/shotvision/ui';
import { FONT } from '../../../src/theme';

export default function PracticeSetup() {
  const router = useRouter();
  const { settings, update } = useSettings();
  const [venue, setVenue] = useState<Venue>('indoor');
  const [busy, setBusy] = useState(false);

  const rightSide = settings.ballCorner === 'bottomRight';

  async function start() {
    setBusy(true);
    const s = await createSession({
      mode: 'practice',
      venue,
      ballType: settings.ballType,
      saved: false,
    });
    router.replace(`/shotvision/practice/${s.id}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Practicar', headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 120 }}>

        <Step n={1} title="¿Dónde juegas?">
          <Seg options={[['indoor', 'Interior (red)'], ['outdoor', 'Exterior']]}
            value={venue} onChange={v => setVenue(v as Venue)} />
        </Step>

        <Step n={2} title="¿Qué bolas usas?">
          <Seg options={[['range', 'De práctica'], ['premium', 'Normales']]}
            value={settings.ballType} onChange={v => update({ ballType: v as any })} />
          <Text style={styles.hint}>
            Las bolas de práctica vuelan más corto — se tiene en cuenta en la estimación.
          </Text>
        </Step>

        <Step n={3} title="Coloca el móvil">
          <View style={styles.diagram}>
            <Svg width="100%" height={130} viewBox="0 0 300 130">
              {/* ground */}
              <Line x1={10} y1={110} x2={290} y2={110} stroke={SV.line} strokeWidth={2} />
              {/* phone on stand */}
              {(() => {
                const px = rightSide ? 240 : 60;
                const bx = rightSide ? 90 : 210;
                return (
                  <>
                    <Line x1={px} y1={110} x2={px} y2={78} stroke={SV.faint} strokeWidth={2} />
                    <Rect x={px - 7} y={64} width={14} height={22} rx={3} fill={SV.surfaceAlt} stroke={SV.green} />
                    <SvgText x={px + (rightSide ? -12 : 12)} y={98} fill={SV.sub} fontSize={9}
                      textAnchor={rightSide ? 'end' : 'start'}>{settings.cameraDistanceM.toFixed(2)} m</SvgText>
                    {/* ball */}
                    <Circle cx={bx} cy={106} r={5} fill={SV.ink} />
                    {/* sight line */}
                    <Line x1={px} y1={75} x2={bx} y2={104} stroke={SV.green} strokeWidth={1} strokeDasharray="3 3" />
                    <SvgText x={(px + bx) / 2} y={62} fill={SV.sub} fontSize={9} textAnchor="middle">↑ ~10°</SvgText>
                  </>
                );
              })()}
            </Svg>
          </View>
          <Bullet t={`Trípode o suelo a 25–35 cm de altura, en horizontal.`} />
          <Bullet t={`A ${settings.cameraDistanceM.toFixed(2)} m de la bola, perpendicular a la línea de tiro.`} />
          <Bullet t={`Inclinado ~10° hacia arriba.`} />
          <Bullet t={`La bola irá en la esquina ${rightSide ? 'inferior derecha' : 'inferior izquierda'} del encuadre.`} />
          <TouchableOpacity style={styles.adjust} onPress={() => router.push('/shotvision/settings')}>
            <Ionicons name="options-outline" size={14} color={SV.green} />
            <Text style={styles.adjustTxt}>Ajustar distancia / posición</Text>
          </TouchableOpacity>
        </Step>

        <Step n={4} title="Coloca una bola en la zona de golpeo">
          <Text style={styles.hint}>Cuando la app detecte la bola, el recuadro se pondrá verde y podrás golpear.</Text>
        </Step>
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

  seg: { flexDirection: 'row', gap: 6 },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: SV.surfaceAlt, alignItems: 'center' },
  segItemOn: { backgroundColor: SV.green },
  segTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold, color: SV.sub },
  segTxtOn: { color: '#06210f' },

  diagram: { backgroundColor: '#0d1a26', borderRadius: 10, padding: 6 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletTxt: { flex: 1, fontSize: 12.5, color: '#c7d4de', lineHeight: 18 },
  adjust: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  adjustTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: SV.green },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: SV.bg, borderTopWidth: 1, borderColor: SV.line },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SV.green, borderRadius: 14, paddingVertical: 15,
  },
  btnTxt: { color: '#06210f', fontSize: 15, fontFamily: FONT.headingSemiBold },
});
