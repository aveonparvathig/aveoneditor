import { View } from '../view';
import { getRect, type Rect } from '../../utils/dom';
import type { Locale } from '../../utils/locale';

export type PositioningFunction = (targetRect: Rect, balloonRect: Rect, viewportRect: Rect) => { top: number; left: number; name: string } | null;

export interface PinOptions {
  target: HTMLElement | Range | Rect | (() => HTMLElement | Range | Rect | null);
  limiter?: HTMLElement | Range | Rect | (() => HTMLElement | Range | Rect | null);
  positions?: PositioningFunction[];
  fitInViewport?: boolean;
  viewportOffsetConfig?: { top?: number; bottom?: number; left?: number; right?: number };
}

const ARROW_V = 10;
const ARROW_H = 15;

/**
 * Floating balloon panel positioned relative to a target with an arrow. Used by
 * contextual toolbars (link, image, table) and balloon editors.
 */
export class BalloonPanelView extends View {
  declare public top: number;
  declare public left: number;
  declare public position: string;
  declare public isVisible: boolean;
  declare public withArrow: boolean;
  declare public class: string | undefined;
  public readonly content = this.createCollection();
  private _pinWhenIsVisibleCallback: (() => void) | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _scrollHandler: (() => void) | null = null;

  public static readonly arrowSideOffset = 25;
  public static readonly arrowHeightOffset = 10;
  public static readonly stickyVerticalOffset = 20;

  public static defaultPositions = createDefaultPositions();

