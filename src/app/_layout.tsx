import { useEffect } from 'react';
import {
  useFonts,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, ThemeProvider } from 'expo-router';
import { navigationTheme, colors } from '@/theme';
import { ToastProvider } from '@/components';
import { AuthProvider } from '@/hooks/useAuth';

// Keep the splash screen visible until fonts load
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <AuthProvider>
        <ToastProvider>
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: colors.background,
              },
              headerTintColor: colors.text,
              contentStyle: {
                backgroundColor: colors.background,
              },
            }}
          />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
