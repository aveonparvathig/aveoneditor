import { Text } from '../text';
import { TextProxy } from '../textproxy';
import { Range } from '../range';
import { Position } from '../position';
import type { Node } from '../node';
import type { Element } from '../element';
import type { DocumentFragment } from '../documentfragment';
import { DocumentFragment as DocFrag } from '../documentfragment';
import type { Item } from '../item';
import { isIterable } from '../../../utils/misc';

export type NodeSet = Item | string | Iterable<Item | string> | DocumentFragment;

/** Inserts nodes at the position, merging adjacent text nodes with equal attributes. */
export function _insert(position: Position, nodes: NodeSet): Range {
  const normalizedNodes = _normalizeNodes(nodes);
  const offset = normalizedNodes.reduce((sum, node) => sum + node.offsetSize, 0);
  const parent = position.parent;
  _splitNodeAtPosition(position);
  const index = position.index;
  parent._insertChild(index, normalizedNodes);
  _mergeNodesAtIndex(parent, index + normalizedNodes.length);
  _mergeNodesAtIndex(parent, index);
  return new Range(position, position.getShiftedBy(offset));
}

/** Removes nodes in the flat range. */
export function _remove(range: Range): Node[] {
  if (!range.isFlat) throw new Error('operation-utils-remove-range-not-flat');
  const parent = range.start.parent;
  _splitNodeAtPosition(range.start);
  _splitNodeAtPosition(range.end);
  const removed = parent._removeChildren(range.start.index, range.end.index - range.start.index);
  _mergeNodesAtIndex(parent, range.start.index);
  return removed;
}

/** Moves nodes in the flat range to the target position. */
export function _move(sourceRange: Range, targetPosition: Position): Range {
  if (!sourceRange.isFlat) throw new Error('operation-utils-move-range-not-flat');
  const nodes = _remove(sourceRange);
  targetPosition = targetPosition._getTransformedByDeletion(sourceRange.start, sourceRange.end.offset - sourceRange.start.offset)!;
  return _insert(targetPosition, nodes);
}

/** Sets (or removes when value is null) an attribute on all nodes in the range. */
export function _setAttribute(range: Range, key: string, value: unknown): void {
  _splitNodeAtPosition(range.start);
  _splitNodeAtPosition(range.end);
  for (const item of range.getItems({ shallow: true })) {
    const node = item instanceof TextProxy ? item.textNode : (item as Node);
    if (value !== null && value !== undefined) {
      node._setAttribute(key, value);
    } else {
      node._removeAttribute(key);
    }
    _mergeNodesAtIndex(node.parent as Element, node.index!);
  }
  _mergeNodesAtIndex(range.end.parent, range.end.index);
}

/** Converts various inputs to an array of nodes. */
export function _normalizeNodes(nodes: NodeSet): Node[] {
  const normalized: Node[] = [];
  if (!(nodes instanceof Array) && !isIterable(nodes) || typeof nodes === 'string') {
    nodes = [nodes as any];
  }
  if (nodes instanceof DocFrag) {
    nodes = Array.from(nodes.getChildren());
  }
  for (let i = 0; i < (nodes as any[]).length; i++) {
    const node = (nodes as any[])[i];
    if (typeof node === 'string') {
      normalized.push(new Text(node));
    } else if (node instanceof TextProxy) {
      normalized.push(new Text(node.data, node.getAttributes()));
    } else if (node instanceof DocFrag) {
      for (const child of node.getChildren()) normalized.push(child);
    } else {
      normalized.push(node);
    }
  }
  // Merge adjacent text nodes with the same attributes.
  for (let i = 1; i < normalized.length; i++) {
    const node = normalized[i];
    const prev = normalized[i - 1];
    if (node instanceof Text && prev instanceof Text && _haveSameAttributes(node, prev)) {
      normalized.splice(i - 1, 2, new Text(prev.data + node.data, prev.getAttributes()));
      i--;
    }
  }
  return normalized;
}

function _mergeNodesAtIndex(element: Element | DocumentFragment, index: number): void {
  const nodeBefore = element.getChild(index - 1);
  const nodeAfter = element.getChild(index);
  if (nodeBefore instanceof Text && nodeAfter instanceof Text && _haveSameAttributes(nodeBefore, nodeAfter)) {
    const mergedNode = new Text(nodeBefore.data + nodeAfter.data, nodeBefore.getAttributes());
    element._removeChildren(index - 1, 2);
    element._insertChild(index - 1, mergedNode);
  }
}

function _splitNodeAtPosition(position: Position): void {
  const textNode = position.textNode;
  const element = position.parent;
  if (textNode) {
    const offsetDiff = position.offset - textNode.startOffset!;
    const index = textNode.index!;
    element._removeChildren(index, 1);
    const firstPart = new Text(textNode.data.substr(0, offsetDiff), textNode.getAttributes());
    const secondPart = new Text(textNode.data.substr(offsetDiff), textNode.getAttributes());
    element._insertChild(index, [firstPart, secondPart]);
  }
}

function _haveSameAttributes(nodeA: Node, nodeB: Node): boolean {
  const iteratorA = nodeA.getAttributes()[Symbol.iterator]();
  const iteratorB = nodeB.getAttributes()[Symbol.iterator]();
  for (;;) {
    const stepA = iteratorA.next();
    const stepB = iteratorB.next();
    if (stepA.done !== stepB.done) return false;
    if (stepA.done) return true;
    if (stepA.value[0] !== stepB.value[0] || stepA.value[1] !== stepB.value[1]) return false;
  }
}
