import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT } from '../../src/theme';

export default function SignupScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!email.trim() || !password) {
      Alert.alert('Faltan datos', 'Introduce tu email y contraseña.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Contraseña muy corta', 'Mínimo 6 caracteres.');
      return;
    }
    setLoading(true);
    const err = await signUp(email.trim().toLowerCase(), password);
    setLoading(false);
    if (err) {
      Alert.alert('Error al registrarse', err);
    } else {
      Alert.alert(
        'Cuenta creada',
        'Revisa tu email para confirmar tu cuenta, luego inicia sesión.',
        [{ text: 'OK', onPress: () => router.replace('/auth/login') }],
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Ionicons name="golf" size={52} color={COLORS.dark.accent} style={styles.logo} />
        <Text style={styles.title}>Crear cuenta</Text>
        <Text style={styles.sub}>Guarda tu historial en la nube</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#6c757d"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña (mín. 6 caracteres)"
            placeholderTextColor="#6c757d"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Confirmar contraseña"
            placeholderTextColor="#6c757d"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={COLORS.dark.text} />
              : <Text style={styles.btnTxt}>Crear cuenta</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.link} onPress={() => router.replace('/auth/login')}>
          <Text style={styles.linkTxt}>¿Ya tienes cuenta? <Text style={styles.linkBold}>Inicia sesión</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.dark.bg },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 30, fontFamily: FONT.headingExtraBold, color: COLORS.dark.text, textAlign: 'center' },
  sub: { fontSize: 15, color: COLORS.dark.accent, textAlign: 'center', marginTop: 6, marginBottom: 36 },
  form: { gap: 14 },
  input: {
    backgroundColor: COLORS.dark.surface, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: COLORS.dark.text, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  btn: {
    backgroundColor: COLORS.success, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 6,
  },
  btnDisabled: { opacity: 0.6 },
  btnTxt: { color: COLORS.dark.text, fontSize: 17, fontFamily: FONT.bodySemiBold },
  link: { marginTop: 28, alignItems: 'center' },
  linkTxt: { color: COLORS.dark.muted, fontSize: 14, fontFamily: FONT.body },
  linkBold: { color: COLORS.dark.accent, fontFamily: FONT.bodySemiBold },
});
