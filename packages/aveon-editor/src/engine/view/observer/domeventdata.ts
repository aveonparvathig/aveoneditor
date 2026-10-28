import type { View } from '../view';
import type { Document } from '../document';
import type { Element } from '../element';

/** Data passed with view events fired from DOM events. */
export class DomEventData<TEvent extends Event = Event> {
  public readonly view: View;
  public readonly document: Document;
  public readonly domEvent: TEvent;
  public readonly domTarget: HTMLElement;

  constructor(view: View, domEvent: TEvent, additionalData?: Record<string, unknown>) {
    this.view = view;
    this.document = view.document;
    this.domEvent = domEvent;
    this.domTarget = domEvent.target as HTMLElement;
    Object.assign(this, additionalData);
  }

  public get target(): Element | null {
    const mapped = this.view.domConverter.mapDomToView(this.domTarget);
    return mapped ? (mapped as Element) : null;
  }

  public preventDefault(): void {
    this.domEvent.preventDefault();
  }

  public stopPropagation(): void {
    this.domEvent.stopPropagation();
  }
}

export interface KeyEventData extends DomEventData<KeyboardEvent> {
  keyCode: number;
  keystroke: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}
