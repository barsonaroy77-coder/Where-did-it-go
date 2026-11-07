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
import { AuthProvider, useAuth } from '@/hooks/useAuth';

// Keep the splash screen visible until fonts and initial auth state are ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore in environments where splash screen cannot be controlled
});

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {
        // Ignore splash screen hide errors if already hidden
      });
    }
  }, [isLoading, fontsLoaded]);

  // Keep splash screen visible until both fonts and stored auth session are resolved
  if (isLoading || !fontsLoaded) {
    return null;
  }

  return (
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
    >
      {/* Protected routes: reachable only when signed in */}
      <Stack.Protected guard={isAuthenticated} redirectTo="/welcome">
        <Stack.Screen
          name="index"
          options={{
            headerShown: false,
            title: 'Dashboard',
          }}
        />
        <Stack.Screen
          name="dashboard"
          options={{
            headerShown: false,
            title: 'Dashboard',
          }}
        />
      </Stack.Protected>

      {/* Public auth route: reachable only when signed out */}
      <Stack.Protected guard={!isAuthenticated} redirectTo="/">
        <Stack.Screen
          name="welcome"
          options={{
            headerShown: false,
            title: 'Welcome',
          }}
        />
      </Stack.Protected>

      {/* Dev-only route: reachable only in development (__DEV__) */}
      <Stack.Protected
        guard={Boolean(__DEV__)}
        redirectTo={isAuthenticated ? '/' : '/welcome'}
      >
        <Stack.Screen
          name="style-demo"
          options={{
            title: 'Style Demo',
            headerBackTitle: isAuthenticated ? 'Dashboard' : 'Welcome',
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  const isFontReady = Boolean(fontsLoaded || fontError);

  return (
    <ThemeProvider value={navigationTheme}>
      <ToastProvider>
        <AuthProvider>
          <RootNavigator fontsLoaded={isFontReady} />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
