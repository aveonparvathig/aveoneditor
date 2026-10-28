import { Emitter } from '../../utils/emitter';
import { Selection, type Selectable, type SelectionOptions } from './selection';
import type { Position, PositionOffset } from './position';
import type { Range } from './range';
import type { Element } from './element';
import type { EditableElement } from './editableelement';
import type { Item } from './item';
import type { DocumentFragment } from './documentfragment';

/** The view document selection (read-only wrapper around a selection). */
export class DocumentSelection extends Emitter {
  private _selection: Selection;

  constructor(selectable?: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | SelectionOptions, options?: SelectionOptions) {
    super();
    this._selection = new Selection();
    this._selection.delegate('change').to(this);
    if (selectable) this._selection.setTo(selectable, placeOrOffset, options);
  }

  public get isFake(): boolean {
    return this._selection.isFake;
  }

  public get fakeSelectionLabel(): string {
    return this._selection.fakeSelectionLabel;
  }

  public get anchor(): Position | null {
    return this._selection.anchor;
  }

  public get focus(): Position | null {
    return this._selection.focus;
  }

  public get isCollapsed(): boolean {
    return this._selection.isCollapsed;
  }

  public get rangeCount(): number {
    return this._selection.rangeCount;
  }

  public get isBackward(): boolean {
    return this._selection.isBackward;
  }

  public get editableElement(): EditableElement | null {
    return this._selection.editableElement;
  }

  /** @internal */
  public get _ranges(): Range[] {
    return (this._selection as any)._ranges;
  }

  public getRanges(): IterableIterator<Range> {
    return this._selection.getRanges();
  }

  public getFirstRange(): Range | null {
    return this._selection.getFirstRange();
  }

  public getLastRange(): Range | null {
    return this._selection.getLastRange();
  }

  public getFirstPosition(): Position | null {
    return this._selection.getFirstPosition();
  }

  public getLastPosition(): Position | null {
    return this._selection.getLastPosition();
  }

  public getSelectedElement(): Element | null {
    return this._selection.getSelectedElement();
  }

  public isEqual(otherSelection: Selection | DocumentSelection): boolean {
    return this._selection.isEqual(otherSelection instanceof DocumentSelection ? otherSelection._selection : otherSelection);
  }

  public isSimilar(otherSelection: Selection | DocumentSelection): boolean {
    return this._selection.isSimilar(otherSelection instanceof DocumentSelection ? otherSelection._selection : otherSelection);
  }

  public is(type: string): boolean {
    return type === 'selection' || type === 'view:selection' || type === 'documentSelection' || type === 'view:documentSelection';
  }

  /** @internal */
  public _setTo(selectable: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | SelectionOptions, options?: SelectionOptions): void {
    this._selection.setTo(selectable instanceof DocumentSelection ? selectable._selection : selectable, placeOrOffset, options);
  }

  /** @internal */
  public _setFocus(itemOrPosition: Item | Position | DocumentFragment, offset?: PositionOffset): void {
    this._selection.setFocus(itemOrPosition, offset);
  }
}
