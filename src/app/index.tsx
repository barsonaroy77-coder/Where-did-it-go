import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
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

const COLOR_SWATCHES = [
  { name: 'Cream', token: 'colors.background', hex: colors.background },
  { name: 'Accent', token: 'colors.accent', hex: colors.accent },
  { name: 'Green', token: 'colors.positive', hex: colors.positive },
  { name: 'Red', token: 'colors.negative', hex: colors.negative },
  { name: 'Black', token: 'colors.black', hex: colors.black },
] as const;

export default function Index() {
  const { showToast } = useToast();

  const [normalInput, setNormalInput] = useState('');
  const [errorInput, setErrorInput] = useState('invalid-amount');
  const [interactiveChipSelected, setInteractiveChipSelected] = useState(false);

  return (
    <>
      <Stack.Screen options={{ title: 'Style Demo' }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Style Guide Demo</Text>
          <Text style={styles.headerSubtitle}>
            Showcase of neobrutalist components and theme tokens.
          </Text>
        </View>

        {/* Color Swatches */}
        <Card title="Color Swatches">
          <View style={styles.swatchList}>
            {COLOR_SWATCHES.map((swatch, index) => (
              <View
                key={swatch.name}
                style={[
                  styles.swatchRow,
                  index < COLOR_SWATCHES.length - 1 && styles.swatchDivider,
                ]}
              >
                <View
                  style={[styles.swatchColorBox, { backgroundColor: swatch.hex }]}
                />
                <View style={styles.swatchInfo}>
                  <Text style={styles.swatchName}>{swatch.name}</Text>
                  <Text style={styles.swatchHex}>{swatch.hex}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        {/* Buttons */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Buttons</Text>
          <View style={styles.buttonList}>
            <Button
              variant="primary"
              title="Primary Button"
              onPress={() => showToast('Primary button pressed')}
            />
            <Button
              variant="secondary"
              title="Secondary Button"
              onPress={() => showToast('Secondary button pressed')}
            />
            <Button
              variant="danger"
              title="Danger Button"
              onPress={() =>
                showToast({
                  message: 'Danger button clicked',
                  variant: 'error',
                })
              }
            />
            <Button
              disabled
              title="Disabled Button"
              onPress={() => {}}
            />
            <Button
              loading
              title="Loading Button"
              onPress={() => {}}
            />
            <Button
              fullWidth
              title="Full Width Button"
              onPress={() => showToast('Full width button pressed')}
            />
          </View>
        </View>

        {/* Cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cards</Text>
          <Card title="Card with Title">
            <Text style={styles.cardContentText}>
              This card has a bold title header and standard neobrutalist offset shadow.
            </Text>
          </Card>
          <Card>
            <Text style={styles.cardContentText}>
              This card is created without a title. It wraps content in the same bordered surface.
            </Text>
          </Card>
        </View>

        {/* Inputs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inputs</Text>
          <Input
            label="Normal Input"
            placeholder="Type some text here..."
            value={normalInput}
            onChangeText={setNormalInput}
            hint="Helper hint: try typing into this field"
          />
          <Input
            label="Error State Input"
            placeholder="Enter a valid value..."
            value={errorInput}
            onChangeText={setErrorInput}
            error="Please enter a valid numeric value"
          />
        </View>

        {/* Chips */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Chips</Text>
          <View style={styles.chipRow}>
            <Chip
              label="Selected Chip"
              selected={true}
              onPress={() => showToast('Selected chip clicked')}
            />
            <Chip
              label="Unselected Chip"
              selected={false}
              onPress={() => showToast('Unselected chip clicked')}
            />
            <Chip
              label={
                interactiveChipSelected
                  ? 'Interactive (Selected)'
                  : 'Interactive (Unselected)'
              }
              selected={interactiveChipSelected}
              onPress={() =>
                setInteractiveChipSelected((previous) => !previous)
              }
            />
          </View>
        </View>

        {/* Toast Triggers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Toast Triggers</Text>
          <View style={styles.buttonList}>
            <Button
              variant="secondary"
              title="Trigger Default Toast"
              onPress={() =>
                showToast({
                  message: 'This is a default notification message.',
                  variant: 'default',
                })
              }
            />
            <Button
              variant="secondary"
              title="Trigger Success Toast"
              onPress={() =>
                showToast({
                  message: 'Budget saved successfully!',
                  variant: 'success',
                })
              }
            />
            <Button
              variant="secondary"
              title="Trigger Error Toast"
              onPress={() =>
                showToast({
                  message: 'Failed to update transaction.',
                  variant: 'error',
                })
              }
            />
            <Button
              variant="primary"
              title="Trigger Toast with Undo"
              onPress={() =>
                showToast({
                  message: 'Item removed from budget',
                  variant: 'default',
                  action: {
                    label: 'Undo',
                    onPress: () =>
                      showToast({
                        message: 'Item restored!',
                        variant: 'success',
                      }),
                  },
                })
              }
            />
          </View>
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
  container: {
    padding: spacing.md,
    paddingBottom: spacing['3xl'],
    gap: spacing.lg,
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
    lineHeight: lineHeights.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
  },
  swatchList: {
    gap: spacing.xs,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  swatchDivider: {
    borderBottomWidth: borderWidths.thin,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  swatchColorBox: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
  },
  swatchInfo: {
    flex: 1,
  },
  swatchName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.text,
  },
  swatchHex: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
  },
  buttonList: {
    gap: spacing.sm,
  },
  cardContentText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
