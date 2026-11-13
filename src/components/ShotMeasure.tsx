import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useShotMeasure } from '../services/location';
import { ShotMeasurement } from '../types';
import { COLORS, FONT } from '../theme';

interface Props {
  shots: ShotMeasurement[];
  onSave: (meters: number) => void;
  onDelete: (id: string) => void;
}

export function ShotMeasurePanel({ shots, onSave, onDelete }: Props) {
  const { measuring, start, stop, cancel } = useShotMeasure();

  function handleStart() {
    const ok = start();
    if (!ok) Alert.alert('GPS no disponible', 'Espera a que el GPS tenga señal');
  }

  function handleStop() {
    const dist = stop();
    if (dist !== null) {
      Alert.alert('Distancia del golpe', `${dist} metros`, [
        { text: 'Guardar', onPress: () => onSave(dist) },
        { text: 'Descartar', style: 'cancel' },
      ]);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Medir golpe</Text>

      {measuring ? (
        <View style={styles.measuringRow}>
          <View style={styles.pulse} />
          <Text style={styles.measuringText}>Midiendo… camina hasta donde cayó la bola</Text>
        </View>
      ) : null}

      <View style={styles.btnRow}>
        {!measuring ? (
          <TouchableOpacity style={styles.btn} onPress={handleStart}>
            <Text style={styles.btnText}>▶ Inicio golpe</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnOrange]} onPress={handleStop}>
              <Text style={styles.btnText}>⏹ Marcar llegada</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={cancel}>
              <Text style={[styles.btnText, { color: '#6c757d' }]}>Cancelar</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {shots.length > 0 && (
        <View style={styles.shotList}>
          {shots.map((s, i) => (
            <View key={s.id} style={styles.shotRow}>
              <Text style={styles.shotNum}>#{i + 1}</Text>
              <Text style={styles.shotDist}>{Math.round(s.distanceMeters)} m</Text>
              <TouchableOpacity onPress={() => onDelete(s.id)}>
                <Text style={styles.deleteBtn}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: COLORS.shadow, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  title: { fontSize: 16, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary, marginBottom: 10 },
  measuringRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  pulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.warning },
  measuringText: { fontSize: 13, color: COLORS.warning, flex: 1 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnOrange: { backgroundColor: COLORS.warning },
  btnGhost: { backgroundColor: '#f8f9fa' },
  btnText: { color: COLORS.textOnPrimary, fontFamily: FONT.bodyMedium, fontSize: 14 },
  shotList: { marginTop: 12, gap: 6 },
  shotRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8f9fa', borderRadius: 8, padding: 10, gap: 8 },
  shotNum: { fontSize: 13, color: COLORS.textSecondary, width: 24 },
  shotDist: { flex: 1, fontSize: 15, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary },
  deleteBtn: { fontSize: 16, color: COLORS.textTertiary, padding: 4 },
});
