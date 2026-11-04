/**
 * Crop dialog shared by images and sketches: the picture with a rectangle to drag and resize (eight
 * handles, an aspect lock, a pixel readout). Resolves with the chosen rectangle in picture pixels.
 */

import { applyTheme } from '../../ui/theme';
import type { Editor } from '../../core/editor';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropDialogOptions {
  /** URL (or data URL) of the picture to show. */
  src: string;
  width: number;
  height: number;
  title?: string;
  /** Shown instead of the Apply button when the picture cannot be cropped (e.g. cross-origin). */
  error?: string;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];
const MIN_SIZE = 8;

export function openCropDialog(editor: Editor, options: CropDialogOptions): Promise<CropRect | null> {
  const t = editor.t;
  const doc = editor.ui.element?.ownerDocument || document;
  return new Promise(resolve => {
    const overlay = doc.createElement('div');
    overlay.className = 'ck ck-dialog-overlay ck-reset_all-excluded';
    applyTheme(editor, overlay);
    const dialog = doc.createElement('div');
    dialog.className = 'ck-dialog ck-dialog_crop';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', options.title || t('Crop'));

    const title = doc.createElement('h2');
    title.className = 'ck-dialog__title';
    title.textContent = options.title || t('Crop');

    // The picture is shown at a size that fits the dialog; the rectangle is kept in picture pixels.
    const maxW = Math.min(720, Math.max(240, (doc.defaultView?.innerWidth || 800) - 96));
    const maxH = Math.min(480, Math.max(200, (doc.defaultView?.innerHeight || 600) - 240));
    const scale = Math.min(1, maxW / options.width, maxH / options.height);
    const shownW = Math.max(1, Math.round(options.width * scale));
    const shownH = Math.max(1, Math.round(options.height * scale));

    const stage = doc.createElement('div');
    stage.className = 'ck-crop__stage';
    stage.style.width = `${shownW}px`;
    stage.style.height = `${shownH}px`;
    const picture = doc.createElement('img');
    picture.className = 'ck-crop__picture';
    picture.src = options.src;
    picture.alt = '';
    picture.draggable = false;
    const box = doc.createElement('div');
    box.className = 'ck-crop__box';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', t('Crop area'));
    for (const handle of HANDLES) {
      const el = doc.createElement('div');
      el.className = `ck-crop__handle ck-crop__handle_${handle}`;
      el.setAttribute('data-crop-handle', handle);
      box.appendChild(el);
    }
    stage.append(picture, box);

    const toolbar = doc.createElement('div');
    toolbar.className = 'ck-crop__toolbar';
    const aspectLabel = doc.createElement('label');
    aspectLabel.className = 'ck-crop__aspect';
    aspectLabel.textContent = t('Aspect');
    const aspect = doc.createElement('select');
    aspect.className = 'ck-dialog__input ck-crop__aspect-select';
    const ratios: Array<[string, number | null]> = [
      [t('Free'), null],
      [t('Original'), options.width / options.height],
      ['1:1', 1],
      ['4:3', 4 / 3],
      ['16:9', 16 / 9],
      ['3:4', 3 / 4]
    ];
    ratios.forEach(([label, value], index) => {
      const option = doc.createElement('option');
      option.value = String(index);
      option.textContent = label;
      aspect.appendChild(option);
    });
    aspectLabel.appendChild(aspect);
    const readout = doc.createElement('span');
    readout.className = 'ck-crop__readout';
    const reset = doc.createElement('button');
    reset.type = 'button';
    reset.className = 'ck-dialog__button';
    reset.textContent = t('Reset');
    toolbar.append(aspectLabel, readout, reset);

    const actions = doc.createElement('div');
    actions.className = 'ck-dialog__actions';
    const close = (result: CropRect | null) => {
      overlay.remove();
      editor.editing.view.focus();
      resolve(result);
    };
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ck-dialog__button';
    cancel.textContent = t('Cancel');
    cancel.addEventListener('click', () => close(null));
    const apply = doc.createElement('button');
    apply.type = 'button';
    apply.className = 'ck-dialog__button ck-dialog__button_primary';
    apply.textContent = t('Apply');
    actions.append(cancel, apply);
    if (options.error) {
      const error = doc.createElement('p');
      error.className = 'ck-crop__error';
      error.textContent = options.error;
      dialog.append(title, stage, error, actions);
      apply.disabled = true;
    } else {
      dialog.append(title, stage, toolbar, actions);
    }
    overlay.append(dialog);
    doc.body.appendChild(overlay);

    // The rectangle, in picture pixels.
    let rect: CropRect = { x: 0, y: 0, width: options.width, height: options.height };
    let ratio: number | null = null;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const draw = () => {
      box.style.left = `${rect.x * scale}px`;
      box.style.top = `${rect.y * scale}px`;
      box.style.width = `${rect.width * scale}px`;
      box.style.height = `${rect.height * scale}px`;
      readout.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
    };
    const applyRatio = () => {
      if (!ratio) return;
      let width = rect.width;
      let height = width / ratio;
      if (height > options.height) {
        height = options.height;
        width = height * ratio;
      }
      rect = { x: clamp(rect.x, 0, options.width - width), y: clamp(rect.y, 0, options.height - height), width, height };
      draw();
    };
    aspect.addEventListener('change', () => {
      ratio = ratios[Number(aspect.value)][1];
      applyRatio();
    });
    reset.addEventListener('click', () => {
      rect = { x: 0, y: 0, width: options.width, height: options.height };
      applyRatio();
      draw();
    });
    apply.addEventListener('click', () => {
      const result = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
      const whole = result.x === 0 && result.y === 0 && result.width === options.width && result.height === options.height;
      close(whole ? null : result);
    });

    // Dragging the box moves it; dragging a handle resizes it (within the picture, keeping the ratio).
    let drag: { handle: Handle | 'move'; startX: number; startY: number; start: CropRect } | null = null;
    const pointAt = (event: PointerEvent) => ({ x: event.clientX / scale, y: event.clientY / scale });
    box.addEventListener('pointerdown', event => {
      if (event.button > 0) return;
      event.preventDefault();
      const target = event.target as HTMLElement;
      const handle = (target.getAttribute('data-crop-handle') as Handle | null) || 'move';
      const point = pointAt(event);
      drag = { handle, startX: point.x, startY: point.y, start: { ...rect } };
      try {
        box.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured.
      }
    });
    box.addEventListener('pointermove', event => {
      if (!drag) return;
      const point = pointAt(event);
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const s = drag.start;
      if (drag.handle === 'move') {
        rect = { ...s, x: clamp(s.x + dx, 0, options.width - s.width), y: clamp(s.y + dy, 0, options.height - s.height) };
        draw();
        return;
      }
      let { x, y, width, height } = s;
      const h = drag.handle;
      if (h.includes('e')) width = clamp(s.width + dx, MIN_SIZE, options.width - s.x);
      if (h.includes('s')) height = clamp(s.height + dy, MIN_SIZE, options.height - s.y);
      if (h.includes('w')) {
        const nx = clamp(s.x + dx, 0, s.x + s.width - MIN_SIZE);
        width = s.width + (s.x - nx);
        x = nx;
      }
      if (h.includes('n')) {
        const ny = clamp(s.y + dy, 0, s.y + s.height - MIN_SIZE);
        height = s.height + (s.y - ny);
        y = ny;
      }
      if (ratio) {
        // Corners follow the width; edges follow the moved side.
        if (h === 'n' || h === 's') width = height * ratio;
        else height = width / ratio;
        if (h.includes('w')) x = s.x + s.width - width;
        if (h.includes('n')) y = s.y + s.height - height;
        if (x < 0 || y < 0 || x + width > options.width || y + height > options.height) return;
      }
      rect = { x, y, width, height };
      draw();
    });
    const end = () => {
      drag = null;
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') close(null);
    });
    draw();
    (options.error ? cancel : apply).focus();
  });
}
