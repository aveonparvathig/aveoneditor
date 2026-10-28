import { Observable } from '../../utils/observable';
import { Batch, type BatchType } from './batch';
import { Document } from './document';
import { MarkerCollection } from './markercollection';
import { Schema } from './schema';
import { Writer } from './writer';
import { Position, type PositionOffset, type PositionStickiness } from './position';
import { Range } from './range';
import { Selection, type Selectable } from './selection';
import { Element } from './element';
import { DocumentFragment } from './documentfragment';
import { OperationFactory } from './operation/operationfactory';
import type { Operation } from './operation/operation';
import type { Item } from './item';
import type { DocumentSelection } from './documentselection';
import { insertContent } from './utils/insertcontent';
import { insertObject } from './utils/insertobject';
import { deleteContent, type DeleteContentOptions } from './utils/deletecontent';
import { modifySelection, type ModifySelectionOptions } from './utils/modifyselection';
import { getSelectedContent } from './utils/getselectedcontent';
import { injectSelectionPostFixer } from './utils/selection-post-fixer';
import { autoParagraphEmptyRoots } from './utils/autoparagraphing';

/**
 * The editor's data model. Holds the document, schema and markers, and runs change blocks.
 */
export class Model extends Observable {
  public readonly markers = new MarkerCollection();
  public readonly schema = new Schema();
  public readonly document: Document;
  /** @internal */
  public _currentWriter: Writer | null = null;
  private _pendingChanges: Array<{ batch: Batch; callback: (writer: Writer) => unknown }> = [];
  private _runningPendingChanges = false;

  constructor() {
    super();
    this.document = new Document(this);
    this.decorate('applyOperation');
    this.decorate('insertContent');
    this.decorate('insertObject');
    this.decorate('deleteContent');
    this.decorate('modifySelection');
    this.decorate('getSelectedContent');
    this.decorate('canEditAt');

    this.schema.register('$root', { isLimit: true });
    this.schema.register('$container', { allowIn: ['$root', '$container'] });
    this.schema.register('$block', { allowIn: ['$root', '$container'], isBlock: true });
    this.schema.register('$blockObject', { allowWhere: '$block', isBlock: true, isObject: true });
    this.schema.register('$inlineObject', { allowWhere: '$text', isInline: true, isObject: true });
    this.schema.register('$text', { allowIn: '$block', isInline: true, isContent: true });
    this.schema.register('$clipboardHolder', { allowContentOf: '$root', allowChildren: '$text', isLimit: true });
    this.schema.register('$documentFragment', { allowContentOf: '$root', allowChildren: '$text', isLimit: true });
    this.schema.register('$marker');
    this.schema.addChildCheck((context, childDefinition) => {
      if (childDefinition.name === '$marker') return true;
      return undefined;
    });

    injectSelectionPostFixer(this);
    this.document.registerPostFixer(autoParagraphEmptyRoots);

    this.on('applyOperation', (evt, args: [Operation]) => {
      const operation = args[0];
      operation._validate();
    }, { priority: 'highest' });
  }

  /** Runs the callback with a writer in a new (or the current) change block. */
  public change<T>(callback: (writer: Writer) => T): T {
    try {
      if (this._pendingChanges.length === 0) {
        this._pendingChanges.push({ batch: new Batch(), callback });
        return this._runPendingChanges()[0] as T;
      }
      return callback(this._currentWriter!);
    } catch (err) {
      throw err;
    }
  }

  /** Enqueues a change to be run after the current change block, in the given (or a new) batch. */
  public enqueueChange(batchOrType: Batch | BatchType | ((writer: Writer) => unknown) | undefined, callback?: (writer: Writer) => unknown): void {
    try {
      if (!batchOrType) {
        batchOrType = new Batch();
      } else if (typeof batchOrType === 'function') {
        callback = batchOrType;
        batchOrType = new Batch();
      } else if (!(batchOrType instanceof Batch)) {
        batchOrType = new Batch(batchOrType);
      }
      this._pendingChanges.push({ batch: batchOrType as Batch, callback: callback! });
      if (this._pendingChanges.length === 1) {
        this._runPendingChanges();
      }
    } catch (err) {
      throw err;
    }
  }

  /** Applies an operation. Decorated; do not call directly except from the writer. */
  public applyOperation(operation: Operation): void {
    operation._execute();
  }

