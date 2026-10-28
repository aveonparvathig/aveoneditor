import { Observable } from '../../utils/observable';
import { Document as ViewDocument } from './document';
import { DowncastWriter } from './downcastwriter';
import { Renderer } from './renderer';
import { DomConverter } from './domconverter';
import { Position, type PositionOffset } from './position';
import { Range } from './range';
import { Selection, type Selectable, type SelectionOptions } from './selection';
import { RootEditableElement } from './rooteditableelement';
import type { Observer } from './observer/observer';
import type { Item } from './item';
import type { Node } from './node';
import type { Element } from './element';
import type { DocumentFragment } from './documentfragment';
import { MutationObserver } from './observer/mutationobserver';
import { FocusObserver } from './observer/focusobserver';
import { SelectionObserver } from './observer/selectionobserver';
import { KeyObserver } from './observer/keyobserver';
import { CompositionObserver } from './observer/compositionobserver';
import { InputObserver } from './observer/inputobserver';
import { ArrowKeysObserver } from './observer/arrowkeysobserver';
import { TabObserver } from './observer/tabobserver';
import { scrollViewportToShowTarget } from '../../utils/dom';

type ObserverConstructor = new (view: View) => Observer;

/**
 * The editing view: owns the view document, the DOM converter, the renderer and the observers.
 * Use `view.change()` to modify the view; rendering happens automatically afterwards.
 */
export class View extends Observable {
  public readonly document: ViewDocument;
  public readonly domConverter: DomConverter;
  public readonly domRoots = new Map<string, HTMLElement>();
  declare public isRenderingInProgress: boolean;
  declare public hasDomSelection: boolean;
  private readonly _renderer: Renderer;
  private readonly _initialDomRootAttributes = new WeakMap<HTMLElement, Record<string, string>>();
  private readonly _observers = new Map<ObserverConstructor, Observer>();
  private readonly _writer: DowncastWriter;
  private _ongoingChange = false;
  private _postFixersInProgress = false;
  private _renderingDisabled = false;
  private _hasChangedSinceTheLastRendering = false;

  constructor() {
    super();
    this.document = new ViewDocument();
    this.domConverter = new DomConverter(this.document);
    this.set('isRenderingInProgress', false);
    this.set('hasDomSelection', false);
    this._renderer = new Renderer(this.domConverter, this.document.selection);
    this._renderer.bind('isFocused', 'isSelecting', 'isComposing').to(this.document);
    this._writer = new DowncastWriter(this.document);

    this.addObserver(MutationObserver);
    this.addObserver(FocusObserver);
    this.addObserver(SelectionObserver);
    this.addObserver(KeyObserver);
    this.addObserver(CompositionObserver);
    this.addObserver(ArrowKeysObserver);
    this.addObserver(InputObserver);
    this.addObserver(TabObserver);

    this.on('render', () => {
      this._renderer.render();
      for (const observer of this._observers.values()) {
        observer.flush?.();
      }
    });

    this.listenTo(this.document.selection, 'change', () => {
      this._hasChangedSinceTheLastRendering = true;
    });
    this.listenTo(this.document, 'change:isFocused', () => {
      this._hasChangedSinceTheLastRendering = true;
    });
    this.listenTo(this.document, 'change:isComposing', () => {
      if (!this.document.isComposing) {
        this._hasChangedSinceTheLastRendering = true;
        this.change(() => {});
      }
    });
  }

  public attachDomRoot(domRoot: HTMLElement, name = 'main'): void {
    const viewRoot = this.document.getRoot(name)!;
    (viewRoot as any).name = domRoot.tagName.toLowerCase();

    const initialDomRootAttributes: Record<string, string> = {};
    for (const { name: attrName, value } of Array.from(domRoot.attributes)) {
      initialDomRootAttributes[attrName] = value;
      if (attrName === 'class') {
        this._writer.addClass(value.split(' '), viewRoot);
      } else {
        this._writer.setAttribute(attrName, value, viewRoot);
      }
    }
    this._initialDomRootAttributes.set(domRoot, initialDomRootAttributes);

    const updateContenteditableAttribute = () => {
      this._writer.setAttribute('contenteditable', (!viewRoot.isReadOnly).toString(), viewRoot);
      if (viewRoot.isReadOnly) {
        this._writer.addClass('ck-read-only', viewRoot);
      } else {
        this._writer.removeClass('ck-read-only', viewRoot);
      }
    };
    updateContenteditableAttribute();

    this.domRoots.set(name, domRoot);
    this.domConverter.bindElements(domRoot, viewRoot);
    this._renderer.markToSync('children', viewRoot);
    this._renderer.markToSync('attributes', viewRoot);
    this._renderer.domDocuments.add(domRoot.ownerDocument);
    this._hasChangedSinceTheLastRendering = true;

    viewRoot.on('change:children', (evt, node: Node) => this._renderer.markToSync('children', node));
    viewRoot.on('change:attributes', (evt, node: Node) => this._renderer.markToSync('attributes', node));
    viewRoot.on('change:text', (evt, node: Node) => this._renderer.markToSync('text', node));
    viewRoot.on('change:isReadOnly', () => this.change(updateContenteditableAttribute));
    viewRoot.on('change', () => {
      this._hasChangedSinceTheLastRendering = true;
    });

    for (const observer of this._observers.values()) {
      observer.observe(domRoot, name);
    }
  }

