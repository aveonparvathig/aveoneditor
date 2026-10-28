/**
 * Handwriting recognition for the formula editor.
 *
 * `HandwritingRecognizer` is the pluggable contract (MyScript, Mathpix or any service can be wired in
 * through `math.handwriting.recognizer`). `createBasicRecognizer()` is a dependency-free, on-device
 * recogniser: strokes are grouped into symbols, each symbol is matched against template shapes with
 * a rotation-limited variant of the $1 unistroke algorithm (Wobbrock, Wilson and Li, 2007), and the
 * symbols are assembled into LaTeX by position: fraction bars, roots, superscripts and subscripts.
 */

export interface Point {
  x: number;
  y: number;
  t?: number;
}

export type Stroke = Point[];

export interface RecognitionResult {
  latex: string;
  /** 0–1 confidence of the weakest symbol. */
  confidence: number;
  symbols: RecognizedSymbol[];
}

export interface RecognizedSymbol {
  name: string;
  latex: string;
  score: number;
  box: Box;
  strokes: Stroke[];
}

export interface HandwritingRecognizer {
  recognize(strokes: Stroke[]): Promise<RecognitionResult> | RecognitionResult;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/* ------------------------------------------------------------------------------------------ */
/* Geometry                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const SAMPLE_COUNT = 64;
const SQUARE_SIZE = 250;
const ANGLE_RANGE = (25 * Math.PI) / 180;
const ANGLE_PRECISION = (2 * Math.PI) / 180;
const PHI = 0.5 * (-1 + Math.sqrt(5));

export function boundingBox(points: Point[]): Box {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

function pathLength(points: Point[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return d;
}

function resample(points: Point[], n: number): Point[] {
  const interval = pathLength(points) / (n - 1);
  if (!interval) return Array.from({ length: n }, () => ({ ...points[0] }));
  let distance = 0;
  const result: Point[] = [{ ...points[0] }];
  const source = points.map(p => ({ ...p }));
  for (let i = 1; i < source.length; i++) {
    const d = Math.hypot(source[i].x - source[i - 1].x, source[i].y - source[i - 1].y);
    if (distance + d >= interval) {
      const q = {
        x: source[i - 1].x + ((interval - distance) / d) * (source[i].x - source[i - 1].x),
        y: source[i - 1].y + ((interval - distance) / d) * (source[i].y - source[i - 1].y)
      };
      result.push(q);
      source.splice(i, 0, q);
      distance = 0;
    } else distance += d;
  }
  while (result.length < n) result.push({ ...source[source.length - 1] });
  return result.slice(0, n);
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function rotateBy(points: Point[], angle: number): Point[] {
  const c = centroid(points);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map(p => ({ x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x, y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y }));
}

/** Scales to the square while keeping very flat/tall shapes (lines, bars) from exploding. */
function scaleToSquare(points: Point[]): Point[] {
  const box = boundingBox(points);
  const ratio = Math.min(box.width, box.height) / Math.max(box.width, box.height, 1);
  const uniform = ratio < 0.2;
  const scale = uniform ? SQUARE_SIZE / Math.max(box.width, box.height, 1) : 1;
  return points.map(p => ({
    x: uniform ? p.x * scale : (p.x * SQUARE_SIZE) / Math.max(box.width, 1),
    y: uniform ? p.y * scale : (p.y * SQUARE_SIZE) / Math.max(box.height, 1)
  }));
}

function translateToOrigin(points: Point[]): Point[] {
  const c = centroid(points);
  return points.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
}

function normalize(points: Point[]): Point[] {
  return translateToOrigin(scaleToSquare(resample(points, SAMPLE_COUNT)));
}

function pathDistance(a: Point[], b: Point[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return d / a.length;
}

function distanceAtAngle(points: Point[], template: Point[], angle: number): number {
  return pathDistance(rotateBy(points, angle), template);
}

/** Golden-section search of the best rotation within ±ANGLE_RANGE. */
function distanceAtBestAngle(points: Point[], template: Point[]): number {
  let a = -ANGLE_RANGE;
  let b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = distanceAtAngle(points, template, x1);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = distanceAtAngle(points, template, x2);
  while (Math.abs(b - a) > ANGLE_PRECISION) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = distanceAtAngle(points, template, x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = distanceAtAngle(points, template, x2);
    }
  }
  return Math.min(f1, f2);
}

/* ------------------------------------------------------------------------------------------ */
/* Templates                                                                                   */
/* ------------------------------------------------------------------------------------------ */

interface Template {
  name: string;
  latex: string;
  points: Point[];
  strokes: number;
}

/** Tiny path language in a unit box: `M x y`, `L x y`, `A cx cy rx ry fromDeg toDeg` (sampled arc). */
function path(spec: string): Point[] {
  const points: Point[] = [];
  const commands = spec.trim().split(/\s+(?=[MLA])/);
  for (const command of commands) {
    const parts = command.trim().split(/\s+/);
    const op = parts[0];
    const nums = parts.slice(1).map(Number);
    if (op === 'M' || op === 'L') {
      points.push({ x: nums[0], y: nums[1] });
    } else if (op === 'A') {
      const [cx, cy, rx, ry, from, to] = nums;
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
        points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
      }
    }
  }
  return points;
}

