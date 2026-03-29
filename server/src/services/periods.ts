import { PeriodType } from '../types.js';

export function formatPeriodLabel(periodType: PeriodType, periodKey: string): string {
  if (periodType === 'annual') {
    return `${periodKey}年度`;
  }

  if (periodType === 'quarterly') {
    const match = periodKey.match(/^(\d{4})-Q([1-4])$/);
    if (match) {
      return `${match[1]}年Q${match[2]}`;
    }
  }

  if (periodType === 'monthly') {
    const match = periodKey.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      return `${match[1]}年${Number(match[2])}月`;
    }
  }

  return periodKey;
}

export function getPeriodParts(periodKey: string): Record<string, string> {
  const quarterMatch = periodKey.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    return {
      period: periodKey,
      year: quarterMatch[1],
      quarter: quarterMatch[2],
      month: '',
    };
  }

  const monthMatch = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return {
      period: periodKey,
      year: monthMatch[1],
      quarter: String(Math.floor((Number(monthMatch[2]) - 1) / 3) + 1),
      month: String(Number(monthMatch[2])),
    };
  }

  return {
    period: periodKey,
    year: periodKey,
    quarter: '',
    month: '',
  };
}
