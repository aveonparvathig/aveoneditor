import { Operation } from './operation';
import { Position } from '../position';
import { Element } from '../element';
import type { Document } from '../document';

/** Renames an element. */
export class RenameOperation extends Operation {
  public readonly position: Position;
  public readonly oldName: string;
  public readonly newName: string;

  constructor(position: Position, oldName: string, newName: string, baseVersion: number | null) {
    super(baseVersion);
    this.position = position.clone();
    this.position.stickiness = 'toNext';
    this.oldName = oldName;
    this.newName = newName;
  }

  public get type(): string {
    return 'rename';
  }

  public override clone(): RenameOperation {
    return new RenameOperation(this.position, this.oldName, this.newName, this.baseVersion);
  }

  public override getReversed(): RenameOperation {
    return new RenameOperation(this.position, this.newName, this.oldName, this.baseVersion! + 1);
  }

  public override _validate(): void {
    const element = this.position.nodeAfter;
    if (!(element instanceof Element)) throw new Error('rename-operation-wrong-position');
    if (element.name !== this.oldName) throw new Error('rename-operation-wrong-name');
  }

  public override _execute(): void {
    const element = this.position.nodeAfter as Element;
    element.name = this.newName;
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.position = this.position.toJSON();
    json.oldName = this.oldName;
    json.newName = this.newName;
    return json;
  }

  public static get className(): string {
    return 'RenameOperation';
  }

  public static override fromJSON(json: any, document: Document): RenameOperation {
    return new RenameOperation(Position.fromJSON(json.position, document), json.oldName, json.newName, json.baseVersion);
  }
}
