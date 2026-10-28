export function isIterable(value: unknown): value is Iterable<unknown> {
  return !!(value && typeof (value as any)[Symbol.iterator] === 'function');
}

export function toArray<T>(data: T | T[] | Iterable<T>): T[] {
  if (Array.isArray(data)) return data;
  if (typeof data !== 'string' && isIterable(data)) return [...data];
  return [data as T];
}

export function toMap<K, V>(data: Map<K, V> | Record<string, V> | Iterable<[K, V]> | undefined | null): Map<K, V> {
  if (!data) return new Map();
  if (data instanceof Map) return new Map(data);
  if (isIterable(data)) return new Map(data as Iterable<[K, V]>);
  return new Map(Object.entries(data) as any);
}

export function count(iterable: Iterable<unknown>): number {
  let n = 0;
  for (const _ of iterable) n++;
  return n;
}

export function first<T>(iterable: Iterable<T>): T | null {
  for (const item of iterable) return item;
  return null;
}

export function last<T>(arr: ArrayLike<T>): T | undefined {
  return arr[arr.length - 1];
}

export function compareArrays<T>(a: readonly T[], b: readonly T[]): number | 'same' | 'prefix' | 'extension' {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return i;
  }
  if (a.length === b.length) return 'same';
  if (a.length < b.length) return 'prefix';
  return 'extension';
}

export function debounce<F extends (...args: any[]) => void>(fn: F, wait: number): F & { cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] | null = null;
  const debounced = ((...args: any[]) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs!;
      lastArgs = null;
      fn(...a);
    }, wait);
  }) as F & { cancel(): void; flush(): void };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      const a = lastArgs!;
      lastArgs = null;
      fn(...a);
    }
  };
  return debounced;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
