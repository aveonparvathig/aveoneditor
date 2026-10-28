import { DomEventObserver } from './domeventobserver';
import { DataTransfer } from './datatransfer';
import type { Range as ViewRange } from '../range';

export interface InputEventData {
  inputType: string;
  data: string | null;
  dataTransfer: DataTransfer | null;
  targetRanges: ViewRange[];
  isComposing: boolean;
}

/** Fires `beforeinput` view events with the input type, data and target ranges. */
export class InputObserver extends DomEventObserver<InputEvent> {
  public readonly domEventType = 'beforeinput';

  public onDomEvent(domEvent: InputEvent): void {
    const domTargetRanges = typeof domEvent.getTargetRanges === 'function' ? domEvent.getTargetRanges() : [];
    const view = this.view;
    const viewDocument = view.document;
    let dataTransfer: DataTransfer | null = null;
    let data: string | null = null;
    let targetRanges: ViewRange[] = [];

    if (domEvent.dataTransfer) {
      dataTransfer = new DataTransfer(domEvent.dataTransfer);
    }
    if (domEvent.data !== null) {
      data = domEvent.data;
    } else if (dataTransfer) {
      data = dataTransfer.getData('text/plain');
    }

    if (viewDocument.selection.isFake) {
      targetRanges = Array.from(viewDocument.selection.getRanges());
    } else if (domTargetRanges.length) {
      targetRanges = domTargetRanges.map(domRange => view.domConverter.domRangeToView(domRange)).filter((r): r is ViewRange => !!r);
    } else if (domEvent.inputType === 'insertText' || domEvent.inputType === 'insertCompositionText') {
      targetRanges = Array.from(viewDocument.selection.getRanges());
    } else {
      targetRanges = Array.from(viewDocument.selection.getRanges());
    }

    this.fire(domEvent.type, domEvent, {
      data,
      dataTransfer,
      targetRanges,
      inputType: domEvent.inputType,
      isComposing: domEvent.isComposing
    });
  }
}