const templateSpecs: Array<[string, string, string, number]> = [
  ['0', '0', 'A 0.5 0.5 0.35 0.5 -90 270', 1],
  ['1', '1', 'M 0.5 0 L 0.5 1', 1],
  ['1', '1', 'M 0.3 0.2 L 0.5 0 L 0.5 1', 1],
  ['2', '2', 'A 0.5 0.3 0.35 0.3 -160 20 L 0.1 1 L 0.95 1', 1],
  ['3', '3', 'A 0.5 0.27 0.3 0.27 -150 90 A 0.5 0.73 0.33 0.27 -90 150', 1],
  ['4', '4', 'M 0.65 0 L 0.1 0.65 L 0.95 0.65 M 0.65 0 L 0.65 1', 2],
  ['4', '4', 'M 0.65 0 L 0.65 1 M 0.65 0 L 0.1 0.65 L 0.95 0.65', 2],
  ['5', '5', 'M 0.9 0 L 0.15 0 L 0.12 0.45 A 0.5 0.7 0.38 0.3 -80 170', 1],
  ['6', '6', 'M 0.8 0 A 0.45 0.65 0.38 0.35 -140 230', 1],
  ['7', '7', 'M 0.05 0 L 0.95 0 L 0.35 1', 1],
  ['8', '8', 'A 0.5 0.27 0.3 0.27 -90 270 A 0.5 0.73 0.33 0.27 90 450', 1],
  ['9', '9', 'A 0.5 0.3 0.35 0.3 0 360 L 0.85 0.3 L 0.6 1', 1],
  ['+', '+', 'M 0 0.5 L 1 0.5 M 0.5 0 L 0.5 1', 2],
  ['+', '+', 'M 0.5 0 L 0.5 1 M 0 0.5 L 1 0.5', 2],
  ['-', '-', 'M 0 0.5 L 1 0.5', 1],
  ['=', '=', 'M 0 0.3 L 1 0.3 M 0 0.7 L 1 0.7', 2],
  ['x', 'x', 'M 0 0 L 1 1 M 1 0 L 0 1', 2],
  ['x', 'x', 'M 1 0 L 0 1 M 0 0 L 1 1', 2],
  ['y', 'y', 'M 0 0 L 0.5 0.6 M 1 0 L 0.1 1', 2],
  ['(', '(', 'A 0.9 0.5 0.6 0.55 160 200', 1],
  [')', ')', 'A 0.1 0.5 0.6 0.55 -20 20', 1],
  ['/', '/', 'M 1 0 L 0 1', 1],
  ['<', '<', 'M 1 0 L 0 0.5 L 1 1', 1],
  ['>', '>', 'M 0 0 L 1 0.5 L 0 1', 1],
  ['a', 'a', 'A 0.4 0.5 0.4 0.5 0 360 L 0.85 0.3 L 0.85 1', 1],
  ['b', 'b', 'M 0.1 0 L 0.1 1 A 0.5 0.72 0.4 0.28 180 540', 1],
  ['c', 'c', 'A 0.55 0.5 0.45 0.5 -50 230', 1],
  ['d', 'd', 'A 0.4 0.72 0.4 0.28 0 360 L 0.85 0 L 0.85 1', 1],
  ['e', 'e', 'M 0.1 0.5 L 0.9 0.5 A 0.5 0.5 0.4 0.5 0 -250', 1],
  ['k', 'k', 'M 0.1 0 L 0.1 1 M 0.9 0.35 L 0.1 0.65 L 0.9 1', 2],
  ['m', 'm', 'M 0.05 1 L 0.05 0 A 0.28 0.25 0.22 0.25 180 360 L 0.5 1 L 0.5 0.25 A 0.72 0.25 0.22 0.25 180 360 L 0.95 1', 1],
  ['n', 'n', 'M 0.1 1 L 0.1 0 A 0.5 0.3 0.4 0.3 180 360 L 0.9 1', 1],
  ['p', 'p', 'M 0.1 0 L 0.1 1 M 0.1 0 A 0.5 0.25 0.4 0.25 180 540', 2],
  ['r', 'r', 'M 0.1 1 L 0.1 0 A 0.55 0.35 0.4 0.35 180 300', 1],
  ['s', 's', 'A 0.5 0.27 0.33 0.27 10 -150 A 0.5 0.73 0.33 0.27 -90 90', 1],
  ['t', 't', 'M 0.5 0 L 0.5 1 M 0.1 0.3 L 0.9 0.3', 2],
  ['u', 'u', 'M 0.1 0 L 0.1 0.6 A 0.5 0.6 0.4 0.4 180 360 L 0.9 0', 1],
  ['v', 'v', 'M 0 0 L 0.5 1 L 1 0', 1],
  ['w', 'w', 'M 0 0 L 0.25 1 L 0.5 0.2 L 0.75 1 L 1 0', 1],
  ['z', 'z', 'M 0 0 L 1 0 L 0 1 L 1 1', 1],
  ['h', 'h', 'M 0.1 0 L 0.1 1 M 0.1 0.45 A 0.5 0.6 0.4 0.15 180 360 L 0.9 1', 2],
  ['i', 'i', 'M 0.5 0.3 L 0.5 1', 1],
  ['j', 'j', 'M 0.6 0.3 L 0.6 0.8 A 0.35 0.8 0.25 0.2 0 180', 1],
  ['l', 'l', 'M 0.5 0 L 0.5 1', 1],
  ['o', 'o', 'A 0.5 0.5 0.45 0.5 -90 270', 1],
  ['q', 'q', 'A 0.4 0.3 0.4 0.3 0 360 L 0.85 0.3 L 0.85 1', 1],
  ['f', 'f', 'A 0.7 0.15 0.25 0.15 -180 -90 L 0.45 1 M 0.2 0.4 L 0.75 0.4', 2],
  ['g', 'g', 'A 0.4 0.3 0.4 0.3 0 360 L 0.85 0.3 L 0.85 0.8 A 0.5 0.8 0.35 0.2 0 180', 1],
  ['π', '\\pi', 'M 0 0.1 L 1 0.1 M 0.25 0.1 L 0.25 1 M 0.75 0.1 L 0.75 1', 3],
  ['∞', '\\infty', 'A 0.27 0.5 0.27 0.4 0 -360 A 0.73 0.5 0.27 0.4 180 540', 1],
  ['√', '\\sqrt', 'M 0 0.6 L 0.2 1 L 0.45 0 L 1 0', 1],
  ['∑', '\\sum', 'M 1 0 L 0 0 L 0.55 0.5 L 0 1 L 1 1', 1],
  ['∫', '\\int', 'A 0.7 0.15 0.25 0.15 -180 -90 L 0.5 0.5 L 0.3 0.85 A 0.3 0.85 0.25 0.15 0 90', 1],
  ['.', '.', 'M 0.45 0.45 L 0.55 0.55', 1],
  [',', ',', 'M 0.5 0 L 0.3 1', 1]
];

