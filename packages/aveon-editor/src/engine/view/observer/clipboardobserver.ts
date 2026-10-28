import { DomEventObserver } from './domeventobserver';
import { DataTransfer } from './datatransfer';
import { EventInfo } from '../../../utils/eventinfo';
import type { View } from '../view';
import type { Range as ViewRange } from '../range';

/** Fires clipboard and drag-and-drop view events, plus `clipboardInput` for paste/drop. */
export class ClipboardObserver extends DomEventObserver<ClipboardEvent | DragEvent> {
  public readonly domEventType = ['paste', 'copy', 'cut', 'drop', 'dragover', 'dragstart', 'dragend', 'dragenter', 'dragleave'] as const;

  constructor(view: View) {
    super(view);
    const viewDocument = this.document;
    this.listenTo(viewDocument, 'paste', handleInput('clipboardInput'), { priority: 'low' });
    this.listenTo(viewDocument, 'drop', handleInput('clipboardInput'), { priority: 'low' });
    this.listenTo(viewDocument, 'dragover', handleInput('dragging'), { priority: 'low' });

    function handleInput(type: string) {
      return (evt: any, data: any) => {
        data.preventDefault();
        const targetRanges = data.dropRange ? [data.dropRange] : null;
        const eventInfo = new EventInfo(viewDocument, type);
        viewDocument.fire(eventInfo, {
          dataTransfer: data.dataTransfer,
          method: evt.name,
          targetRanges,
          target: data.target,
          domEvent: data.domEvent
        });
        if (eventInfo.stopped) {
          data.stopPropagation();
        }
      };
    }
  }

  public onDomEvent(domEvent: ClipboardEvent | DragEvent): void {
    const nativeDataTransfer = 'clipboardData' in domEvent ? domEvent.clipboardData! : (domEvent as DragEvent).dataTransfer!;
    const cacheFiles = domEvent.type === 'drop' || domEvent.type === 'paste';
    const evtData: Record<string, unknown> = {
      dataTransfer: new DataTransfer(nativeDataTransfer, { cacheFiles })
    };
    if (domEvent.type === 'drop' || domEvent.type === 'dragover') {
      evtData.dropRange = getDropViewRange(this.view, domEvent as DragEvent);
    }
    this.fire(domEvent.type, domEvent, evtData);
  }
}

function getDropViewRange(view: View, domEvent: DragEvent): ViewRange | null {
  const domDoc = (domEvent.target as HTMLElement).ownerDocument;
  const x = domEvent.clientX;
  const y = domEvent.clientY;
  let domRange: globalThis.Range | null = null;
  const doc = domDoc as any;
  if (doc.caretRangeFromPoint && doc.caretRangeFromPoint(x, y)) {
    domRange = doc.caretRangeFromPoint(x, y);
  } else if ((domEvent as any).rangeParent) {
    domRange = domDoc.createRange();
    domRange.setStart((domEvent as any).rangeParent, (domEvent as any).rangeOffset);
    domRange.collapse(true);
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      domRange = domDoc.createRange();
      domRange.setStart(pos.offsetNode, pos.offset);
      domRange.collapse(true);
    }
  }
  if (domRange) {
    return view.domConverter.domRangeToView(domRange);
  }
  return null;
}
