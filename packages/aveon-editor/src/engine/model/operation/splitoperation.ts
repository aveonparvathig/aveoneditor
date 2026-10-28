import { Operation } from './operation';
import { Position } from '../position';
import { Range } from '../range';
import { MergeOperation } from './mergeoperation';
import { _insert, _move } from './utils';
import type { Element } from '../element';
import type { Document } from '../document';

/** Splits an element at a position; the part after the position moves into a new element inserted right after. */
export class SplitOperation extends Operation {
  public splitPosition: Position;
  public howMany: number;
  public insertionPosition: Position;
  public graveyardPosition: Position | null;

  constructor(splitPosition: Position, howMany: number, insertionPosition: Position, graveyardPosition: Position | null, baseVersion: number | null) {
    super(baseVersion);
    this.splitPosition = splitPosition.clone();
    this.splitPosition.stickiness = 'toNext';
    this.howMany = howMany;
    this.insertionPosition = insertionPosition;
    this.graveyardPosition = graveyardPosition ? graveyardPosition.clone() : null;
    if (this.graveyardPosition) this.graveyardPosition.stickiness = 'toNext';
  }

  public get type(): string {
    return 'split';
  }

  public get moveTargetPosition(): Position {
    const path = this.insertionPosition.path.slice();
    path.push(0);
    return new Position(this.insertionPosition.root, path);
  }

  public get movedRange(): Range {
    const end = this.splitPosition.getShiftedBy(Number.POSITIVE_INFINITY);
    return new Range(this.splitPosition, end);
  }

  public override clone(): SplitOperation {
    return new SplitOperation(this.splitPosition, this.howMany, this.insertionPosition, this.graveyardPosition, this.baseVersion);
  }

  public override getReversed(): MergeOperation {
    const graveyard = (this.splitPosition.root as any).document.graveyard;
    const graveyardPosition = new Position(graveyard, [0]);
    return new MergeOperation(this.moveTargetPosition, this.howMany, this.splitPosition, graveyardPosition, this.baseVersion! + 1);
  }

  public override _validate(): void {
    const element = this.splitPosition.parent;
    const offset = this.splitPosition.offset;
    if (!element || element.maxOffset < offset) throw new Error('split-operation-position-invalid');
    if (!element.parent) throw new Error('split-operation-split-in-root');
    if (this.howMany !== element.maxOffset - this.splitPosition.offset) throw new Error('split-operation-how-many-invalid');
    if (this.graveyardPosition && !this.graveyardPosition.nodeAfter) throw new Error('split-operation-graveyard-position-invalid');
  }

  public override _execute(): void {
    const splitElement = this.splitPosition.parent as Element;
    if (this.graveyardPosition) {
      _move(Range._createFromPositionAndShift(this.graveyardPosition, 1), this.insertionPosition);
    } else {
      const newElement = splitElement._clone();
      _insert(this.insertionPosition, newElement);
    }
    const sourceRange = new Range(Position._createAt(splitElement, this.splitPosition.offset), Position._createAt(splitElement, 'end'));
    _move(sourceRange, this.moveTargetPosition);
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.splitPosition = this.splitPosition.toJSON();
    json.howMany = this.howMany;
    json.insertionPosition = this.insertionPosition.toJSON();
    json.graveyardPosition = this.graveyardPosition ? this.graveyardPosition.toJSON() : null;
    return json;
  }

  public static get className(): string {
    return 'SplitOperation';
  }

  public static getInsertionPosition(splitPosition: Position): Position {
    const path = splitPosition.path.slice(0, -1);
    path[path.length - 1]++;
    return new Position(splitPosition.root, path, 'toPrevious');
  }

  public static override fromJSON(json: any, document: Document): SplitOperation {
    const splitPosition = Position.fromJSON(json.splitPosition, document);
    const insertionPosition = Position.fromJSON(json.insertionPosition, document);
    const graveyardPosition = json.graveyardPosition ? Position.fromJSON(json.graveyardPosition, document) : null;
    return new SplitOperation(splitPosition, json.howMany, insertionPosition, graveyardPosition, json.baseVersion);
  }
}
