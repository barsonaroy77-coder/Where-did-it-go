/**
 * Theme color tokens for neobrutalist wallet-app style.
 * Light mode only.
 */
export const colors = {
  // Background & surface
  background: '#FAF7EE', // Warm cream background
  surface: '#FFFFFF', // White surface / card background

  // Text & borders
  text: '#000000', // Pure black text
  textSecondary: '#4A4A4A',
  textMuted: '#71717A',
  border: '#000000', // Pure black borders

  // Accent & status
  accent: '#FFE600', // Neobrutalist yellow accent
  positive: '#16A34A', // Green for saved / positive
  saved: '#16A34A', // Alias for positive savings
  negative: '#DC2626', // Red for overspent / deficits
  overspent: '#DC2626', // Alias for overspent amounts

  // Base utilities
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export type Colors = typeof colors;
export type ColorKey = keyof Colors;
