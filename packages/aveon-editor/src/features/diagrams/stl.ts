/**
 * 3D models from ASCII STL, drawn on a canvas without a 3D library: drag to turn the model, the
 * +/− buttons or Ctrl+wheel to zoom, and three views like GitHub's (Solid, Surface angle, Wireframe).
 */

export interface StlMesh {
  name: string;
  /** Nine numbers (three corners) per triangle. */
  vertices: Float32Array;
  /** Unit normal per triangle, computed from the corners. */
  normals: Float32Array;
  count: number;
}

export type StlMode = 'solid' | 'surface' | 'wireframe';

export interface StlView {
  /** Turn around the vertical axis and tilt, in radians. */
  yaw: number;
  pitch: number;
  zoom: number;
}

/** At most this many triangles are read (larger models are cut off). */
export const MAX_TRIANGLES = 200_000;

/** Reads an ASCII STL model; throws a readable error when it is not one. */
export function parseStl(source: string): StlMesh {
  const text = source.trim();
  if (!/^solid\b/i.test(text)) throw new Error('ASCII STL must start with "solid".');
  const name = /^solid[ \t]*([^\r\n]*)/i.exec(text)![1].trim();
  const numbers: number[] = [];
  const pattern = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && numbers.length < MAX_TRIANGLES * 9) {
    const values = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!values.every(Number.isFinite)) throw new Error(`Not a number in "${match[0]}".`);
    numbers.push(...values);
  }
  const count = Math.floor(numbers.length / 9);
  if (!count) throw new Error('The model has no facets (expected "facet … outer loop … vertex x y z … endloop … endfacet").');
  const vertices = new Float32Array(numbers.slice(0, count * 9));
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const ux = vertices[o + 3] - vertices[o];
    const uy = vertices[o + 4] - vertices[o + 1];
    const uz = vertices[o + 5] - vertices[o + 2];
    const vx = vertices[o + 6] - vertices[o];
    const vy = vertices[o + 7] - vertices[o + 1];
    const vz = vertices[o + 8] - vertices[o + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals.set([nx / length, ny / length, nz / length], i * 3);
  }
  return { name, vertices, normals, count };
}

export const DEFAULT_STL_VIEW: StlView = { yaw: -0.7, pitch: 0.5, zoom: 1 };

/** Draws the model on a 2D canvas context (painter's algorithm, perspective projection). */
export function drawStl(context: CanvasRenderingContext2D, width: number, height: number, mesh: StlMesh, view: StlView, mode: StlMode): void {
  const { vertices, normals, count } = mesh;
  // Centre and size of the model.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]); maxX = Math.max(maxX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]); maxY = Math.max(maxY, vertices[i + 1]);
    minZ = Math.min(minZ, vertices[i + 2]); maxZ = Math.max(maxZ, vertices[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2, 1e-9);

  // Z is up (the usual STL convention): turn around Z, then tilt towards the viewer.
  const cosYaw = Math.cos(view.yaw), sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch), sinPitch = Math.sin(view.pitch);
  const rotate = (x: number, y: number, z: number): [number, number, number] => {
    const rx = x * cosYaw - y * sinYaw;
    const ry = x * sinYaw + y * cosYaw;
    // Screen x, screen up, depth (larger is further away).
    return [rx, z * cosPitch + ry * sinPitch, ry * cosPitch - z * sinPitch];
  };
  const scale = (Math.min(width, height) / 2 / radius) * 0.8 * view.zoom;
  const distance = radius * 4;
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const [sx, sy, depth] = rotate((x - cx), (y - cy), (z - cz));
    const perspective = distance / (distance + depth);
    return [width / 2 + sx * scale * perspective, height / 2 - sy * scale * perspective, depth];
  };

  const projected = new Float32Array(count * 6);
  const depths = new Float32Array(count);
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    let depth = 0;
    for (let c = 0; c < 3; c++) {
      const [px, py, pz] = project(vertices[o + c * 3], vertices[o + c * 3 + 1], vertices[o + c * 3 + 2]);
      projected[i * 6 + c * 2] = px;
      projected[i * 6 + c * 2 + 1] = py;
      depth += pz;
    }
    depths[i] = depth;
    order[i] = i;
  }
  // Furthest first.
  order.sort((a, b) => depths[b] - depths[a]);

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#f6f8fa';
  context.fillRect(0, 0, width, height);
  context.lineJoin = 'round';
  for (const i of order) {
    const p = i * 6;
    context.beginPath();
    context.moveTo(projected[p], projected[p + 1]);
    context.lineTo(projected[p + 2], projected[p + 3]);
    context.lineTo(projected[p + 4], projected[p + 5]);
    context.closePath();
    if (mode === 'wireframe') {
      context.strokeStyle = 'rgba(31, 35, 40, 0.55)';
      context.lineWidth = 0.6;
      context.stroke();
      continue;
    }
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    let color: string;
    if (mode === 'surface') {
      // Colour by the direction the face points to.
      color = `rgb(${Math.round((nx * 0.5 + 0.5) * 255)}, ${Math.round((ny * 0.5 + 0.5) * 255)}, ${Math.round((nz * 0.5 + 0.5) * 255)})`;
    } else {
      // Light from the viewer, slightly above.
      const [, up, towards] = rotate(nx, ny, nz);
      const light = Math.min(1, Math.abs(-towards * 0.85 + up * 0.35));
      const shade = 0.3 + 0.7 * light;
      color = `rgb(${Math.round(110 * shade + 40)}, ${Math.round(150 * shade + 40)}, ${Math.round(200 * shade + 40)})`;
    }
    context.fillStyle = color;
    context.strokeStyle = color;
    context.lineWidth = 0.5;
    context.fill();
    // Hides hairline gaps between neighbouring triangles.
    context.stroke();
  }
}

