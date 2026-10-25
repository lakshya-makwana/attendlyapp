/**
 * Calendar date utilities that prevent any timezone shifting.
 * Always formats and parses YYYY-MM-DD in the device's local calendar.
 */

export function toLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthDateRange(year: number, monthZeroIndexed: number): { startDate: string; endDate: string } {
  const startDate = `${year}-${String(monthZeroIndexed + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthZeroIndexed + 1, 0).getDate();
  const endDate = `${year}-${String(monthZeroIndexed + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

export function shiftDays(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + offsetDays);
  return toLocalDateString(date);
}

export function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateIndian(dateInput: string | Date = new Date()): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const parts = dateInput.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatCurrency(val: number | string | null | undefined): string {
  const num = typeof val === 'number' ? val : parseFloat(val || '0');
  if (isNaN(num)) return '₹0';
  return '₹' + Math.round(num).toLocaleString('en-IN');
}

