/**
 * Maps from GeoJSON and TopoJSON, drawn as SVG in the Web Mercator projection without a map library,
 * so they work offline. A tile server (`diagrams.map.tiles`) adds a background map when configured.
 *
 * Shapes follow the simplestyle properties GitHub uses (`stroke`, `stroke-width`, `stroke-opacity`,
 * `fill`, `fill-opacity`, `marker-color`); every value is validated before it reaches the markup.
 */

import { escapeHtml } from '../shared/upcast';

export interface MapFeature {
  geometry: Geometry | null;
  properties: Record<string, unknown>;
}

type Position = number[];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint' | 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };

export interface MapOptions {
  /** Tile URL template, e.g. `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. None: shapes only. */
  tiles?: string;
  /** Attribution shown over the tiles (plain text). */
  attribution?: string;
  maxZoom?: number;
}

export interface MapView {
  /** Centre in world units (0–256 across the whole world at zoom 0). */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  k: number;
}

/** Logical size of a map; the SVG scales to the width of the page. */
export const MAP_WIDTH = 640;
export const MAP_HEIGHT = 360;

const MAX_LAT = 85.05112878;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_COLOR = '#0969da';

/* ------------------------------------------------------------------------------------------ */
/* Reading GeoJSON and TopoJSON                                                                */
/* ------------------------------------------------------------------------------------------ */

/** Features of a GeoJSON or TopoJSON document; throws a readable error when it is neither. */
export function parseMapSource(type: 'geojson' | 'topojson', source: string): MapFeature[] {
  let data: any;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new Error(`Not valid JSON: ${(error as Error).message}`);
  }
  if (type === 'topojson' || data?.type === 'Topology') return topojsonToFeatures(data);
  return geojsonToFeatures(data);
}

export function geojsonToFeatures(data: any): MapFeature[] {
  if (!data || typeof data !== 'object') throw new Error('GeoJSON must be an object.');
  switch (data.type) {
    case 'FeatureCollection':
      if (!Array.isArray(data.features)) throw new Error('A FeatureCollection needs a "features" array.');
      return data.features.flatMap((feature: any) => geojsonToFeatures(feature));
    case 'Feature':
      return [{ geometry: data.geometry ? checkGeometry(data.geometry) : null, properties: plainObject(data.properties) }];
    default:
      return [{ geometry: checkGeometry(data), properties: {} }];
  }
}

const GEOMETRY_DEPTH: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

function checkGeometry(geometry: any): Geometry {
  if (!geometry || typeof geometry !== 'object') throw new Error('Missing geometry.');
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) throw new Error('A GeometryCollection needs a "geometries" array.');
    return { type: 'GeometryCollection', geometries: geometry.geometries.map(checkGeometry) };
  }
  const depth = GEOMETRY_DEPTH[geometry.type];
  if (depth === undefined) throw new Error(`Unknown geometry type "${String(geometry.type)}".`);
  const check = (value: any, level: number): boolean =>
    Array.isArray(value) && (level === 0 ? value.length >= 2 && value.every(n => typeof n === 'number' && Number.isFinite(n)) : value.every(item => check(item, level - 1)));
  if (!check(geometry.coordinates, depth)) throw new Error(`The coordinates of a ${geometry.type} are not valid.`);
  return { type: geometry.type, coordinates: geometry.coordinates } as Geometry;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Decodes a TopoJSON topology (quantised or not) into features, one per geometry of each object. */
