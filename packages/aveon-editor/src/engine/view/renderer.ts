import { Observable } from '../../utils/observable';
import { Element as ViewElement } from './element';
import { Text as ViewText } from './text';
import { UIElement } from './uielement';
import { RawElement } from './rawelement';
import type { Node as ViewNode } from './node';
import type { DomConverter } from './domconverter';
import type { DocumentSelection } from './documentselection';
import type { Position as ViewPosition } from './position';
import { isDomText, isDomElement } from './filler';
import { env } from '../../utils/env';

type Expected = { kind: 'node'; node: ViewNode } | { kind: 'filler' };

/**
 * Renders the view tree to the DOM. Only nodes marked as changed are synced.
 * DOM nodes are reused whenever a matching element or text node is found at the
 * expected position, which keeps the native selection and composition stable.
 */
export class Renderer extends Observable {
  public readonly domDocuments = new Set<globalThis.Document>();
  public readonly domConverter: DomConverter;
  public readonly markedAttributes = new Set<ViewElement>();
  public readonly markedChildren = new Set<ViewElement>();
  public readonly markedTexts = new Set<ViewText>();
  public readonly selection: DocumentSelection;
  declare public isFocused: boolean;
  declare public isSelecting: boolean;
  declare public isComposing: boolean;
  private _fakeSelectionContainer: HTMLElement | null = null;

  constructor(domConverter: DomConverter, selection: DocumentSelection) {
    super();
    this.domConverter = domConverter;
    this.selection = selection;
    this.set('isFocused', false);
    this.set('isSelecting', false);
    this.set('isComposing', false);
    this.on('change:isSelecting', () => {
      if (!this.isSelecting) this.render();
    });
  }

  public markToSync(type: 'children' | 'attributes' | 'text', node: ViewNode): void {
    if (type === 'text') {
      if (node.parent && this.domConverter.mapViewToDom(node.parent as ViewElement)) {
        this.markedTexts.add(node as ViewText);
      }
    } else {
      if (!this.domConverter.mapViewToDom(node)) return;
      if (type === 'attributes') {
        this.markedAttributes.add(node as ViewElement);
      } else if (type === 'children') {
        this.markedChildren.add(node as ViewElement);
      } else {
        throw new Error('view-renderer-unknown-type');
      }
    }
  }

  public render(): void {
    if (this.isComposing && !env.isAndroid) {
      return;
    }
    for (const element of this.markedAttributes) {
      this._updateAttrs(element);
    }
    for (const element of this.markedChildren) {
      this._updateChildren(element);
    }
    for (const node of this.markedTexts) {
      if (!this.markedChildren.has(node.parent as ViewElement) && this.domConverter.mapViewToDom(node.parent as ViewElement)) {
        this._updateText(node);
      }
    }
    if (!this.isSelecting || env.isGecko) {
      this._updateSelection();
      this._updateFocus();
    }
    this.markedTexts.clear();
    this.markedAttributes.clear();
    this.markedChildren.clear();
  }

  private _updateAttrs(viewElement: ViewElement): void {
    const domElement = this.domConverter.mapViewToDom(viewElement) as globalThis.Element | undefined;
    if (!domElement) return;
    const domAttrKeys = Array.from(domElement.attributes).map(attr => attr.name);
    const viewAttrKeys = Array.from(viewElement.getAttributeKeys());
    for (const key of viewAttrKeys) {
      this.domConverter.setDomElementAttribute(domElement, key, viewElement.getAttribute(key)!, viewElement);
    }
    for (const key of domAttrKeys) {
      if (!viewElement.hasAttribute(key) && !key.startsWith('data-ck-unsafe')) {
        this.domConverter.removeDomElementAttribute(domElement, key);
      }
    }
  }

