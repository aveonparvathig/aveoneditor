import { Observer } from './observer';
import { MutationObserver } from './mutationobserver';
import { FocusObserver } from './focusobserver';
import { debounce } from '../../../utils/misc';
import { env } from '../../../utils/env';
import type { View } from '../view';
import type { Selection as ViewSelection } from '../selection';

/**
 * Listens to native `selectionchange` and translates the DOM selection into the view
 * selection, firing `selectionChange` and (debounced) `selectionChangeDone` on the document.
 */
export class SelectionObserver extends Observer {
  public readonly selection;
  public readonly domConverter;
  private _documents = new WeakSet<globalThis.Document>();
  private _fireSelectionChangeDoneDebounced: ((data: unknown) => void) & { cancel(): void };
  private _clearInfiniteLoopInterval: ReturnType<typeof setInterval>;
  private _loopbackCounter = 0;
  private _documentIsSelectingInactivityTimeoutDebounced: (() => void) & { cancel(): void };
  private _listeners = new Map<globalThis.Document, Array<[string, EventListener, boolean?]>>();
  private _domElements = new Set<HTMLElement>();

  constructor(view: View) {
    super(view);
    this.mutationObserver = view.getObserver(MutationObserver)!;
    this.focusObserver = view.getObserver(FocusObserver)!;
    this.selection = this.document.selection;
    this.domConverter = view.domConverter;
    this._fireSelectionChangeDoneDebounced = debounce((data: unknown) => {
      this.document.fire('selectionChangeDone', data);
    }, 200);
    this._clearInfiniteLoopInterval = setInterval(() => (this._loopbackCounter = 0), 1000);
    this._documentIsSelectingInactivityTimeoutDebounced = debounce(() => {
      this.document.isSelecting = false;
    }, 5000);
  }

  public mutationObserver: MutationObserver;
  public focusObserver: FocusObserver;

  public observe(domElement: HTMLElement): void {
    const domDocument = domElement.ownerDocument;
    this._domElements.add(domElement);

    const startDocumentIsSelecting = () => {
      this.document.isSelecting = true;
      this._documentIsSelectingInactivityTimeoutDebounced();
    };
    const endDocumentIsSelecting = () => {
      if (!this.document.isSelecting) return;
      this._handleSelectionChange(domDocument);
      this.document.isSelecting = false;
      this._documentIsSelectingInactivityTimeoutDebounced.cancel();
    };

    const add = (target: globalThis.Document | HTMLElement, type: string, listener: EventListener, capture = false) => {
      target.addEventListener(type, listener, capture);
      if (!this._listeners.has(domDocument)) this._listeners.set(domDocument, []);
      this._listeners.get(domDocument)!.push([type, listener, capture]);
    };

    add(domElement, 'selectstart', startDocumentIsSelecting, true);
    add(domElement, 'keydown', (evt: Event) => {
      const keyboardEvent = evt as KeyboardEvent;
      if (keyboardEvent.shiftKey && keyboardEvent.keyCode >= 37 && keyboardEvent.keyCode <= 40) {
        startDocumentIsSelecting();
      }
    }, true);
    add(domElement, 'keyup', endDocumentIsSelecting, true);

    if (this._documents.has(domDocument)) return;

    add(domDocument, 'mouseup', endDocumentIsSelecting, true);
    add(domDocument, 'selectionchange', () => {
      if (this.document.isComposing && env.isAndroid) return;
      this._handleSelectionChange(domDocument);
      this._documentIsSelectingInactivityTimeoutDebounced();
    });
    this._documents.add(domDocument);
  }

  public stopObserving(domElement: HTMLElement): void {
    this._domElements.delete(domElement);
  }

  public override destroy(): void {
    super.destroy();
    clearInterval(this._clearInfiniteLoopInterval);
    this._fireSelectionChangeDoneDebounced.cancel();
    this._documentIsSelectingInactivityTimeoutDebounced.cancel();
    for (const [doc, listeners] of this._listeners) {
      for (const [type, listener, capture] of listeners) {
        doc.removeEventListener(type, listener, capture);
      }
    }
  }

  private _handleSelectionChange(domDocument: globalThis.Document): void {
    if (!this.isEnabled) return;
    // While the editing view is not focused, DOM selection changes come from the browser moving the
    // selection around (e.g. when a fake selection container is removed), not from the user.
    if (!this.document.isFocused) return;
    const domSelection = domDocument.defaultView!.getSelection()!;
    if (this.checkShouldIgnoreEventFromTarget(domSelection.anchorNode)) return;

    // Only handle selection changes inside one of our DOM roots (or the fake selection container).
    const anchorNode = domSelection.anchorNode;
    if (!anchorNode) return;
    let inside = false;
    for (const domElement of this._domElements) {
      if (domElement.contains(anchorNode)) {
        inside = true;
        break;
      }
    }
    if (!inside) {
      const container = this.domConverter.fakeSelectionContainer;
      if (!(container && container.contains(anchorNode))) return;
    }

    // A DOM selection inside the fake selection container that is no longer bound to a view selection
    // (the widget selection was rendered, then focus moved to a UI element) must not be mapped.
    const fakeContainer = this.domConverter.fakeSelectionContainer;
    if (fakeContainer && fakeContainer.contains(anchorNode) && !this.domConverter.fakeSelectionToView(fakeContainer)) return;

    this.mutationObserver.flush();
    const newViewSelection = this.domConverter.domSelectionToView(domSelection);
    if (newViewSelection.rangeCount === 0) {
      this.view.hasDomSelection = false;
      return;
    }
    this.view.hasDomSelection = true;

    if (this.selection.isEqual(newViewSelection) && this.domConverter.isDomSelectionCorrect(domSelection)) {
      return;
    }

    if (++this._loopbackCounter > 60) {
      // Infinite loop protection: the DOM and view selections keep diverging.
      return;
    }

    if (this.selection.isSimilar(newViewSelection)) {
      this.view.forceRender();
    } else {
      const data = { oldSelection: this.selection, newSelection: newViewSelection, domSelection };
      this.document.fire('selectionChange', data);
      this._fireSelectionChangeDoneDebounced(data);
    }
  }
}

export type { ViewSelection };
