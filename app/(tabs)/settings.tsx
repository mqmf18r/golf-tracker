import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, TextInput, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { getOwnProfile, updateOwnDisplayName } from '../../src/lib/api';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CARD_SHADOW, RADIUS, SPACING, FONT } from '../../src/theme';

const DEV_CODE = '0000';

export default function SettingsScreen() {
  const { user, isDeveloper, signOut } = useAuth();
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    getOwnProfile().then(p => { if (mounted) setDisplayName(p?.displayName ?? ''); }).catch(() => {});
    return () => { mounted = false; };
  }, []));

  function startEditName() {
    setNameDraft(displayName);
    setEditingName(true);
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await updateOwnDisplayName(trimmed);
      setDisplayName(trimmed);
      setEditingName(false);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'No se pudo guardar el nombre.');
    } finally {
      setSavingName(false);
    }
  }

  async function activateDeveloper() {
    if (code !== DEV_CODE) {
      Alert.alert('Código incorrecto', 'El código introducido no es válido.');
      setCode('');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ data: { role: 'developer' } });
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setShowCodeModal(false);
      setCode('');
      Alert.alert('Modo developer activado', 'Cierra sesión y vuelve a entrar para que surta efecto.');
    }
  }

  async function deactivateDeveloper() {
    Alert.alert(
      'Desactivar modo developer',
      '¿Seguro? Perderás acceso a las herramientas de mapeo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desactivar', style: 'destructive', onPress: async () => {
            setBusy(true);
            const { error } = await supabase.auth.updateUser({ data: { role: null } });
            setBusy(false);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Modo developer desactivado', 'Cierra sesión y vuelve a entrar para que surta efecto.');
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>

      {/* Profile */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cuenta</Text>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={24} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.email}>{user?.email ?? '—'}</Text>
            <Text style={styles.uid}>ID: {user?.id?.slice(0, 8)}…</Text>
          </View>
        </View>
        <View style={styles.divider} />
        {editingName ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Tu nombre"
              placeholderTextColor={COLORS.textTertiary}
              autoFocus
              maxLength={40}
              onSubmitEditing={saveName}
            />
            <TouchableOpacity style={styles.okBtn} onPress={saveName} disabled={savingName}>
              <Ionicons name="checkmark" size={16} color={COLORS.textOnPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelIconBtn} onPress={() => setEditingName(false)}>
              <Ionicons name="close" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.nameRow} onPress={startEditName}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nameLabel}>Nombre para mostrar</Text>
              <Text style={displayName ? styles.nameValue : styles.nameValueEmpty}>
                {displayName || 'Sin definir · otros jugadores no podrán encontrarte por nombre'}
              </Text>
            </View>
            <Ionicons name="pencil" size={16} color={COLORS.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Developer mode */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Modo Developer</Text>
        <View style={styles.devRow}>
          <View style={[styles.badge, isDeveloper ? styles.badgeOn : styles.badgeOff]}>
            <Ionicons
              name={isDeveloper ? 'code-slash' : 'person-outline'}
              size={14}
              color={isDeveloper ? COLORS.textOnPrimary : '#6c757d'}
            />
            <Text style={[styles.badgeTxt, isDeveloper ? styles.badgeTxtOn : styles.badgeTxtOff]}>
              {isDeveloper ? 'Developer' : 'Usuario normal'}
            </Text>
          </View>
          {isDeveloper ? (
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={deactivateDeveloper}
              disabled={busy}
            >
              <Text style={styles.btnSecondaryTxt}>Desactivar</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={() => { setCode(''); setShowCodeModal(true); }}
              disabled={busy}
            >
              <Text style={styles.btnPrimaryTxt}>Activar</Text>
            </TouchableOpacity>
          )}
        </View>
        {isDeveloper && (
          <Text style={styles.hint}>
            Tienes acceso a mapeo de campos, zonas, peligros e importación OSM.
          </Text>
        )}
        {!isDeveloper && (
          <Text style={styles.hint}>
            El modo developer activa herramientas de mapeo y edición de campos.
            Necesitas el código para activarlo.
          </Text>
        )}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={() => signOut()}>
        <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
        <Text style={styles.signOutTxt}>Cerrar sesión</Text>
      </TouchableOpacity>

      {/* Code modal */}
      <Modal visible={showCodeModal} transparent animationType="fade" onRequestClose={() => setShowCodeModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Código developer</Text>
            <Text style={styles.modalDesc}>Introduce el código para activar el modo developer.</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={setCode}
              placeholder="••••"
              placeholderTextColor={COLORS.textTertiary}
              secureTextEntry
              keyboardType="default"
              autoFocus
              maxLength={20}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => { setShowCodeModal(false); setCode(''); }}
              >
                <Text style={styles.modalBtnCancelTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnOk, (!code.trim() || busy) && { opacity: 0.4 }]}
                onPress={activateDeveloper}
                disabled={!code.trim() || busy}
              >
                <Text style={styles.modalBtnOkTxt}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm,
    ...CARD_SHADOW,
  },
  cardTitle: {
    fontSize: 12, fontFamily: FONT.headingSemiBold, color: COLORS.primary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 6 },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.primaryTint, alignItems: 'center', justifyContent: 'center',
  },
  email: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary },
  uid: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: SPACING.xs },
  divider: { height: 1, backgroundColor: '#f0f2f5' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  nameLabel: { fontSize: 11, fontFamily: FONT.body, color: COLORS.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  nameValue: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textPrimary, marginTop: SPACING.xs },
  nameValueEmpty: { fontSize: 13, fontFamily: FONT.body, color: COLORS.textTertiary, marginTop: SPACING.xs, fontStyle: 'italic' },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  nameInput: {
    flex: 1, backgroundColor: '#f8faf8', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 4,
    fontSize: 15, fontFamily: FONT.bodyMedium, color: COLORS.textPrimary, borderWidth: 1, borderColor: '#e0e8e0',
  },
  okBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  cancelIconBtn: { padding: SPACING.xs },

  devRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs + 2,
  },
  badgeOn: { backgroundColor: COLORS.primary },
  badgeOff: { backgroundColor: '#f0f2f5' },
  badgeTxt: { fontSize: 13, fontFamily: FONT.bodySemiBold },
  badgeTxtOn: { color: COLORS.textOnPrimary },
  badgeTxtOff: { color: COLORS.textSecondary },
  hint: { fontSize: 12, fontFamily: FONT.body, color: COLORS.textSecondary, lineHeight: 17 },

  btnPrimary: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 1,
  },
  btnPrimaryTxt: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
  btnSecondary: {
    backgroundColor: '#f0f2f5', borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 1,
  },
  btnSecondaryTxt: { fontSize: 14, fontFamily: FONT.bodySemiBold, color: COLORS.danger },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, paddingVertical: SPACING.md,
    ...CARD_SHADOW,
  },
  signOutTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.danger },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  modal: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg + 8, padding: SPACING.lg, width: '100%', gap: SPACING.sm + 6,
  },
  modalTitle: { fontSize: 18, fontFamily: FONT.headingSemiBold, color: COLORS.textPrimary },
  modalDesc: { fontSize: 14, fontFamily: FONT.body, color: COLORS.textSecondary, lineHeight: 20 },
  codeInput: {
    backgroundColor: '#f8faf8', borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    fontSize: 22, fontFamily: FONT.heading, color: COLORS.textPrimary, textAlign: 'center',
    borderWidth: 1, borderColor: '#e0e8e0', letterSpacing: 6,
  },
  modalBtns: { flexDirection: 'row', gap: SPACING.sm },
  modalBtnCancel: {
    flex: 1, paddingVertical: SPACING.sm + 5, borderRadius: RADIUS.md,
    backgroundColor: '#f0f2f5', alignItems: 'center',
  },
  modalBtnCancelTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textSecondary },
  modalBtnOk: {
    flex: 1, paddingVertical: SPACING.sm + 5, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary, alignItems: 'center',
  },
  modalBtnOkTxt: { fontSize: 15, fontFamily: FONT.bodySemiBold, color: COLORS.textOnPrimary },
});
