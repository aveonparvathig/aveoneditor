/**
 * Accuracy benchmark for the built-in recogniser. Samples are hand-written shape descriptions that are
 * deliberately independent of the recogniser's templates (different proportions, stroke orders and
 * directions) and are distorted with slant, rotation, uneven scaling, wobble, jitter and pen hooks.
 */

import { describe, it, expect } from 'vitest';
import { createBasicRecognizer, type Stroke, type Point } from './recognizer';

/* ------------------------------------------------------------------------------------------ */
/* Sample generation                                                                           */
/* ------------------------------------------------------------------------------------------ */

function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit-box shape language: `M x y` starts a new stroke, `L x y` draws a line, `A cx cy rx ry from to` an arc. */
function shape(spec: string): Point[][] {
  const strokes: Point[][] = [];
  for (const command of spec.trim().split(/\s+(?=[MLA])/)) {
    const [op, ...rest] = command.trim().split(/\s+/);
    const n = rest.map(Number);
    if (op === 'M') strokes.push([{ x: n[0], y: n[1] }]);
    else if (op === 'L') strokes[strokes.length - 1].push({ x: n[0], y: n[1] });
    else if (op === 'A') {
      if (!strokes.length) strokes.push([]);
      const [cx, cy, rx, ry, from, to] = n;
      for (let i = 0; i <= 24; i++) {
        const a = ((from + ((to - from) * i) / 24) * Math.PI) / 180;
        strokes[strokes.length - 1].push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      }
    }
  }
  return strokes;
}

