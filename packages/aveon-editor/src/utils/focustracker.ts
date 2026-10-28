import { Observable } from './observable';

/** Tracks focus across a set of DOM elements. Observable `isFocused` and `focusedElement`. */
export class FocusTracker extends Observable {
  declare public isFocused: boolean;
  declare public focusedElement: Element | null;
  private _elements = new Set<Element>();
  private _nextEventLoopTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly _onFocus = (evt: Event) => this._focus(evt.currentTarget as Element);
  private readonly _onBlur = () => this._blur();

  constructor() {
    super();
    this.set('isFocused', false);
    this.set('focusedElement', null);
  }

  public add(element: Element): void {
    if (this._elements.has(element)) return;
    this._elements.add(element);
    element.addEventListener('focus', this._onFocus, true);
    element.addEventListener('blur', this._onBlur, true);
  }

  public remove(element: Element): void {
    if (!this._elements.has(element)) return;
    if (element === this.focusedElement) this._blur();
    this._elements.delete(element);
    element.removeEventListener('focus', this._onFocus, true);
    element.removeEventListener('blur', this._onBlur, true);
  }

  public get elements(): Element[] {
    return [...this._elements];
  }

  public destroy(): void {
    for (const element of [...this._elements]) this.remove(element);
  }

  private _focus(element: Element): void {
    if (this._nextEventLoopTimeout) {
      clearTimeout(this._nextEventLoopTimeout);
      this._nextEventLoopTimeout = null;
    }
    this.focusedElement = element;
    this.isFocused = true;
  }

  private _blur(): void {
    if (this._nextEventLoopTimeout) clearTimeout(this._nextEventLoopTimeout);
    this._nextEventLoopTimeout = setTimeout(() => {
      this.focusedElement = null;
      this.isFocused = false;
      this._nextEventLoopTimeout = null;
    }, 0);
  }
}
