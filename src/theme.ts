// Single source of truth for the main app's colors. Extracted from values
// that were previously copy-pasted by hand into every screen's own
// StyleSheet (same hex strings, one file at a time) — centralizing them here
// means a rebrand or dark-mode pass only touches this file.
// (`src/shotvision/ui.tsx` has its own dark "TrackMan-style" palette for that
// sub-feature — intentionally separate, not merged into this one.)

export const COLORS = {
  // surfaces
  bg: '#f5f7f5',
  card: '#ffffff',
  border: '#e8ece8',

  // text — never pure black; #1f2937 (Tailwind's gray-800) reads as dark
  // enough for body copy without the harsh contrast of #000
  textPrimary: '#1f2937',
  textSecondary: '#6b7280',
  textTertiary: '#9ca3af',
  textOnPrimary: '#ffffff',
  emptyIcon: '#c8d6bf',

  // brand
  primary: '#1a472a',
  primaryMuted: '#7ab87a',
  primaryTint: '#e8f4e8',

  // status / accents
  success: '#27ae60',
  danger: '#e74c3c',
  info: '#2980b9',
  warning: '#e67e22',
  accent: '#8b5cf6',

  shadow: '#000000',

  // dark "hero" screens (auth, splash) — a deliberate different look from
  // the light app that follows; kept as named tokens rather than one-off
  // hex literals so the two dark screens + splash stay in sync with each other
  dark: {
    bg: '#0d1f15',
    surface: 'rgba(255,255,255,0.08)',
    accent: '#a8d5a2',
    text: '#ffffff',
    muted: '#8e9aaf',
  },
} as const;

// Card/box corner radius only — pill-shaped elements (badges, chips) stay
// fully rounded via their own height/2, not this scale.
export const RADIUS = {
  sm: 8,
  md: 10,
  lg: 12,
};

// 8pt spacing scale for all padding/margin/gap. `xs` (4) is the one
// deliberate half-step below the requested 8/16/24/32 run — for the very
// tight icon-to-label gaps inside compact pills/badges, where 8px reads as
// a visible gap rather than a single unit; every other value in the app
// should come from {sm, md, lg, xl}.
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Poppins for headings/emphasis (bold, geometric — reads well for big
// numbers like the handicap index), Inter for body copy (neutral,
// optimized for small UI text). Both loaded via useFonts in app/_layout.tsx
// (@expo-google-fonts/poppins + @expo-google-fonts/inter); consumers
// reference these names, never a bare 'System' or ad-hoc fontFamily string.
export const FONT = {
  headingExtraBold: 'Poppins_800ExtraBold',
  heading: 'Poppins_700Bold',
  headingSemiBold: 'Poppins_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
};

export const CARD_SHADOW = {
  shadowColor: COLORS.shadow,
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
};
