export const Colors = {
  background: '#faf9f6', // Attendly warm off-white canvas
  surface: '#ffffff',    // Crisp white surface
  surfaceElevated: '#ffffff',
  surfaceMuted: '#f4f4f5',
  
  textPrimary: '#09090b',   // High-contrast neutral dark text
  textSecondary: '#71717a', // Neutral zinc secondary text
  textMuted: '#a1a1aa',
  textTertiary: '#a1a1aa',
  textInverse: '#ffffff',
  
  border: '#e4e4e7',        // Subtle hairline neutral border
  borderStrong: '#d4d4d8',  // Border for inactive tactile controls
  borderFocus: '#ea580c',   // Active orange focus border
  
  // Primary brand obsidian black
  primary: '#000000',
  primaryHover: '#27272a',

  // Premium Minimal Design Tokens
  navyAccent: '#334B67',
  navyAccentLight: '#f0f4f8',
  navyAccentMuted: '#476587',
  navyAccentBorder: '#d5e0ea',
  heroBg: '#18181B',
  heroText: '#FFFFFF',
  heroTextSecondary: '#D4D4D8',
  heroDivider: '#27272A',

  // Industrial international orange accent
  accent: '#ea580c',
  accentLight: '#fff7ed',   // Warm subtle background tint
  accentHover: '#c2410c',
  accentBorder: '#fed7aa',  // Subtle orange border
  
  // Semantic
  success: '#16a34a',
  successLight: '#ecfdf5',
  warning: '#d97706',
  warningLight: '#fffbeb',
  error: '#dc2626',
  errorLight: '#fff7ed',
  errorBorder: '#fed7aa',
  errorText: '#9a3412',
  
  // Work units highlight (monochrome primary)
  unitAbsent: '#dc2626',
  unitHalf: '#d97706',
  unitFull: '#000000',
  unitOvertime: '#16a34a',
  unitDouble: '#7c3aed',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
};

export const Typography = {
  fontSize: {
    xs: 12,
    sm: 13,
    md: 15,
    lg: 18,
    xl: 22,
    xxl: 26,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    heavy: '800' as const,
  },
  titleLarge: {
    fontSize: 26,
    fontWeight: '800' as const,
    lineHeight: 32,
    color: Colors.textPrimary,
  },
  titleMedium: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    color: Colors.textPrimary,
  },
  titleSmall: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
    color: Colors.textPrimary,
  },
  bodyRegular: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 20,
    color: Colors.textPrimary,
  },
  bodyMedium: {
    fontSize: 15,
    fontWeight: '500' as const,
    lineHeight: 20,
    color: Colors.textPrimary,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  captionMedium: {
    fontSize: 13,
    fontWeight: '500' as const,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  numericLarge: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    color: Colors.textPrimary,
  },
  numericMedium: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 26,
    color: Colors.textPrimary,
  },
};

export const TouchTarget = {
  min: 44,
  comfortable: 48,
  large: 54,
};

export const Shadows = {
  subtle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 4,
  },
};

export const Motion = {
  duration: {
    instant: 100,
    quick: 140,
    base: 220,
    enter: 280,
  },
  scale: {
    pressed: 0.96,
    subtlePressed: 0.97,
    default: 1.0,
    initial: 0.95,
  },
};
