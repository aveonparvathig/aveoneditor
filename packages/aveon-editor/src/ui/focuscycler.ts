import { Emitter } from '../utils/emitter';
import type { ViewCollection } from './viewcollection';
import type { FocusTracker } from '../utils/focustracker';
import type { KeystrokeHandler } from '../utils/keystrokehandler';
import type { View } from './view';
import { isVisible } from '../utils/dom';

export interface FocusCyclerActions {
  focusFirst?: string | string[];
  focusLast?: string | string[];
  focusNext?: string | string[];
  focusPrevious?: string | string[];
}

/** Cycles focus between focusable child views with keystrokes (arrows, Tab). */
export class FocusCycler extends Emitter {
  public readonly focusables: ViewCollection;
  public readonly focusTracker: FocusTracker;
  public readonly keystrokeHandler?: KeystrokeHandler;
  public readonly actions?: FocusCyclerActions;

  constructor(options: { focusables: ViewCollection; focusTracker: FocusTracker; keystrokeHandler?: KeystrokeHandler; actions?: FocusCyclerActions }) {
    super();
    this.focusables = options.focusables;
    this.focusTracker = options.focusTracker;
    this.keystrokeHandler = options.keystrokeHandler;
    this.actions = options.actions;
    if (options.actions && options.keystrokeHandler) {
      for (const methodName in options.actions) {
        let actions = (options.actions as any)[methodName] as string | string[];
        if (typeof actions === 'string') actions = [actions];
        for (const keystroke of actions) {
          options.keystrokeHandler.set(keystroke, (data, cancel) => {
            (this as any)[methodName]();
            cancel();
          });
        }
      }
    }
  }

  public get first(): View | null {
    return this.focusables.find(isFocusable) || null;
  }

  public get last(): View | null {
    return this.focusables.filter(isFocusable).slice(-1)[0] || null;
  }

  public get next(): View | null {
    return this._getFocusableItem(1);
  }

  public get previous(): View | null {
    return this._getFocusableItem(-1);
  }

  public get current(): number | null {
    let index = 0;
    if (this.focusTracker.focusedElement === null) return null;
    for (const view of this.focusables) {
      if (view.element === this.focusTracker.focusedElement || (view.element && view.element.contains(this.focusTracker.focusedElement))) return index;
      index++;
    }
    return null;
  }

  public focusFirst(): void {
    this._focus(this.first);
  }

  public focusLast(): void {
    this._focus(this.last);
  }

  public focusNext(): void {
    this._focus(this.next);
  }

  public focusPrevious(): void {
    this._focus(this.previous);
  }

  private _focus(view: View | null): void {
    if (view) (view as any).focus();
  }

  private _getFocusableItem(step: number): View | null {
    const current = this.current;
    const collectionLength = this.focusables.length;
    if (!collectionLength) return null;
    if (current === null) return (this as any)[step === 1 ? 'first' : 'last'];
    let index = (current + collectionLength + step) % collectionLength;
    do {
      const view = this.focusables.get(index)!;
      if (isFocusable(view)) return view;
      index = (index + collectionLength + step) % collectionLength;
    } while (index !== current);
    return null;
  }
}

function isFocusable(view: View): boolean {
  return !!(typeof (view as any).focus === 'function' && view.element && isVisible(view.element));
}