  public insertContent(content: Item | DocumentFragment, selectable?: Selectable | DocumentSelection, placeOrOffset?: PositionOffset, ...rest: unknown[]): Range {
    return insertContent(this, content, selectable as any, placeOrOffset);
  }

  public insertObject(element: Element, selectable?: Selectable | DocumentSelection, placeOrOffset?: PositionOffset | null, options: { findOptimalPosition?: 'auto' | 'before' | 'after'; setSelection?: 'on' | 'after' } = {}): Range {
    return insertObject(this, element, selectable as any, placeOrOffset, options);
  }

  public deleteContent(selection: Selection | DocumentSelection, options?: DeleteContentOptions): void {
    deleteContent(this, selection, options);
  }

  public modifySelection(selection: Selection | DocumentSelection, options?: ModifySelectionOptions): void {
    modifySelection(this, selection, options);
  }

  public getSelectedContent(selection: Selection | DocumentSelection): DocumentFragment {
    return getSelectedContent(this, selection);
  }

  public hasContent(rangeOrElement: Range | Element | DocumentFragment, options: { ignoreWhitespaces?: boolean; ignoreMarkers?: boolean } = {}): boolean {
    const range = rangeOrElement instanceof Range ? rangeOrElement : Range._createIn(rangeOrElement);
    if (range.isCollapsed) return false;
    const { ignoreWhitespaces = false, ignoreMarkers = false } = options;
    if (!ignoreMarkers) {
      for (const intersectingMarker of this.markers.getMarkersIntersectingRange(range)) {
        if (intersectingMarker.affectsData) return true;
      }
    }
    for (const item of range.getItems()) {
      if (this.schema.isContent(item as any)) {
        if ((item as any).is('$textProxy')) {
          if (!ignoreWhitespaces) return true;
          if ((item as any).data.search(/\S/) !== -1) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  public canEditAt(selectable: Selectable | DocumentSelection): boolean {
    const selection = this.createSelection(selectable as any);
    for (const range of selection.getRanges()) {
      if ((range.root as any).rootName === '$graveyard') return false;
    }
    return true;
  }

  public createPositionFromPath(root: Element | DocumentFragment, path: number[], stickiness?: PositionStickiness): Position {
    return new Position(root, path, stickiness);
  }

  public createPositionAt(itemOrPosition: Item | Position | Element | DocumentFragment, offset?: PositionOffset): Position {
    return Position._createAt(itemOrPosition as any, offset);
  }

  public createPositionAfter(item: Item): Position {
    return Position._createAfter(item as any);
  }

  public createPositionBefore(item: Item): Position {
    return Position._createBefore(item as any);
  }

  public createRange(start: Position, end?: Position): Range {
    return new Range(start, end);
  }

  public createRangeIn(element: Element | DocumentFragment): Range {
    return Range._createIn(element);
  }

  public createRangeOn(item: Item): Range {
    return Range._createOn(item as any);
  }

  public createSelection(selectable?: Selectable | DocumentSelection, placeOrOffset?: any, options?: { backward?: boolean }): Selection {
    const selection = new Selection(selectable as any, placeOrOffset, options);
    (selection as any)._schema = this.schema;
    return selection;
  }

  public createBatch(type?: BatchType): Batch {
    return new Batch(type);
  }

  public createOperationFromJSON(json: any): Operation {
    return OperationFactory.fromJSON(json, this.document);
  }

  public destroy(): void {
    this.document.destroy();
    this.stopListening();
  }

  private _runPendingChanges(): unknown[] {
    const ret: unknown[] = [];
    this.fire('_beforeChanges');
    this._runningPendingChanges = true;
    try {
      while (this._pendingChanges.length) {
        const currentBatch = this._pendingChanges[0].batch;
        this._currentWriter = new Writer(this, currentBatch);
        const callbackReturnValue = this._pendingChanges[0].callback(this._currentWriter);
        ret.push(callbackReturnValue);
        this.document._handleChangeBlock(this._currentWriter);
        this._pendingChanges.shift();
        this._currentWriter = null;
      }
    } finally {
      this._pendingChanges.length = 0;
      this._currentWriter = null;
      this._runningPendingChanges = false;
      this.fire('_afterChanges');
    }
    return ret;
  }
}