function buildTemplates(): Template[] {
  return templateSpecs.map(([name, latex, spec, strokes]) => ({ name, latex, points: normalize(path(spec)), strokes }));
}

let templates: Template[] | null = null;

/* ------------------------------------------------------------------------------------------ */
/* Symbol recognition                                                                          */
/* ------------------------------------------------------------------------------------------ */

function recognizeSymbol(strokes: Stroke[], typicalSize: number): RecognizedSymbol {
  if (!templates) templates = buildTemplates();
  const points = strokes.flat();
  const box = boundingBox(points);
  // A dot: a stroke much smaller than the other symbols.
  if (box.width < typicalSize * 0.18 && box.height < typicalSize * 0.18) {
    return { name: '.', latex: '.', score: 1, box, strokes };
  }
  const aspect = box.width / Math.max(box.height, 1);
  if (aspect > 3 && strokes.length === 1) {
    return { name: '-', latex: '-', score: 1, box, strokes };
  }
  if (aspect < 0.25 && strokes.length === 1) {
    return { name: '1', latex: '1', score: 0.9, box, strokes };
  }
  const normalized = normalize(points);
  let best: Template | null = null;
  let bestDistance = Infinity;
  for (const template of templates) {
    const strokePenalty = template.strokes === strokes.length ? 0 : 25;
    const distance = distanceAtBestAngle(normalized, template.points) + strokePenalty;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = template;
    }
  }
  const score = Math.max(0, 1 - bestDistance / (0.5 * Math.sqrt(2) * SQUARE_SIZE));
  return { name: best ? best.name : '?', latex: best ? best.latex : '?', score, box, strokes };
}