export function topojsonToFeatures(topology: any): MapFeature[] {
  if (!topology || topology.type !== 'Topology' || typeof topology.objects !== 'object' || !topology.objects) {
    throw new Error('TopoJSON must be a Topology with "objects".');
  }
  const transform = topology.transform;
  const [sx, sy] = transform?.scale || [1, 1];
  const [tx, ty] = transform?.translate || [0, 0];
  const point = (p: number[]): Position => (transform ? [p[0] * sx + tx, p[1] * sy + ty] : [p[0], p[1]]);
  const arcs: Position[][] = (Array.isArray(topology.arcs) ? topology.arcs : []).map((arc: number[][]) => {
    if (!transform) return arc.map(p => [p[0], p[1]]);
    let x = 0;
    let y = 0;
    return arc.map(p => {
      x += p[0];
      y += p[1];
      return [x * sx + tx, y * sy + ty];
    });
  });
  const arc = (index: number): Position[] => {
    const points = arcs[index < 0 ? ~index : index];
    if (!points) throw new Error(`TopoJSON refers to arc ${index}, which does not exist.`);
    return index < 0 ? points.slice().reverse() : points;
  };
  const line = (indexes: number[]): Position[] => {
    const points: Position[] = [];
    for (const index of indexes) {
      const part = arc(index);
      points.push(...(points.length ? part.slice(1) : part));
    }
    return points;
  };
  const geometry = (object: any): Geometry | null => {
    switch (object?.type) {
      case 'Point':
        return { type: 'Point', coordinates: point(object.coordinates) };
      case 'MultiPoint':
        return { type: 'MultiPoint', coordinates: object.coordinates.map(point) };
      case 'LineString':
        return { type: 'LineString', coordinates: line(object.arcs) };
      case 'MultiLineString':
        return { type: 'MultiLineString', coordinates: object.arcs.map(line) };
      case 'Polygon':
        return { type: 'Polygon', coordinates: object.arcs.map(line) };
      case 'MultiPolygon':
        return { type: 'MultiPolygon', coordinates: object.arcs.map((polygon: number[][]) => polygon.map(line)) };
      case 'GeometryCollection':
        return { type: 'GeometryCollection', geometries: (object.geometries || []).map(geometry).filter(Boolean) };
      default:
        return null;
    }
  };
  const features: MapFeature[] = [];
  for (const object of Object.values(topology.objects) as any[]) {
    const members = object?.type === 'GeometryCollection' ? object.geometries || [] : [object];
    for (const member of members) {
      const shape = geometry(member);
      features.push({ geometry: shape ? checkGeometry(shape) : null, properties: plainObject(member?.properties) });
    }
  }
  return features;
}

/* ------------------------------------------------------------------------------------------ */
/* Projection and drawing                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Web Mercator: longitude/latitude to world units (0–256 at zoom 0, y downwards). */
export function project([lon, lat]: Position): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return [((lon + 180) / 360) * 256, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256];
}

function eachPosition(geometry: Geometry | null, visit: (p: Position) => void): void {
  if (!geometry) return;
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach(g => eachPosition(g, visit));
    return;
  }
  const walk = (value: any): void => {
    if (typeof value[0] === 'number') visit(value);
    else value.forEach(walk);
  };
  walk(geometry.coordinates);
}

/** The view that fits every feature, with a margin. */
export function fitView(features: MapFeature[], maxZoom = 18): MapView {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const feature of features) {
    eachPosition(feature.geometry, p => {
      const [x, y] = project(p);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
  }
  if (!Number.isFinite(minX)) return { x: 128, y: 128, k: MAP_HEIGHT / 256 };
  const maxK = 2 ** Math.min(maxZoom, 16);
  const k = Math.min(maxK, (MAP_WIDTH * 0.85) / Math.max(maxX - minX, 1e-9), (MAP_HEIGHT * 0.85) / Math.max(maxY - minY, 1e-9));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k: Math.max(k, MAP_HEIGHT / 256 / 2) };
}

const round = (n: number) => Math.round(n * 10) / 10;

function styleOf(properties: Record<string, unknown>) {
  const color = (key: string, fallback: string) => (COLOR.test(String(properties[key] ?? '')) ? String(properties[key]) : fallback);
  const number = (key: string, fallback: number, max: number) => {
    const value = Number(properties[key]);
    return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
  };
  return {
    stroke: color('stroke', DEFAULT_COLOR),
    strokeWidth: number('stroke-width', 2, 20),
    strokeOpacity: number('stroke-opacity', 1, 1),
    fill: color('fill', DEFAULT_COLOR),
    fillOpacity: number('fill-opacity', 0.25, 1),
    marker: color('marker-color', DEFAULT_COLOR)
  };
}

/** A short label for a feature (its name or title property). */
function featureTitle(properties: Record<string, unknown>): string {
  for (const key of ['name', 'title', 'Name', 'NAME', 'label']) {
    if (properties[key] !== undefined && properties[key] !== null) return String(properties[key]);
  }
  return '';
}

