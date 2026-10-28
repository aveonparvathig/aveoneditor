import { Emitter } from '../../../utils/emitter';
import type { View } from '../view';
import type { Document } from '../document';

/** Base class for view observers. Observers translate DOM events into view events. */
export abstract class Observer extends Emitter {
  public readonly view: View;
  public readonly document: Document;
  public isEnabled = false;

  constructor(view: View) {
    super();
    this.view = view;
    this.document = view.document;
  }

  public enable(): void {
    this.isEnabled = true;
  }

  public disable(): void {
    this.isEnabled = false;
  }

  public destroy(): void {
    this.disable();
    this.stopListening();
  }

  public flush?(): void;

  public abstract observe(domElement: HTMLElement, name?: string): void;

  public abstract stopObserving(domElement: HTMLElement): void;

  /** Returns true for events from nested editables that belong to another editor. */
  public checkShouldIgnoreEventFromTarget(domTarget: globalThis.Node | null): boolean {
    if (domTarget && domTarget.nodeType === 3) domTarget = domTarget.parentNode;
    if (!domTarget || domTarget.nodeType !== 1) return false;
    return (domTarget as HTMLElement).matches('[data-cke-ignore-events], [data-cke-ignore-events] *');
  }
}
