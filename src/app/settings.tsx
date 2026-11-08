import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { Button, EmptyState, useToast } from '@/components';
import { colors, fonts, fontSizes, lineHeights, spacing } from '@/theme';
import { useAuth } from '@/hooks/useAuth';

export default function SettingsRoute() {
  const { user, profile, signOut } = useAuth();
  const { showToast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      showToast({ message: 'Signed out successfully', variant: 'default' });
    } catch {
      showToast({ message: 'Error signing out', variant: 'error' });
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Settings',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerBackTitle: 'Back',
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>
        <EmptyState
          title="Settings & Preferences"
          message={`Currency: ${profile?.currency ?? 'USD'} | Account: ${user?.email ?? 'User'}. Full preferences, budgets, recurring rules, and export will appear here.`}
        />

        <View style={styles.footer}>
          <Button
            variant="danger"
            size="lg"
            fullWidth
            loading={isSigningOut}
            disabled={isSigningOut}
            onPress={handleSignOut}
            title="Sign Out"
          />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.text,
    marginBottom: spacing.sm,
  },
  footer: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
});
