import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, TextInput,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSettings } from '../../src/shotvision/useSettings';
import { MetricKey, METRIC_LABELS, METRIC_PENDING } from '../../src/shotvision/settings';
import { PUTT_GREEN_PRESETS } from '../../src/shotvision/putting';
import { SV } from '../../src/shotvision/ui';
import { FONT } from '../../src/theme';

const METRIC_ORDER: MetricKey[] = [
  'ballSpeed', 'clubSpeed', 'smash', 'launchAngle', 'launchDirection',
  'spinRate', 'spinAxis', 'carry', 'total', 'apex', 'descentAngle', 'hangTime', 'offline',
];

export default function ShotVisionSettings() {
  const { settings, update, updateShow, updateView } = useSettings();

  return (
    <>
      <Stack.Screen options={{
        title: 'Ajustes ShotVision',
        headerStyle: { backgroundColor: SV.bg }, headerTintColor: SV.ink,
      }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}>

        <Section title="Unidades">
          <Segmented
            options={[['yd', 'Yardas'], ['m', 'Metros']]}
            value={settings.distanceUnit}
            onChange={v => update({ distanceUnit: v as 'yd' | 'm' })}
          />
          <Segmented
            options={[['mph', 'mph'], ['kmh', 'km/h']]}
            value={settings.speedUnit}
            onChange={v => update({ speedUnit: v as 'mph' | 'kmh' })}
          />
        </Section>

        <Section title="Bola y entorno">
          <Segmented
            options={[['premium', 'Premium'], ['range', 'Práctica']]}
            value={settings.ballType}
            onChange={v => update({ ballType: v as 'premium' | 'range' })}
          />
          <Segmented
            options={[['tee', 'Tee'], ['mat', 'Alfombra'], ['turf', 'Hierba']]}
            value={settings.surface}
            onChange={v => update({ surface: v as any })}
          />
          <NumRow
            label="Altitud (m)" placeholder="auto (GPS)"
            value={settings.altitudeOverrideM}
            onChange={n => update({ altitudeOverrideM: n })}
          />
          <NumRow
            label="Temperatura (°C)" placeholder="auto (clima)"
            value={settings.tempOverrideC}
            onChange={n => update({ tempOverrideC: n })}
          />
          <NumRow
            label="Distancia objetivo (m)" placeholder="—"
            value={settings.targetDistanceM}
            onChange={n => update({ targetDistanceM: n })}
          />
        </Section>

        <Section title="Encuadre">
          <Text style={styles.sectionHint}>
            La bola en una esquina + más distancia = más fotogramas de vuelo.
          </Text>
          <View style={styles.rowStack}>
            <Text style={styles.rowLabel}>Distancia a la bola</Text>
            <Segmented
              options={[['1.2', '1,20 m'], ['1.35', '1,35 m'], ['1.5', '1,50 m']]}
              value={String(settings.cameraDistanceM)}
              onChange={v => update({ cameraDistanceM: Number(v) })}
            />
          </View>
          <View style={styles.rowStack}>
            <Text style={styles.rowLabel}>Posición de la bola</Text>
            <Segmented
              options={[['bottomRight', 'Inf. derecha'], ['bottomLeft', 'Inf. izquierda']]}
              value={settings.ballCorner}
              onChange={v => update({ ballCorner: v as any })}
            />
          </View>
        </Section>

        <Section title="Captura">
          <ToggleRow
            label="Manos libres" hint="Registra golpes seguidos sin tocar el móvil"
            value={settings.handsFree} onChange={v => update({ handsFree: v })}
          />
          <ToggleRow
            label="Señal de luz entre golpes" hint="Destello para indicar 'listo para el siguiente'"
            value={settings.torchSignal} onChange={v => update({ torchSignal: v })}
          />
          <Stepper
            label="Auto en (s)" value={settings.autoAdvanceSec} min={3} max={15}
            onChange={n => update({ autoAdvanceSec: n })}
          />
        </Section>

        <Section title="Putt">
          <Text style={styles.sectionHint}>
            Cámara de cara, perpendicular a la línea, entre 0,5 y 1,2 m — la app detecta la distancia sola por el tamaño de la bola.
          </Text>
          <View style={styles.rowStack}>
            <Text style={styles.rowLabel}>Distancia a la bola</Text>
            <Segmented
              options={[['0.5', '0,5 m'], ['0.8', '0,8 m'], ['1.2', '1,2 m']]}
              value={String(settings.puttCameraDistanceM)}
              onChange={v => update({ puttCameraDistanceM: Number(v) })}
            />
          </View>
          <View style={styles.rowStack}>
            <Text style={styles.rowLabel}>Velocidad del green</Text>
            <Segmented
              options={PUTT_GREEN_PRESETS.map(p => [String(p.decelMs2), p.label.split(' ')[0]] as [string, string])}
              value={String(settings.puttDecelMs2)}
              onChange={v => update({ puttDecelMs2: Number(v) })}
            />
            <Text style={styles.rowHint}>
              Cuánto frena la bola al rodar — se autoajusta si registras la distancia real de un putt.
            </Text>
          </View>
          <NumRow
            label="Distancia al hoyo (m)" placeholder="—"
            value={settings.puttTargetDistanceM}
            onChange={n => update({ puttTargetDistanceM: n })}
          />
        </Section>

        <Section title="Vistas del resultado">
          <CheckRow label="Vuelo 3D" value={settings.views.perspective} onChange={v => updateView('perspective', v)} />
          <CheckRow label="Perfil de vuelo" value={settings.views.trajectory} onChange={v => updateView('trajectory', v)} />
          <CheckRow label="Panel de números" value={settings.views.numbers} onChange={v => updateView('numbers', v)} />
        </Section>

        <Section title="Métricas visibles">
          <Text style={styles.sectionHint}>
            Marca lo que quieres ver en el panel de números.
          </Text>
          {METRIC_ORDER.map(k => (
            <CheckRow
              key={k}
              label={METRIC_LABELS[k]}
              tag={METRIC_PENDING[k] ? 'próximamente' : undefined}
              value={settings.show[k]}
              onChange={v => updateShow(k, v)}
            />
          ))}
        </Section>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Segmented({
  options, value, onChange,
}: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.segment}>
      {options.map(([v, label]) => (
        <TouchableOpacity
          key={v}
          style={[styles.segItem, value === v && styles.segItemOn]}
          onPress={() => onChange(v)}
        >
          <Text style={[styles.segTxt, value === v && styles.segTxtOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ToggleRow({
  label, hint, value, onChange,
}: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value} onValueChange={onChange}
        trackColor={{ false: SV.surfaceAlt, true: SV.green }} thumbColor="#fff"
      />
    </View>
  );
}

function CheckRow({
  label, tag, value, onChange,
}: { label: string; tag?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={() => onChange(!value)} activeOpacity={0.7}>
      <Ionicons
        name={value ? 'checkbox' : 'square-outline'}
        size={22} color={value ? SV.green : SV.faint}
      />
      <Text style={[styles.rowLabel, { flex: 1, marginLeft: 10 }]}>{label}</Text>
      {tag ? <Text style={styles.tag}>{tag}</Text> : null}
    </TouchableOpacity>
  );
}

function NumRow({
  label, placeholder, value, onChange,
}: { label: string; placeholder: string; value: number | null; onChange: (n: number | null) => void }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="numbers-and-punctuation"
        placeholder={placeholder}
        placeholderTextColor={SV.faint}
        defaultValue={value != null ? String(value) : ''}
        onEndEditing={e => {
          const t = e.nativeEvent.text.trim().replace(',', '.');
          onChange(t === '' ? null : Number(t));
        }}
      />
    </View>
  );
}

function Stepper({
  label, value, min, max, onChange,
}: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - 1))}>
        <Ionicons name="remove" size={16} color={SV.ink} />
      </TouchableOpacity>
      <Text style={styles.stepVal}>{value}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(Math.min(max, value + 1))}>
        <Ionicons name="add" size={16} color={SV.ink} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SV.bg },
  sectionTitle: { fontSize: 11, fontFamily: FONT.headingSemiBold, color: SV.sub, textTransform: 'uppercase', letterSpacing: 1 },
  sectionHint: { fontSize: 11, color: SV.faint, marginBottom: 2 },
  card: {
    backgroundColor: SV.surface, borderRadius: 14, borderWidth: 1, borderColor: SV.line,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: SV.line, gap: 4,
  },
  rowStack: {
    paddingVertical: 10, gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: SV.line,
  },
  rowLabel: { fontSize: 14, color: SV.ink, fontFamily: FONT.bodyMedium },
  rowHint: { fontSize: 11, color: SV.sub, marginTop: 2 },
  tag: { fontSize: 9, color: SV.faint, fontFamily: FONT.bodySemiBold, textTransform: 'uppercase' },

  segment: { flexDirection: 'row', gap: 6, paddingVertical: 10 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: SV.surfaceAlt, alignItems: 'center' },
  segItemOn: { backgroundColor: SV.green },
  segTxt: { fontSize: 12, fontFamily: FONT.bodySemiBold, color: SV.sub },
  segTxtOn: { color: '#06210f' },

  input: {
    minWidth: 96, textAlign: 'right', color: SV.ink, fontSize: 14, fontFamily: FONT.bodySemiBold,
    paddingVertical: 4,
  },
  stepBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: SV.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  stepVal: { fontSize: 15, fontFamily: FONT.headingSemiBold, color: SV.ink, minWidth: 28, textAlign: 'center' },
});
