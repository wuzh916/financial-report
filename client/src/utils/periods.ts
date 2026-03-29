import { PeriodType } from '../types';

export interface PeriodOption {
  key: string;
  label: string;
}

export function getDefaultPeriodKey(periodType: PeriodType, now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (periodType === 'annual') {
    return String(year - 1);
  }

  if (periodType === 'quarterly') {
    const currentQuarter = Math.floor((month - 1) / 3) + 1;
    if (currentQuarter === 1) {
      return `${year - 1}-Q4`;
    }
    return `${year}-Q${currentQuarter - 1}`;
  }

  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getPeriodOptions(periodType: PeriodType, now = new Date()): PeriodOption[] {
  if (periodType === 'annual') {
    return Array.from({ length: 6 }, (_, index) => {
      const year = now.getFullYear() - 1 - index;
      return {
        key: String(year),
        label: `${year}年度`,
      };
    });
  }

  if (periodType === 'quarterly') {
    const options: PeriodOption[] = [];
    let year = now.getFullYear();
    let quarter = Math.floor((now.getMonth()) / 3);
    if (quarter === 0) {
      year -= 1;
      quarter = 4;
    }

    for (let index = 0; index < 8; index += 1) {
      options.push({
        key: `${year}-Q${quarter}`,
        label: `${year}年Q${quarter}`,
      });
      quarter -= 1;
      if (quarter === 0) {
        quarter = 4;
        year -= 1;
      }
    }
    return options;
  }

  const options: PeriodOption[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  for (let index = 0; index < 12; index += 1) {
    options.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      label: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`,
    });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return options;
}

export function getPeriodLabel(periodType: PeriodType, periodKey: string): string {
  return getPeriodOptions(periodType).find((item) => item.key === periodKey)?.label ?? periodKey;
}
