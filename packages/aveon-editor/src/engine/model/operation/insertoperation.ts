import { Operation } from './operation';
import { Position } from '../position';
import { NodeList } from '../nodelist';
import { MoveOperation } from './moveoperation';
import { _insert, _normalizeNodes, type NodeSet } from './utils';
import { Element } from '../element';
import { Text } from '../text';
import type { Document } from '../document';
import type { Node } from '../node';

/** Inserts nodes at a position. */
export class InsertOperation extends Operation {
  public readonly position: Position;
  public nodes: NodeList;
  public shouldReceiveAttributes = false;

  constructor(position: Position, nodes: NodeSet, baseVersion: number | null) {
    super(baseVersion);
    this.position = position.clone();
    this.position.stickiness = 'toNone';
    this.nodes = new NodeList(_normalizeNodes(nodes));
  }

  public get type(): string {
    return 'insert';
  }

  public get howMany(): number {
    return this.nodes.maxOffset;
  }

  public override clone(): InsertOperation {
    const nodes = Array.from(this.nodes).map(node => node._clone(true));
    const insert = new InsertOperation(this.position, nodes, this.baseVersion);
    insert.shouldReceiveAttributes = this.shouldReceiveAttributes;
    return insert;
  }

  public override getReversed(): MoveOperation {
    const graveyard = (this.position.root as any).document.graveyard;
    const gyPosition = new Position(graveyard, [0]);
    return new MoveOperation(this.position, this.nodes.maxOffset, gyPosition, this.baseVersion! + 1);
  }

  public override _validate(): void {
    const targetElement = this.position.parent;
    if (!targetElement || targetElement.maxOffset < this.position.offset) {
      throw new Error('insert-operation-position-invalid');
    }
  }

  public override _execute(): void {
    const originalNodes = this.nodes;
    this.nodes = new NodeList(Array.from(originalNodes).map(node => node._clone(true)));
    _insert(this.position, Array.from(originalNodes) as Node[]);
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.position = this.position.toJSON();
    json.nodes = this.nodes.toJSON();
    json.shouldReceiveAttributes = this.shouldReceiveAttributes;
    return json;
  }

  public static get className(): string {
    return 'InsertOperation';
  }

  public static override fromJSON(json: any, document: Document): InsertOperation {
    const children: Node[] = [];
    for (const child of json.nodes) {
      children.push(child.name ? Element.fromJSON(child) : Text.fromJSON(child));
    }
    const insert = new InsertOperation(Position.fromJSON(json.position, document), children, json.baseVersion);
    insert.shouldReceiveAttributes = json.shouldReceiveAttributes;
    return insert;
  }
}
