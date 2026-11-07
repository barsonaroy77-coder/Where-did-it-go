import { escapeCsvField, buildCsv, buildGenericCsv } from '../csv';

describe('csv.ts', () => {
  describe('escapeCsvField', () => {
    it('leaves plain fields unchanged', () => {
      expect(escapeCsvField('Groceries')).toBe('Groceries');
      expect(escapeCsvField('4.50')).toBe('4.50');
      expect(escapeCsvField('100')).toBe('100');
    });

    it('neutralizes fields starting with =SUM(1)', () => {
      expect(escapeCsvField('=SUM(1)')).toBe("'=SUM(1)");
      expect(escapeCsvField('=1+2')).toBe("'=1+2");
    });

    it('neutralizes all spreadsheet formula prefixes (+, -, @, tab, CR)', () => {
      expect(escapeCsvField('+44 12345')).toBe("'+44 12345");
      expect(escapeCsvField('-100')).toBe("'-100");
      expect(escapeCsvField('@special')).toBe("'@special");
      expect(escapeCsvField('\ttabbed')).toBe("'\ttabbed");
      // Since it contains \r (carriage return), RFC 4180 requires wrapping in double quotes
      expect(escapeCsvField('\rreturn')).toBe('"\'\rreturn"');
    });

    it('escapes fields containing commas and quotes by doubling inner quotes and enclosing in quotes', () => {
      expect(escapeCsvField('Hello, "World"')).toBe('"Hello, ""World"""');
      expect(escapeCsvField('Only, comma')).toBe('"Only, comma"');
      expect(escapeCsvField('Only "quotes"')).toBe('"Only ""quotes"""');
    });

    it('escapes fields containing carriage returns and line feeds', () => {
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
      expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
    });

    it('handles formula prefix combined with quotes and commas', () => {
      expect(escapeCsvField('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
      expect(escapeCsvField('=SUM(1, 2)')).toBe('"\'=SUM(1, 2)"');
    });

    it('handles null and undefined', () => {
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
    });
  });

  describe('buildCsv', () => {
    it('builds RFC 4180 CSV using formatMinorUnits for amounts and neutralizing fields', () => {
      const rows = [
        {
          date: '2026-11-01',
          type: 'income',
          category: 'Salary',
          amount: 500000, // 5000.00
          note: 'November salary',
        },
        {
          date: '2026-11-02',
          type: 'expense',
          category: 'Dining',
          amount: 450, // 4.50
          note: '=SUM(1, 2) note with, comma',
        },
      ];

      const csv = buildCsv(rows, 2);
      const lines = csv.split('\r\n');

      expect(lines[0]).toBe('Date,Type,Category,Amount,Note');
      expect(lines[1]).toBe('2026-11-01,income,Salary,5000.00,November salary');
      // Amount formatted as 4.50, formula neutralized and quoted due to comma
      expect(lines[2]).toBe('2026-11-02,expense,Dining,4.50,"\'=SUM(1, 2) note with, comma"');
    });

    it('formats with 0 decimals for JPY', () => {
      const rows = [
        {
          date: '2026-11-01',
          type: 'expense',
          category: 'Ramen',
          amount: 1200,
          note: null,
        },
      ];
      const csv = buildCsv(rows, 0);
      const lines = csv.split('\r\n');
      expect(lines[1]).toBe('2026-11-01,expense,Ramen,1200,');
    });
  });

  describe('buildGenericCsv', () => {
    it('creates generic CSV with escaped fields', () => {
      const headers = ['Name', 'Value'];
      const data = [
        ['Alice', 100],
        ['=cmd|', 200],
      ];
      const csv = buildGenericCsv(headers, data);
      expect(csv).toBe("Name,Value\r\nAlice,100\r\n'=cmd|,200");
    });
  });
});
