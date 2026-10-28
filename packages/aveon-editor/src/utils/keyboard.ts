import { env } from './env';

export const keyCodes: Record<string, number> = {
  arrowleft: 37,
  arrowup: 38,
  arrowright: 39,
  arrowdown: 40,
  backspace: 8,
  delete: 46,
  enter: 13,
  space: 32,
  esc: 27,
  tab: 9,
  home: 36,
  end: 35,
  pageup: 33,
  pagedown: 34,
  insert: 45,
  ctrl: 0x110000,
  shift: 0x220000,
  alt: 0x440000,
  cmd: 0x880000
};

for (let code = 65; code <= 90; code++) {
  keyCodes[String.fromCharCode(code).toLowerCase()] = code;
}
for (let code = 48; code <= 57; code++) {
  keyCodes[code - 48] = code;
}
for (let code = 112; code <= 123; code++) {
  keyCodes['f' + (code - 111)] = code;
}
Object.assign(keyCodes, {
  "'": 222, ',': 108, '-': 109, '.': 110, '/': 111, ';': 186, '=': 187, '[': 219, '\\': 220, ']': 221, '`': 223
});

export interface KeystrokeInfo {
  keyCode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export function getCode(key: string | KeystrokeInfo): number {
  if (typeof key === 'string') {
    const code = keyCodes[key.toLowerCase()];
    if (!code) throw new Error(`keyboard-unknown-key: Unknown key name "${key}".`);
    return code;
  }
  return (
    key.keyCode +
    (key.altKey ? keyCodes.alt : 0) +
    (key.ctrlKey ? keyCodes.ctrl : 0) +
    (key.shiftKey ? keyCodes.shift : 0) +
    (key.metaKey ? keyCodes.cmd : 0)
  );
}

/** Parses a keystroke like `Ctrl+Shift+B` into a numeric code. `Ctrl` maps to Cmd on Mac. */
export function parseKeystroke(keystroke: string | Array<string | number>): number {
  const parts = typeof keystroke === 'string' ? keystroke.split('+').map(part => part.trim()) : keystroke;
  return parts.map(key => (typeof key === 'string' ? getEnvKeyCode(key) : key)).reduce((a, b) => a + b, 0);
}

function getEnvKeyCode(key: string): number {
  const lower = key.toLowerCase();
  if (lower === 'ctrl' && env.isMac) return keyCodes.cmd;
  return getCode(lower);
}

export function getEnvKeystrokeText(keystroke: string): string {
  if (env.isMac) {
    return keystroke.replace(/Ctrl\+/gi, '⌘').replace(/Shift\+/gi, '⇧').replace(/Alt\+/gi, '⌥');
  }
  return keystroke;
}

export function isArrowKeyCode(keyCode: number): boolean {
  return keyCode === keyCodes.arrowleft || keyCode === keyCodes.arrowright || keyCode === keyCodes.arrowup || keyCode === keyCodes.arrowdown;
}

export function getLocalizedArrowKeyCodeDirection(keyCode: number, contentLanguageDirection: 'ltr' | 'rtl' = 'ltr'): 'left' | 'right' | 'up' | 'down' | undefined {
  const isLtr = contentLanguageDirection === 'ltr';
  switch (keyCode) {
    case keyCodes.arrowleft:
      return isLtr ? 'left' : 'right';
    case keyCodes.arrowright:
      return isLtr ? 'right' : 'left';
    case keyCodes.arrowup:
      return 'up';
    case keyCodes.arrowdown:
      return 'down';
  }
  return undefined;
}

export function isForwardArrowKeyCode(keyCode: number, direction: 'ltr' | 'rtl' = 'ltr'): boolean {
  const d = getLocalizedArrowKeyCodeDirection(keyCode, direction);
  return d === 'down' || d === 'right';
}
