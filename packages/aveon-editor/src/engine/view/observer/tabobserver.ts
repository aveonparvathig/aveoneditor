import { Observer } from './observer';
import { keyCodes } from '../../../utils/keyboard';
import { EventInfo } from '../../../utils/eventinfo';
import type { View } from '../view';

/** Fires the bubbling `tab` event for Tab keydowns (without Ctrl/Alt/Cmd). */
export class TabObserver extends Observer {
  constructor(view: View) {
    super(view);
    this.document.on('keydown', (event, data: any) => {
      if (!this.isEnabled || data.keyCode !== keyCodes.tab || data.ctrlKey || data.altKey || data.metaKey) return;
      const eventInfo = new EventInfo(this.document, 'tab');
      this.document.fire(eventInfo, data);
      if (eventInfo.stopped) {
        event.stop();
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