  private _updateText(viewText: ViewText): void {
    const domText = this.domConverter.findCorrespondingDomText(viewText);
    if (!domText) return;
    const newDomText = this.domConverter.viewToDom(viewText) as globalThis.Text;
    if (domText.data !== newDomText.data) {
      domText.data = newDomText.data;
    }
    this.domConverter.bindTexts(domText, viewText);
  }

  private _updateChildren(viewElement: ViewElement): void {
    const domElement = this.domConverter.mapViewToDom(viewElement) as globalThis.Element | undefined;
    if (!domElement) return;
    this._reconcileChildren(viewElement, domElement);
  }

  private _reconcileChildren(viewElement: ViewElement, domElement: globalThis.Element): void {
    const expected: Expected[] = [];
    const fillerOffset = viewElement.getFillerOffset();
    let offset = 0;
    for (const child of viewElement.getChildren()) {
      if (fillerOffset === offset) expected.push({ kind: 'filler' });
      expected.push({ kind: 'node', node: child });
      offset++;
    }
    if (fillerOffset === offset) expected.push({ kind: 'filler' });

    const actual: globalThis.Node[] = Array.from(domElement.childNodes);
    let actualIndex = 0;

    const removeActual = (index: number) => {
      const node = actual[index];
      this.domConverter.unbindDomElement(node);
      domElement.removeChild(node as ChildNode);
      actual.splice(index, 1);
    };

    for (const entry of expected) {
      if (entry.kind === 'filler') {
        const candidate = actual[actualIndex];
        if (candidate && this.domConverter.isBlockFiller(candidate)) {
          actualIndex++;
          continue;
        }
        const filler = this.domConverter.createBlockFiller();
        domElement.insertBefore(filler, (candidate as ChildNode) || null);
        actual.splice(actualIndex, 0, filler);
        actualIndex++;
        continue;
      }

      const viewChild = entry.node;
      const bound = this.domConverter.mapViewToDom(viewChild);

      if (bound && bound.parentNode === domElement) {
        // Remove any stale nodes before the bound node.
        while (actual[actualIndex] !== bound) {
          removeActual(actualIndex);
        }
        actualIndex++;
        if (viewChild instanceof ViewText) {
          this._updateText(viewChild);
        }
        continue;
      }

      const candidate = actual[actualIndex];
      if (candidate && this._canReuse(candidate, viewChild)) {
        this._reuse(candidate, viewChild);
        actualIndex++;
        continue;
      }

      const created = this.domConverter.viewToDom(viewChild, { bind: true, withChildren: true });
      // Building the new node can reuse (and so move) existing DOM nodes, e.g. text that gets
      // wrapped in a new highlight: forget nodes that are no longer children here.
      for (let i = actual.length - 1; i >= 0; i--) {
        if (actual[i].parentNode !== domElement) {
          actual.splice(i, 1);
          if (i < actualIndex) actualIndex--;
        }
      }
      const next = actual[actualIndex];
      domElement.insertBefore(created, (next as ChildNode) || null);
      actual.splice(actualIndex, 0, created);
      actualIndex++;
    }

    while (actualIndex < actual.length) {
      removeActual(actualIndex);
    }
  }

  private _canReuse(domNode: globalThis.Node, viewChild: ViewNode): boolean {
    if (this.domConverter.isBlockFiller(domNode)) return false;
    if (viewChild instanceof ViewText) {
      return isDomText(domNode) && !this._isBoundToLiveNode(domNode);
    }
    if (viewChild instanceof UIElement || viewChild instanceof RawElement) return false;
    if (!isDomElement(domNode)) return false;
    const mappedView = this.domConverter.mapDomToView(domNode);
    if (mappedView && ((mappedView as ViewElement).is('uiElement') || (mappedView as ViewElement).is('rawElement'))) return false;
    if (domNode.tagName.toLowerCase() !== (viewChild as ViewElement).name.toLowerCase()) return false;
    return !this._isBoundToLiveNode(domNode);
  }