  public detachDomRoot(name: string): void {
    const domRoot = this.domRoots.get(name)!;
    for (const attrName of Array.from(domRoot.attributes).map(a => a.name)) {
      domRoot.removeAttribute(attrName);
    }
    const initialDomRootAttributes = this._initialDomRootAttributes.get(domRoot) || {};
    for (const attribute in initialDomRootAttributes) {
      domRoot.setAttribute(attribute, initialDomRootAttributes[attribute]);
    }
    this.domRoots.delete(name);
    this.domConverter.unbindDomElement(domRoot);
    for (const observer of this._observers.values()) {
      observer.stopObserving(domRoot);
    }
  }

  public getDomRoot(name = 'main'): HTMLElement | undefined {
    return this.domRoots.get(name);
  }

  public addObserver<T extends Observer>(ObserverClass: new (view: View) => T): T {
    let observer = this._observers.get(ObserverClass as any) as T | undefined;
    if (observer) return observer;
    observer = new ObserverClass(this);
    this._observers.set(ObserverClass as any, observer);
    for (const [name, domElement] of this.domRoots) {
      observer.observe(domElement, name);
    }
    observer.enable();
    return observer;
  }

  public getObserver<T extends Observer>(ObserverClass: new (view: View) => T): T | undefined {
    return this._observers.get(ObserverClass as any) as T | undefined;
  }

  public disableObservers(): void {
    for (const observer of this._observers.values()) observer.disable();
  }

  public enableObservers(): void {
    for (const observer of this._observers.values()) observer.enable();
  }

  public scrollToTheSelection(options: { viewportOffset?: number } = {}): void {
    const range = this.document.selection.getFirstRange();
    if (!range) return;
    try {
      const domRange = this.domConverter.viewRangeToDom(range);
      scrollViewportToShowTarget(domRange, options.viewportOffset ?? 20);
    } catch {
      // ignore
    }
  }

  public focus(): void {
    if (!this.document.isFocused) {
      const editable = this.document.selection.editableElement;
      if (editable) {
        this.domConverter.focus(editable);
        this.forceRender();
      }
    }
  }

  /** Runs the callback with a downcast writer and renders afterwards (unless rendering is disabled). */
  public change<T>(callback: (writer: DowncastWriter) => T): T {
    if (this.isRenderingInProgress || this._postFixersInProgress) {
      throw new Error('cannot-change-view-tree: Attempting to make changes to the view while rendering.');
    }
    if (this._ongoingChange) {
      return callback(this._writer);
    }
    this._ongoingChange = true;
    let callbackResult: T;
    try {
      callbackResult = callback(this._writer);
    } finally {
      this._ongoingChange = false;
    }
    if (!this._renderingDisabled && this._hasChangedSinceTheLastRendering) {
      this._postFixersInProgress = true;
      try {
        this.document._callPostFixers(this._writer);
      } finally {
        this._postFixersInProgress = false;
      }
      this._render();
    }
    return callbackResult;
  }

  public forceRender(): void {
    this._hasChangedSinceTheLastRendering = true;
    this.getObserver(FocusObserver)?.flush();
    this.change(() => {});
  }

  public destroy(): void {
    for (const observer of this._observers.values()) observer.destroy();
    this.document.destroy();
    this.stopListening();
  }

  public createPositionAt(itemOrPosition: Item | Position | DocumentFragment, offset?: PositionOffset): Position {
    return Position._createAt(itemOrPosition, offset);
  }

  public createPositionAfter(item: Item): Position {
    return Position._createAfter(item);
  }

  public createPositionBefore(item: Item): Position {
    return Position._createBefore(item);
  }

  public createRange(start: Position, end?: Position | null): Range {
    return new Range(start, end);
  }

  public createRangeOn(item: Item): Range {
    return Range._createOn(item);
  }

  public createRangeIn(element: Element | DocumentFragment): Range {
    return Range._createIn(element);
  }

  public createSelection(selectable?: Selectable, placeOrOffset?: PositionOffset | SelectionOptions, options?: SelectionOptions): Selection {
    return new Selection(selectable, placeOrOffset, options);
  }

  /** @internal Creates a view root for the given name. */
  public _createRoot(name: string, rootName = 'main'): RootEditableElement {
    const root = new RootEditableElement(this.document, name);
    root.rootName = rootName;
    this.document.roots.add(root);
    return root;
  }

  /** @internal */
  public _disableRendering(flag: boolean): void {
    this._renderingDisabled = flag;
    if (flag === false) {
      this.change(() => {});
    }
  }

  private _render(): void {
    this.isRenderingInProgress = true;
    const mutationObserver = this.getObserver(MutationObserver);
    mutationObserver?.flush();
    this.disableObservers();
    try {
      this.fire('render');
    } finally {
      this.enableObservers();
      mutationObserver?.discardPending();
      this.isRenderingInProgress = false;
      this._hasChangedSinceTheLastRendering = false;
    }
  }
}
