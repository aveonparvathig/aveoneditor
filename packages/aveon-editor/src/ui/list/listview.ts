import { View } from '../view';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../focuscycler';
import type { Locale } from '../../utils/locale';

/** A `<ul>` list of focusable items (used by dropdowns). */
export class ListView extends View {
  public readonly items = this.createCollection();
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  declare public ariaLabel: string | undefined;
  declare public role: string | undefined;
  private readonly _focusCycler: FocusCycler;

  constructor(locale?: Locale) {
    super(locale);
    this.set('ariaLabel', undefined);
    this.set('role', undefined);
    this._focusCycler = new FocusCycler({
      focusables: this.items,
      focusTracker: this.focusTracker,
      keystrokeHandler: this.keystrokes,
      actions: { focusPrevious: 'arrowup', focusNext: 'arrowdown' }
    });
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'ul',
      attributes: { class: ['ck', 'ck-reset', 'ck-list'], role: bind.to('role'), 'aria-label': bind.to('ariaLabel') },
      children: this.items
    });
  }

  public override render(): void {
    super.render();
    for (const item of this.items) {
      this.focusTracker.add(item.element!);
    }
    this.items.on('add', (evt, item: View) => this.focusTracker.add(item.element!));
    this.items.on('remove', (evt, item: View) => this.focusTracker.remove(item.element!));
    this.keystrokes.listenTo(this.element as any);
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  public focusLast(): void {
    this._focusCycler.focusLast();
  }
}

/** A `<li>` wrapper around a button or other view. */
export class ListItemView extends View {
  public readonly children = this.createCollection();
  declare public isVisible: boolean;

  constructor(locale?: Locale) {
    super(locale);
    this.set('isVisible', true);
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'li',
      attributes: { class: ['ck', 'ck-list__item', bind.if('isVisible', 'ck-hidden', value => !value)], role: 'presentation' },
      children: this.children
    });
  }

  public focus(): void {
    const first = this.children.first as any;
    if (first && first.focus) first.focus();
  }
}

export class ListSeparatorView extends View {
  constructor(locale?: Locale) {
    super(locale);
    this.setTemplate({ tag: 'li', attributes: { class: ['ck', 'ck-list__separator'] } });
  }
}