/* ------------------------------------------------------------------------------------------ */
/* Stroke grouping and layout                                                                  */
/* ------------------------------------------------------------------------------------------ */

function inflate(box: Box, pad: number): Box {
  return { ...box, left: box.left - pad, right: box.right + pad, top: box.top - pad, bottom: box.bottom + pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
}

function overlap(a: Box, b: Box): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return width / Math.max(1, Math.min(a.width, b.width));
}

/** Groups strokes drawn one after another that overlap horizontally (t, +, =, x, 4, π…). */
function groupStrokes(strokes: Stroke[], typicalSize: number): Stroke[][] {
  const groups: Array<{ strokes: Stroke[]; box: Box }> = [];
  for (const stroke of strokes) {
    const box = boundingBox(stroke);
    const last = groups[groups.length - 1];
    const previous = groups[groups.length - 2];
    const candidates = [last, previous].filter(Boolean);
    let merged = false;
    for (const group of candidates) {
      const pad = typicalSize * 0.15;
      const o = overlap(inflate(group.box, pad), inflate(box, pad));
      const near = Math.abs(group.box.cx - box.cx) < typicalSize * 0.45;
      const thin = (b: Box) => b.height < typicalSize * 0.25;
      const dy = Math.abs(group.box.cy - box.cy);
      // Strokes stacked above/below each other (numerator, bar, denominator) stay separate symbols.
      const verticallyClose = dy < typicalSize * 0.6 || (thin(group.box) && thin(box) && dy < typicalSize * 1.2);
      const smallCrossbar = thin(box) && o > 0.3 && dy < typicalSize * 0.6;
      if (((o > 0.55 && near) || smallCrossbar || (group.box.width < typicalSize * 0.2 && box.width < typicalSize * 0.2 && near)) && verticallyClose) {
        group.strokes.push(stroke);
        group.box = boundingBox(group.strokes.flat());
        merged = true;
        break;
      }
    }
    if (!merged) groups.push({ strokes: [stroke], box });
  }
  return groups.map(group => group.strokes);
}

function typicalSymbolSize(strokes: Stroke[]): number {
  const heights = strokes.map(stroke => boundingBox(stroke).height).filter(h => h > 2).sort((a, b) => a - b);
  if (!heights.length) return 40;
  return Math.max(12, heights[Math.floor(heights.length / 2)]);
}

