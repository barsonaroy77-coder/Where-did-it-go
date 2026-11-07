import React from 'react';
import { Stack, router } from 'expo-router';
import { WelcomeScreen } from '@/screens/WelcomeScreen';

export default function IndexRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          title: 'Where Did It Go?',
        }}
      />
      <WelcomeScreen onNavigateToDemo={() => router.push('/demo')} />
    </>
  );
}
