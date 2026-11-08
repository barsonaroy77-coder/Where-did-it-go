import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDatabase } from '@/db';
import { TransactionRow, TransactionType } from '@/db/types';
import { createTransaction, updateTransaction } from '@/db/repositories/transactions';
import { useAuth } from '@/hooks/useAuth';
import { useCategories } from '@/hooks/useCategories';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { getCurrency } from '@/lib/currencies';
import { formatMinorUnits } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { applyKeypadKey } from '@/lib/amountKeypad';
import { deleteWithUndo } from '@/lib/transactionActions';
import {
  chooseDefaultCategory,
  cleanAmountInputForParse,
  getMostRecentCategoryIdForType,
  getQuickDate,
  validateTransactionForm,
} from '@/lib/transactionForm';
import { runSync } from '@/sync/engine';
import { MagicEntrySlot } from './MagicEntrySlot';
import { CustomKeypad } from './CustomKeypad';
import { DatePickerSheet } from './DatePickerSheet';
import {
  borderWidths,
  colors,
  fonts,
  fontSizes,
  lineHeights,
  radii,
  shadowOffsets,
  spacing,
} from '@/theme';

export interface TransactionFormProps {
  mode: 'add' | 'edit';
  initialTransaction?: TransactionRow;
  onSuccess: () => void;
  onCancel: () => void;
}

