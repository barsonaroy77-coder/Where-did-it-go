import {
  monthlySummary,
  getDeficitDisplayMessage,
  goalProgress,
  budgetStatus,
  changePercent,
  isMonthToDate,
  TransactionLike,
} from '../calculations';

describe('calculations.ts', () => {
  describe('monthlySummary', () => {
    it('calculates income, spent, and saved for the calendar month', () => {
      const txs: TransactionLike[] = [
        { amount: 10000, type: 'income', date: '2026-11-01' },
        { amount: 3000, type: 'expense', date: '2026-11-15' },
        // Transaction on the last day of the month must count
        { amount: 2000, type: 'expense', date: '2026-11-30' },
        // Transaction in another month must not count
        { amount: 5000, type: 'income', date: '2026-12-01' },
        { amount: 5000, type: 'income', date: '2026-10-31' },
      ];

      const summary = monthlySummary(txs, '2026-11-01');
      expect(summary.income).toBe(10000);
      expect(summary.spent).toBe(5000);
      expect(summary.saved).toBe(5000);
      expect(summary.transactionCount).toBe(3);
    });

    it('strictly excludes soft-deleted rows', () => {
      const txs: TransactionLike[] = [
        { amount: 10000, type: 'income', date: '2026-11-05', deleted_at: null },
        { amount: 4000, type: 'expense', date: '2026-11-10', deleted_at: '2026-11-10T12:00:00Z' },
        { amount: 1500, type: 'expense', date: '2026-11-12' }, // deleted_at undefined
      ];

      const summary = monthlySummary(txs, '2026-11');
      expect(summary.income).toBe(10000);
      expect(summary.spent).toBe(1500);
      expect(summary.saved).toBe(8500);
      expect(summary.transactionCount).toBe(2);
    });

    it('handles negative saved amount correctly when spent > income', () => {
      const txs: TransactionLike[] = [
        { amount: 2000, type: 'income', date: '2026-11-01' },
        { amount: 5000, type: 'expense', date: '2026-11-02' },
      ];

      const summary = monthlySummary(txs, '2026-11-01');
      expect(summary.income).toBe(2000);
      expect(summary.spent).toBe(5000);
      expect(summary.saved).toBe(-3000);
    });
  });

  describe('getDeficitDisplayMessage', () => {
    it('returns the exact display message without the word "debt" when saved < 0', () => {
      // 3000 minor units with 2 decimals is 30.00
      const msg = getDeficitDisplayMessage(-3000, 2);
      expect(msg).toBe('Spent 30.00 more than earned.');
      expect(msg?.toLowerCase()).not.toContain('debt');

      // With currency symbol
      const msgWithSymbol = getDeficitDisplayMessage(-450, 2, '$');
      expect(msgWithSymbol).toBe('Spent $4.50 more than earned.');
      expect(msgWithSymbol?.toLowerCase()).not.toContain('debt');
    });

    it('returns null when saved >= 0', () => {
      expect(getDeficitDisplayMessage(0, 2)).toBeNull();
      expect(getDeficitDisplayMessage(5000, 2)).toBeNull();
    });
  });

  describe('goalProgress', () => {
    it('clamps progress below 0 and above 1, but returns raw savedAmount', () => {
      // Negative saved: progress clamped to 0, raw saved returned
      const negativeResult = goalProgress(-500, 1000);
      expect(negativeResult.progress).toBe(0);
      expect(negativeResult.savedAmount).toBe(-500);
      expect(negativeResult.isCompleted).toBe(false);

      // Zero saved: progress is 0
      const zeroResult = goalProgress(0, 1000);
      expect(zeroResult.progress).toBe(0);
      expect(zeroResult.savedAmount).toBe(0);

      // Normal progress: 50%
      const halfResult = goalProgress(500, 1000);
      expect(halfResult.progress).toBe(0.5);
      expect(halfResult.savedAmount).toBe(500);
      expect(halfResult.isCompleted).toBe(false);

      // Target exactly reached
      const exactResult = goalProgress(1000, 1000);
      expect(exactResult.progress).toBe(1);
      expect(exactResult.savedAmount).toBe(1000);
      expect(exactResult.isCompleted).toBe(true);

      // Above target: progress clamped to 1, raw saved shows exceeding amount
      const overResult = goalProgress(1500, 1000);
      expect(overResult.progress).toBe(1);
      expect(overResult.savedAmount).toBe(1500);
      expect(overResult.isCompleted).toBe(true);
    });

    it('handles targetAmount <= 0 gracefully', () => {
      const res = goalProgress(500, 0);
      expect(res.progress).toBe(0);
      expect(res.savedAmount).toBe(500);
      expect(res.isCompleted).toBe(false);
    });
  });

  describe('budgetStatus', () => {
    it('evaluates budget status at exactly 80% and exactly 100%', () => {
      const limit = 10000;

      // Below 80%: ok
      const under80 = budgetStatus(7999, limit);
      expect(under80.status).toBe('ok');
      expect(under80.exceededAmount).toBe(0);

      // Exactly 80%: warning
      const exact80 = budgetStatus(8000, limit);
      expect(exact80.status).toBe('warning');
      expect(exact80.percent).toBe(80);
      expect(exact80.exceededAmount).toBe(0);

      // Between 80% and 100%: warning
      const midWarning = budgetStatus(9500, limit);
      expect(midWarning.status).toBe('warning');
      expect(midWarning.exceededAmount).toBe(0);

      // Exactly 100%: over
      const exact100 = budgetStatus(10000, limit);
      expect(exact100.status).toBe('over');
      expect(exact100.percent).toBe(100);
      expect(exact100.exceededAmount).toBe(0);

      // Exceeded > 100%: over with exceededAmount
      const over = budgetStatus(12500, limit);
      expect(over.status).toBe('over');
      expect(over.percent).toBe(125);
      expect(over.exceededAmount).toBe(2500);
    });
  });

  describe('changePercent and isMonthToDate', () => {
    it('returns percentage change according to PRD formula', () => {
      // 50% increase: current 150, previous 100
      expect(changePercent(150, 100)).toBe(50);
      // 25% decrease: current 75, previous 100
      expect(changePercent(75, 100)).toBe(-25);
      // No change
      expect(changePercent(100, 100)).toBe(0);
    });

    it('returns null (never Infinity or NaN) when previous is 0', () => {
      expect(changePercent(100, 0)).toBeNull();
      expect(changePercent(0, 0)).toBeNull();
    });

    it('identifies whether a date/month represents the ongoing month-to-date', () => {
      const fixedToday = '2026-11-07';
      expect(isMonthToDate('2026-11-01', fixedToday)).toBe(true);
      expect(isMonthToDate('2026-11', fixedToday)).toBe(true);
      expect(isMonthToDate('2026-10-31', fixedToday)).toBe(false);
      expect(isMonthToDate('2026-12-01', fixedToday)).toBe(false);
    });
  });
});
