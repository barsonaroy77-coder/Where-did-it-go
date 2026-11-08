import React from 'react';
import { Stack } from 'expo-router';
import { SyncInspectorScreen } from '@/screens/SyncInspectorScreen';

export default function DevSyncRoute() {
  if (!__DEV__) {
    return null;
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          title: 'Sync Inspector',
        }}
      />
      <SyncInspectorScreen />
    </>
  );
}
