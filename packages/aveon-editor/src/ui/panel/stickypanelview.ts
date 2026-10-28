import { View } from '../view';
import type { Locale } from '../../utils/locale';

/**
 * Panel that sticks to the top of the viewport when the editor is scrolled (classic editor toolbar).
 */
export class StickyPanelView extends View {
  declare public isActive: boolean;
  declare public isSticky: boolean;
  declare public limiterElement: HTMLElement | null;
  declare public limiterBottomOffset: number;
  declare public viewportTopOffset: number;
  declare public _marginLeft: string | null;
  declare public _isStickyToTheBottomOfLimiter: boolean;
  declare public _stickyTopOffset: number | null;
  declare public _stickyBottomOffset: number | null;
  public readonly content = this.createCollection();
  public readonly contentPanelElement: HTMLElement | null = null;
  private _contentPanelPlaceholder: HTMLElement | null = null;
  private _contentPanel: View;
  private _handler: (() => void) | null = null;

  constructor(locale?: Locale) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('isActive', false);
    this.set('isSticky', false);
    this.set('limiterElement', null);
    this.set('limiterBottomOffset', 50);
    this.set('viewportTopOffset', 0);
    this.set('_marginLeft', null);
    this.set('_isStickyToTheBottomOfLimiter', false);
    this.set('_stickyTopOffset', null);
    this.set('_stickyBottomOffset', null);

    this._contentPanel = new View(locale);
    this._contentPanel.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-sticky-panel__content', bind.if('isSticky', 'ck-sticky-panel__content_sticky'), bind.if('_isStickyToTheBottomOfLimiter', 'ck-sticky-panel__content_sticky_bottom-limit')],
        style: {
          width: bind.to('isSticky', (isSticky: boolean) => (isSticky && this._contentPanelPlaceholder ? `${this._contentPanelPlaceholder.getBoundingClientRect().width}px` : '')),
          top: bind.to('_stickyTopOffset', (value: number | null) => (value !== null ? `${value}px` : '')),
          bottom: bind.to('_stickyBottomOffset', (value: number | null) => (value !== null ? `${value}px` : '')),
          'margin-left': bind.to('_marginLeft', (value: string | null) => value || '')
        } as any
      },
      children: this.content
    });

    const placeholder = new View(locale);
    placeholder.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-sticky-panel__placeholder'],
        style: {
          display: bind.to('isSticky', (isSticky: boolean) => (isSticky ? 'block' : 'none')),
          height: bind.to('isSticky', (isSticky: boolean) => (isSticky && this._contentPanel.element ? `${this._contentPanel.element.getBoundingClientRect().height}px` : ''))
        } as any
      }
    });

    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-sticky-panel'] },
      children: [placeholder, this._contentPanel]
    });
    this._contentPanelPlaceholderView = placeholder;
  }

  private _contentPanelPlaceholderView: View;

  public override render(): void {
    super.render();
    this._contentPanelPlaceholder = this._contentPanelPlaceholderView.element;
    (this as any).contentPanelElement = this._contentPanel.element;
    this._handler = () => this.checkIfShouldBeSticky();
    window.addEventListener('scroll', this._handler, { passive: true });
    window.addEventListener('resize', this._handler);
    this.listenTo(this, 'change:isActive', () => this.checkIfShouldBeSticky());
    this.checkIfShouldBeSticky();
  }

  public override destroy(): void {
    if (this._handler) {
      window.removeEventListener('scroll', this._handler);
      window.removeEventListener('resize', this._handler);
    }
    super.destroy();
  }

  public checkIfShouldBeSticky(): void {
    if (!this.limiterElement || !this.isActive || !this._contentPanel.element) {
      this._unstick();
      return;
    }
    const limiterRect = this.limiterElement.getBoundingClientRect();
    const panelHeight = this._contentPanel.element.offsetHeight;
    const viewportTopOffset = this.viewportTopOffset;
    const limiterTopOffset = limiterRect.top;
    const visibleLimiterHeight = limiterRect.bottom - viewportTopOffset;
    if (limiterTopOffset < viewportTopOffset && visibleLimiterHeight > panelHeight + this.limiterBottomOffset) {
      this._stickToTopOfViewport(limiterRect, viewportTopOffset);
    } else if (limiterTopOffset < viewportTopOffset && visibleLimiterHeight > panelHeight) {
      this._stickToBottomOfLimiter(limiterRect);
    } else {
      this._unstick();
    }
  }

  private _stickToTopOfViewport(limiterRect: DOMRect, viewportTopOffset: number): void {
    this.isSticky = true;
    this._isStickyToTheBottomOfLimiter = false;
    this._stickyTopOffset = viewportTopOffset;
    this._stickyBottomOffset = null;
    this._marginLeft = `${limiterRect.left - (this._contentPanelPlaceholder ? this._contentPanelPlaceholder.getBoundingClientRect().left : 0)}px`;
  }

  private _stickToBottomOfLimiter(limiterRect: DOMRect): void {
    this.isSticky = true;
    this._isStickyToTheBottomOfLimiter = true;
    this._stickyTopOffset = null;
    this._stickyBottomOffset = this.limiterBottomOffset;
    this._marginLeft = null;
    void limiterRect;
  }

  private _unstick(): void {
    this.isSticky = false;
    this._isStickyToTheBottomOfLimiter = false;
    this._stickyTopOffset = null;
    this._stickyBottomOffset = null;
    this._marginLeft = null;
  }
}
