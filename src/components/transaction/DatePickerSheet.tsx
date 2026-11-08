import React, { useState, useMemo } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import {
  addMonths,
  getDaysInMonth,
  monthKey,
  todayLocal,
  isValidDateString,
} from '@/lib/dates';
import { isDateInRange, MIN_TRANSACTION_DATE } from '@/lib/transactionForm';

export interface DatePickerSheetProps {
  visible: boolean;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose: () => void;
  today?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const DatePickerSheet: React.FC<DatePickerSheetProps> = ({
  visible,
  selectedDate,
  onSelectDate,
  onClose,
  today: propToday,
}) => {
  const today = propToday ?? todayLocal();
  const currentMonthKey = monthKey(today);
  const minMonthKey = monthKey(MIN_TRANSACTION_DATE); // '2000-01'

  const initialViewMonth = useMemo(() => {
    if (isValidDateString(selectedDate)) {
      const key = monthKey(selectedDate);
      if (key <= currentMonthKey && key >= minMonthKey) {
        return key;
      }
    }
    return currentMonthKey;
  }, [selectedDate, currentMonthKey, minMonthKey]);

  // Track user navigation independently of props
  const [navMonth, setNavMonth] = useState<string | null>(null);

  const viewMonth = navMonth ?? initialViewMonth;

  const [yearStr, monthNumStr] = viewMonth.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthNumStr, 10);

  const canGoPrev = viewMonth > minMonthKey;
  const canGoNext = viewMonth < currentMonthKey;

  const handlePrevMonth = () => {
    if (canGoPrev) {
      setNavMonth(addMonths(viewMonth, -1));
    }
  };

  const handleNextMonth = () => {
    if (canGoNext) {
      setNavMonth(addMonths(viewMonth, 1));
    }
  };

  const handleDismiss = () => {
    setNavMonth(null);
    onClose();
  };

  // Compute days for calendar grid
  const daysInMonth = getDaysInMonth(year, monthNum);
  const firstDayOfWeek = new Date(year, monthNum - 1, 1).getDay(); // 0 (Sun) - 6 (Sat)

  const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${year}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPressable}
          accessibilityLabel="Close date picker"
          accessibilityRole="button"
          onPress={handleDismiss}
        />

        <View style={styles.sheetWrapper}>
          {/* Neobrutalist shadow */}
          <View style={styles.sheetShadow} />

          {/* Sheet face */}
          <View style={styles.sheetFace}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle} maxFontSizeMultiplier={1.5}>
                Pick Date
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close date picker sheet"
                onPress={handleDismiss}
                hitSlop={8}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </Pressable>
            </View>

            {/* Month Selector Bar */}
            <View style={styles.monthBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                accessibilityState={{ disabled: !canGoPrev }}
                disabled={!canGoPrev}
                onPress={handlePrevMonth}
                style={[styles.monthNavBtn, !canGoPrev && styles.monthNavBtnDisabled]}
              >
                <Text
                  style={[styles.monthNavBtnText, !canGoPrev && styles.monthNavBtnTextDisabled]}
                >
                  ◀
                </Text>
              </Pressable>

              <Text style={styles.monthTitle} maxFontSizeMultiplier={1.5}>
                {monthLabel}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                accessibilityState={{ disabled: !canGoNext }}
                disabled={!canGoNext}
                onPress={handleNextMonth}
                style={[styles.monthNavBtn, !canGoNext && styles.monthNavBtnDisabled]}
              >
                <Text
                  style={[styles.monthNavBtnText, !canGoNext && styles.monthNavBtnTextDisabled]}
                >
                  ▶
                </Text>
              </Pressable>
            </View>

            {/* Weekdays Row */}
            <View style={styles.weekdaysRow}>
              {WEEKDAY_NAMES.map((w) => (
                <View key={w} style={styles.weekdayCell}>
                  <Text style={styles.weekdayText}>{w}</Text>
                </View>
              ))}
            </View>

            {/* Days Grid */}
            <View style={styles.grid}>
              {/* Empty leading offset days */}
              {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                <View key={`empty-${idx}`} style={styles.dayCell} />
              ))}

              {/* Day numbers */}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const dayStr = String(day).padStart(2, '0');
                const cellDate = `${viewMonth}-${dayStr}`;
                const inRange = isDateInRange(cellDate, today);
                const isSelected = cellDate === selectedDate;

                return (
                  <View key={cellDate} style={styles.dayCell}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${MONTH_NAMES[monthNum - 1]} ${day}, ${year}`}
                      accessibilityState={{ selected: isSelected, disabled: !inRange }}
                      disabled={!inRange}
                      onPress={() => {
                        onSelectDate(cellDate);
                        handleDismiss();
                      }}
                      style={[
                        styles.dayButton,
                        isSelected && styles.dayButtonSelected,
                        !inRange && styles.dayButtonDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          isSelected && styles.dayTextSelected,
                          !inRange && styles.dayTextDisabled,
                        ]}
                        maxFontSizeMultiplier={1.5}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  backdropPressable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetWrapper: {
    width: '100%',
    maxWidth: 360,
    position: 'relative',
    marginRight: shadowOffsets.default.width,
    marginBottom: shadowOffsets.default.height,
  },
  sheetShadow: {
    position: 'absolute',
    top: shadowOffsets.default.height,
    left: shadowOffsets.default.width,
    right: -shadowOffsets.default.width,
    bottom: -shadowOffsets.default.height,
    backgroundColor: colors.border,
    borderRadius: radii.lg,
  },
  sheetFace: {
    backgroundColor: colors.surface,
    borderWidth: borderWidths.thick,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    color: colors.text,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  closeBtnText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    color: colors.text,
  },
  monthBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  monthNavBtn: {
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 36,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavBtnDisabled: {
    borderColor: '#D4D4D8',
    backgroundColor: '#F4F4F5',
  },
  monthNavBtnText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.xs,
    color: colors.text,
  },
  monthNavBtnTextDisabled: {
    color: '#A1A1AA',
  },
  monthTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.base,
    lineHeight: lineHeights.base,
    color: colors.text,
  },
  weekdaysRow: {
    flexDirection: 'row',
    borderBottomWidth: borderWidths.thin,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
    marginBottom: spacing.xs,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayButton: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  dayButtonSelected: {
    backgroundColor: colors.accent,
    borderWidth: borderWidths.regular,
    borderColor: colors.border,
  },
  dayButtonDisabled: {
    opacity: 0.3,
  },
  dayText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  dayTextSelected: {
    fontFamily: fonts.bold,
    color: colors.text,
  },
  dayTextDisabled: {
    color: colors.textMuted,
  },
});
