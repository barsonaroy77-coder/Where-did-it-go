import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import {
  colors,
  fonts,
  fontSizes,
  lineHeights,
  radii,
  borderWidths,
  spacing,
} from '@/theme';
import { Button, Card, Chip, Input, useToast } from '@/components';
import { useAuth } from '@/hooks/useAuth';

const COLOR_SWATCHES = [
  { name: 'Cream', token: 'colors.background', hex: colors.background },
  { name: 'Accent', token: 'colors.accent', hex: colors.accent },
  { name: 'Green', token: 'colors.positive', hex: colors.positive },
  { name: 'Red', token: 'colors.negative', hex: colors.negative },
  { name: 'Black', token: 'colors.black', hex: colors.black },
] as const;

/**
 * Neobrutalist Style Guide Showcase screen.
 * Moved to /style-demo and reachable ONLY in development (__DEV__).
 */
export default function StyleDemo() {
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();

  const [normalInput, setNormalInput] = useState('');
  const [errorInput, setErrorInput] = useState('invalid-amount');
  const [interactiveChipSelected, setInteractiveChipSelected] = useState(false);

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(isAuthenticated ? '/' : '/welcome');
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Style Demo',
          headerBackTitle: isAuthenticated ? 'Dashboard' : 'Welcome',
        }}
      />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Style Guide Demo</Text>
          <Text style={styles.headerSubtitle}>
            Phase 1 Neobrutalist design system component showcase
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleBack}
            title="← Back"
            style={styles.backButton}
          />
        </View>

        {/* Color Palette */}
        <Card title="Colors" style={styles.sectionCard}>
          <View style={styles.swatchGrid}>
            {COLOR_SWATCHES.map((swatch) => (
              <View key={swatch.token} style={styles.swatchItem}>
                <View
                  style={[
                    styles.swatchBox,
                    { backgroundColor: swatch.hex },
                    swatch.hex === colors.background && styles.creamSwatchBorder,
                  ]}
                />
                <Text style={styles.swatchName}>{swatch.name}</Text>
                <Text style={styles.swatchHex}>{swatch.hex}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Buttons */}
        <Card title="Buttons" style={styles.sectionCard}>
          <View style={styles.componentStack}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => showToast({ message: 'Primary button pressed', variant: 'default' })}
              title="Primary Action (Lg)"
            />
            <Button
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => showToast({ message: 'Secondary button pressed', variant: 'default' })}
              title="Secondary Action (Md)"
            />
            <Button
              variant="danger"
              size="md"
              fullWidth
              onPress={() => showToast({ message: 'Danger button pressed', variant: 'error' })}
              title="Danger Action"
            />
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading
              title="Loading State"
            />
          </View>
        </Card>

        {/* Inputs */}
        <Card title="Inputs" style={styles.sectionCard}>
          <View style={styles.componentStack}>
            <Input
              label="Standard Input"
              placeholder="Enter text..."
              value={normalInput}
              onChangeText={setNormalInput}
              hint="Helper hint text"
            />
            <Input
              label="Input with Error"
              value={errorInput}
              onChangeText={setErrorInput}
              error="Please enter a valid format."
            />
          </View>
        </Card>

        {/* Chips */}
        <Card title="Chips" style={styles.sectionCard}>
          <View style={styles.chipRow}>
            <Chip
              label="Default"
              selected={interactiveChipSelected}
              onPress={() => setInteractiveChipSelected(!interactiveChipSelected)}
            />
            <Chip label="Selected" selected />
            <Chip label="Disabled" disabled />
          </View>
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.xs,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes['2xl'],
    lineHeight: lineHeights['2xl'],
    color: colors.text,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  backButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  sectionCard: {
    marginBottom: spacing.xs,
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatchItem: {
    alignItems: 'center',
    width: 60,
  },
  swatchBox: {
    width: 48,
    height: 48,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  creamSwatchBorder: {
    borderStyle: 'dashed',
  },
  swatchName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.text,
    marginTop: spacing.xs,
  },
  swatchHex: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textSecondary,
  },
  componentStack: {
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
