import { Observer } from './observer';
import { DomEventData } from './domeventdata';
import type { View } from '../view';

/** Base for observers that listen to native DOM events and fire them on the view document. */
export abstract class DomEventObserver<TEvent extends Event = Event> extends Observer {
  public abstract readonly domEventType: string | readonly string[];
  public useCapture = false;
  public usePassive = false;
  private _domListeners = new Map<HTMLElement, Array<{ type: string; listener: EventListener }>>();

  constructor(view: View) {
    super(view);
  }

  public abstract onDomEvent(domEvent: TEvent): void;

  public observe(domElement: HTMLElement): void {
    const types = typeof this.domEventType === 'string' ? [this.domEventType] : this.domEventType;
    const listeners: Array<{ type: string; listener: EventListener }> = [];
    for (const type of types) {
      const listener = (domEvent: Event) => {
        if (this.isEnabled && !this.checkShouldIgnoreEventFromTarget(domEvent.target as globalThis.Node)) {
          this.onDomEvent(domEvent as TEvent);
        }
      };
      domElement.addEventListener(type, listener, { capture: this.useCapture, passive: this.usePassive });
      listeners.push({ type, listener });
    }
    this._domListeners.set(domElement, listeners);
  }

  public stopObserving(domElement: HTMLElement): void {
    const listeners = this._domListeners.get(domElement);
    if (!listeners) return;
    for (const { type, listener } of listeners) {
      domElement.removeEventListener(type, listener, { capture: this.useCapture } as any);
    }
    this._domListeners.delete(domElement);
  }

  public override destroy(): void {
    for (const domElement of Array.from(this._domListeners.keys())) {
      this.stopObserving(domElement);
    }
    super.destroy();
  }

  /** Fires the event on the view document with DomEventData. */
  public override fire<T = unknown>(eventType: string, domEvent?: TEvent, additionalData?: Record<string, unknown>): T | undefined {
    if (this.isEnabled) {
      return this.document.fire<T>(eventType, new DomEventData(this.view, domEvent!, additionalData));
    }
    return undefined;
  }
}
