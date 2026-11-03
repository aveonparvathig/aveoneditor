/** Strips `\( \)`, `\[ \]`, `$ $` and `$$ $$` delimiters and reports whether the equation is in display mode. */
export function parseDelimitedEquation(text: string): { equation: string; display: boolean } {
  const trimmed = text.trim();
  const patterns: Array<{ start: string; end: string; display: boolean }> = [
    { start: '\\[', end: '\\]', display: true },
    { start: '$$', end: '$$', display: true },
    { start: '\\(', end: '\\)', display: false },
    { start: '$', end: '$', display: false }
  ];
  for (const { start, end, display } of patterns) {
    if (trimmed.length >= start.length + end.length && trimmed.startsWith(start) && trimmed.endsWith(end)) {
      return { equation: trimmed.slice(start.length, trimmed.length - end.length).trim(), display };
    }
  }
  return { equation: trimmed, display: false };
}

/** Removes a trailing `\tag{…}` and reports whether one was present. */
export function stripTag(equation: string): { equation: string; numbered: boolean } {
  const match = /\\tag\*?\{[^}]*\}\s*$/.exec(equation);
  if (!match) return { equation, numbered: false };
  return { equation: equation.slice(0, match.index).trim(), numbered: true };
}