  constructor(locale?: Locale) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('top', 0);
    this.set('left', 0);
    this.set('position', 'arrow_nw');
    this.set('isVisible', false);
    this.set('withArrow', true);
    this.set('class', undefined);
    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-balloon-panel', bind.to('position', value => `ck-balloon-panel_${value}`), bind.if('isVisible', 'ck-balloon-panel_visible'), bind.if('withArrow', 'ck-balloon-panel_with-arrow'), bind.to('class')],
        style: {
          top: bind.to('top', value => `${value}px`),
          left: bind.to('left', value => `${value}px`)
        } as any
      },
      children: this.content
    });
  }

  public show(): void {
    this.isVisible = true;
  }

  public hide(): void {
    this.isVisible = false;
  }

  /** Positions the balloon relative to the target (once). */
  public attachTo(options: PinOptions): void {
    this.show();
    const positionOptions = Object.assign({}, { element: this.element, positions: this.constructor === BalloonPanelView ? defaultPositionList() : defaultPositionList(), limiter: document.body, fitInViewport: true }, options);
    const optimalPosition = getOptimalPosition(positionOptions as any);
    if (!optimalPosition) return;
    const { top, left, name: position } = optimalPosition;
    Object.assign(this, { top, left, position });
  }

  /** Keeps the balloon attached to the target on scroll/resize until `unpin()`. */
  public pin(options: PinOptions): void {
    this.unpin();
    this._pinWhenIsVisibleCallback = () => {
      if (this.isVisible) {
        this._startPinning(options);
      } else {
        this._stopPinning();
      }
    };
    this._startPinning(options);
    this.listenTo(this, 'change:isVisible', this._pinWhenIsVisibleCallback);
  }

  public unpin(): void {
    if (this._pinWhenIsVisibleCallback) {
      this._stopPinning();
      this.stopListening(this, 'change:isVisible', this._pinWhenIsVisibleCallback);
      this._pinWhenIsVisibleCallback = null;
      this.hide();
    }
  }

  private _startPinning(options: PinOptions): void {
    this.attachTo(options);
    const targetElement = getDomElement(options.target);
    const limiterElement = options.limiter ? getDomElement(options.limiter) : document.body;
    this._scrollHandler = () => {
      this.attachTo(options);
    };
    window.addEventListener('scroll', this._scrollHandler, true);
    window.addEventListener('resize', this._scrollHandler);
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.attachTo(options));
      if (targetElement) this._resizeObserver.observe(targetElement);
      if (limiterElement) this._resizeObserver.observe(limiterElement);
      this._resizeObserver.observe(this.element!);
    }
  }

  private _stopPinning(): void {
    if (this._scrollHandler) {
      window.removeEventListener('scroll', this._scrollHandler, true);
      window.removeEventListener('resize', this._scrollHandler);
      this._scrollHandler = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
}

function getDomElement(object: any): HTMLElement | null {
  if (typeof object === 'function') object = object();
  if (object && object instanceof HTMLElement) return object;
  return null;
}

function defaultPositionList(): PositioningFunction[] {
  const p = BalloonPanelView.defaultPositions;
  return [p.southArrowNorth, p.southArrowNorthMiddleWest, p.southArrowNorthMiddleEast, p.southArrowNorthWest, p.southArrowNorthEast, p.northArrowSouth, p.northArrowSouthMiddleWest, p.northArrowSouthMiddleEast, p.northArrowSouthWest, p.northArrowSouthEast, p.viewportStickyNorth];
}

function createDefaultPositions(): Record<string, PositioningFunction> {
  const sideOffset = 25;
  const heightOffset = 10;
  const stickyOffset = 20;
  return {
    northWestArrowSouthWest: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left - sideOffset, name: 'arrow_sw' }),
    northWestArrowSouthMiddleWest: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left - balloonRect.width * 0.25 - sideOffset, name: 'arrow_smw' }),
    northWestArrowSouth: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left - balloonRect.width / 2, name: 'arrow_s' }),
    northWestArrowSouthMiddleEast: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left - balloonRect.width * 0.75 + sideOffset, name: 'arrow_sme' }),
    northWestArrowSouthEast: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left - balloonRect.width + sideOffset, name: 'arrow_se' }),
    northArrowSouthWest: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left + targetRect.width / 2 - sideOffset, name: 'arrow_sw' }),
    northArrowSouthMiddleWest: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width * 0.25 - sideOffset, name: 'arrow_smw' }),
    northArrowSouth: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width / 2, name: 'arrow_s' }),
    northArrowSouthMiddleEast: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width * 0.75 + sideOffset, name: 'arrow_sme' }),
    northArrowSouthEast: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width + sideOffset, name: 'arrow_se' }),
    northEastArrowSouthWest: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.right - sideOffset, name: 'arrow_sw' }),
    northEastArrowSouthMiddleWest: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.right - balloonRect.width * 0.25 - sideOffset, name: 'arrow_smw' }),
    northEastArrowSouth: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.right - balloonRect.width / 2, name: 'arrow_s' }),
    northEastArrowSouthMiddleEast: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.right - balloonRect.width * 0.75 + sideOffset, name: 'arrow_sme' }),
    northEastArrowSouthEast: (targetRect, balloonRect) => ({ top: getNorthTop(targetRect, balloonRect), left: targetRect.right - balloonRect.width + sideOffset, name: 'arrow_se' }),
    southWestArrowNorthWest: targetRect => ({ top: getSouthTop(targetRect), left: targetRect.left - sideOffset, name: 'arrow_nw' }),
    southWestArrowNorthMiddleWest: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left - balloonRect.width * 0.25 - sideOffset, name: 'arrow_nmw' }),
    southWestArrowNorth: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left - balloonRect.width / 2, name: 'arrow_n' }),
    southWestArrowNorthMiddleEast: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left - balloonRect.width * 0.75 + sideOffset, name: 'arrow_nme' }),
    southWestArrowNorthEast: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left - balloonRect.width + sideOffset, name: 'arrow_ne' }),
    southArrowNorthWest: targetRect => ({ top: getSouthTop(targetRect), left: targetRect.left + targetRect.width / 2 - sideOffset, name: 'arrow_nw' }),
    southArrowNorthMiddleWest: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width * 0.25 - sideOffset, name: 'arrow_nmw' }),
    southArrowNorth: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width / 2, name: 'arrow_n' }),
    southArrowNorthMiddleEast: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width * 0.75 + sideOffset, name: 'arrow_nme' }),
    southArrowNorthEast: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.left + targetRect.width / 2 - balloonRect.width + sideOffset, name: 'arrow_ne' }),
    southEastArrowNorthWest: targetRect => ({ top: getSouthTop(targetRect), left: targetRect.right - sideOffset, name: 'arrow_nw' }),
    southEastArrowNorthMiddleWest: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.right - balloonRect.width * 0.25 - sideOffset, name: 'arrow_nmw' }),
    southEastArrowNorth: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.right - balloonRect.width / 2, name: 'arrow_n' }),
    southEastArrowNorthMiddleEast: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.right - balloonRect.width * 0.75 + sideOffset, name: 'arrow_nme' }),
    southEastArrowNorthEast: (targetRect, balloonRect) => ({ top: getSouthTop(targetRect), left: targetRect.right - balloonRect.width + sideOffset, name: 'arrow_ne' }),
    westArrowEast: (targetRect, balloonRect) => ({ top: targetRect.top + targetRect.height / 2 - balloonRect.height / 2, left: targetRect.left - balloonRect.width - heightOffset, name: 'arrow_e' }),
    eastArrowWest: (targetRect, balloonRect) => ({ top: targetRect.top + targetRect.height / 2 - balloonRect.height / 2, left: targetRect.right + heightOffset, name: 'arrow_w' }),
    viewportStickyNorth: (targetRect, balloonRect, viewportRect) => {
      if (!isRectIntersecting(targetRect, viewportRect)) return null;
      return { top: viewportRect.top + stickyOffset, left: targetRect.left + targetRect.width / 2 - balloonRect.width / 2, name: 'arrowless', config: { withArrow: false } } as any;
    }
  };

  function getNorthTop(targetRect: Rect, balloonRect: Rect): number {
    return targetRect.top - balloonRect.height - heightOffset;
  }

  function getSouthTop(targetRect: Rect): number {
    return targetRect.bottom + heightOffset;
  }
}

