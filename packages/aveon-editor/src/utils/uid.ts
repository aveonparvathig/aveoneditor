let counter = 0;

/** Returns a unique, DOM-safe id string. */
export function uid(): string {
  counter++;
  return 'e' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}
