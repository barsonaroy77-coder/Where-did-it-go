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
import { DatabaseProvider, useDatabase } from '@/db';
import { MonthProvider } from '@/lib/MonthProvider';

// Keep the splash screen visible until fonts and initial auth state are ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore in environments where splash screen cannot be controlled
});

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isAuthenticated, isLoading, profile, profileLoading } = useAuth();
  const { isReady: isDbReady } = useDatabase();

  // Keep splash screen visible until fonts and initial auth state are ready.
  // For a signed-in user, keep the splash screen up until the profile and database are ready.
  // Signed-out users do not open any database and proceed once auth resolves.
  const isReady =
    fontsLoaded &&
    !isLoading &&
    (isAuthenticated ? !profileLoading && isDbReady : true);

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
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="dashboard"
          options={{
            headerShown: false,
            title: 'Dashboard',
          }}
        />
        <Stack.Screen
          name="add/index"
          options={{
            presentation: 'modal',
            title: 'Add Transaction',
          }}
        />
        <Stack.Screen
          name="add/[id]"
          options={{
            presentation: 'modal',
            title: 'Edit Transaction',
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            headerBackTitle: 'Back',
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
        <Stack.Screen
          name="dev-sync"
          options={{
            headerShown: false,
            title: 'Sync Inspector',
            headerBackTitle: 'Dashboard',
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
          <DatabaseProvider>
            <MonthProvider>
              <RootNavigator fontsLoaded={isFontReady} />
            </MonthProvider>
          </DatabaseProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
