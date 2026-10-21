import { Platform } from 'react-native';

export const colors = {
  bg: '#09090b',
  surface: '#141417',
  surfaceRaised: '#1c1c21',
  border: '#27272a',
  text: '#f4f4f5',
  textMuted: '#a1a1aa',
  textFaint: '#71717a',
  accent: '#34d399',
  accentSoft: 'rgba(52, 211, 153, 0.12)',
  danger: '#f87171',
  dangerSoft: 'rgba(248, 113, 113, 0.12)',
  warning: '#fbbf24',
  warningSoft: 'rgba(251, 191, 36, 0.12)',
  info: '#38bdf8',
  infoSoft: 'rgba(56, 189, 248, 0.12)',
  violet: '#a78bfa',
  violetSoft: 'rgba(167, 139, 250, 0.12)',
} as const;

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;

export const methodColors: Record<string, string> = {
  GET: colors.info,
  POST: colors.accent,
  PUT: colors.warning,
  PATCH: colors.violet,
  DELETE: colors.danger,
};