/** Densifies a polyline to roughly `step` px spacing (pointer events arrive every few pixels). */
function densify(points: Point[], step: number): Point[] {
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

interface Placement {
  x: number;
  y: number;
  /** Symbol height in pixels. */
  size: number;
  /** Width relative to height. */
  aspect?: number;
}

/** Turns a unit-box shape into distorted pixel strokes. */
function write(spec: string, at: Placement, random: () => number, strength = 1): Stroke[] {
  const shear = (random() - 0.5) * 0.5 * strength;
  const rotation = (random() - 0.5) * 0.24 * strength;
  const sx = at.size * (at.aspect ?? 0.7) * (1 + (random() - 0.5) * 0.3 * strength);
  const sy = at.size * (1 + (random() - 0.5) * 0.3 * strength);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const step = 2 + random() * 4;
  return shape(spec).map(stroke => {
    const phase = random() * Math.PI * 2;
    const wobble = 0.025 * at.size * strength;
    let pts = stroke.map(p => {
      const ux = (p.x - 0.5) * sx + (0.5 - p.y) * shear * sy;
      const uy = (p.y - 0.5) * sy;
      return { x: at.x + ux * cos - uy * sin, y: at.y + ux * sin + uy * cos };
    });
    pts = densify(pts, step).map((p, i, all) => ({
      x: p.x + Math.sin(phase + (i / all.length) * 5) * wobble + (random() - 0.5) * 1.2 * strength,
      y: p.y + Math.cos(phase + (i / all.length) * 4) * wobble + (random() - 0.5) * 1.2 * strength
    }));
    // Pen-up hook.
    if (random() < 0.3 * strength && pts.length > 4) {
      const last = pts[pts.length - 1];
      const angle = random() * Math.PI * 2;
      const len = 2 + random() * 3;
      pts.push({ x: last.x + Math.cos(angle) * len, y: last.y + Math.sin(angle) * len });
    }
    return pts.map((p, i) => ({ ...p, t: i * 8 }));
  });
}

/** Expected LaTeX → ways people write it. Every spec is independent of the recogniser's templates. */
const SAMPLES: Record<string, string[]> = {
  '0': ['A 0.5 0.5 0.45 0.5 -90 270', 'A 0.5 0.5 0.45 0.5 -80 -440', 'A 0.5 0.5 0.42 0.5 -100 265'],
  '1': ['M 0.5 0 L 0.5 1', 'M 0.2 0.25 L 0.55 0 L 0.55 1', 'M 0.55 0 L 0.45 1'],
  '2': ['A 0.5 0.28 0.42 0.28 -170 20 L 0.05 1 L 1 1', 'A 0.48 0.3 0.4 0.3 -160 10 L 0.1 0.98 L 0.95 0.95', 'A 0.5 0.25 0.4 0.25 -180 30 L 0.08 1 L 0.92 1'],
  '3': ['A 0.48 0.26 0.4 0.26 -160 90 A 0.48 0.74 0.45 0.26 -90 160', 'M 0.1 0 L 0.9 0 L 0.45 0.4 A 0.48 0.68 0.42 0.3 -90 150', 'A 0.5 0.25 0.38 0.25 -170 80 A 0.5 0.72 0.42 0.28 -80 170'],
  '4': ['M 0.65 0 L 0.05 0.65 L 0.95 0.65 M 0.7 0.25 L 0.7 1', 'M 0.15 0 L 0.12 0.6 L 0.95 0.6 M 0.75 0 L 0.75 1', 'M 0.6 0 L 0.05 0.7 L 1 0.7 M 0.65 0.1 L 0.65 1'],
  '5': ['M 0.85 0 L 0.2 0 L 0.15 0.42 A 0.48 0.68 0.4 0.3 -110 160', 'M 0.18 0 L 0.14 0.45 A 0.5 0.7 0.4 0.3 -110 160 M 0.18 0 L 0.9 0', 'M 0.9 0.02 L 0.2 0 L 0.18 0.45 A 0.48 0.7 0.42 0.3 -100 170'],
  '6': ['A 0.85 0.6 0.75 0.6 -100 -180 A 0.5 0.72 0.4 0.28 180 -180', 'M 0.75 0 L 0.2 0.55 A 0.5 0.7 0.35 0.3 180 -180', 'M 0.8 0 A 0.52 0.65 0.4 0.35 -130 235'],
  '7': ['M 0.05 0 L 0.95 0 L 0.35 1', 'M 0 0.05 L 1 0 L 0.45 1', 'M 0.05 0 L 0.95 0 L 0.4 1 M 0.25 0.5 L 0.85 0.5'],
  '8': ['A 0.5 0.26 0.32 0.26 0 -180 A 0.5 0.74 0.4 0.26 -180 180 A 0.5 0.26 0.32 0.26 180 0', 'A 0.5 0.27 0.33 0.27 -20 -340 A 0.5 0.75 0.4 0.25 -100 260'],
  '9': ['A 0.5 0.28 0.4 0.28 0 -360 L 0.88 1', 'A 0.48 0.3 0.4 0.3 10 -350 L 0.85 0.3 L 0.75 1', 'A 0.5 0.3 0.42 0.3 -10 -370 L 0.6 1'],
  '+': ['M 0 0.5 L 1 0.5 M 0.5 0 L 0.5 1', 'M 0.5 0 L 0.5 1 M 0 0.5 L 1 0.5', 'M 0.05 0.55 L 0.95 0.45 M 0.45 0 L 0.55 1'],
  '=': ['M 0 0.3 L 1 0.3 M 0 0.7 L 1 0.7', 'M 0.05 0.25 L 0.95 0.3 M 0 0.75 L 1 0.7'],
  'x': ['M 0 0 L 1 1 M 1 0 L 0 1', 'M 1 0 L 0 1 M 0 0 L 1 1', 'M 0.05 0.05 L 0.95 1 M 0.9 0 L 0.1 0.95'],
  'y': ['M 0 0 L 0.5 0.55 M 1 0 L 0.15 1', 'M 0.05 0 L 0.55 0.5 M 0.95 0 L 0.2 1'],
  '(': ['A 2 0.5 2 0.58 240 120', 'A 1 0.5 1 0.52 105 255'],
  ')': ['A -1 0.5 2 0.58 -60 60', 'A 0 0.5 1 0.52 -75 75'],
  '<': ['M 1 0 L 0 0.5 L 1 1', 'M 0.95 0.05 L 0.05 0.5 L 0.95 0.95'],
  '>': ['M 0 0 L 1 0.5 L 0 1', 'M 0.05 0.05 L 0.95 0.5 L 0.05 0.95'],
  'a': ['A 0.42 0.5 0.4 0.45 -20 -380 L 0.88 1', 'A 0.45 0.55 0.4 0.42 -10 -370 L 0.85 0.15 L 0.88 1'],
  'b': ['M 0.1 0 L 0.1 1 A 0.48 0.7 0.38 0.3 180 540', 'M 0.15 0 L 0.12 1 A 0.5 0.72 0.38 0.28 170 530'],
  'c': ['A 0.55 0.5 0.45 0.5 -40 -320', 'A 0.55 0.5 0.45 0.48 -50 -310'],
  'd': ['A 0.42 0.7 0.38 0.3 0 -360 L 0.85 0 L 0.85 1', 'A 0.4 0.72 0.36 0.28 -10 -370 L 0.8 0 L 0.82 1'],
  'e': ['M 0.1 0.5 L 0.9 0.5 A 0.5 0.5 0.4 0.5 0 -260', 'M 0.12 0.55 L 0.88 0.45 A 0.5 0.5 0.4 0.5 -10 -270'],
  'n': ['M 0.1 1 L 0.1 0 A 0.5 0.32 0.4 0.32 180 360 L 0.9 1', 'M 0.12 0 L 0.12 1 L 0.12 0.4 A 0.5 0.35 0.38 0.3 180 360 L 0.9 1'],
  'z': ['M 0 0 L 1 0 L 0 1 L 1 1', 'M 0.05 0.05 L 0.95 0 L 0.05 0.95 L 0.95 1'],
  't': ['M 0.5 0 L 0.5 1 M 0.1 0.3 L 0.9 0.3', 'M 0.1 0.3 L 0.9 0.3 M 0.5 0 L 0.5 1'],
  '\\pi': ['M 0 0.1 L 1 0.1 M 0.3 0.1 L 0.25 1 M 0.72 0.1 L 0.78 1', 'M 0.3 0.1 L 0.25 1 M 0.72 0.1 L 0.78 1 M 0 0.12 L 1 0.08'],
  '\\sqrt': ['M 0 0.55 L 0.15 0.45 L 0.35 1 L 0.55 0 L 1 0', 'M 0 0.6 L 0.25 1 L 0.5 0 L 1 0'],
  '\\sum': ['M 1 0 L 0 0 L 0.55 0.5 L 0 1 L 1 1', 'M 0.95 0.05 L 0.05 0 L 0.5 0.5 L 0.05 1 L 0.95 0.95'],
  '\\infty': ['A 0.27 0.5 0.25 0.38 0 -360 A 0.73 0.5 0.25 0.38 180 540', 'A 0.73 0.5 0.25 0.38 180 -180 A 0.27 0.5 0.25 0.38 0 360']
};

/** Aspect ratio (width/height) people typically give each symbol. */
const ASPECT: Record<string, number> = { '1': 0.15, '(': 0.3, ')': 0.3, '+': 1, '=': 1.8, '\\infty': 1.6, '<': 0.8, '>': 0.8, 'x': 0.9, 'z': 0.85, '\\pi': 1, '\\sqrt': 1.2, '\\sum': 0.9, 'c': 0.75, 'n': 0.8 };
const HEIGHT: Record<string, number> = { '=': 0.4, 'a': 0.6, 'c': 0.6, 'e': 0.6, 'n': 0.6, 'x': 0.6, 'z': 0.6, '+': 0.7 };

function symbolAt(latex: string, variant: number, at: Placement, random: () => number, strength = 1): Stroke[] {
  const specs = SAMPLES[latex];
  const aspect = ASPECT[latex] ?? 0.65;
  const size = at.size * (HEIGHT[latex] ?? 1);
  return write(specs[variant % specs.length], { ...at, size, aspect }, random, strength);
}

/* ------------------------------------------------------------------------------------------ */
/* Benchmark                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const REPEATS = 6;

function symbolAccuracy(): { accuracy: number; failures: Record<string, Record<string, number>> } {
  const recognizer = createBasicRecognizer();
  const random = rng(7);
  const failures: Record<string, Record<string, number>> = {};
  let total = 0;
  let correct = 0;
  for (const latex of Object.keys(SAMPLES)) {
    for (let variant = 0; variant < SAMPLES[latex].length; variant++) {
      for (let r = 0; r < REPEATS; r++) {
        const strokes = symbolAt(latex, variant, { x: 100, y: 80, size: 50 }, random);
        const result = recognizer.recognize(strokes) as { latex: string };
        const got = result.latex.trim();
        total++;
        if (got === latex || got === `${latex}{}`) correct++;
        else {
          failures[latex] ??= {};
          failures[latex][got] = (failures[latex][got] || 0) + 1;
        }
      }
    }
  }
  return { accuracy: correct / total, failures };
}

/** Builds whole expressions out of symbols and checks the assembled LaTeX. */
const EXPRESSIONS: Array<{ latex: string; build: (random: () => number) => Stroke[] }> = [
  { latex: 'x^{2}', build: r => [...symbolAt('x', 0, { x: 100, y: 100, size: 50 }, r), ...symbolAt('2', 0, { x: 140, y: 68, size: 26 }, r)] },
  { latex: 'a+b', build: r => [...symbolAt('a', 0, { x: 100, y: 108, size: 50 }, r), ...symbolAt('+', 0, { x: 150, y: 105, size: 40 }, r), ...symbolAt('b', 0, { x: 200, y: 100, size: 50 }, r)] },
  { latex: '2x=4', build: r => [...symbolAt('2', 0, { x: 100, y: 100, size: 50 }, r), ...symbolAt('x', 0, { x: 145, y: 110, size: 50 }, r), ...symbolAt('=', 0, { x: 195, y: 105, size: 50 }, r), ...symbolAt('4', 0, { x: 245, y: 100, size: 50 }, r)] },
  { latex: '\\frac{1}{2}', build: r => [...symbolAt('1', 0, { x: 120, y: 60, size: 40 }, r), ...write('M 0 0.5 L 1 0.5', { x: 120, y: 95, size: 50, aspect: 1.4 }, r, 0.3), ...symbolAt('2', 0, { x: 120, y: 130, size: 40 }, r)] },
  { latex: '\\sqrt{x}', build: r => [...write(SAMPLES['\\sqrt'][1], { x: 120, y: 100, size: 60, aspect: 1.5 }, r, 0.5), ...symbolAt('x', 0, { x: 135, y: 112, size: 50 }, r)] },
  { latex: 'y_{1}', build: r => [...symbolAt('y', 0, { x: 100, y: 100, size: 50 }, r), ...symbolAt('1', 0, { x: 135, y: 135, size: 24 }, r)] },
  { latex: '3+5=8', build: r => [...symbolAt('3', 0, { x: 100, y: 100, size: 50 }, r), ...symbolAt('+', 0, { x: 150, y: 105, size: 40 }, r), ...symbolAt('5', 0, { x: 200, y: 100, size: 50 }, r), ...symbolAt('=', 0, { x: 250, y: 105, size: 50 }, r), ...symbolAt('8', 0, { x: 300, y: 100, size: 50 }, r)] },
  { latex: '(a)', build: r => [...symbolAt('(', 0, { x: 100, y: 100, size: 60 }, r), ...symbolAt('a', 0, { x: 130, y: 108, size: 50 }, r), ...symbolAt(')', 0, { x: 160, y: 100, size: 60 }, r)] }
];

function expressionAccuracy(): { accuracy: number; failures: string[] } {
  const recognizer = createBasicRecognizer();
  const random = rng(11);
  const failures: string[] = [];
  let correct = 0;
  let total = 0;
  for (const expression of EXPRESSIONS) {
    for (let r = 0; r < REPEATS; r++) {
      const got = (recognizer.recognize(expression.build(random)) as { latex: string }).latex;
      total++;
      if (got === expression.latex) correct++;
      else failures.push(`${expression.latex} → ${got}`);
    }
  }
  return { accuracy: correct / total, failures };
}

describe('handwriting recogniser accuracy', () => {
  it('recognises distorted single symbols', () => {
    const { accuracy, failures } = symbolAccuracy();
    console.log(`symbol accuracy: ${(accuracy * 100).toFixed(1)}%`, JSON.stringify(failures));
    expect(accuracy).toBeGreaterThan(0.9);
  });

  it('assembles distorted expressions', () => {
    const { accuracy, failures } = expressionAccuracy();
    console.log(`expression accuracy: ${(accuracy * 100).toFixed(1)}%`, failures.slice(0, 30).join(' | '));
    expect(accuracy).toBeGreaterThan(0.85);
  });

  it('offers the correct reading among the alternatives', () => {
    const recognizer = createBasicRecognizer();
    const random = rng(3);
    let found = 0;
    let total = 0;
    for (const latex of Object.keys(SAMPLES)) {
      for (let r = 0; r < 4; r++) {
        const result = recognizer.recognize(symbolAt(latex, r, { x: 100, y: 80, size: 50 }, random)) as { latex: string; alternatives?: string[] };
        total++;
        if (result.latex === latex || result.latex === `${latex}{}` || (result.alternatives || []).includes(latex)) found++;
      }
    }
    expect(found / total).toBeGreaterThan(0.97);
  });
});
