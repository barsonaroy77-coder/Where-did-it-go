import { DefaultTheme, type Theme as NavigationTheme } from 'expo-router';
import { colors } from './colors';

/**
 * Light mode React Navigation theme for Expo Router.
 */
export const navigationTheme: NavigationTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.text,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.negative,
  },
};
