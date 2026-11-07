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
  const { isAuthenticated, isLoading, profile, profileLoading } = useAuth();

  // Keep splash screen visible until both fonts and stored auth session + profile are resolved
  const isReady = fontsLoaded && !isLoading && !profileLoading;

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch(() => {
        // Ignore splash screen hide errors if already hidden
      });
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  const hasProfile = Boolean(profile);

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
      {/* Protected routes: reachable only when signed in with a profile */}
      <Stack.Protected
        guard={isAuthenticated && hasProfile}
        redirectTo={!isAuthenticated ? '/welcome' : '/onboarding'}
      >
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

      {/* Onboarding route: reachable only when signed in with no profile */}
      <Stack.Protected
        guard={isAuthenticated && !hasProfile}
        redirectTo={!isAuthenticated ? '/welcome' : '/'}
      >
        <Stack.Screen
          name="onboarding"
          options={{
            headerShown: false,
            title: 'Onboarding',
          }}
        />
      </Stack.Protected>

      {/* Public auth route: reachable only when signed out */}
      <Stack.Protected
        guard={!isAuthenticated}
        redirectTo={hasProfile ? '/' : '/onboarding'}
      >
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
        redirectTo={!isAuthenticated ? '/welcome' : hasProfile ? '/' : '/onboarding'}
      >
        <Stack.Screen
          name="style-demo"
          options={{
            title: 'Style Demo',
            headerBackTitle: isAuthenticated ? (hasProfile ? 'Dashboard' : 'Onboarding') : 'Welcome',
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