export const TransactionForm: React.FC<TransactionFormProps> = ({
  mode,
  initialTransaction,
  onSuccess,
  onCancel,
}) => {
  const { db } = useDatabase();
  const { user, profile } = useAuth();
  const toast = useToast();

  const decimals = profile?.currency_decimals ?? 2;
  const currencyCode = profile?.currency ?? 'USD';
  const currencySymbol = getCurrency(currencyCode)?.symbol ?? currencyCode;

  const today = todayLocal();

  // Form states
  const [type, setType] = useState<TransactionType>(
    initialTransaction?.type ?? 'expense'
  );

  const initialAmountStr = useMemo(() => {
    if (initialTransaction) {
      return formatMinorUnits(initialTransaction.amount, decimals);
    }
    return '';
  }, [initialTransaction, decimals]);

  const [amount, setAmount] = useState<string>(initialAmountStr);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(
    initialTransaction?.category_id
  );
  const [date, setDate] = useState<string>(initialTransaction?.date ?? today);
  const [note, setNote] = useState<string>(initialTransaction?.note ?? '');

  // UI state
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isSyncingCategories, setIsSyncingCategories] = useState(false);

  const noteInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // Categories for current type
  const { categories, loading: categoriesLoading } = useCategories(type);

  // Initialize or maintain default category in Add mode
  useEffect(() => {
    if (mode === 'add' && db) {
      let isMounted = true;
      getMostRecentCategoryIdForType(db, type).then((recentId) => {
        if (!isMounted) return;
        setSelectedCategoryId((prev) => {
          // If previous selection is still valid for this type, keep it
          if (prev && categories.some((c) => c.id === prev)) {
            return prev;
          }
          return chooseDefaultCategory(categories, recentId);
        });
      });
      return () => {
        isMounted = false;
      };
    }
  }, [mode, db, type, categories]);

  // Type change handling: "Changing the type clears the category if it no longer matches"
  const handleTypeChange = (newType: TransactionType) => {
    if (newType === type) return;
    setType(newType);
    setSelectedCategoryId((prev) => {
      if (!prev) return undefined;
      const matches = categories.some((c) => c.id === prev && c.type === newType);
      return matches ? prev : undefined;
    });
  };

  // Check for unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (mode === 'add') {
      return Boolean(
        amount !== '' ||
          date !== today ||
          note.trim() !== ''
      );
    }
    if (initialTransaction) {
      const cleanCurrent = cleanAmountInputForParse(amount);
      const cleanInitial = formatMinorUnits(initialTransaction.amount, decimals);
      return (
        type !== initialTransaction.type ||
        cleanCurrent !== cleanInitial ||
        selectedCategoryId !== initialTransaction.category_id ||
        date !== initialTransaction.date ||
        note.trim() !== (initialTransaction.note ?? '').trim()
      );
    }
    return false;
  }, [mode, amount, date, today, note, initialTransaction, decimals, type, selectedCategoryId]);

  const handleClose = () => {
    if (hasUnsavedChanges) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onCancel },
        ]
      );
    } else {
      onCancel();
    }
  };

  // Keypad key press handler
  const handleKeypadPress = (key: string) => {
    setAmount((prev) => applyKeypadKey(prev, key, decimals));
  };

  // Keyboard dismiss listener
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      setIsEditingNote(false);
    });
    return () => sub.remove();
  }, []);

  // Sync now for empty categories
  const handleSyncNow = async () => {
    if (!db || !user?.id || isSyncingCategories) return;
    setIsSyncingCategories(true);
    try {
      await runSync(db, user.id);
      toast.showToast({ message: 'Sync complete', variant: 'success' });
    } catch {
      toast.showToast({ message: 'Sync failed', variant: 'error' });
    } finally {
      setIsSyncingCategories(false);
    }
  };

  // Validation
  const validationResult = useMemo(() => {
    return validateTransactionForm(
      {
        amount,
        categoryId: selectedCategoryId,
        date,
        note,
        decimals,
      },
      today
    );
  }, [amount, selectedCategoryId, date, note, decimals, today]);

  // Form submission
  const handleSave = async () => {
    if (isSubmitting || !db) return;
    setHasAttemptedSave(true);

    if (!validationResult.isValid || !selectedCategoryId || validationResult.amountMinor === null) {
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedNote = note.trim();
      const noteToSave = trimmedNote.length > 0 ? trimmedNote : null;

      if (mode === 'add') {
        const res = await createTransaction(db, {
          type,
          amount: validationResult.amountMinor,
          category_id: selectedCategoryId,
          date,
          note: noteToSave,
        });

        if (res.ok) {
          toast.showToast({ message: 'Saved', variant: 'success' });
          onSuccess();
        } else {
          setIsSubmitting(false);
          toast.showToast({
            message: res.error || 'Failed to save transaction',
            variant: 'error',
          });
        }
      } else if (mode === 'edit' && initialTransaction) {
        const res = await updateTransaction(db, initialTransaction.id, {
          type,
          amount: validationResult.amountMinor,
          category_id: selectedCategoryId,
          date,
          note: noteToSave,
        });

        if (res.ok) {
          toast.showToast({ message: 'Saved', variant: 'success' });
          onSuccess();
        } else {
          setIsSubmitting(false);
          toast.showToast({
            message: res.error || 'Failed to save transaction',
            variant: 'error',
          });
        }
      }
    } catch (err: unknown) {
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      toast.showToast({ message: msg || 'An unexpected error occurred', variant: 'error' });
    }
  };

  // Delete transaction in Edit mode
  const handleDelete = async () => {
    if (!db || !initialTransaction || isDeleting) return;

    Alert.alert(
      'Delete transaction',
      'Are you sure you want to delete this transaction?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              const success = await deleteWithUndo(db, initialTransaction.id, toast);
              if (success) {
                onSuccess();
              } else {
                setIsDeleting(false);
              }
            } catch {
              setIsDeleting(false);
              toast.showToast({ message: 'Failed to delete transaction', variant: 'error' });
            }
          },
        },
      ]
    );
  };

  // Save button title and color calculation
  const hasValidAmount = Boolean(
    validationResult.amountMinor !== null && validationResult.amountMinor > 0
  );
  const hasUsableCategories = categories.length > 0;
  const isFormValid = validationResult.isValid && hasUsableCategories;

  let saveButtonTitle = 'Enter an amount to save';
  if (hasValidAmount && validationResult.amountMinor !== null) {
    const formatted = formatMinorUnits(validationResult.amountMinor, decimals);
    saveButtonTitle =
      type === 'income' ? `Save income (${formatted})` : `Save expense (${formatted})`;
  }

  const isSaveDisabled = !isFormValid || isSubmitting;

  // Amount display value
  const displayAmount = amount.length > 0 ? amount : decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';
  const isAmountEmpty = amount.length === 0;

  // Active date chip check
  const yesterday = getQuickDate('yesterday', today);
  const isTodaySelected = date === today;
  const isYesterdaySelected = date === yesterday;
  const isCustomDateSelected = !isTodaySelected && !isYesterdaySelected;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      {/* 1. Modal Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.5}>
          {mode === 'add' ? 'Add transaction' : 'Edit transaction'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* 2. Scrollable Body */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Magic natural-language entry slot (Part 8 placeholder) */}
        <MagicEntrySlot />

        {/* Validation Errors banner */}
        {hasAttemptedSave && !validationResult.isValid && (
          <View
            style={styles.errorBox}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {validationResult.errors.amount && (
              <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>
                • {validationResult.errors.amount}
              </Text>
            )}
            {validationResult.errors.category && (
              <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>
                • {validationResult.errors.category}
              </Text>
            )}
            {validationResult.errors.date && (
              <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>
                • {validationResult.errors.date}
              </Text>
            )}
            {validationResult.errors.note && (
              <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>
                • {validationResult.errors.note}
              </Text>
            )}
          </View>
        )}

        {/* Expense / Income segmented control */}
        <View style={styles.typeSelectorWrapper}>
          <View style={styles.typeSelectorShadow} />
          <View style={styles.typeSelectorFace}>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Expense"
              accessibilityState={{ selected: type === 'expense' }}
              onPress={() => handleTypeChange('expense')}
              style={[
                styles.typeOption,
                type === 'expense' && styles.typeOptionExpenseSelected,
              ]}
            >
              <Text
                style={[
                  styles.typeOptionText,
                  type === 'expense' && styles.typeOptionExpenseTextSelected,
                ]}
                maxFontSizeMultiplier={1.5}
              >
                ↘ Expense
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Income"
              accessibilityState={{ selected: type === 'income' }}
              onPress={() => handleTypeChange('income')}
              style={[
                styles.typeOption,
                type === 'income' && styles.typeOptionIncomeSelected,
              ]}
            >
              <Text
                style={[
                  styles.typeOptionText,
                  type === 'income' && styles.typeOptionIncomeTextSelected,
                ]}
                maxFontSizeMultiplier={1.5}
              >
                ↗ Income
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Empty Categories Warning */}
        {!categoriesLoading && !hasUsableCategories && (
          <View style={styles.emptyCategoriesCard}>
            <Text style={styles.emptyCategoriesText} maxFontSizeMultiplier={1.5}>
              Categories appear after your first sync.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              title="Sync now"
              loading={isSyncingCategories}
              onPress={handleSyncNow}
            />
          </View>
        )}

        {/* Amount Display Box */}
        <View style={styles.amountCardWrapper}>
          <View style={styles.amountCardShadow} />
          <View style={styles.amountCardFace}>
            <View style={styles.amountCardTopRow}>
              <Text style={styles.flowLabel} maxFontSizeMultiplier={1.5}>
                {type === 'expense' ? 'OUTFLOW RECORD' : 'INFLOW RECORD'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="clear amount"
                onPress={() => setAmount('')}
                hitSlop={8}
                style={styles.clrButton}
              >
                <Text style={styles.clrButtonText}>CLR</Text>
              </Pressable>
            </View>

            <View
              style={styles.amountDisplayRow}
              accessibilityRole="text"
              accessibilityLabel={`Amount: ${amount || '0'} ${currencyCode}`}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.currencySymbolText} maxFontSizeMultiplier={1.5}>
                {currencySymbol}
              </Text>
              <Text
                style={[
                  styles.amountText,
                  isAmountEmpty && styles.amountTextPlaceholder,
                ]}
                maxFontSizeMultiplier={1.5}
              >
                {displayAmount}
              </Text>
              <Text style={styles.cursorText}>▌</Text>
            </View>
          </View>
        </View>

        {/* Category Chips Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel} maxFontSizeMultiplier={1.5}>
            CATEGORY
          </Text>
          <View style={styles.chipsWrap}>
            {categories.map((cat) => {
              const isSelected = selectedCategoryId === cat.id;
              return (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  selected={isSelected}
                  accessibilityLabel={`${cat.name} category`}
                  onPress={() => setSelectedCategoryId(cat.id)}
                />
              );
            })}
          </View>
        </View>

        {/* Date Quick Chips Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel} maxFontSizeMultiplier={1.5}>
            TIMELINE & DETAILS
          </Text>
          <View style={styles.chipsRow}>
            <Chip
              label="Today"
              selected={isTodaySelected}
              accessibilityLabel="Today's date"
              onPress={() => setDate(today)}
            />
            <Chip
              label="Yesterday"
              selected={isYesterdaySelected}
              accessibilityLabel="Yesterday's date"
              onPress={() => setDate(yesterday)}
            />
            <Chip
              label={isCustomDateSelected ? `Pick date (${date})` : 'Pick date 📅'}
              selected={isCustomDateSelected}
              accessibilityLabel="Pick custom date"
              onPress={() => setIsDatePickerVisible(true)}
            />
          </View>
        </View>

        {/* Note Row */}
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a note"
            onPress={() => {
              setIsEditingNote(true);
              setTimeout(() => {
                noteInputRef.current?.focus();
              }, 50);
            }}
            style={styles.noteRowWrapper}
          >
            <View style={styles.noteRowFace}>
              <Text style={styles.noteIconText}>≡</Text>
              <TextInput
                ref={noteInputRef}
                value={note}
                onChangeText={setNote}
                placeholder="Add a note or receipt tag..."
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Transaction note"
                maxLength={500}
                onFocus={() => setIsEditingNote(true)}
                onBlur={() => setIsEditingNote(false)}
                style={styles.noteInput}
                maxFontSizeMultiplier={1.5}
              />
              {isEditingNote && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Done editing note"
                  onPress={() => {
                    Keyboard.dismiss();
                    setIsEditingNote(false);
                  }}
                  style={styles.noteDoneBtn}
                >
                  <Text style={styles.noteDoneBtnText}>Done</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </View>

        {/* Edit mode only: Delete button in scroll view */}
        {mode === 'edit' && (
          <View style={styles.deleteSection}>
            <Button
              variant="danger"
              size="md"
              title="Delete transaction"
              fullWidth
              loading={isDeleting}
              disabled={isDeleting || isSubmitting}
              accessibilityLabel="Delete transaction"
              onPress={handleDelete}
            />
          </View>
        )}
      </ScrollView>

      {/* 3. Pinned Bottom Section */}
      <View style={styles.bottomPinned}>
        {/* Custom number keypad (hidden when system keyboard is active for note editing) */}
        {!isEditingNote && (
          <CustomKeypad onKeyPress={handleKeypadPress} decimals={decimals} />
        )}

        {/* Save button: green for income, yellow for expense */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          title={saveButtonTitle}
          disabled={isSaveDisabled}
          loading={isSubmitting}
          accessibilityLabel={saveButtonTitle}
          onPress={handleSave}
          contentStyle={[
            type === 'income' && !isSaveDisabled && styles.saveIncomeButtonFace,
          ]}
          textStyle={[
            type === 'income' && !isSaveDisabled && styles.saveIncomeButtonText,
          ]}
        />
      </View>

      {/* In-app Date Picker Sheet */}
      <DatePickerSheet
        visible={isDatePickerVisible}
        selectedDate={date}
        onSelectDate={setDate}
        onClose={() => setIsDatePickerVisible(false)}
        today={today}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: borderWidths.thin,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xl,
    lineHeight: lineHeights.xl,
    color: colors.text,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  closeBtnText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    color: colors.text,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderWidth: borderWidths.thick,
    borderColor: colors.negative,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 4,
  },
  errorText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    color: colors.negative,
  },
  typeSelectorWrapper: {
    width: '100%',
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: shadowOffsets.default.height,
  },
  typeSelectorShadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    right: -shadowOffsets.default.width,
    bottom: -shadowOffsets.default.height,
    backgroundColor: colors.border,
    borderRadius: radii.lg,
  },
  typeSelectorFace: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 4,
    gap: 6,
  },
  typeOption: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: 'transparent',
  },
  typeOptionExpenseSelected: {
    backgroundColor: '#FEE2E2', // Neobrutalist red accent
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
  },
  typeOptionIncomeSelected: {
    backgroundColor: colors.positive, // Green accent
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
  },
  typeOptionText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.text,
  },
  typeOptionExpenseTextSelected: {
    color: colors.negative,
  },
  typeOptionIncomeTextSelected: {
    color: colors.white,
  },
  emptyCategoriesCard: {
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  emptyCategoriesText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.textSecondary,
  },
  amountCardWrapper: {
    width: '100%',
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: shadowOffsets.default.height,
  },
  amountCardShadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    right: -shadowOffsets.default.width,
    bottom: -shadowOffsets.default.height,
    backgroundColor: colors.border,
    borderRadius: radii.lg,
  },
  amountCardFace: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    minHeight: 120,
    justifyContent: 'space-between',
  },
  amountCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flowLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  clrButton: {
    borderWidth: borderWidths.regular,
    borderColor: colors.negative,
    borderRadius: radii.sm,
    backgroundColor: '#FEE2E2',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  clrButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.negative,
  },
  amountDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  currencySymbolText: {
    fontFamily: fonts.bold,
    fontSize: 36,
    color: colors.text,
  },
  amountText: {
    fontFamily: fonts.bold,
    fontSize: 56,
    color: colors.text,
  },
  amountTextPlaceholder: {
    color: colors.textMuted,
  },
  cursorText: {
    fontFamily: fonts.bold,
    fontSize: 48,
    color: colors.accent,
  },
  section: {
    gap: spacing.xs,
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  noteRowWrapper: {
    width: '100%',
  },
  noteRowFace: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  noteIconText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    color: colors.textSecondary,
  },
  noteInput: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.text,
    minHeight: 38,
    paddingVertical: 0,
  },
  noteDoneBtn: {
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  noteDoneBtnText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.text,
  },
  deleteSection: {
    marginTop: spacing.sm,
  },
  bottomPinned: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: colors.background,
    borderTopWidth: borderWidths.thin,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  saveIncomeButtonFace: {
    backgroundColor: colors.positive,
  },
  saveIncomeButtonText: {
    color: colors.white,
  },
});
