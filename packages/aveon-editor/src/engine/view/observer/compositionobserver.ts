import { DomEventObserver } from './domeventobserver';
import type { View } from '../view';

/** Tracks IME composition and updates `document.isComposing`. */
export class CompositionObserver extends DomEventObserver<CompositionEvent> {
  public readonly domEventType = ['compositionstart', 'compositionupdate', 'compositionend'] as const;

  constructor(view: View) {
    super(view);
    const document = this.document;
    document.on('compositionstart', () => {
      document.isComposing = true;
    });
    document.on('compositionend', () => {
      document.isComposing = false;
    });
  }

  public onDomEvent(domEvent: CompositionEvent): void {
    this.fire(domEvent.type, domEvent, { data: domEvent.data });
  }
}
