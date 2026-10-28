import { Element as ViewElement } from './element';
import { Text as ViewText } from './text';
import { DocumentFragment as ViewDocumentFragment } from './documentfragment';
import { Position as ViewPosition } from './position';
import { Range as ViewRange } from './range';
import { Selection as ViewSelection } from './selection';
import { UIElement } from './uielement';
import { RawElement } from './rawelement';
import { TreeWalker } from './treewalker';
import type { Node as ViewNode } from './node';
import type { Document as ViewDocument } from './document';
import type { EditableElement } from './editableelement';
import { BR_FILLER, NBSP_FILLER, MARKED_NBSP_FILLER, isBlockFiller, isDomText, isDomElement, startsWithFiller, getDataWithoutFiller, type BlockFillerMode } from './filler';

export type RenderingMode = 'editing' | 'data';

const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'center', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'body', 'html'
]);

const INLINE_OBJECT_ELEMENTS = new Set(['object', 'iframe', 'input', 'button', 'textarea', 'select', 'option', 'video', 'embed', 'audio', 'img', 'canvas']);

const UNSAFE_ATTRIBUTE_NAME_PREFIX = 'data-ck-unsafe-attribute-';
const UNSAFE_ELEMENT_REPLACEMENT_ATTRIBUTE = 'data-ck-unsafe-element';
const UNSAFE_ELEMENTS = ['script', 'style'];

/**
 * Converts between the view tree and the DOM, both ways, and keeps the mapping
 * between view and DOM nodes.
 */
export class DomConverter {
  public readonly document: ViewDocument;
  public readonly renderingMode: RenderingMode;
  public blockFillerMode: BlockFillerMode;
  public readonly preElements = ['pre', 'textarea'];
  public readonly blockElements = Array.from(BLOCK_ELEMENTS);
  public readonly inlineObjectElements = Array.from(INLINE_OBJECT_ELEMENTS);
  public readonly unsafeElements = UNSAFE_ELEMENTS;
  public fakeSelectionContainer: HTMLElement | null = null;
  private _domToViewMapping = new WeakMap<globalThis.Node, ViewNode | ViewDocumentFragment>();
  private _viewToDomMapping = new WeakMap<ViewNode | ViewDocumentFragment, globalThis.Node>();
  private _fakeSelectionMapping = new WeakMap<HTMLElement, ViewSelection>();
  private _rawContentElementMatcher: Array<(el: ViewElement) => boolean> = [];
  private _encounteredRawContentDomNodes = new WeakSet<globalThis.Node>();

  constructor(document: ViewDocument, { blockFillerMode, renderingMode = 'editing' }: { blockFillerMode?: BlockFillerMode; renderingMode?: RenderingMode } = {}) {
    this.document = document;
    this.renderingMode = renderingMode;
    this.blockFillerMode = blockFillerMode || (renderingMode === 'editing' ? 'br' : 'nbsp');
  }

  public bindFakeSelection(domElement: HTMLElement, viewDocumentSelection: ViewSelection): void {
    this._fakeSelectionMapping.set(domElement, new ViewSelection(viewDocumentSelection));
  }

  public fakeSelectionToView(domElement: HTMLElement): ViewSelection | undefined {
    return this._fakeSelectionMapping.get(domElement);
  }

  public bindElements(domElement: globalThis.Element, viewElement: ViewElement): void {
    this._domToViewMapping.set(domElement, viewElement);
    this._viewToDomMapping.set(viewElement, domElement);
  }

  public bindTexts(domText: globalThis.Text, viewText: ViewText): void {
    this._domToViewMapping.set(domText, viewText);
    this._viewToDomMapping.set(viewText, domText);
  }

  public unbindDomElement(domElement: globalThis.Node): void {
    const viewElement = this._domToViewMapping.get(domElement);
    if (viewElement) {
      this._domToViewMapping.delete(domElement);
      this._viewToDomMapping.delete(viewElement);
      for (const child of Array.from(domElement.childNodes)) {
        this.unbindDomElement(child);
      }
    }
  }

  public unbindViewElement(viewNode: ViewNode): void {
    const dom = this._viewToDomMapping.get(viewNode);
    if (dom) {
      this._viewToDomMapping.delete(viewNode);
      this._domToViewMapping.delete(dom);
    }
  }

  public bindDocumentFragments(domFragment: globalThis.DocumentFragment, viewFragment: ViewDocumentFragment): void {
    this._domToViewMapping.set(domFragment, viewFragment);
    this._viewToDomMapping.set(viewFragment, domFragment);
  }

