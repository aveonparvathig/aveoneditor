import { DomEventObserver } from './domeventobserver';
import { getCode } from '../../../utils/keyboard';

/** Fires `keydown` and `keyup` view events with keystroke info. */
export class KeyObserver extends DomEventObserver<KeyboardEvent> {
  public readonly domEventType = ['keydown', 'keyup'] as const;

  public onDomEvent(domEvt: KeyboardEvent): void {
    const data = {
      keyCode: domEvt.keyCode,
      altKey: domEvt.altKey,
      ctrlKey: domEvt.ctrlKey,
      shiftKey: domEvt.shiftKey,
      metaKey: domEvt.metaKey,
      get keystroke() {
        return getCode(this);
      }
    };
    this.fire(domEvt.type, domEvt, data);
  }
}
