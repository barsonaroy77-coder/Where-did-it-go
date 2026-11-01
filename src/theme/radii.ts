/**
 * Border radius tokens for neobrutalist style.
 */
export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const radius = radii;

export type Radii = typeof radii;
export type RadiusKey = keyof Radii;
