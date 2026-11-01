import { colors } from './colors';
import { borders, borderWidths } from './borders';
import { shadows, shadowOffsets } from './shadows';
import { spacing } from './spacing';
import { radii, radius } from './radii';
import { fonts, fontSizes, lineHeights } from './typography';
import { navigationTheme } from './navigation';

export * from './colors';
export * from './borders';
export * from './shadows';
export * from './spacing';
export * from './radii';
export * from './typography';
export * from './navigation';

export const theme = {
  colors,
  borders,
  borderWidths,
  shadows,
  shadowOffsets,
  spacing,
  radii,
  radius,
  fonts,
  fontSizes,
  lineHeights,
  navigation: navigationTheme,
} as const;

export type Theme = typeof theme;

export default theme;