  private _isBoundToLiveNode(domNode: globalThis.Node): boolean {
    const mapped = this.domConverter.mapDomToView(domNode);
    if (!mapped) return false;
    const root = (mapped as ViewNode).root;
    return !!root && (root as any).is && (root as any).is('rootElement');
  }

  private _reuse(domNode: globalThis.Node, viewChild: ViewNode): void {
    const previous = this.domConverter.mapDomToView(domNode);
    if (previous) this.domConverter.unbindViewElement(previous as ViewNode);
    if (viewChild instanceof ViewText) {
      this.domConverter.bindTexts(domNode as globalThis.Text, viewChild);
      this._updateText(viewChild);
      return;
    }
    const viewElement = viewChild as ViewElement;
    this.domConverter.bindElements(domNode as globalThis.Element, viewElement);
    this._updateAttrs(viewElement);
    this._reconcileChildren(viewElement, domNode as globalThis.Element);
  }

  private _updateSelection(): void {
    if (this.selection.isFake) {
      this._updateFakeSelection();
      return;
    }
    this._removeFakeSelection();
    if (!this.isFocused) return;
    if (this.selection.rangeCount === 0) return;
    const editable = this.selection.editableElement;
    if (!editable) return;
    const domRoot = this.domConverter.mapViewToDom(editable) as HTMLElement | undefined;
    if (!domRoot) return;
    const domDocument = domRoot.ownerDocument;
    const domSelection = domDocument.defaultView!.getSelection()!;

    const oldViewSelection = domSelection && this.domConverter.domSelectionToView(domSelection);
    if (oldViewSelection && oldViewSelection.rangeCount && this.selection.isEqual(oldViewSelection) && this.domConverter.isDomSelectionCorrect(domSelection)) {
      return;
    }
    const anchor = this.domConverter.viewPositionToDom(this.selection.anchor!);
    const focus = this.domConverter.viewPositionToDom(this.selection.focus!);
    if (!anchor || !focus) return;
    try {
      if (this.selection.isCollapsed) {
        domSelection.collapse(anchor.parent, anchor.offset);
      } else {
        domSelection.setBaseAndExtent(anchor.parent, anchor.offset, focus.parent, focus.offset);
      }
    } catch {
      // Invalid positions; ignore.
    }
  }

  private _updateFakeSelection(): void {
    const editable = this.selection.editableElement;
    if (!editable) return;
    const domRoot = this.domConverter.mapViewToDom(editable) as HTMLElement | undefined;
    if (!domRoot) return;
    const domDocument = domRoot.ownerDocument;
    if (!this._fakeSelectionContainer) {
      const container = domDocument.createElement('div');
      container.className = 'ck-fake-selection-container';
      Object.assign(container.style, { position: 'fixed', top: '0', left: '-9999px', width: '1px' });
      container.textContent = ' ';
      this._fakeSelectionContainer = container;
      this.domConverter.fakeSelectionContainer = container;
    }
    const container = this._fakeSelectionContainer;
    if (!container.parentElement || container.parentElement !== domRoot.parentElement) {
      domRoot.parentElement!.appendChild(container);
    }
    const label = this.selection.fakeSelectionLabel || ' ';
    if (container.textContent !== label) container.textContent = label;
    this.domConverter.bindFakeSelection(container, this.selection as any);
    if (!this.isFocused) return;
    const domSelection = domDocument.defaultView!.getSelection()!;
    const anchor = domSelection.anchorNode;
    if (anchor && container.contains(anchor)) return;
    const domRange = domDocument.createRange();
    domRange.selectNodeContents(container);
    domSelection.removeAllRanges();
    domSelection.addRange(domRange);
  }

  private _removeFakeSelection(): void {
    const container = this._fakeSelectionContainer;
    if (container && container.parentElement) {
      container.remove();
    }
  }

  private _updateFocus(): void {
    if (this.isFocused) {
      const editable = this.selection.editableElement;
      if (editable) this.domConverter.focus(editable);
    }
  }
}

export type { ViewPosition };
