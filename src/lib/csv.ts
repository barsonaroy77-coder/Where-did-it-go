/**
 * CSV serialization and formula-injection neutralization for Where Did It Go?
 * Follows PRD v4.0 Sections 6.8 & AGENTS.md Rule 31.
 */

import { formatMinorUnits } from './money';

/**
 * Escapes a single CSV field following RFC 4180 rules and neutralizes spreadsheet formula injection:
 * 1. If the text starts with =, +, -, @, a tab (\t), or a carriage return (\r),
 *    prefix it with a single quote (') to prevent spreadsheet execution.
 * 2. If the field contains a comma (,), double-quote ("), carriage return (\r), or line feed (\n),
 *    double any inner quotes (" -> "") and wrap the entire field in double quotes.
 * 3. Plain fields without special characters are returned unchanged.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let s = String(value);

  // Neutralize spreadsheet formula prefixes (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }

  // Check if quoting is needed (comma, quote, CR, LF)
  const needsQuoting = /[,"\r\n]/.test(s);

  if (needsQuoting) {
    const escapedQuotes = s.replace(/"/g, '""');
    return `"${escapedQuotes}"`;
  }

  return s;
}

export interface CsvTransactionRow {
  date: string;
  type: string;
  category: string;
  amount: number; // In minor units (e.g. 450 for $4.50)
  note?: string | null;
}

/**
 * Builds an RFC 4180 compliant CSV string from transaction records.
 * Uses formatMinorUnits to format amounts based on the account's decimal precision.
 * Neutralizes formula injection on all fields.
 */
export function buildCsv(
  rows: readonly CsvTransactionRow[],
  decimals: number = 2
): string {
  const headers = ['Date', 'Type', 'Category', 'Amount', 'Note'];
  const headerLine = headers.map(escapeCsvField).join(',');
  const lines: string[] = [headerLine];

  for (const row of rows) {
    const formattedAmount = formatMinorUnits(row.amount, decimals);
    const fields = [
      escapeCsvField(row.date),
      escapeCsvField(row.type),
      escapeCsvField(row.category),
      escapeCsvField(formattedAmount),
      escapeCsvField(row.note ?? ''),
    ];
    lines.push(fields.join(','));
  }

  return lines.join('\r\n');
}

/**
 * Generic CSV builder for arbitrary headers and rows with formula neutralization.
 */
export function buildGenericCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  const lines: string[] = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\r\n');
}
