/**
 * Handwriting recognition for the formula editor.
 *
 * `HandwritingRecognizer` is the pluggable contract (MyScript, Mathpix or any service can be wired in
 * through `math.handwriting.recognizer`). `createBasicRecognizer()` is a dependency-free, on-device
 * recogniser:
 *
 * 1. Strokes are cleaned up: duplicate points dropped, jitter smoothed and pen-down/pen-up hooks cut.
 * 2. Strokes are grouped into symbols by position, with recognition deciding borderline merges.
 * 3. Each symbol is scored against template shapes by combining a direction-tolerant, rotation-limited
 *    $1 unistroke distance (Wobbrock, Wilson and Li, 2007), an order-independent $P point-cloud
 *    distance (Vatavu, Anthony and Wobbrock, 2012), the aspect ratio and the stroke count.
 * 4. The symbols are assembled into LaTeX by position: fraction bars, roots, superscripts and
 *    subscripts. Alternative readings are offered for the least certain symbols.
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
  /** Other plausible readings of the whole input, most likely first. */
  alternatives?: string[];
}

export interface SymbolCandidate {
  name: string;
  latex: string;
  score: number;
}

export interface RecognizedSymbol {
  name: string;
  latex: string;
  score: number;
  box: Box;
  strokes: Stroke[];
  /** Ranked readings of this symbol, the chosen one first. */
  candidates?: SymbolCandidate[];
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
const CLOUD_COUNT = 32;
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
  const uniform = ratio < 0.3;
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

/** $P point cloud: all strokes resampled together, scaled uniformly (aspect ratio kept) to a unit box. */
function normalizeCloud(strokes: Stroke[]): Point[] {
  const total = strokes.reduce((sum, stroke) => sum + Math.max(pathLength(stroke), 1e-6), 0);
  const points: Point[] = [];
  strokes.forEach((stroke, index) => {
    const share = index === strokes.length - 1 ? CLOUD_COUNT - points.length : Math.max(1, Math.round((CLOUD_COUNT * Math.max(pathLength(stroke), 1e-6)) / total));
    points.push(...(stroke.length > 1 && share > 1 ? resample(stroke, share) : [{ ...stroke[0] }]));
  });
  while (points.length < CLOUD_COUNT) points.push({ ...points[points.length - 1] });
  points.length = CLOUD_COUNT;
  const box = boundingBox(points);
  const scale = Math.max(box.width, box.height, 1e-6);
  const scaled = points.map(p => ({ x: (p.x - box.left) / scale, y: (p.y - box.top) / scale }));
  return translateToOrigin(scaled);
}

function cloudDistance(a: Point[], b: Point[], start: number): number {
  const n = a.length;
  const matched = new Array<boolean>(n).fill(false);
  let sum = 0;
  let i = start;
  do {
    let index = -1;
    let min = Infinity;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
      if (d < min) {
        min = d;
        index = j;
      }
    }
    matched[index] = true;
    const weight = 1 - ((i - start + n) % n) / n;
    sum += weight * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

/** Greedy $P matching; returns the mean point distance in unit-box units. */
function greedyCloudMatch(points: Point[], template: Point[]): number {
  const step = Math.floor(Math.sqrt(points.length));
  let min = Infinity;
  for (let i = 0; i < points.length; i += step) {
    min = Math.min(min, cloudDistance(points, template, i), cloudDistance(template, points, i));
  }
  // The weights sum to (n + 1) / 2.
  return min / ((points.length + 1) / 2);
}

/* ------------------------------------------------------------------------------------------ */
/* Stroke clean-up                                                                             */
/* ------------------------------------------------------------------------------------------ */

function dedupe(stroke: Stroke): Stroke {
  const out: Stroke = [stroke[0]];
  for (let i = 1; i < stroke.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(stroke[i].x - last.x, stroke[i].y - last.y) >= 1) out.push(stroke[i]);
  }
  if (out.length === 1 && stroke.length > 1) out.push(stroke[stroke.length - 1]);
  return out;
}

function smooth(stroke: Stroke): Stroke {
  if (stroke.length < 5) return stroke;
  return stroke.map((p, i) => {
    if (i === 0 || i === stroke.length - 1) return p;
    const a = stroke[i - 1];
    const b = stroke[i + 1];
    return { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
  });
}

/** Index of the point `distance` along the stroke from its start. */
function indexAtDistance(stroke: Stroke, distance: number): number {
  let d = 0;
  for (let i = 1; i < stroke.length; i++) {
    d += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
    if (d >= distance) return i;
  }
  return stroke.length - 1;
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (!la || !lb) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
}

/** Cuts the short, sharply bent flicks a pen often leaves when it lands or lifts. */
function dehook(stroke: Stroke): Stroke {
  if (stroke.length < 6) return stroke;
  const length = pathLength(stroke);
  const box = boundingBox(stroke);
  const limit = Math.min(length * 0.15, Math.max(box.width, box.height) * 0.2);
  const cut = (points: Stroke): Stroke => {
    const k = indexAtDistance(points, limit);
    const k2 = indexAtDistance(points, limit * 2.5);
    if (k <= 0 || k2 <= k) return points;
    const hook = angleBetween(points[k].x - points[0].x, points[k].y - points[0].y, points[k2].x - points[k].x, points[k2].y - points[k].y);
    return hook > (100 * Math.PI) / 180 ? points.slice(k) : points;
  };
  const head = cut(stroke);
  return cut(head.slice().reverse()).reverse();
}

function cleanStroke(stroke: Stroke): Stroke {
  const deduped = dedupe(stroke);
  if (deduped.length < 3) return deduped;
  return dehook(smooth(deduped));
}

/* ------------------------------------------------------------------------------------------ */
/* Templates                                                                                   */
/* ------------------------------------------------------------------------------------------ */

interface Template {
  name: string;
  latex: string;
  /** $1 path: all strokes joined in drawing order. */
  points: Point[];
  /** The same path drawn backwards. */
  reversed: Point[];
  cloud: Point[];
  strokes: number;
  aspect: number;
  /** Small bias against rarely meant readings (e.g. the letter o versus zero). */
  prior: number;
  /** Only small marks (commas) are limited in size relative to the other symbols. */
  maxSize?: number;
}

/**
 * Tiny path language in a unit box: `M x y` starts a stroke, `L x y` draws a line and
 * `A cx cy rx ry fromDeg toDeg` an arc (0° points right, angles grow clockwise on screen).
 */
function path(spec: string): Point[][] {
  const strokes: Point[][] = [];
  const commands = spec.trim().split(/\s+(?=[MLA])/);
  for (const command of commands) {
    const parts = command.trim().split(/\s+/);
    const op = parts[0];
    const nums = parts.slice(1).map(Number);
    if (op === 'M') {
      strokes.push([{ x: nums[0], y: nums[1] }]);
    } else if (op === 'L') {
      strokes[strokes.length - 1].push({ x: nums[0], y: nums[1] });
    } else if (op === 'A') {
      if (!strokes.length) strokes.push([]);
      const [cx, cy, rx, ry, from, to] = nums;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
        strokes[strokes.length - 1].push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
      }
    }
  }
  return strokes;
}

/**
 * [name, latex, path, natural width/height, prior penalty, largest size relative to other symbols].
 * Several variants per symbol cover common writing styles and stroke orders.
 */
const templateSpecs: Array<[string, string, string, number, number?, number?]> = [
  ['0', '0', 'A 0.5 0.5 0.5 0.5 -90 270', 0.7],
  ['0', '0', 'A 0.5 0.5 0.5 0.5 -100 -460', 0.7],
  ['o', 'o', 'A 0.5 0.5 0.5 0.5 -90 270', 1.05, 0.06],
  ['1', '1', 'M 0.5 0 L 0.5 1', 0.1],
  ['1', '1', 'M 0 0.25 L 0.6 0 L 0.6 1', 0.4],
  ['1', '1', 'M 0.2 0.2 L 0.55 0 L 0.55 1 M 0.15 1 L 0.95 1', 0.6],
  ['2', '2', 'A 0.5 0.25 0.45 0.25 -170 30 L 0 1 L 1 1', 0.65],
  ['2', '2', 'A 0.5 0.28 0.45 0.28 -160 10 L 0.05 1 L 0.95 1', 0.75],
  ['3', '3', 'A 0.5 0.25 0.42 0.25 -160 90 A 0.5 0.75 0.45 0.25 -90 160', 0.6],
  ['3', '3', 'M 0.05 0 L 0.9 0 L 0.4 0.38 A 0.5 0.68 0.45 0.32 -90 160', 0.65],
  ['4', '4', 'M 0.65 0 L 0 0.65 L 1 0.65 M 0.7 0.2 L 0.7 1', 0.75],
  ['4', '4', 'M 0.1 0 L 0.05 0.6 L 1 0.6 M 0.75 0 L 0.75 1', 0.75],
  ['4', '4', 'M 0.7 0.2 L 0.7 1 M 0.65 0 L 0 0.65 L 1 0.65', 0.75],
  ['5', '5', 'M 0.9 0 L 0.2 0 L 0.15 0.45 A 0.5 0.7 0.42 0.3 -120 160', 0.65],
  ['5', '5', 'M 0.2 0 L 0.15 0.45 A 0.5 0.7 0.42 0.3 -120 160 M 0.2 0 L 0.9 0', 0.65],
  ['6', '6', 'A 0.8 0.65 0.7 0.65 -95 -180 A 0.5 0.7 0.4 0.3 180 -180', 0.65],
  ['6', '6', 'M 0.75 0 L 0.15 0.6 A 0.5 0.72 0.37 0.28 180 -180', 0.65],
  ['7', '7', 'M 0 0 L 1 0 L 0.35 1', 0.65],
  ['7', '7', 'M 0 0 L 1 0 L 0.35 1 M 0.25 0.5 L 0.85 0.5', 0.7],
  ['8', '8', 'A 0.5 0.25 0.35 0.25 -20 -270 A 0.5 0.75 0.42 0.25 -90 270 A 0.5 0.25 0.35 0.25 90 -20', 0.6],
  ['8', '8', 'A 0.5 0.25 0.35 0.25 -90 270 A 0.5 0.75 0.42 0.25 -90 270', 0.6],
  ['9', '9', 'A 0.5 0.3 0.42 0.3 0 -360 L 0.9 1', 0.6],
  ['9', '9', 'A 0.5 0.3 0.42 0.3 0 -360 L 0.85 0.8 A 0.55 0.8 0.3 0.2 0 150', 0.6],
  ['9', '9', 'A 0.5 0.3 0.42 0.3 0 -360 L 0.6 1', 0.6],
  ['+', '+', 'M 0 0.5 L 1 0.5 M 0.5 0 L 0.5 1', 1],
  ['+', '+', 'M 0.5 0 L 0.5 1 M 0 0.5 L 1 0.5', 1],
  ['-', '-', 'M 0 0.5 L 1 0.5', 4],
  ['=', '=', 'M 0 0.2 L 1 0.2 M 0 0.8 L 1 0.8', 1.8],
  ['x', 'x', 'M 0 0 L 1 1 M 1 0 L 0 1', 0.9],
  ['x', 'x', 'M 1 0 L 0 1 M 0 0 L 1 1', 0.9],
  ['x', 'x', 'A -0.1 0.5 0.55 0.5 -60 60 M 0.82 0.07 A 1.1 0.5 0.55 0.5 -120 -240', 0.9, 0.04],
  ['y', 'y', 'M 0 0 L 0.5 0.55 M 1 0 L 0.15 1', 0.75],
  ['y', 'y', 'M 0.05 0 L 0.05 0.35 A 0.45 0.35 0.4 0.25 180 0 L 0.85 0 L 0.85 0.8 A 0.5 0.8 0.35 0.2 0 160', 0.65],
  ['(', '(', 'A 2 0.5 2 0.58 240 120', 0.3],
  [')', ')', 'A -1 0.5 2 0.58 -60 60', 0.3],
  ['/', '/', 'M 1 0 L 0 1', 0.6],
  ['<', '<', 'M 1 0 L 0 0.5 L 1 1', 0.8],
  ['>', '>', 'M 0 0 L 1 0.5 L 0 1', 0.8],
  ['a', 'a', 'A 0.45 0.5 0.42 0.45 -20 -380 L 0.88 0.05 L 0.9 1', 0.85],
  ['a', 'a', 'A 0.45 0.5 0.42 0.45 -20 -380 L 0.9 1', 0.85],
  ['b', 'b', 'M 0.12 0 L 0.12 1 L 0.12 0.6 A 0.5 0.72 0.38 0.28 -150 180', 0.65],
  ['b', 'b', 'M 0.12 0 L 0.12 1 A 0.5 0.72 0.38 0.28 180 540', 0.65],
  ['c', 'c', 'A 0.55 0.5 0.5 0.5 -45 -315', 0.8],
  ['d', 'd', 'A 0.45 0.7 0.4 0.3 -20 -380 L 0.88 0 L 0.88 1', 0.65],
  ['e', 'e', 'M 0.1 0.5 L 0.9 0.5 A 0.5 0.5 0.4 0.5 0 -300', 0.8],
  ['k', 'k', 'M 0.1 0 L 0.1 1 M 0.9 0.35 L 0.1 0.65 L 0.9 1', 0.7],
  ['m', 'm', 'M 0.05 1 L 0.05 0 A 0.28 0.25 0.22 0.25 180 360 L 0.5 1 L 0.5 0.25 A 0.72 0.25 0.22 0.25 180 360 L 0.95 1', 1.2],
  ['n', 'n', 'M 0.1 1 L 0.1 0 A 0.5 0.3 0.4 0.3 180 360 L 0.9 1', 0.8],
  ['n', 'n', 'M 0.1 0 L 0.1 1 L 0.1 0.4 A 0.5 0.35 0.4 0.3 180 360 L 0.9 1', 0.8],
  ['p', 'p', 'M 0.12 0 L 0.12 1 M 0.12 0.05 A 0.5 0.28 0.38 0.25 -160 180', 0.65],
  ['p', 'p', 'M 0.12 0 L 0.12 1 L 0.12 0.1 A 0.5 0.28 0.38 0.25 -160 180', 0.65],
  ['r', 'r', 'M 0.12 1 L 0.12 0 L 0.12 0.35 A 0.6 0.4 0.48 0.35 180 300', 0.6],
  ['s', 's', 'A 0.5 0.27 0.4 0.25 -20 -270 A 0.5 0.73 0.4 0.25 -90 160', 0.6],
  ['t', 't', 'M 0.5 0 L 0.5 1 M 0.1 0.3 L 0.9 0.3', 0.7],
  ['t', 't', 'M 0.1 0.3 L 0.9 0.3 M 0.5 0 L 0.5 1', 0.7],
  ['u', 'u', 'M 0.1 0 L 0.1 0.6 A 0.5 0.6 0.4 0.4 180 0 L 0.9 0 L 0.92 1', 0.8],
  ['u', 'u', 'M 0.1 0 L 0.1 0.6 A 0.5 0.6 0.4 0.4 180 0 L 0.9 0', 0.8],
  ['v', 'v', 'M 0 0 L 0.5 1 L 1 0', 0.8],
  ['w', 'w', 'M 0 0 L 0.25 1 L 0.5 0.2 L 0.75 1 L 1 0', 1.3],
  ['z', 'z', 'M 0 0 L 1 0 L 0 1 L 1 1', 0.85],
  ['h', 'h', 'M 0.1 0 L 0.1 1 L 0.1 0.6 A 0.5 0.6 0.4 0.25 180 360 L 0.9 1', 0.7],
  ['i', 'i', 'M 0.5 0.3 L 0.5 1 M 0.5 0 L 0.52 0.02', 0.2],
  ['j', 'j', 'M 0.6 0.3 L 0.6 0.8 A 0.35 0.8 0.25 0.2 0 150 M 0.6 0 L 0.62 0.02', 0.4],
  ['f', 'f', 'A 0.7 0.15 0.25 0.15 -10 -180 L 0.45 1 M 0.2 0.4 L 0.75 0.4', 0.5],
  ['g', 'g', 'A 0.45 0.3 0.4 0.28 -20 -380 L 0.88 0 L 0.88 0.8 A 0.5 0.8 0.38 0.2 0 160', 0.6],
  ['q', 'q', 'A 0.45 0.3 0.4 0.28 -20 -380 L 0.88 0 L 0.88 1 L 1 0.9', 0.65, 0.04],
  ['π', '\\pi', 'M 0 0.1 L 1 0.1 M 0.25 0.1 L 0.25 1 M 0.75 0.1 L 0.75 1', 1],
  ['π', '\\pi', 'M 0.25 0.1 L 0.25 1 M 0.75 0.1 L 0.75 1 M 0 0.1 L 1 0.1', 1],
  ['∞', '\\infty', 'A 0.27 0.5 0.27 0.4 0 -360 A 0.73 0.5 0.27 0.4 180 540', 1.8],
  ['√', '\\sqrt', 'M 0 0.6 L 0.2 1 L 0.45 0 L 1 0', 1.3],
  ['√', '\\sqrt', 'M 0 0.55 L 0.12 0.45 L 0.3 1 L 0.5 0 L 1 0', 1.3],
  ['∑', '\\sum', 'M 1 0 L 0 0 L 0.55 0.5 L 0 1 L 1 1', 0.9],
  ['∫', '\\int', 'A 0.7 0.12 0.25 0.12 -10 -180 L 0.5 0.5 L 0.3 0.88 A 0.3 0.88 0.25 0.12 0 90', 0.4],
  [',', ',', 'M 0.5 0 L 0.3 1', 0.4, 0, 0.45]
];

function buildTemplates(): Template[] {
  return templateSpecs.map(([name, latex, spec, aspect, prior, maxSize]) => {
    const strokes = path(spec).map(stroke => stroke.map(p => ({ x: p.x * aspect, y: p.y })));
    const joined = strokes.flat();
    return {
      name,
      latex,
      points: normalize(joined),
      reversed: normalize(joined.slice().reverse()),
      cloud: normalizeCloud(strokes),
      strokes: strokes.length,
      aspect,
      prior: prior || 0,
      maxSize
    };
  });
}

let templates: Template[] | null = null;

/** Readings that are often written identically; offered as alternatives. */
const CONFUSABLE: Record<string, string[]> = {
  '0': ['o', 'O'],
  o: ['0'],
  '1': ['l', '|', 'I'],
  '2': ['z'],
  z: ['2'],
  '5': ['s', 'S'],
  s: ['5'],
  '9': ['g', 'q'],
  q: ['9'],
  g: ['9'],
  x: ['\\times'],
  '.': ['\\cdot'],
  '/': ['1'],
  t: ['+'],
  '+': ['t'],
  '(': ['c'],
  c: ['('],
  u: ['v'],
  v: ['u']
};

/* ------------------------------------------------------------------------------------------ */
/* Symbol recognition                                                                          */
/* ------------------------------------------------------------------------------------------ */

function scoreFromDistance(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 0.45));
}

