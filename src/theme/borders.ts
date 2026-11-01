/**
 * Neobrutalist border tokens (2px and 3px solid black).
 */
export const borderWidths = {
  regular: 2,
  thick: 3,
  // Convenience aliases
  thin: 2,
  default: 2,
} as const;

export const borders = {
  color: '#000000',
  width: borderWidths,
  regular: {
    borderWidth: 2,
    borderColor: '#000000',
  },
  thick: {
    borderWidth: 3,
    borderColor: '#000000',
  },
} as const;

export type BorderWidths = typeof borderWidths;
export type Borders = typeof borders;