  public shouldRenderAttribute(attributeKey: string, attributeValue: string, elementName: string): boolean {
    if (this.renderingMode === 'data') return true;
    attributeKey = attributeKey.toLowerCase();
    if (attributeKey.startsWith('on')) return false;
    if (attributeKey === 'srcdoc' && attributeValue.match(/\bon\S+\s*=|javascript:|<\s*\/*script/i)) return false;
    if (elementName === 'img' && (attributeKey === 'src' || attributeKey === 'srcset')) return true;
    if (elementName === 'source' && attributeKey === 'srcset') return true;
    if (attributeValue.match(/^\s*(javascript:|data:(image\/svg|text\/x?html))/i)) return false;
    return true;
  }

  public setContentOf(domElement: HTMLElement, html: string): void {
    if (this.renderingMode === 'data') {
      domElement.innerHTML = html;
      return;
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fragment = doc.createDocumentFragment();
    const bodyChildNodes = doc.body.childNodes;
    while (bodyChildNodes.length > 0) fragment.appendChild(bodyChildNodes[0]);
    const treeWalker = doc.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
    const nodes: globalThis.Element[] = [];
    let currentNode: globalThis.Node | null;
    while ((currentNode = treeWalker.nextNode())) nodes.push(currentNode as globalThis.Element);
    for (const currentNode of nodes) {
      const parentNode = currentNode.parentNode;
      if (parentNode && this.renderingMode === 'editing' && this.unsafeElements.includes(currentNode.tagName.toLowerCase())) {
        parentNode.replaceChild(this._createReplacementDomElement(currentNode.tagName.toLowerCase(), currentNode), currentNode);
      }
      for (const attributeName of Array.from(currentNode.getAttributeNames())) {
        this.setDomElementAttribute(currentNode, attributeName, currentNode.getAttribute(attributeName)!);
      }
    }
    domElement.innerHTML = '';
    domElement.append(fragment);
  }

  /** Converts a view node (or fragment) to DOM. */
  public viewToDom(viewNode: ViewNode | ViewDocumentFragment, options: { bind?: boolean; withChildren?: boolean } = {}): globalThis.Node {
    if (viewNode instanceof ViewText) {
      const textData = this._processDataFromViewText(viewNode);
      const domText = this.document ? getOwnerDocument(this).createTextNode(textData) : document.createTextNode(textData);
      if (options.bind) this.bindTexts(domText, viewNode);
      return domText;
    }
    const domDocument = getOwnerDocument(this);
    const existing = this.mapViewToDom(viewNode);
    if (existing && options.bind !== false && !(viewNode instanceof ViewDocumentFragment)) {
      // Already rendered: still make sure children/attributes are up to date when requested.
      return existing;
    }

    let domElement: globalThis.Node;
    if (viewNode instanceof ViewDocumentFragment) {
      domElement = domDocument.createDocumentFragment();
      if (options.bind) this.bindDocumentFragments(domElement as globalThis.DocumentFragment, viewNode);
    } else if (viewNode instanceof UIElement) {
      domElement = viewNode.render(domDocument, this);
      if (options.bind) this.bindElements(domElement as globalThis.Element, viewNode);
      return domElement;
    } else if (viewNode instanceof RawElement) {
      const viewElement = viewNode;
      if (this.renderingMode === 'editing' && this.unsafeElements.includes(viewElement.name)) {
        domElement = this._createReplacementDomElement(viewElement.name);
      } else {
        domElement = domDocument.createElement(viewElement.name);
      }
      if (options.bind) this.bindElements(domElement as globalThis.Element, viewElement);
      for (const key of viewElement.getAttributeKeys()) {
        this.setDomElementAttribute(domElement as globalThis.Element, key, viewElement.getAttribute(key)!, viewElement);
      }
      viewElement.render(domElement as HTMLElement, this);
      return domElement;
    } else {
      const viewElement = viewNode as ViewElement;
      if (this.renderingMode === 'editing' && this.unsafeElements.includes(viewElement.name)) {
        domElement = this._createReplacementDomElement(viewElement.name);
      } else if (viewElement.name === 'svg' || viewElement.name === 'path' || viewElement.name === 'circle' || viewElement.name === 'g' || viewElement.name === 'rect') {
        domElement = domDocument.createElementNS('http://www.w3.org/2000/svg', viewElement.name);
      } else {
        domElement = domDocument.createElement(viewElement.name);
      }
      if (options.bind) this.bindElements(domElement as globalThis.Element, viewElement);
      for (const key of viewElement.getAttributeKeys()) {
        this.setDomElementAttribute(domElement as globalThis.Element, key, viewElement.getAttribute(key)!, viewElement);
      }
    }

    if (options.withChildren !== false) {
      for (const child of this.viewChildrenToDom(viewNode as ViewElement | ViewDocumentFragment, options)) {
        domElement.appendChild(child);
      }
    }
    return domElement;
  }

  public setDomElementAttribute(domElement: globalThis.Element, key: string, value: string, relatedViewElement?: ViewElement): void {
    const shouldRenderAttribute = this.shouldRenderAttribute(key, value, domElement.tagName.toLowerCase()) || (relatedViewElement && relatedViewElement.shouldRenderUnsafeAttribute(key));
    if (!shouldRenderAttribute) {
      domElement.removeAttribute(key);
      domElement.setAttribute(UNSAFE_ATTRIBUTE_NAME_PREFIX + key, value);
      return;
    }
    if (domElement.hasAttribute(UNSAFE_ATTRIBUTE_NAME_PREFIX + key)) {
      domElement.removeAttribute(UNSAFE_ATTRIBUTE_NAME_PREFIX + key);
    }
    try {
      domElement.setAttribute(key, value);
    } catch {
      // Invalid attribute name; ignore.
    }
  }

  public removeDomElementAttribute(domElement: globalThis.Element, key: string): void {
    if (key === UNSAFE_ELEMENT_REPLACEMENT_ATTRIBUTE) return;
    domElement.removeAttribute(key);
    domElement.removeAttribute(UNSAFE_ATTRIBUTE_NAME_PREFIX + key);
  }

  /** Yields DOM children for the view element's children, inserting block fillers where needed. */
  public *viewChildrenToDom(viewElement: ViewElement | ViewDocumentFragment, options: { bind?: boolean; withChildren?: boolean } = {}): IterableIterator<globalThis.Node> {
    const fillerPositionOffset = (viewElement as ViewElement).getFillerOffset ? (viewElement as ViewElement).getFillerOffset() : null;
    let offset = 0;
    for (const childView of viewElement.getChildren()) {
      if (fillerPositionOffset === offset) {
        yield this._getBlockFiller();
      }
      const transparentRendering = (childView as ViewElement).is?.('element') && !!(childView as ViewElement).getCustomProperty('dataPipeline:transparentRendering') && this.renderingMode === 'data';
      if (transparentRendering) {
        yield* this.viewChildrenToDom(childView as ViewElement, options);
      } else {
        yield this.viewToDom(childView, options);
      }
      offset++;
    }
    if (fillerPositionOffset === offset) {
      yield this._getBlockFiller();
    }
  }

  public viewRangeToDom(viewRange: ViewRange): globalThis.Range {
    const domStart = this.viewPositionToDom(viewRange.start)!;
    const domEnd = this.viewPositionToDom(viewRange.end)!;
    const domRange = getOwnerDocument(this).createRange();
    domRange.setStart(domStart.parent, domStart.offset);
    domRange.setEnd(domEnd.parent, domEnd.offset);
    return domRange;
  }

  public viewPositionToDom(viewPosition: ViewPosition): { parent: globalThis.Node; offset: number } | null {
    const viewParent = viewPosition.parent;
    if (viewParent instanceof ViewText) {
      const domParent = this.findCorrespondingDomText(viewParent);
      if (!domParent) return null;
      let offset = viewPosition.offset;
      if (startsWithFiller(domParent)) offset += 7;
      return { parent: domParent, offset };
    }
    let domParent: globalThis.Node | undefined;
    let domBefore: globalThis.Node | undefined;
    let domAfter: globalThis.Node | undefined | null;
    if (viewPosition.offset === 0) {
      domParent = this.mapViewToDom(viewParent as ViewElement);
      if (!domParent) return null;
      domAfter = domParent.childNodes[0] ?? undefined;
    } else {
      const nodeBefore = viewPosition.nodeBefore!;
      domBefore = (nodeBefore instanceof ViewText ? this.findCorrespondingDomText(nodeBefore) : this.mapViewToDom(nodeBefore as ViewElement)) ?? undefined;
      if (!domBefore) return null;
      domParent = domBefore.parentNode!;
      domAfter = domBefore.nextSibling || undefined;
    }
    if (domAfter && isDomText(domAfter) && startsWithFiller(domAfter)) {
      return { parent: domAfter, offset: 7 };
    }
    const offset = domBefore ? indexOf(domBefore) + 1 : 0;
    return { parent: domParent, offset };
  }

  /** Converts a DOM node to a view node. Returns `null` for block fillers and ignored nodes. */
  public domToView(domNode: globalThis.Node, options: { bind?: boolean; withChildren?: boolean; keepOriginalCase?: boolean; skipComments?: boolean } = {}): ViewNode | ViewDocumentFragment | null {
    const inlineNodes: ViewNode[] = [];
    const generator = this._domToView(domNode, options, inlineNodes);
    const node = generator.next().value as ViewNode | ViewDocumentFragment | null;
    if (!node) return null;
    generator.next();
    this._processDomInlineNodes(null, inlineNodes, options);
    if (node instanceof ViewText && node.data === '') return null;
    return node;
  }

  public *domChildrenToView(domElement: globalThis.Node, options: { bind?: boolean; withChildren?: boolean; keepOriginalCase?: boolean; skipComments?: boolean } = {}, inlineNodes: ViewNode[] = []): IterableIterator<ViewNode> {
    const childNodes = Array.from(domElement.childNodes);
    if (options.withChildren === false) return;
    for (let i = 0; i < childNodes.length; i++) {
      const domChild = childNodes[i];
      const generator = this._domToView(domChild, options, inlineNodes);
      const viewChild = generator.next().value as ViewNode | null;
      if (viewChild !== null) {
        if (isDomText(domChild) && (domChild as globalThis.Text).data === '' ) continue;
        // Whitespace cleaning before entering a block element (between block elements).
        if (viewChild instanceof ViewElement && this.blockElements.includes(viewChild.name)) {
          this._processDomInlineNodes(domElement as globalThis.Element, inlineNodes, options);
        }
        yield viewChild;
        generator.next();
      }
    }
    this._processDomInlineNodes(domElement as globalThis.Element, inlineNodes, options);
  }

  public domSelectionToView(domSelection: globalThis.Selection): ViewSelection {
    if (domSelection.rangeCount === 1) {
      let domRange: globalThis.Range | null = domSelection.getRangeAt(0);
      const anchorNode = domSelection.anchorNode;
      if (anchorNode) {
        const fakeContainer = findFakeSelectionContainer(anchorNode);
        if (fakeContainer) {
          const viewSelection = this.fakeSelectionToView(fakeContainer);
          if (viewSelection) return viewSelection;
        }
      }
      void domRange;
      domRange = null;
    }
    const isBackward = this.isDomSelectionBackward(domSelection);
    const viewSelection = new ViewSelection();
    for (let i = 0; i < domSelection.rangeCount; i++) {
      const domRange = domSelection.getRangeAt(i);
      const viewRange = this.domRangeToView(domRange);
      if (viewRange) {
        try {
          viewSelection.setTo([...viewSelection.getRanges(), viewRange], { backward: isBackward });
        } catch {
          // intersecting ranges; ignore
        }
      }
    }
    return viewSelection;
  }

  public domRangeToView(domRange: globalThis.Range | StaticRange): ViewRange | null {
    const viewStart = this.domPositionToView(domRange.startContainer, domRange.startOffset);
    const viewEnd = this.domPositionToView(domRange.endContainer, domRange.endOffset);
    if (viewStart && viewEnd) return new ViewRange(viewStart, viewEnd);
    return null;
  }

  public domPositionToView(domParent: globalThis.Node, domOffset = 0): ViewPosition | null {
    if (this.isBlockFiller(domParent)) {
      return this.domPositionToView(domParent.parentNode!, indexOf(domParent));
    }
    const viewElement = this.mapDomToView(domParent);
    if (viewElement && ((viewElement as ViewElement).is('uiElement') || (viewElement as ViewElement).is('rawElement'))) {
      return ViewPosition._createBefore(viewElement as ViewElement);
    }
    if (isDomText(domParent)) {
      if (startsWithFiller(domParent) && domParent.data.length === 7) {
        return this.domPositionToView(domParent.parentNode!, indexOf(domParent));
      }
      const viewParent = this.findCorrespondingViewText(domParent);
      let offset = domOffset;
      if (!viewParent) return null;
      if (startsWithFiller(domParent)) {
        offset -= 7;
        offset = offset < 0 ? 0 : offset;
      }
      return new ViewPosition(viewParent, offset);
    }
    if (domOffset === 0) {
      const viewParent = this.mapDomToView(domParent);
      if (viewParent) return new ViewPosition(viewParent as ViewElement, 0);
    } else {
      let domBefore: globalThis.Node | null = domParent.childNodes[domOffset - 1] ?? null;
      while (domBefore && this.isBlockFiller(domBefore)) {
        domBefore = domBefore.previousSibling;
      }
      if (!domBefore) {
        const viewParent = this.mapDomToView(domParent);
        if (viewParent) return new ViewPosition(viewParent as ViewElement, 0);
        return null;
      }
      const viewBefore = isDomText(domBefore) ? this.findCorrespondingViewText(domBefore) : this.mapDomToView(domBefore);
      if (viewBefore && (viewBefore as ViewNode).parent) {
        return new ViewPosition((viewBefore as ViewNode).parent!, (viewBefore as ViewNode).index! + 1);
      }
    }
    return null;
  }

  public mapDomToView(domElementOrDocumentFragment: globalThis.Node): ViewNode | ViewDocumentFragment | undefined {
    const hostElement = this.getHostViewElement(domElementOrDocumentFragment);
    return hostElement || this._domToViewMapping.get(domElementOrDocumentFragment);
  }

  public findCorrespondingViewText(domText: globalThis.Text): ViewText | null {
    const mapped = this._domToViewMapping.get(domText);
    if (mapped instanceof ViewText) return mapped;
    if (this.isBlockFiller(domText)) return null;
    const previousSibling = domText.previousSibling;
    if (previousSibling) {
      if (!isDomElement(previousSibling)) return null;
      const viewElement = this.mapDomToView(previousSibling);
      if (viewElement) {
        const nextSibling = (viewElement as ViewNode).nextSibling;
        if (nextSibling instanceof ViewText) return nextSibling;
        return null;
      }
    } else {
      const viewElement = this.mapDomToView(domText.parentNode!);
      if (viewElement) {
        const firstChild = (viewElement as ViewElement).getChild(0);
        if (firstChild instanceof ViewText) return firstChild;
        return null;
      }
    }
    return null;
  }

  public mapViewToDom(viewNode: ViewNode | ViewDocumentFragment): globalThis.Node | undefined {
    return this._viewToDomMapping.get(viewNode);
  }

  public findCorrespondingDomText(viewText: ViewText): globalThis.Text | null {
    const mapped = this._viewToDomMapping.get(viewText);
    if (mapped && isDomText(mapped)) return mapped;
    const previousSibling = viewText.previousSibling;
    if (previousSibling && this.mapViewToDom(previousSibling)) {
      const dom = this.mapViewToDom(previousSibling)!.nextSibling;
      return isDomText(dom) ? dom : null;
    }
    if (!previousSibling && viewText.parent && this.mapViewToDom(viewText.parent as ViewElement)) {
      const dom = this.mapViewToDom(viewText.parent as ViewElement)!.childNodes[0];
      return isDomText(dom) ? dom : null;
    }
    return null;
  }

  public focus(viewEditable: EditableElement): void {
    const domEditable = this.mapViewToDom(viewEditable) as HTMLElement | undefined;
    if (domEditable && domEditable.ownerDocument.activeElement !== domEditable) {
      const { scrollX, scrollY } = window;
      const scrollPositions: Array<[number, number]> = [];
      let parent: HTMLElement | null = domEditable;
      while (parent && parent !== document.documentElement) {
        scrollPositions.push([parent.scrollLeft, parent.scrollTop]);
        parent = parent.parentElement;
      }
      domEditable.focus();
      // Restore scroll positions changed by focus().
      parent = domEditable;
      let i = 0;
      while (parent && parent !== document.documentElement) {
        const [left, top] = scrollPositions[i++] || [0, 0];
        parent.scrollLeft = left;
        parent.scrollTop = top;
        parent = parent.parentElement;
      }
      window.scrollTo(scrollX, scrollY);
    }
  }

  public isElement(node: globalThis.Node): node is globalThis.Element {
    return isDomElement(node);
  }

  public isDocumentFragment(node: globalThis.Node): node is globalThis.DocumentFragment {
    return node.nodeType === 11;
  }

  public isBlockFiller(domNode: globalThis.Node): boolean {
    if (this.blockFillerMode === 'br') {
      return isBlockFiller(domNode, 'br') || (isDomElement(domNode) && domNode.tagName === 'BR' && (domNode as HTMLElement).dataset.ckeFiller === 'true');
    }
    if (isDomElement(domNode) && domNode.tagName === 'BR' && (domNode as HTMLElement).dataset.ckeFiller === 'true') return true;
    if (isDomElement(domNode) && domNode.tagName === 'SPAN' && (domNode as HTMLElement).dataset.ckeFiller === 'true') return true;
    return isNbspBlockFiller(domNode, this.blockElements);
  }

  public isDomSelectionBackward(selection: globalThis.Selection): boolean {
    if (selection.isCollapsed) return false;
    const range = getOwnerDocument(this).createRange();
    try {
      range.setStart(selection.anchorNode!, selection.anchorOffset);
      range.setEnd(selection.focusNode!, selection.focusOffset);
    } catch {
      return false;
    }
    const backward = range.collapsed;
    range.detach();
    return backward;
  }

  public getHostViewElement(domNode: globalThis.Node): UIElement | RawElement | null {
    const ancestors = getDomAncestors(domNode);
    ancestors.pop();
    while (ancestors.length) {
      const domNodeAncestor = ancestors.pop()!;
      const viewNode = this._domToViewMapping.get(domNodeAncestor);
      if (viewNode && ((viewNode as ViewElement).is('uiElement') || (viewNode as ViewElement).is('rawElement'))) {
        return viewNode as UIElement | RawElement;
      }
    }
    return null;
  }

  public isDomSelectionCorrect(domSelection: globalThis.Selection): boolean {
    return this._isDomSelectionPositionCorrect(domSelection.anchorNode!, domSelection.anchorOffset) && this._isDomSelectionPositionCorrect(domSelection.focusNode!, domSelection.focusOffset);
  }

  public registerRawContentMatcher(pattern: (el: ViewElement) => boolean): void {
    this._rawContentElementMatcher.push(pattern);
  }

  /** @internal Returns the DOM document used for rendering. */
  public _getDomDocument(): globalThis.Document {
    return getOwnerDocument(this);
  }

  /** Creates a block filler node for the current filler mode. */
  public createBlockFiller(): globalThis.Node {
    return this._getBlockFiller();
  }

  private _getBlockFiller(): globalThis.Node {
    const domDocument = getOwnerDocument(this);
    switch (this.blockFillerMode) {
      case 'nbsp':
        return NBSP_FILLER(domDocument);
      case 'markedNbsp':
        return MARKED_NBSP_FILLER(domDocument);
      default:
        return BR_FILLER(domDocument);
    }
  }

  private _isDomSelectionPositionCorrect(domParent: globalThis.Node, offset: number): boolean {
    if (isDomText(domParent) && startsWithFiller(domParent) && offset < 7) return false;
    if (this.isElement(domParent) && startsWithFiller(domParent.childNodes[offset] as any)) return false;
    const viewParent = this.mapDomToView(domParent);
    if (viewParent && ((viewParent as ViewElement).is('uiElement') || (viewParent as ViewElement).is('rawElement'))) return false;
    return true;
  }

  private *_domToView(domNode: globalThis.Node, options: { bind?: boolean; withChildren?: boolean; keepOriginalCase?: boolean; skipComments?: boolean }, inlineNodes: ViewNode[]): IterableIterator<ViewNode | ViewDocumentFragment | null> {
    if (this.isBlockFiller(domNode)) {
      return null;
    }
    const hostElement = this.getHostViewElement(domNode);
    if (hostElement) {
      return hostElement;
    }
    if (domNode.nodeType === 8 && options.skipComments) {
      return null;
    }
    if (isDomText(domNode)) {
      if (isNbspBlockFiller(domNode, this.blockElements)) {
        return null;
      }
      const textData = domNode.data;
      if (textData === '') return null;
      const viewText = new ViewText(this.document, textData);
      inlineNodes.push(viewText);
      return viewText;
    }
    if (domNode.nodeType === 8) {
      return null;
    }
    let viewElement: ViewNode | ViewDocumentFragment;
    if (this.isDocumentFragment(domNode)) {
      viewElement = new ViewDocumentFragment(this.document);
      if (options.bind) this.bindDocumentFragments(domNode, viewElement);
    } else {
      viewElement = this._createViewElement(domNode as globalThis.Element, options);
      if (options.bind) this.bindElements(domNode as globalThis.Element, viewElement as ViewElement);
      const attrs = (domNode as globalThis.Element).attributes;
      if (attrs) {
        for (let l = attrs.length, i = 0; i < l; i++) {
          (viewElement as ViewElement)._setAttribute(attrs[i].name, attrs[i].value);
        }
      }
      if (this._isViewElementWithRawContent(viewElement as ViewElement, options)) {
        (viewElement as ViewElement)._setCustomProperty('$rawContent', (domNode as globalThis.Element).innerHTML);
        if (!this.isElement(domNode) || !this.blockElements.includes(domNode.tagName.toLowerCase())) {
          inlineNodes.push(viewElement as ViewNode);
        }
        this._encounteredRawContentDomNodes.add(domNode);
        return viewElement;
      }
    }
    yield viewElement;
    if (options.withChildren !== false) {
      const isBlock = this.isElement(domNode) && this.blockElements.includes(domNode.tagName.toLowerCase());
      const nestedInline: ViewNode[] = isBlock ? [] : inlineNodes;
      for (const child of this.domChildrenToView(domNode, options, nestedInline)) {
        (viewElement as ViewElement)._appendChild(child);
      }
      if (isBlock) {
        this._processDomInlineNodes(domNode as globalThis.Element, nestedInline, options);
      } else if (!this.isElement(domNode) && !this.isDocumentFragment(domNode)) {
        // nothing
      } else if (!this.isDocumentFragment(domNode) && !this.blockElements.includes((domNode as globalThis.Element).tagName.toLowerCase())) {
        // inline element: children are handled by parent's inline processing; also treat the element itself as inline.
        inlineNodes.push(viewElement as ViewNode);
      }
    }
  }

  /** Normalizes whitespace in consecutive inline text nodes (browser-like whitespace collapsing). */
  private _processDomInlineNodes(domParent: globalThis.Element | null, inlineNodes: ViewNode[], options: { withChildren?: boolean }): void {
    if (!inlineNodes.length) return;
    if (domParent && !this.isDocumentFragment(domParent) && hasPreAncestor(domParent, this.preElements)) {
      // Whitespace preserved; nothing to do except dropping leading newline of <pre>.
      for (const node of inlineNodes) {
        if (node instanceof ViewText) {
          let data = node.data;
          if (data.startsWith('\n') && domParent.firstChild && this.mapDomToView(domParent.firstChild) === node) {
            data = data.slice(1);
          }
          node._data = getDataWithoutFiller(data);
        }
      }
      inlineNodes.length = 0;
      return;
    }
    let prevNodeEndsWithSpace = false;
    for (let i = 0; i < inlineNodes.length; i++) {
      const node = inlineNodes[i];
      if (!(node instanceof ViewText)) {
        prevNodeEndsWithSpace = false;
        continue;
      }
      let data = node.data.replace(/[ \n\t\r]{1,}/g, ' ');
      const nodeEndsWithSpace = /[^\S ]/.test(data.charAt(data.length - 1));
      if (i === 0 || prevNodeEndsWithSpace || isPrecededByBlockLikeNode(inlineNodes, i)) {
        data = data.replace(/^ /, '');
      }
      if (i === inlineNodes.length - 1 || isFollowedByBlockLikeNode(inlineNodes, i)) {
        data = data.replace(/ $/, '');
      }
      data = getDataWithoutFiller(data);
      data = data.replace(/  /g, '  ');
      const nextNode = inlineNodes[i + 1];
      const isNextNodeInlineObject = nextNode && !(nextNode instanceof ViewText) && (nextNode as ViewElement).name !== 'br';
      const isNextNodeStartWithSpace = nextNode instanceof ViewText && nextNode.data.charAt(0) === ' ';
      if (/( | ) $/.test(data) || !nextNode || isNextNodeStartWithSpace || isNextNodeInlineObject) {
        data = data.replace(/ $/, ' ');
      }
      if (i === 0 || prevNodeEndsWithSpace || (inlineNodes[i - 1] && !(inlineNodes[i - 1] instanceof ViewText) && (inlineNodes[i - 1] as ViewElement).name !== 'br')) {
        data = data.replace(/^ /, ' ');
      }
      node._data = data;
      prevNodeEndsWithSpace = nodeEndsWithSpace && data.length > 0 ? data.endsWith(' ') : nodeEndsWithSpace;
      if (data.length === 0) {
        // Empty text nodes are removed later by the caller (we leave them; parent handles).
      }
    }
    // Remove empty text nodes.
    for (const node of inlineNodes) {
      if (node instanceof ViewText && node.data === '' && node.parent) {
        node._remove();
      }
    }
    inlineNodes.length = 0;
  }

  private _processDataFromViewText(node: ViewText): string {
    let data = node.data;
    if (node.getAncestors().some(parent => (parent as ViewElement).is?.('element') && this.preElements.includes((parent as ViewElement).name))) {
      return data;
    }
    if (data.charAt(0) === ' ') {
      const prevNode = this._getTouchingInlineViewNode(node, false);
      const prevEndsWithSpace = prevNode && prevNode instanceof ViewText && prevNode.data.charAt(prevNode.data.length - 1) === ' ';
      if (prevEndsWithSpace || !prevNode) {
        data = ' ' + data.substr(1);
      }
    }
    if (data.charAt(data.length - 1) === ' ') {
      const nextNode = this._getTouchingInlineViewNode(node, true);
      const nextStartsWithSpace = nextNode && nextNode instanceof ViewText && nextNode.data.charAt(0) === ' ';
      if (data.charAt(data.length - 2) === ' ' || !nextNode || nextStartsWithSpace) {
        data = data.substr(0, data.length - 1) + ' ';
      }
    }
    return data.replace(/ {2}/g, '  ');
  }

  private _getTouchingInlineViewNode(node: ViewText, getNext: boolean): ViewNode | null {
    const treeWalker = new TreeWalker({ startPosition: getNext ? ViewPosition._createAfter(node) : ViewPosition._createBefore(node), direction: getNext ? 'forward' : 'backward' });
    for (const value of treeWalker) {
      if (value.item.is('element')) {
        const name = (value.item as ViewElement).name;
        if (this.inlineObjectElements.includes(name)) return value.item as ViewElement;
        if (name === 'br' || this.blockElements.includes(name)) return null;
        // Inline containers, UI, raw and empty elements (e.g. inline widgets) count as inline neighbours.
        if (!value.item.is('attributeElement')) return value.item as ViewElement;
      }
      if (value.item.is('$textProxy')) {
        return (value.item as any).textNode;
      }
    }
    return null;
  }

  private _createViewElement(node: globalThis.Element, options: { keepOriginalCase?: boolean }): ViewElement {
    const viewName = options.keepOriginalCase ? node.tagName : node.tagName.toLowerCase();
    return new ViewElement(this.document, viewName);
  }

  private _isViewElementWithRawContent(viewElement: ViewElement, options: { withChildren?: boolean }): boolean {
    return options.withChildren !== false && this._rawContentElementMatcher.some(m => m(viewElement));
  }

  private _createReplacementDomElement(elementName: string, originalDomElement?: globalThis.Element): globalThis.Element {
    const newDomElement = getOwnerDocument(this).createElement('span');
    newDomElement.setAttribute(UNSAFE_ELEMENT_REPLACEMENT_ATTRIBUTE, elementName);
    if (originalDomElement) {
      while (originalDomElement.firstChild) newDomElement.appendChild(originalDomElement.firstChild);
      for (const attributeName of Array.from(originalDomElement.getAttributeNames())) {
        newDomElement.setAttribute(attributeName, originalDomElement.getAttribute(attributeName)!);
      }
    }
    return newDomElement;
  }
}

function isPrecededByBlockLikeNode(nodes: ViewNode[], i: number): boolean {
  const prev = nodes[i - 1];
  return !!prev && !(prev instanceof ViewText) && (prev as ViewElement).name === 'br';
}

function isFollowedByBlockLikeNode(nodes: ViewNode[], i: number): boolean {
  const next = nodes[i + 1];
  return !!next && !(next instanceof ViewText) && (next as ViewElement).name === 'br';
}

function isNbspBlockFiller(domNode: globalThis.Node, blockElements: string[]): boolean {
  const isNbspFiller = isDomText(domNode) && domNode.data === ' ';
  if (!isNbspFiller) return false;
  const parent = domNode.parentNode;
  return !!parent && isDomElement(parent) && parent.childNodes.length === 1 && blockElements.includes(parent.tagName.toLowerCase());
}

function getDomAncestors(node: globalThis.Node): globalThis.Node[] {
  const ancestors: globalThis.Node[] = [];
  let current: globalThis.Node | null = node;
  while (current && current.nodeType !== 9) {
    ancestors.unshift(current);
    current = current.parentNode;
  }
  return ancestors;
}

function indexOf(node: globalThis.Node): number {
  let index = 0;
  let current = node.previousSibling;
  while (current) {
    index++;
    current = current.previousSibling;
  }
  return index;
}

function findFakeSelectionContainer(node: globalThis.Node): HTMLElement | null {
  let current: globalThis.Node | null = node;
  while (current) {
    if (isDomElement(current) && current.classList.contains('ck-fake-selection-container')) return current as HTMLElement;
    current = current.parentNode;
  }
  return null;
}

let ownerDocument: globalThis.Document | null = null;

function getOwnerDocument(converter: DomConverter): globalThis.Document {
  void converter;
  if (!ownerDocument) ownerDocument = typeof document !== 'undefined' ? document : (null as any);
  return ownerDocument!;
}

function hasPreAncestor(domElement: globalThis.Element, preElements: string[]): boolean {
  let current: globalThis.Element | null = domElement;
  while (current && current.nodeType === 1) {
    if (preElements.includes(current.tagName.toLowerCase())) return true;
    current = current.parentElement;
  }
  return false;
}