/**
 * Tall, narrow single strokes (1, /, (, ), ∫) lose their shape when scaled to a square, so they are told
 * apart by how they bend away from the line joining their ends.
 */
function classifyThinStroke(stroke: Stroke, box: Box): Omit<RecognizedSymbol, 'box' | 'strokes'> | null {
  if ((box.width + 2) / (box.height + 2) > 0.45 || box.height < 8) return null;
  const points = stroke[0].y <= stroke[stroke.length - 1].y ? stroke : stroke.slice().reverse();
  const a = points[0];
  const b = points[points.length - 1];
  // Both ends must be the vertical extremes; a flagged 1 or a j's hook is left to the templates.
  const tolerance = box.height * 0.15;
  if (a.y - box.top > tolerance || box.bottom - b.y > tolerance) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy) || 1;
  let maxLeft = 0;
  let maxRight = 0;
  let extremeIndex = 0;
  points.forEach((p, i) => {
    const offset = ((p.x - a.x) * dy - (p.y - a.y) * dx) / chord / chord;
    if (offset < -maxLeft) {
      maxLeft = -offset;
      if (maxLeft > maxRight) extremeIndex = i;
    }
    if (offset > maxRight) {
      maxRight = offset;
      if (maxRight > maxLeft) extremeIndex = i;
    }
  });
  const candidate = (latex: string, score: number, ...others: string[]): Omit<RecognizedSymbol, 'box' | 'strokes'> => {
    const name = latex === '\\int' ? '∫' : latex;
    return { name, latex, score, candidates: [{ name, latex, score }, ...others.map(o => ({ name: o === '\\int' ? '∫' : o, latex: o, score: score * 0.6 }))] };
  };
  if (maxLeft > 0.06 && maxRight > 0.06) return candidate('\\int', 0.8, '(', ')');
  const bend = Math.max(maxLeft, maxRight);
  const middle = extremeIndex / (points.length - 1);
  if (bend > 0.07 && middle > 0.2 && middle < 0.8) {
    const score = Math.min(1, 0.6 + bend * 2);
    return maxLeft > maxRight ? candidate('(', score, '1', 'c') : candidate(')', score, '1');
  }
  if (bend > 0.07) return null;
  // A clearly slanted straight stroke leaning right is a slash.
  return -dx / dy > 0.35 ? candidate('/', 0.85, '1') : candidate('1', 0.9, '/', 'l', '|');
}

