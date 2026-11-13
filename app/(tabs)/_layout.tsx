import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT } from '../../src/theme';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: COLORS.primary,
      headerShown: true,
      headerStyle: { backgroundColor: COLORS.card },
      headerTintColor: COLORS.textPrimary,
      headerTitleStyle: { fontFamily: FONT.headingSemiBold },
    }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: 'Campos',
          tabBarIcon: ({ color, size }) => <Ionicons name="flag" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clubs"
        options={{
          title: 'Mis palos',
          tabBarIcon: ({ color, size }) => <Ionicons name="golf" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shotvision"
        options={{
          title: 'ShotVision',
          headerStyle: { backgroundColor: '#0a1420' },
          headerTintColor: '#eef4f8',
          headerShadowVisible: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="videocam" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