function isRectIntersecting(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Picks the first position that fits in the limiter and viewport, or the one with the most visible area. */
export function getOptimalPosition(options: { element: HTMLElement; target: any; positions: PositioningFunction[]; limiter?: any; fitInViewport?: boolean; viewportOffsetConfig?: { top?: number; bottom?: number; left?: number; right?: number } }): { top: number; left: number; name: string; config?: any } | null {
  const target = typeof options.target === 'function' ? options.target() : options.target;
  if (!target) return null;
  const limiter = typeof options.limiter === 'function' ? options.limiter() : options.limiter;
  const targetRect = getRect(target);
  const elementRect = getRect(options.element);
  const offset = options.viewportOffsetConfig || {};
  const viewportRect: Rect = {
    top: offset.top || 0,
    left: offset.left || 0,
    right: window.innerWidth - (offset.right || 0),
    bottom: window.innerHeight - (offset.bottom || 0),
    width: window.innerWidth - (offset.left || 0) - (offset.right || 0),
    height: window.innerHeight - (offset.top || 0) - (offset.bottom || 0)
  };
  const limiterRect = limiter ? getRect(limiter) : viewportRect;

  let best: { top: number; left: number; name: string; config?: any } | null = null;
  let bestArea = -1;
  let fits = false;
  for (const positioningFunction of options.positions) {
    const position = positioningFunction(targetRect, elementRect, viewportRect);
    if (!position) continue;
    const rect: Rect = { top: position.top, left: position.left, right: position.left + elementRect.width, bottom: position.top + elementRect.height, width: elementRect.width, height: elementRect.height };
    const limiterArea = getIntersectionArea(rect, limiterRect);
    const viewportArea = options.fitInViewport ? getIntersectionArea(rect, viewportRect) : rect.width * rect.height;
    const fullArea = rect.width * rect.height;
    const area = Math.min(limiterArea, viewportArea);
    if (area >= fullArea - 0.5) {
      best = position;
      fits = true;
      break;
    }
    if (area > bestArea) {
      bestArea = area;
      best = position;
    }
  }
  if (!best) return null;
  if (!fits && options.fitInViewport) best = keepInViewport(best, elementRect, viewportRect);
  // Convert from viewport to absolute (document) coordinates for `position: absolute` elements in body.
  const parent = options.element.offsetParent as HTMLElement | null;
  const parentRect = parent && parent !== document.body ? parent.getBoundingClientRect() : { top: -window.scrollY, left: -window.scrollX };
  return { ...best, top: best.top - parentRect.top, left: best.left - parentRect.left };
}

const VIEWPORT_MARGIN = 8;

/**
 * When no position fits (a big balloon, e.g. the equation dialog, or a target near the window's
 * edge), moves the balloon back inside the window instead of letting it be cut off. Its arrow
 * would then point at the wrong place, so it is hidden.
 */
function keepInViewport(position: { top: number; left: number; name: string; config?: any }, balloonRect: Rect, viewportRect: Rect): { top: number; left: number; name: string; config?: any } {
  const clamp = (value: number, min: number, max: number) => (max < min ? min : Math.min(Math.max(value, min), max));
  const left = clamp(position.left, viewportRect.left + VIEWPORT_MARGIN, viewportRect.right - balloonRect.width - VIEWPORT_MARGIN);
  const top = clamp(position.top, viewportRect.top + VIEWPORT_MARGIN, viewportRect.bottom - balloonRect.height - VIEWPORT_MARGIN);
  if (left === position.left && top === position.top) return position;
  return { ...position, top, left, name: 'arrowless' };
}

function getIntersectionArea(a: Rect, b: Rect): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

export { ARROW_H, ARROW_V };
