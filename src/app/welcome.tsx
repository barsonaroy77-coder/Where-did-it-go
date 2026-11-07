import React from 'react';
import { Stack, router } from 'expo-router';
import { WelcomeScreen } from '@/screens/WelcomeScreen';

export default function WelcomeRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          title: 'Welcome',
        }}
      />
      <WelcomeScreen
        onNavigateToDemo={__DEV__ ? () => router.push('/style-demo') : undefined}
      />
    </>
  );
}
