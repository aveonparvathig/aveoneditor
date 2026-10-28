import { Observer } from './observer';
import { isArrowKeyCode } from '../../../utils/keyboard';
import { EventInfo } from '../../../utils/eventinfo';
import type { View } from '../view';

/** Fires the bubbling `arrowKey` event for arrow keydowns. */
export class ArrowKeysObserver extends Observer {
  constructor(view: View) {
    super(view);
    this.document.on('keydown', (event, data: any) => {
      if (this.isEnabled && isArrowKeyCode(data.keyCode)) {
        const eventInfo = new EventInfo(this.document, 'arrowKey');
        this.document.fire(eventInfo, data);
        if (eventInfo.stopped) {
          event.stop();
        }
      }
    });
  }

  public observe(): void {
    /* listens to the document only */
  }

  public stopObserving(): void {
    /* nothing */
  }
}
