import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from '@expo-google-fonts/poppins';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { COLORS } from '../src/theme';

function RootLayoutNav() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const [fontsLoaded] = useFonts({
    Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  });

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === 'auth';
    if (!session && !inAuth) {
      router.replace('/auth/login');
    } else if (session && inAuth) {
      router.replace('/');
    }
  }, [session, loading]);

  // Keep showing the splash through the redirect itself, not just while
  // `loading` — otherwise, on the render where `session` first resolves to
  // null, the Stack (and whichever protected tab is the initial route)
  // mounts and fires its own data-fetch effects a beat before this
  // component's own redirect effect gets to run, throwing "Not
  // authenticated" (reproduced consistently on a fresh/signed-out load).
  const inAuth = segments[0] === 'auth';
  const settled = session ? !inAuth : inAuth;
  if (loading || !settled || !fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.dark.bg }}>
        <ActivityIndicator color={COLORS.dark.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false }} />
      <Stack.Screen name="round/new" options={{ title: 'Nueva ronda', presentation: 'modal' }} />
      <Stack.Screen name="round/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="history/[id]" options={{ title: 'Detalle ronda' }} />
      <Stack.Screen name="courses/add" options={{ title: 'Nuevo campo', presentation: 'modal' }} />
      <Stack.Screen name="courses/import-osm" options={{ title: 'Importar de OSM', presentation: 'modal' }} />
      <Stack.Screen name="courses/[id]" options={{ title: 'Campo' }} />
      <Stack.Screen name="courses/world" options={{ title: 'Mundo' }} />
      <Stack.Screen name="shotvision/calibrate" options={{ title: 'Calibrar' }} />
      <Stack.Screen name="shotvision/practice/setup" options={{ title: 'Practicar' }} />
      <Stack.Screen name="shotvision/practice/[id]" options={{ title: 'Practicar', gestureEnabled: false }} />
      <Stack.Screen name="shotvision/sim/setup" options={{ title: 'Simulador' }} />
      <Stack.Screen name="shotvision/sim/[id]" options={{ title: 'Simulador', gestureEnabled: false }} />
      <Stack.Screen name="shotvision/session/[id]" options={{ title: 'Sesión' }} />
      <Stack.Screen name="shotvision/shot/[id]" options={{ title: 'Golpe' }} />
      <Stack.Screen name="shotvision/summary/[id]" options={{ title: 'Resumen' }} />
      <Stack.Screen name="shotvision/settings" options={{ title: 'Ajustes ShotVision' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