export const STL_WIDTH = 640;
export const STL_HEIGHT = 400;

/**
 * Draws an interactive model viewer into `container`. Returns a function giving a PNG data URL of
 * the current view (for exports), or `''` where canvases are not available.
 */
export function mountStl(container: HTMLElement, mesh: StlMesh): () => string {
  const doc = container.ownerDocument;
  container.classList.add('ck-stl');
  container.innerHTML = '';
  const canvas = doc.createElement('canvas');
  canvas.className = 'ck-stl__canvas';
  const ratio = Math.min(2, doc.defaultView?.devicePixelRatio || 1);
  canvas.width = STL_WIDTH * ratio;
  canvas.height = STL_HEIGHT * ratio;
  canvas.style.touchAction = 'none';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', mesh.name ? `3D model: ${mesh.name}` : '3D model');
  const controls = doc.createElement('div');
  controls.className = 'ck-stl__controls';
  container.append(canvas, controls);

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  let view: StlView = { ...DEFAULT_STL_VIEW };
  let mode: StlMode = 'solid';
  let frame = 0;
  const draw = () => {
    frame = 0;
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawStl(context, STL_WIDTH, STL_HEIGHT, mesh, view, mode);
  };
  const redraw = () => {
    if (!frame) frame = (doc.defaultView?.requestAnimationFrame || ((cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number))(draw);
  };

  const modeButtons: HTMLButtonElement[] = [];
  const button = (label: string, action: () => void, pressed?: () => boolean) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.className = 'ck-stl__button';
    element.textContent = label;
    element.addEventListener('mousedown', event => event.stopPropagation());
    element.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      action();
      sync();
    });
    if (pressed) {
      modeButtons.push(element);
      (element as any)._pressed = pressed;
    }
    return element;
  };
  const sync = () => modeButtons.forEach(b => b.setAttribute('aria-pressed', String((b as any)._pressed())));
  const setMode = (value: StlMode) => () => {
    mode = value;
    redraw();
  };
  const zoom = (factor: number) => {
    view = { ...view, zoom: Math.max(0.2, Math.min(20, view.zoom * factor)) };
    redraw();
  };
  controls.append(
    button('Solid', setMode('solid'), () => mode === 'solid'),
    button('Surface angle', setMode('surface'), () => mode === 'surface'),
    button('Wireframe', setMode('wireframe'), () => mode === 'wireframe'),
    button('+', () => zoom(1.25)),
    button('−', () => zoom(0.8)),
    button('Reset', () => {
      view = { ...DEFAULT_STL_VIEW };
      redraw();
    })
  );
  controls.querySelectorAll('button').forEach(b => {
    if (b.textContent === '+') b.setAttribute('aria-label', 'Zoom in');
    if (b.textContent === '−') b.setAttribute('aria-label', 'Zoom out');
  });
  sync();

  let drag: { x: number; y: number; view: StlView } | null = null;
  canvas.addEventListener('dragstart', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (event.button > 0) return;
    drag = { x: event.clientX, y: event.clientY, view };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured.
      }
    }
    view = { ...drag.view, yaw: drag.view.yaw + dx * 0.01, pitch: Math.max(-1.55, Math.min(1.55, drag.view.pitch + dy * 0.01)) };
    redraw();
  });
  const end = () => (drag = null);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 0.87);
    },
    { passive: false }
  );

  draw();
  return () => {
    if (!context) return '';
    draw();
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  };
}
