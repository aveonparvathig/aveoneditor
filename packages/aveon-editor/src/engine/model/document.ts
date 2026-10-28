import { Emitter } from '../../utils/emitter';
import { Collection } from '../../utils/collection';
import { RootElement } from './rootelement';
import { DocumentSelection } from './documentselection';
import { History } from './history';
import { Differ } from './differ';
import { Range } from './range';
import { Position } from './position';
import { Element } from './element';
import type { Model } from './model';
import type { Writer } from './writer';
import type { Batch } from './batch';
import type { Operation } from './operation/operation';

export type PostFixer = (writer: Writer) => boolean | void;

const graveyardName = '$graveyard';

/**
 * The model document: roots, selection, history and post-fixers.
 */
export class Document extends Emitter {
  public readonly model: Model;
  public readonly history = new History();
  public readonly selection: DocumentSelection;
  public readonly roots = new Collection<RootElement>({ idProperty: 'rootName' });
  public readonly differ: Differ;
  private _postFixers = new Set<PostFixer>();
  private _hasSelectionChangedFromTheLastChangeBlock = false;
  private _isChangeBlockInProgress = false;

  constructor(model: Model) {
    super();
    this.model = model;
    this.differ = new Differ(model.markers);
    this.createRoot('$root', graveyardName);
    this.selection = new DocumentSelection(this);

    this.listenTo(model, 'applyOperation', (evt, args: [Operation]) => {
      const operation = args[0];
      if (operation.isDocumentOperation) {
        this.differ.bufferOperation(operation);
      }
    }, { priority: 'high' });

    this.listenTo(model, 'applyOperation', (evt, args: [Operation]) => {
      const operation = args[0];
      if (operation.isDocumentOperation) {
        this.history.addOperation(operation);
      }
    }, { priority: 'low' });

    this.listenTo(this.selection, 'change', () => {
      this._hasSelectionChangedFromTheLastChangeBlock = true;
    });

    this.listenTo(model.markers, 'update', (evt, marker, oldRange, newRange, oldMarkerData) => {
      this.differ.bufferMarkerChange(marker.name, oldMarkerData, marker.getData());
      if (oldRange === null) {
        marker.on('change', (evt2: any, oldRange2: Range) => {
          this.differ.bufferMarkerChange(marker.name, { ...marker.getData(), range: oldRange2 }, marker.getData());
        });
      }
    });

    this.registerPostFixer(writer => {
      const sel = this.selection as any;
      const live = sel._selection;
      live._fixSelectionAfterChange();
      return false;
    });
  }

  public get version(): number {
    return this.history.version;
  }

  public set version(version: number) {
    this.history.version = version;
  }

  public get graveyard(): RootElement {
    return this.getRoot(graveyardName)!;
  }

  public createRoot(elementName = '$root', rootName = 'main'): RootElement {
    if (this.roots.get(rootName)) {
      throw new Error(`model-document-createroot-name-exists: Root "${rootName}" already exists.`);
    }
    const root = new RootElement(this, elementName, rootName);
    this.roots.add(root);
    return root;
  }

  public destroy(): void {
    this.selection.destroy();
    this.stopListening();
  }

  public getRoot(name = 'main'): RootElement | null {
    return this.roots.get(name);
  }

  public getRootNames(includeDetached = false): string[] {
    return Array.from(this.roots)
      .filter(root => root !== this.graveyard && (includeDetached || root.isAttached()))
      .map(root => root.rootName);
  }

  public getRoots(includeDetached = false): RootElement[] {
    return Array.from(this.roots).filter(root => root !== this.graveyard && (includeDetached || root.isAttached()));
  }

  public registerPostFixer(postFixer: PostFixer): void {
    this._postFixers.add(postFixer);
  }

  public toJSON(): unknown {
    return { roots: Array.from(this.roots).map(root => root.toJSON()) };
  }

  /** @internal */
  public _handleChangeBlock(writer: Writer): void {
    if (this._hasDocumentChangedFromTheLastChangeBlock()) {
      this._callPostFixers(writer);
      this.selection.refresh();
      if (this.differ.hasDataChanges()) {
        this.fire('change:data', writer.batch);
      } else {
        this.fire('change', writer.batch);
      }
      this.differ.reset();
    }
    this._hasSelectionChangedFromTheLastChangeBlock = false;
  }

  /** @internal */
  public _hasDocumentChangedFromTheLastChangeBlock(): boolean {
    return !this.differ.isEmpty || this._hasSelectionChangedFromTheLastChangeBlock;
  }

  /** @internal */
  public _getDefaultRoot(): RootElement {
    const roots = this.getRoots();
    return roots.length ? roots[0] : this.graveyard;
  }

  /** @internal */
  public _getDefaultRange(): Range {
    const defaultRoot = this._getDefaultRoot();
    const model = this.model;
    const schema = model.schema;
    const position = model.createPositionFromPath(defaultRoot, [0]);
    const nearestRange = schema.getNearestSelectionRange(position);
    return nearestRange || model.createRange(position);
  }

  /** @internal */
  public _validateSelectionRange(range: Range): boolean {
    return validateTextNodePosition(range.start) && validateTextNodePosition(range.end);
  }

  private _callPostFixers(writer: Writer): void {
    let wasFixed = false;
    let guard = 0;
    do {
      wasFixed = false;
      for (const callback of this._postFixers) {
        this.selection.refresh();
        const result = callback(writer);
        if (result) {
          wasFixed = true;
          break;
        }
      }
    } while (wasFixed && guard++ < 100);
  }
}

function validateTextNodePosition(rangeBoundary: Position): boolean {
  const textNode = rangeBoundary.textNode;
  if (textNode) {
    const data = textNode.data;
    const offset = rangeBoundary.offset - textNode.startOffset!;
    return !isInsideSurrogatePair(data, offset) && !isInsideCombinedSymbol(data, offset);
  }
  return true;
}

function isInsideSurrogatePair(data: string, offset: number): boolean {
  const high = data.charCodeAt(offset - 1);
  const low = data.charCodeAt(offset);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

function isInsideCombinedSymbol(data: string, offset: number): boolean {
  const code = data.charCodeAt(offset);
  return code >= 0x0300 && code <= 0x036f;
}

export { Element };