/** SVG markup for the features in `view` (shapes, then tiles behind them when configured). */
export function renderMapSvg(features: MapFeature[], view: MapView, options: MapOptions = {}, interactive = false): string {
  const screen = (p: Position) => {
    const [x, y] = project(p);
    return [round((x - view.x) * view.k + MAP_WIDTH / 2), round((y - view.y) * view.k + MAP_HEIGHT / 2)];
  };
  const shapes: string[] = [];
  features.forEach((feature, index) => {
    const style = styleOf(feature.properties);
    const title = featureTitle(feature.properties);
    const attrs = interactive ? ` data-feature="${index}" tabindex="0"` : '';
    const titleTag = title ? `<title>${escapeHtml(title)}</title>` : '';
    const parts: string[] = [];
    const draw = (geometry: Geometry | null): void => {
      if (!geometry) return;
      const ring = (points: Position[]) => points.map((p, i) => `${i ? 'L' : 'M'}${screen(p).join(' ')}`).join('');
      switch (geometry.type) {
        case 'Point':
        case 'MultiPoint': {
          const points = (geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates) as Position[];
          for (const p of points) {
            const [x, y] = screen(p);
            parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="${style.marker}" stroke="#fff" stroke-width="2"/>`);
          }
          break;
        }
        case 'LineString':
        case 'MultiLineString': {
          const lines = (geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates) as Position[][];
          parts.push(`<path d="${lines.map(ring).join('')}" fill="none" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-opacity="${style.strokeOpacity}" stroke-linejoin="round" stroke-linecap="round"/>`);
          break;
        }
        case 'Polygon':
        case 'MultiPolygon': {
          const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as Position[][][];
          const d = polygons.map(rings => rings.map(points => ring(points) + 'Z').join('')).join('');
          parts.push(`<path d="${d}" fill="${style.fill}" fill-opacity="${style.fillOpacity}" fill-rule="evenodd" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-opacity="${style.strokeOpacity}" stroke-linejoin="round"/>`);
          break;
        }
        case 'GeometryCollection':
          geometry.geometries.forEach(draw);
      }
    };
    draw(feature.geometry);
    if (parts.length) shapes.push(`<g class="ck-map__feature"${attrs}>${titleTag}${parts.join('')}</g>`);
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" role="img" aria-label="Map">` +
    `<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#eef3f8"/>` +
    tileImages(view, options) +
    shapes.join('') +
    '</svg>'
  );
}

function tileImages(view: MapView, options: MapOptions): string {
  if (!options.tiles) return '';
  const maxZoom = options.maxZoom ?? 18;
  const z = Math.max(0, Math.min(maxZoom, Math.round(Math.log2(view.k))));
  const count = 2 ** z;
  const size = (256 / count) * view.k;
  const left = view.x - MAP_WIDTH / 2 / view.k;
  const top = view.y - MAP_HEIGHT / 2 / view.k;
  const firstX = Math.floor((left / 256) * count);
  const firstY = Math.max(0, Math.floor((top / 256) * count));
  const lastX = Math.floor(((left + MAP_WIDTH / view.k) / 256) * count);
  const lastY = Math.min(count - 1, Math.floor(((top + MAP_HEIGHT / view.k) / 256) * count));
  const images: string[] = [];
  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      const wrapped = ((tx % count) + count) % count;
      const href = options.tiles.replace('{z}', String(z)).replace('{x}', String(wrapped)).replace('{y}', String(ty));
      const x = round(((tx * 256) / count - left) * view.k);
      const y = round(((ty * 256) / count - top) * view.k);
      images.push(`<image href="${escapeHtml(href)}" x="${x}" y="${y}" width="${round(size) + 0.5}" height="${round(size) + 0.5}" preserveAspectRatio="none"/>`);
    }
  }
  return images.join('');
}

/* ------------------------------------------------------------------------------------------ */
/* Interactive map                                                                             */
/* ------------------------------------------------------------------------------------------ */

/**
 * Draws an interactive map into `container`: drag to move, the +/− buttons or Ctrl+wheel to zoom,
 * click a shape to see its properties. Returns the current view's static SVG for exports.
 */
export function mountMap(container: HTMLElement, features: MapFeature[], options: MapOptions = {}): () => string {
  const doc = container.ownerDocument;
  const initial = fitView(features, options.maxZoom);
  let view: MapView = { ...initial };
  const maxK = 2 ** (options.maxZoom ?? 18);
  const minK = MAP_HEIGHT / 256 / 2;

  container.classList.add('ck-map');
  container.innerHTML = '';
  const canvas = doc.createElement('div');
  canvas.className = 'ck-map__canvas';
  const controls = doc.createElement('div');
  controls.className = 'ck-map__controls';
  const info = doc.createElement('div');
  info.className = 'ck-map__info';
  info.hidden = true;
  container.append(canvas, controls, info);
  if (options.tiles && options.attribution) {
    const attribution = doc.createElement('div');
    attribution.className = 'ck-map__attribution';
    attribution.textContent = options.attribution;
    container.append(attribution);
  }

  let frame = 0;
  const draw = () => {
    frame = 0;
    canvas.innerHTML = renderMapSvg(features, view, options, true);
  };
  const redraw = () => {
    if (!frame) frame = (doc.defaultView?.requestAnimationFrame || ((cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number))(draw);
  };
  const zoom = (factor: number, cx = MAP_WIDTH / 2, cy = MAP_HEIGHT / 2) => {
    const k = Math.max(minK, Math.min(maxK, view.k * factor));
    // Keep the point under the cursor in place.
    const wx = view.x + (cx - MAP_WIDTH / 2) / view.k;
    const wy = view.y + (cy - MAP_HEIGHT / 2) / view.k;
    view = { k, x: wx - (cx - MAP_WIDTH / 2) / k, y: wy - (cy - MAP_HEIGHT / 2) / k };
    redraw();
  };
  const button = (label: string, title: string, action: () => void) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.className = 'ck-map__button';
    element.textContent = label;
    element.title = title;
    element.setAttribute('aria-label', title);
    element.addEventListener('mousedown', event => event.stopPropagation());
    element.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return element;
  };
  controls.append(
    button('+', 'Zoom in', () => zoom(2)),
    button('−', 'Zoom out', () => zoom(0.5)),
    button('⤢', 'Show everything', () => {
      view = { ...initial };
      redraw();
    })
  );

  const toLogical = (event: MouseEvent | PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const scale = MAP_WIDTH / (rect.width || MAP_WIDTH);
    return [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale];
  };
  let drag: { x: number; y: number; view: MapView; moved: boolean } | null = null;
  canvas.addEventListener('dragstart', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (event.button > 0) return;
    const [x, y] = toLogical(event);
    drag = { x, y, view, moved: false };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const [x, y] = toLogical(event);
    if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured.
      }
    }
    view = { k: drag.view.k, x: drag.view.x - (x - drag.x) / drag.view.k, y: drag.view.y - (y - drag.y) / drag.view.k };
    redraw();
  });
  const endDrag = (event: PointerEvent) => {
    const wasClick = drag && !drag.moved;
    drag = null;
    if (!wasClick) return;
    const target = (event.target as Element | null)?.closest?.('[data-feature]');
    showInfo(target ? Number(target.getAttribute('data-feature')) : -1);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => (drag = null));
  canvas.addEventListener(
    'wheel',
    event => {
      // Plain scrolling scrolls the page; Ctrl (or a pinch, which browsers report as Ctrl) zooms.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const [x, y] = toLogical(event);
      zoom(event.deltaY < 0 ? 1.25 : 0.8, x, y);
    },
    { passive: false }
  );

  function showInfo(index: number): void {
    const feature = features[index];
    const entries = feature ? Object.entries(feature.properties) : [];
    if (!entries.length) {
      info.hidden = true;
      return;
    }
    info.innerHTML =
      '<table>' +
      entries
        .slice(0, 50)
        .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value))}</td></tr>`)
        .join('') +
      '</table>';
    info.hidden = false;
  }

  draw();
  return () => renderMapSvg(features, view, options);
}
