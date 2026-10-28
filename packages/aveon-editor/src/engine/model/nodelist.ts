import type { Node } from './node';

/** Ordered list of nodes that tracks offsets. */
export class NodeList implements Iterable<Node> {
  private _nodes: Node[] = [];
  private _offsetToNode: number[] = [];

  constructor(nodes?: Iterable<Node>) {
    if (nodes) this._insertNodes(0, nodes);
  }

  public [Symbol.iterator](): Iterator<Node> {
    return this._nodes[Symbol.iterator]();
  }

  public get length(): number {
    return this._nodes.length;
  }

  public get maxOffset(): number {
    return this._offsetToNode.length;
  }

  public getNode(index: number): Node | null {
    return this._nodes[index] || null;
  }

  public getNodeAtOffset(offset: number): Node | null {
    return this._nodes[this._offsetToNode[offset]] || null;
  }

  public getNodeIndex(node: Node): number | null {
    const index = this._nodes.indexOf(node);
    return index === -1 ? null : index;
  }

  public getNodeStartOffset(node: Node): number | null {
    const index = this.getNodeIndex(node);
    return index === null ? null : this.indexToOffset(index);
  }

  public indexToOffset(index: number): number {
    if (index === this._nodes.length) return this.maxOffset;
    const node = this._nodes[index];
    if (!node) throw new Error('model-nodelist-index-out-of-bounds');
    let offset = 0;
    for (let i = 0; i < index; i++) offset += this._nodes[i].offsetSize;
    return offset;
  }

  public offsetToIndex(offset: number): number {
    if (offset === this.maxOffset) return this._nodes.length;
    const index = this._offsetToNode[offset];
    if (index === undefined) throw new Error('model-nodelist-offset-out-of-bounds');
    return index;
  }

  /** @internal */
  public _insertNodes(index: number, nodes: Iterable<Node>): void {
    const arr = [...nodes];
    for (const node of arr) {
      if (!node || typeof (node as any).offsetSize !== 'number') throw new Error('model-nodelist-insertnodes-not-node');
    }
    this._nodes.splice(index, 0, ...arr);
    this._rebuildOffsets();
  }

  /** @internal */
  public _removeNodes(indexStart: number, howMany = 1): Node[] {
    const removed = this._nodes.splice(indexStart, howMany);
    this._rebuildOffsets();
    return removed;
  }

  public toJSON(): unknown[] {
    return this._nodes.map(node => node.toJSON());
  }

  private _rebuildOffsets(): void {
    const map: number[] = [];
    for (let i = 0; i < this._nodes.length; i++) {
      const size = this._nodes[i].offsetSize;
      for (let j = 0; j < size; j++) map.push(i);
    }
    this._offsetToNode = map;
  }
}
