import { View } from './view';
import { BalloonPanelView } from './panel/balloonpanelview';
import type { Editor } from '../core/editor';

/**
 * Shows tooltips for elements with `data-cke-tooltip-text` on hover/focus. One shared instance.
 */
export class TooltipManager {
  public readonly balloonPanelView!: BalloonPanelView;
  public readonly tooltipTextView!: View;
  private static _editors = new Set<Editor>();
  private static _instance: TooltipManager | null = null;
  private _currentElementWithTooltip: HTMLElement | null = null;
  private _currentTooltipPosition: string | null = null;
  private _showTimeout: ReturnType<typeof setTimeout> | null = null;
  private _hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private _listeners: Array<[string, EventListener, boolean]> = [];

  constructor(editor: Editor) {
    TooltipManager._editors.add(editor);
    if (TooltipManager._instance) {
      return TooltipManager._instance;
    }
    TooltipManager._instance = this;

    this.tooltipTextView = new View(editor.locale);
    this.tooltipTextView.set('text', '');
    this.tooltipTextView.setTemplate({
      tag: 'span',
      attributes: { class: ['ck', 'ck-tooltip__text'] },
      children: [{ text: this.tooltipTextView.bindTemplate.to('text') }]
    });

    this.balloonPanelView = new BalloonPanelView(editor.locale);
    this.balloonPanelView.class = 'ck-tooltip';
    this.balloonPanelView.content.add(this.tooltipTextView);

    const onMouseOver = (evt: Event) => this._onEnter(evt as MouseEvent);
    const onMouseLeave = (evt: Event) => this._onLeave(evt as MouseEvent);
    const onFocus = (evt: Event) => this._onEnter(evt as FocusEvent);
    const onBlur = (evt: Event) => this._onLeave(evt as FocusEvent);
    const onKeyDown = (evt: Event) => {
      if ((evt as KeyboardEvent).key === 'Escape') this._unpinTooltip();
    };
    document.addEventListener('mouseenter', onMouseOver, true);
    document.addEventListener('mouseleave', onMouseLeave, true);
    document.addEventListener('focus', onFocus, true);
    document.addEventListener('blur', onBlur, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', () => this._unpinTooltip(), true);
    this._listeners.push(['mouseenter', onMouseOver, true], ['mouseleave', onMouseLeave, true], ['focus', onFocus, true], ['blur', onBlur, true], ['keydown', onKeyDown, true]);
  }

  public destroy(editor: Editor): void {
    TooltipManager._editors.delete(editor);
    if (TooltipManager._editors.size === 0) {
      this._unpinTooltip();
      this.balloonPanelView.destroy();
      for (const [type, listener, capture] of this._listeners) {
        document.removeEventListener(type, listener, capture);
      }
      TooltipManager._instance = null;
    }
  }

  private _onEnter(evt: MouseEvent | FocusEvent): void {
    const target = evt.target as HTMLElement;
    if (!target || typeof target.closest !== 'function') return;
    const elementWithTooltipAttribute = target.closest('[data-cke-tooltip-text]') as HTMLElement | null;
    if (!elementWithTooltipAttribute) return;
    if (elementWithTooltipAttribute.matches('[data-cke-tooltip-disabled=true]')) return;
    if (this._currentElementWithTooltip === elementWithTooltipAttribute) {
      if (this._hideTimeout) {
        clearTimeout(this._hideTimeout);
        this._hideTimeout = null;
      }
      return;
    }
    if (this._showTimeout) clearTimeout(this._showTimeout);
    this._showTimeout = setTimeout(() => {
      this._pinTooltip(elementWithTooltipAttribute);
    }, 600);
  }

  private _onLeave(evt: MouseEvent | FocusEvent): void {
    const target = evt.target as HTMLElement;
    if (this._showTimeout) {
      clearTimeout(this._showTimeout);
      this._showTimeout = null;
    }
    if (!this._currentElementWithTooltip) return;
    if (target === this._currentElementWithTooltip || (target && typeof target.contains === 'function' && target.contains(this._currentElementWithTooltip))) {
      this._hideTimeout = setTimeout(() => this._unpinTooltip(), 100);
    }
  }

  private _pinTooltip(targetDomElement: HTMLElement): void {
    const text = targetDomElement.dataset.ckeTooltipText || '';
    if (!text) return;
    const position = targetDomElement.dataset.ckeTooltipPosition || 's';
    const editor = Array.from(TooltipManager._editors)[0];
    if (!editor) return;
    const bodyViewCollection = editor.ui.view.body;
    if (!bodyViewCollection.has(this.balloonPanelView)) {
      bodyViewCollection.add(this.balloonPanelView);
    }
    (this.tooltipTextView as any).text = text;
    this.balloonPanelView.pin({
      target: targetDomElement,
      positions: getPositions(position),
      fitInViewport: true
    });
    this._currentElementWithTooltip = targetDomElement;
    this._currentTooltipPosition = position;
  }

  private _unpinTooltip(): void {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
    if (this._showTimeout) {
      clearTimeout(this._showTimeout);
      this._showTimeout = null;
    }
    this.balloonPanelView.unpin();
    this._currentElementWithTooltip = null;
    this._currentTooltipPosition = null;
    void this._currentTooltipPosition;
  }
}

function getPositions(position: string) {
  const positions = BalloonPanelView.defaultPositions;
  const map: Record<string, any[]> = {
    s: [positions.southArrowNorth, positions.southArrowNorthEast, positions.southArrowNorthWest],
    n: [positions.northArrowSouth],
    e: [positions.eastArrowWest],
    w: [positions.westArrowEast],
    sw: [positions.southArrowNorthEast],
    se: [positions.southArrowNorthWest]
  };
  return map[position] || map.s;
}
