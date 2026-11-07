import React from 'react';
import { Stack } from 'expo-router';
import { DashboardScreen } from '@/screens/DashboardScreen';

export default function IndexRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          title: 'Dashboard',
        }}
      />
      <DashboardScreen />
    </>
  );
}
