import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { todayLocal, firstOfMonth, addMonths } from './dates';

export interface MonthContextValue {
  /** The currently selected month as a first-of-month 'YYYY-MM-01' string */
  selectedMonth: string;
  /** The current calendar month as a first-of-month 'YYYY-MM-01' string */
  currentMonth: string;
  /** Whether navigation to the next month is allowed (cannot go past current month) */
  canGoNext: boolean;
  /** Navigate to the previous calendar month */
  goToPrevious: () => void;
  /** Navigate to the next calendar month (clamped to current month) */
  goToNext: () => void;
  /** Navigate immediately to the current calendar month */
  goToCurrent: () => void;
}

export const MonthContext = createContext<MonthContextValue | undefined>(undefined);

export interface MonthProviderProps {
  children: React.ReactNode;
  initialMonth?: string;
}

/**
 * Calculates the previous calendar month as 'YYYY-MM-01'.
 */
export function getPreviousMonth(selectedMonth: string): string {
  return firstOfMonth(addMonths(selectedMonth, -1));
}

/**
 * Calculates the next calendar month clamped to currentMonth (cannot advance past currentMonth).
 */
export function getNextMonth(selectedMonth: string, currentMonth: string): string {
  if (selectedMonth >= currentMonth) {
    return selectedMonth;
  }
  const next = firstOfMonth(addMonths(selectedMonth, 1));
  return next > currentMonth ? currentMonth : next;
}

/**
 * MonthProvider:
 * Manages the global selected month state for financial calculations and screens.
 * Defaults to the current month on the device's local date.
 * Prevents navigating into future months.
 */
export const MonthProvider: React.FC<MonthProviderProps> = ({
  children,
  initialMonth,
}) => {
  const currentMonth = useMemo(() => firstOfMonth(todayLocal()), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return initialMonth ? firstOfMonth(initialMonth) : currentMonth;
  });

  const canGoNext = selectedMonth < currentMonth;

  const goToPrevious = useCallback(() => {
    setSelectedMonth((prev) => getPreviousMonth(prev));
  }, []);

  const goToNext = useCallback(() => {
    setSelectedMonth((prev) => getNextMonth(prev, currentMonth));
  }, [currentMonth]);

  const goToCurrent = useCallback(() => {
    setSelectedMonth(currentMonth);
  }, [currentMonth]);

  const value = useMemo<MonthContextValue>(
    () => ({
      selectedMonth,
      currentMonth,
      canGoNext,
      goToPrevious,
      goToNext,
      goToCurrent,
    }),
    [selectedMonth, currentMonth, canGoNext, goToPrevious, goToNext, goToCurrent]
  );

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>;
};

/**
 * Hook to access the month context.
 */
export function useMonth(): MonthContextValue {
  const context = useContext(MonthContext);
  if (!context) {
    throw new Error('useMonth must be used within a MonthProvider');
  }
  return context;
}