function assemble(symbols: RecognizedSymbol[], typicalSize: number): string {
  if (!symbols.length) return '';
  // Fraction: the widest bar with content above and below it.
  const bars = symbols.filter(s => s.name === '-' && s.box.width > typicalSize * 0.9).sort((a, b) => b.box.width - a.box.width);
  for (const bar of bars) {
    const inSpan = (s: RecognizedSymbol) => s !== bar && s.box.cx > bar.box.left - typicalSize * 0.2 && s.box.cx < bar.box.right + typicalSize * 0.2;
    const above = symbols.filter(s => inSpan(s) && s.box.cy < bar.box.cy);
    const below = symbols.filter(s => inSpan(s) && s.box.cy > bar.box.cy);
    if (above.length && below.length) {
      const rest = symbols.filter(s => s !== bar && !above.includes(s) && !below.includes(s));
      const left = rest.filter(s => s.box.cx < bar.box.left);
      const right = rest.filter(s => s.box.cx >= bar.box.left);
      return `${assemble(left, typicalSize)}\\frac{${assemble(above, typicalSize)}}{${assemble(below, typicalSize)}}${assemble(right, typicalSize)}`;
    }
  }
  // Root: everything under the radical's bar becomes the radicand.
  const root = symbols.find(s => s.name === '√');
  if (root) {
    const inside = symbols.filter(s => s !== root && s.box.cx > root.box.left + root.box.width * 0.3 && s.box.cx < root.box.right + typicalSize * 0.1 && s.box.cy > root.box.top - typicalSize * 0.2);
    const rest = symbols.filter(s => s !== root && !inside.includes(s));
    const left = rest.filter(s => s.box.cx < root.box.left);
    const right = rest.filter(s => s.box.cx >= root.box.left);
    return `${assemble(left, typicalSize)}\\sqrt{${assemble(inside, typicalSize)}}${assemble(right, typicalSize)}`;
  }
  // Linear layout with superscripts and subscripts relative to the baseline symbols.
  const sorted = symbols.slice().sort((a, b) => a.box.left - b.box.left);
  const baseCandidates = sorted.filter(s => s.box.height > typicalSize * 0.5 || s.name === '-' || s.name === '=');
  const baseline = median((baseCandidates.length ? baseCandidates : sorted).map(s => s.box.cy));
  let out = '';
  let mode: 'base' | 'sup' | 'sub' = 'base';
  let previous: RecognizedSymbol | null = null;
  for (const symbol of sorted) {
    let next: 'base' | 'sup' | 'sub' = 'base';
    if (previous && symbol.box.height < previous.box.height * 0.85 && symbol.box.cy < baseline - typicalSize * 0.35) next = 'sup';
    else if (previous && symbol.box.height < previous.box.height * 0.85 && symbol.box.top > baseline + typicalSize * 0.1) next = 'sub';
    if (next !== mode) {
      if (mode !== 'base') out += '}';
      if (next === 'sup') out += '^{';
      if (next === 'sub') out += '_{';
      mode = next;
    }
    const latex = symbol.latex;
    out += /^\\[a-zA-Z]+$/.test(latex) ? `${latex} ` : latex;
    if (mode === 'base') previous = symbol;
  }
  if (mode !== 'base') out += '}';
  return out.replace(/\s+([{}^_])/g, '$1').trim();
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/** Built-in recogniser: digits, Latin letters, common operators, fractions, roots and scripts. */
export function createBasicRecognizer(): HandwritingRecognizer {
  return {
    recognize(strokes: Stroke[]): RecognitionResult {
      const usable = strokes.filter(stroke => stroke.length > 1);
      if (!usable.length) return { latex: '', confidence: 1, symbols: [] };
      const typicalSize = typicalSymbolSize(usable);
      const groups = groupStrokes(usable, typicalSize);
      const symbols = groups.map(group => recognizeSymbol(group, typicalSize));
      const latex = assemble(symbols, typicalSize);
      const confidence = symbols.reduce((min, s) => Math.min(min, s.score), 1);
      return { latex, confidence, symbols };
    }
  };
}

/** Scribble detection for the deletion gesture: a wide stroke zig-zagging back and forth. */
export function isScribble(stroke: Stroke): boolean {
  if (stroke.length < 8) return false;
  const box = boundingBox(stroke);
  if (box.width < box.height * 1.5) return false;
  let reversals = 0;
  let direction = 0;
  for (let i = 1; i < stroke.length; i++) {
    const dx = stroke[i].x - stroke[i - 1].x;
    if (Math.abs(dx) < 1) continue;
    const next = Math.sign(dx);
    if (direction && next !== direction) reversals++;
    direction = next;
  }
  return reversals >= 4;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
