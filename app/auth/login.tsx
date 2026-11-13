import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT } from '../../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Faltan datos', 'Introduce tu email y contraseña.');
      return;
    }
    setLoading(true);
    const err = await signIn(email.trim().toLowerCase(), password);
    setLoading(false);
    if (err) Alert.alert('Error al iniciar sesión', err);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Ionicons name="golf" size={52} color={COLORS.dark.accent} style={styles.logo} />
        <Text style={styles.title}>Golf Tracker</Text>
        <Text style={styles.sub}>Inicia sesión en tu cuenta</Text>

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
          <View style={styles.passWrap}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Contraseña"
              placeholderTextColor="#6c757d"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(v => !v)}>
              <Ionicons name={showPass ? 'eye-off' : 'eye'} size={20} color="#6c757d" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={COLORS.dark.text} />
              : <Text style={styles.btnTxt}>Iniciar sesión</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.link} onPress={() => router.replace('/auth/signup')}>
          <Text style={styles.linkTxt}>¿Sin cuenta? <Text style={styles.linkBold}>Regístrate</Text></Text>
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
    marginBottom: 0,
  },
  passWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: { padding: 8 },
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
