/**
 * Hard offset shadow tokens with NO blur for neobrutalist style.
 * Uses shadowRadius: 0 and full shadowOpacity: 1.
 */
export const shadowOffsets = {
  sm: { width: 2, height: 2 },
  default: { width: 4, height: 4 },
  md: { width: 4, height: 4 },
  lg: { width: 6, height: 6 },
} as const;

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  default: {
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 6,
  },
} as const;

export type Shadows = typeof shadows;
export type ShadowKey = keyof Shadows;
