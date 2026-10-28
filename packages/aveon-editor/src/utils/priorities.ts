export type PriorityString = 'highest' | 'high' | 'normal' | 'low' | 'lowest';

const map: Record<PriorityString, number> = {
  highest: 100000,
  high: 1000,
  normal: 0,
  low: -1000,
  lowest: -100000
};

export const priorities = {
  get(priority?: PriorityString | number): number {
    if (typeof priority === 'number') return priority;
    return map[priority ?? 'normal'] ?? 0;
  }
};