function recognizeSymbol(strokes: Stroke[], typicalSize: number): RecognizedSymbol {
  if (!templates) templates = buildTemplates();
  const points = strokes.flat();
  const box = boundingBox(points);
  const dot = (latex: string, name = latex): RecognizedSymbol => ({ name, latex, score: 1, box, strokes, candidates: [{ name, latex, score: 1 }] });
  // A dot: a stroke much smaller than the other symbols.
  if (box.width < typicalSize * 0.2 && box.height < typicalSize * 0.2) return dot('.');
  const aspect = box.width / Math.max(box.height, 1);
  // A long flat stroke is a minus sign or a fraction bar.
  if (aspect > 3.5 && strokes.length === 1) return dot('-');
  const thin = strokes.length === 1 ? classifyThinStroke(strokes[0], box) : null;
  if (thin) return { ...thin, box, strokes };

  const normalized = normalize(points);
  const cloud = normalizeCloud(strokes);
  const inputAspect = Math.min(8, Math.max(0.08, (box.width + 2) / (box.height + 2)));
  const relativeSize = Math.max(box.width, box.height) / typicalSize;
  // Multi-stroke paths depend on stroke order, so the order-free point cloud carries more weight there.
  const cloudWeight = strokes.length === 1 ? 0.55 : 0.75;
  const fixedCost = (template: Template, strokeDifference: number) =>
    Math.min(0.25, Math.abs(Math.log(inputAspect / template.aspect)) * 0.07) + strokeDifference * 0.07 + template.prior;
  const pathCost = (template: Template, measure: (a: Point[], b: Point[]) => number) =>
    Math.min(measure(normalized, template.points), strokes.length === 1 ? measure(normalized, template.reversed) : Infinity) / SQUARE_SIZE;

  // Cheap pass (no rotation search, a single cloud alignment) to shortlist templates.
  const shortlist: Array<{ template: Template; strokeDifference: number; estimate: number }> = [];
  for (const template of templates) {
    const strokeDifference = Math.abs(template.strokes - strokes.length);
    if (strokeDifference > 2 || (template.maxSize && relativeSize > template.maxSize)) continue;
    const quickCloud = Math.min(cloudDistance(cloud, template.cloud, 0), cloudDistance(template.cloud, cloud, 0)) / ((CLOUD_COUNT + 1) / 2);
    const quickPath = strokeDifference === 0 ? pathCost(template, pathDistance) : quickCloud * 1.2;
    shortlist.push({ template, strokeDifference, estimate: cloudWeight * quickCloud + (1 - cloudWeight) * quickPath + fixedCost(template, strokeDifference) });
  }
  shortlist.sort((a, b) => a.estimate - b.estimate);

  const best = new Map<string, { template: Template; distance: number }>();
  for (const { template, strokeDifference } of shortlist.slice(0, 14)) {
    const cloudDistanceValue = greedyCloudMatch(cloud, template.cloud);
    // Direction-tolerant unistroke distance; meaningful only when the stroke counts agree.
    const pathDistanceValue = strokeDifference === 0 ? pathCost(template, distanceAtBestAngle) : cloudDistanceValue * 1.2;
    const distance = cloudWeight * cloudDistanceValue + (1 - cloudWeight) * pathDistanceValue + fixedCost(template, strokeDifference);
    const current = best.get(template.latex);
    if (!current || distance < current.distance) best.set(template.latex, { template, distance });
  }
  const ranked = [...best.values()].sort((a, b) => a.distance - b.distance);
  const candidates: SymbolCandidate[] = ranked.slice(0, 5).map(({ template, distance }) => ({ name: template.name, latex: template.latex, score: scoreFromDistance(distance) }));
  if (!candidates.length) return { name: '?', latex: '?', score: 0, box, strokes, candidates: [] };
  // Confidence also reflects how clearly the winner beats the runner-up.
  const margin = ranked.length > 1 ? ranked[1].distance - ranked[0].distance : 0.2;
  const score = Math.min(candidates[0].score, 0.55 + margin * 4);
  return { name: candidates[0].name, latex: candidates[0].latex, score: Math.max(0, score), box, strokes, candidates };
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

function contains(outer: Box, inner: Box, pad: number): boolean {
  return inner.left >= outer.left - pad && inner.right <= outer.right + pad && inner.top >= outer.top - pad && inner.bottom <= outer.bottom + pad;
}

/** Groups strokes drawn one after another that overlap horizontally (t, +, =, x, 4, π…). */
function groupStrokes(strokes: Stroke[], typicalSize: number): Stroke[][] {
  const groups: Array<{ strokes: Stroke[]; box: Box }> = [];
  for (const stroke of strokes) {
    const box = boundingBox(stroke);
    const last = groups[groups.length - 1];
    const previous = groups[groups.length - 2];
    const candidates = [last, previous].filter(Boolean);
    const targets: typeof groups = [];
    for (const group of candidates) {
      const pad = typicalSize * 0.15;
      const o = overlap(inflate(group.box, pad), inflate(box, pad));
      const near = Math.abs(group.box.cx - box.cx) < typicalSize * 0.5;
      const thin = (b: Box) => b.height < Math.max(typicalSize * 0.25, b.width * 0.25);
      const tiny = (b: Box) => b.width < typicalSize * 0.2 && b.height < typicalSize * 0.2;
      const dy = Math.abs(group.box.cy - box.cy);
      // Strokes stacked above/below each other (numerator, bar, denominator) stay separate symbols.
      const parallelBars = thin(group.box) && thin(box) && dy < Math.max(group.box.width, box.width) * 0.7 && Math.abs(group.box.width - box.width) < Math.max(group.box.width, box.width) * 0.5;
      const verticallyClose = dy < typicalSize * 0.6 || parallelBars;
      const smallCrossbar = thin(box) && o > 0.3 && dy < typicalSize * 0.6 && box.width < typicalSize * 1.5;
      // The dot of an i or a j sits just above its stem.
      const dotOverStem = (tiny(box) || tiny(group.box)) && Math.abs(group.box.cx - box.cx) < typicalSize * 0.25 && dy < typicalSize * 0.9;
      let merge = ((o > 0.55 && (near || parallelBars)) || smallCrossbar || dotOverStem) && (verticallyClose || dotOverStem);
      if (merge && group.strokes.length === 1) {
        // A radical's content and a symbol written under a long bar are separate symbols.
        const alone = recognizeSymbol(group.strokes, typicalSize);
        if (alone.name === '√' && alone.score > 0.5 && box.width < group.box.width * 0.8 && contains(inflate(group.box, typicalSize * 0.3), box, 0)) merge = false;
        // Under a fraction bar there is a gap; the legs of a π touch their bar.
        if (alone.name === '-' && !parallelBars && group.box.width > typicalSize * 1.2 && box.top > group.box.bottom + typicalSize * 0.12) merge = false;
      }
      if (merge) targets.push(group);
    }
    if (!targets.length) {
      groups.push({ strokes: [stroke], box });
      continue;
    }
    // A stroke joining two earlier groups (the bar of a π over both legs) fuses them.
    const [target, ...others] = targets.sort((a, b) => groups.indexOf(a) - groups.indexOf(b));
    for (const other of others) {
      target.strokes.push(...other.strokes);
      groups.splice(groups.indexOf(other), 1);
    }
    target.strokes.push(stroke);
    target.box = boundingBox(target.strokes.flat());
  }
  return groups.map(group => group.strokes);
}

/** Median symbol extent, used to scale every spatial threshold. */
function typicalSymbolSize(strokes: Stroke[]): number {
  const sizes = strokes
    .map(stroke => {
      const box = boundingBox(stroke);
      return Math.max(box.height, Math.min(box.width, box.height * 3, 60));
    })
    .filter(h => h > 2)
    .sort((a, b) => a - b);
  if (!sizes.length) return 40;
  return Math.max(12, sizes[Math.floor(sizes.length / 2)]);
}

type ScriptMode = 'base' | 'sup' | 'sub';

/** Position of `symbol` relative to the preceding base symbol. */
function scriptPosition(symbol: RecognizedSymbol, base: RecognizedSymbol | null): ScriptMode {
  if (!base || symbol.name === '.' || symbol.name === ',') return 'base';
  const b = base.box;
  const s = symbol.box;
  // Operators and dots are no anchors for scripts.
  if (b.height < 6 || ['-', '=', '+', '.', '<', '>'].includes(base.name) || symbol.name === '=') return 'base';
  if (s.height <= b.height * 1.05 && s.bottom < b.cy + b.height * 0.1 && s.cy < b.top + b.height * 0.3) return 'sup';
  if (s.height < b.height * 0.95 && s.top > b.cy && s.cy > b.bottom - b.height * 0.15) return 'sub';
  return 'base';
}

function symbolLatex(symbol: RecognizedSymbol, previous: RecognizedSymbol | null): string {
  // A raised dot between operands is a multiplication dot.
  if (symbol.name === '.' && previous && symbol.box.cy < previous.box.top + previous.box.height * 0.7) return '\\cdot ';
  return /^\\[a-zA-Z]+$/.test(symbol.latex) ? `${symbol.latex} ` : symbol.latex;
}

function assemble(symbols: RecognizedSymbol[], typicalSize: number): string {
  if (!symbols.length) return '';
  // Fraction: the widest bar with content above and below it.
  const bars = symbols.filter(s => s.name === '-' && s.box.width > typicalSize * 0.9).sort((a, b) => b.box.width - a.box.width);
  for (const bar of bars) {
    const inSpan = (s: RecognizedSymbol) => s !== bar && s.box.cx > bar.box.left - typicalSize * 0.2 && s.box.cx < bar.box.right + typicalSize * 0.2;
    const above = symbols.filter(s => inSpan(s) && s.box.cy < bar.box.cy && bar.box.cy - s.box.bottom < typicalSize * 1.2);
    const below = symbols.filter(s => inSpan(s) && s.box.cy > bar.box.cy && s.box.top - bar.box.cy < typicalSize * 1.2);
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
  // Linear layout with superscripts and subscripts relative to the preceding base symbol.
  const sorted = symbols.slice().sort((a, b) => a.box.left - b.box.left);
  let out = '';
  let mode: ScriptMode = 'base';
  let base: RecognizedSymbol | null = null;
  let previous: RecognizedSymbol | null = null;
  for (const symbol of sorted) {
    const next = scriptPosition(symbol, base);
    if (next !== mode) {
      if (mode !== 'base') out += '}';
      if (next === 'sup') out += '^{';
      if (next === 'sub') out += '_{';
      mode = next;
    }
    out += symbolLatex(symbol, previous);
    if (mode === 'base') base = symbol;
    previous = symbol;
  }
  if (mode !== 'base') out += '}';
  return out.replace(/\s+([{}^_])/g, '$1').trim();
}

/** Readings of the whole input with the least certain symbols swapped for their runners-up. */
function alternatives(symbols: RecognizedSymbol[], typicalSize: number, latex: string): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    if (value && value !== latex && !out.includes(value)) out.push(value);
  };
  const weakest = symbols
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  for (const symbol of weakest) {
    const options: SymbolCandidate[] = [...(symbol.candidates || []).slice(1, 4), ...(CONFUSABLE[symbol.latex] || []).map(c => ({ name: c, latex: c, score: 0 }))];
    for (const option of options) {
      const swapped = symbols.map(s => (s === symbol ? { ...s, name: option.name, latex: option.latex } : s));
      add(assemble(swapped, typicalSize));
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/** Built-in recogniser: digits, Latin letters, common operators, fractions, roots and scripts. */
export function createBasicRecognizer(): HandwritingRecognizer {
  return {
    recognize(strokes: Stroke[]): RecognitionResult {
      const usable = strokes.filter(stroke => stroke.length > 1).map(cleanStroke).filter(stroke => stroke.length > 1);
      if (!usable.length) return { latex: '', confidence: 1, symbols: [], alternatives: [] };
      const typicalSize = typicalSymbolSize(usable);
      const groups = groupStrokes(usable, typicalSize);
      const symbols = groups.map(group => recognizeSymbol(group, typicalSize));
      const latex = assemble(symbols, typicalSize);
      const confidence = symbols.reduce((min, s) => Math.min(min, s.score), 1);
      return { latex, confidence, symbols, alternatives: alternatives(symbols, typicalSize, latex) };
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
