import { DocumentFragment } from '../documentfragment';
import { Element } from '../element';
import { LivePosition } from '../liveposition';
import { LiveRange } from '../liverange';
import { Position, type PositionOffset } from '../position';
import { Range } from '../range';
import { Text } from '../text';
import { DocumentSelection } from '../documentselection';
import { Selection, type Selectable } from '../selection';
import type { Model } from '../model';
import type { Writer } from '../writer';
import type { Schema } from '../schema';
import type { Node } from '../node';
import type { Item } from '../item';

/**
 * Inserts content at the selection, splitting and merging blocks as needed, and
 * returns the range of the inserted content.
 */
export function insertContent(model: Model, content: Item | DocumentFragment, selectable?: Selectable | DocumentSelection, placeOrOffset?: PositionOffset): Range {
  return model.change(writer => {
    let selection: Selection | DocumentSelection;
    if (!selectable) {
      selection = model.document.selection;
    } else if (selectable instanceof Selection || selectable instanceof DocumentSelection) {
      selection = selectable;
    } else {
      selection = writer.createSelection(selectable as any, placeOrOffset);
    }

    const insertionPosition = selection.getFirstPosition()!;
    if ((insertionPosition.root as any).rootName === '$graveyard') {
      return writer.createRange(insertionPosition);
    }

    if (!selection.isCollapsed) {
      model.deleteContent(selection, { doNotAutoparagraph: true });
    }

    const insertion = new Insertion(model, writer, selection.anchor!);
    const fakeMarkerElements = [] as any[];
    void fakeMarkerElements;

    let nodesToInsert: Iterable<Node>;
    if (content instanceof DocumentFragment) {
      nodesToInsert = content.getChildren();
    } else {
      nodesToInsert = [content as Node];
    }
    insertion.handleNodes(nodesToInsert);

    const newRange = insertion.getSelectionRange();
    if (newRange) {
      if (selection instanceof DocumentSelection) {
        writer.setSelection(newRange);
      } else {
        selection.setTo(newRange);
      }
    }
    const affectedRange = insertion.getAffectedRange() || model.createRange(insertionPosition);
    insertion.destroy();
    return affectedRange;
  });
}

class Insertion {
  public readonly model: Model;
  public readonly writer: Writer;
  public position: Position;
  public canMergeWith = new Set<any>();
  public schema: Schema;
  private _documentFragment: DocumentFragment;
  private _documentFragmentPosition: Position;
  private _firstNode: Node | null = null;
  private _lastNode: Node | null = null;
  private _lastAutoParagraph: Element | null = null;
  private _filterAttributesOf: Node[] = [];
  private _affectedStart: LivePosition | null = null;
  private _affectedEnd: LivePosition | null = null;
  private _nodeToSelect: Element | null = null;

  constructor(model: Model, writer: Writer, position: Position) {
    this.model = model;
    this.writer = writer;
    this.position = position;
    this.canMergeWith = new Set([this.position.parent]);
    this.schema = model.schema;
    this._documentFragment = writer.createDocumentFragment();
    this._documentFragmentPosition = writer.createPositionAt(this._documentFragment, 0);
  }

  public handleNodes(nodes: Iterable<Node>): void {
    for (const node of Array.from(nodes)) {
      this._handleNode(node);
    }
    this._insertPartialFragment();
    if (this._lastAutoParagraph) {
      this._updateLastNodeFromAutoParagraph(this._lastAutoParagraph);
    }
    this._mergeOnRight();
    this.schema.removeDisallowedAttributes(this._filterAttributesOf, this.writer);
    this._filterAttributesOf = [];
  }

  public getSelectionRange(): Range | null {
    if (this._nodeToSelect) return Range._createOn(this._nodeToSelect);
    return this.model.schema.getNearestSelectionRange(this.position);
  }

  public getAffectedRange(): Range | null {
    if (!this._affectedStart) return null;
    return new Range(this._affectedStart, this._affectedEnd!);
  }

  public destroy(): void {
    if (this._affectedStart) this._affectedStart.detach();
    if (this._affectedEnd) this._affectedEnd.detach();
  }

  private _updateLastNodeFromAutoParagraph(node: Node): void {
    const positionAfterLastNode = this.writer.createPositionAfter(this._lastNode!);
    const positionAfterNode = this.writer.createPositionAfter(node);
    if (positionAfterNode.isAfter(positionAfterLastNode)) {
      this._lastNode = node;
      if (this.position.parent !== node || !this.position.isAtEnd) {
        throw new Error('insertcontent-invalid-insertion-position');
      }
      this.position = positionAfterNode;
      this._setAffectedBoundaries(this.position);
    }
  }

  private _handleNode(node: Node): void {
    if (this.schema.isObject(node as any)) {
      this._handleObject(node as Element);
      return;
    }
    const isAllowed = this._checkAndSplitToAllowedPosition(node);
    if (!isAllowed) {
      this._handleDisallowedNode(node);
      return;
    }
    this._appendToFragment(node);
    if (!this._firstNode) this._firstNode = node;
    this._lastNode = node;
  }

  private _insertPartialFragment(): void {
    if (this._documentFragment.isEmpty) return;
    const livePosition = LivePosition.fromPosition(this.position, 'toNext');
    this._setAffectedBoundaries(this.position);

    if (this._documentFragment.getChild(0) === this._firstNode) {
      this.writer.insert(this._firstNode!, this.position);
      this._mergeOnLeft();
      this.position = livePosition.toPosition();
    }
    if (!this._documentFragment.isEmpty) {
      this.writer.insert(this._documentFragment, this.position);
    }
    this._documentFragmentPosition = this.writer.createPositionAt(this._documentFragment, 0);
    this.position = livePosition.toPosition();
    livePosition.detach();
  }

  private _handleObject(node: Element): void {
    if (this._checkAndSplitToAllowedPosition(node)) {
      this._appendToFragment(node);
    } else {
      this._tryAutoparagraphing(node);
    }
  }

  private _handleDisallowedNode(node: Node): void {
    if (node instanceof Element) {
      this.handleNodes(node.getChildren());
    } else {
      this._tryAutoparagraphing(node);
    }
  }

  private _appendToFragment(node: Node): void {
    if (!this.schema.checkChild(this.position, node)) {
      throw new Error('insertcontent-wrong-position');
    }
    this.writer.insert(node, this._documentFragmentPosition);
    this._documentFragmentPosition = this._documentFragmentPosition.getShiftedBy(node.offsetSize);
    this._filterAttributesOf.push(node);
  }

  private _setAffectedBoundaries(position: Position): void {
    if (!this._affectedStart) {
      this._affectedStart = LivePosition.fromPosition(position, 'toPrevious');
    }
    if (!this._affectedEnd || this._affectedEnd.isBefore(position)) {
      if (this._affectedEnd) this._affectedEnd.detach();
      this._affectedEnd = LivePosition.fromPosition(position, 'toNext');
    }
  }

  private _mergeOnLeft(): void {
    const node = this._firstNode;
    if (!(node instanceof Element)) return;
    if (!this._canMergeLeft(node)) return;
    const mergePosLeft = LivePosition._createBefore(node) as LivePosition;
    mergePosLeft.stickiness = 'toNext';

    const livePosition = LivePosition.fromPosition(this.position, 'toNext');
    if (this._affectedStart!.isEqual(mergePosLeft)) {
      this._affectedStart!.detach();
      this._affectedStart = LivePosition._createAt(mergePosLeft.nodeBefore!, 'end', 'toPrevious') as LivePosition;
    }
    if (this._firstNode === this._lastNode) {
      this._firstNode = mergePosLeft.nodeBefore;
      this._lastNode = mergePosLeft.nodeBefore;
    }
    this.writer.merge(mergePosLeft);
    if (mergePosLeft.isEqual(this._affectedEnd!) && this._firstNode === this._lastNode) {
      this._affectedEnd!.detach();
      this._affectedEnd = LivePosition._createAt(mergePosLeft.nodeBefore!, 'end', 'toNext') as LivePosition;
    }
    this.position = livePosition.toPosition();
    livePosition.detach();
    this._filterAttributesOf.push(this.position.parent as Element);
    mergePosLeft.detach();
  }

  private _mergeOnRight(): void {
    const node = this._lastNode;
    if (!(node instanceof Element)) return;
    if (!this._canMergeRight(node)) return;
    const mergePosRight = LivePosition._createAfter(node) as LivePosition;
    mergePosRight.stickiness = 'toNext';

    if (!this.position.isEqual(mergePosRight)) {
      throw new Error('insertcontent-invalid-insertion-position');
    }
    this.position = Position._createAt(mergePosRight.nodeBefore!, 'end');
    const livePosition = LivePosition.fromPosition(this.position, 'toPrevious');
    if (this._affectedEnd!.isEqual(mergePosRight)) {
      this._affectedEnd!.detach();
      this._affectedEnd = LivePosition._createAt(mergePosRight.nodeBefore!, 'end', 'toNext') as LivePosition;
    }
    if (this._firstNode === this._lastNode) {
      this._firstNode = mergePosRight.nodeBefore;
      this._lastNode = mergePosRight.nodeBefore;
    }
    this.writer.merge(mergePosRight);
    if (mergePosRight.getShiftedBy(-1).isEqual(this._affectedStart!) && this._firstNode === this._lastNode) {
      this._affectedStart!.detach();
      this._affectedStart = LivePosition._createAt(mergePosRight.nodeBefore!, 0, 'toPrevious') as LivePosition;
    }
    this.position = livePosition.toPosition();
    livePosition.detach();
    this._filterAttributesOf.push(this.position.parent as Element);
    mergePosRight.detach();
  }

  private _canMergeLeft(node: Element): boolean {
    const previousSibling = node.previousSibling;
    return previousSibling instanceof Element && this.canMergeWith.has(previousSibling) && this.model.schema.checkMerge(previousSibling, node);
  }

  private _canMergeRight(node: Element): boolean {
    const nextSibling = node.nextSibling;
    return nextSibling instanceof Element && this.canMergeWith.has(nextSibling) && this.model.schema.checkMerge(node, nextSibling);
  }

  private _tryAutoparagraphing(node: Node): void {
    const paragraph = this.writer.createElement('paragraph');
    if (!this._getAllowedIn(this.position.parent as Element, paragraph)) return;
    if (!this.schema.checkChild(paragraph, node)) return;
    paragraph._appendChild(node);
    this._handleNode(paragraph);
  }

  private _checkAndAutoParagraphToAllowedPosition(node: Node): boolean {
    if (this.schema.checkChild(this.position.parent as Element, node)) return true;
    if (!this.schema.checkChild(this.position.parent as Element, 'paragraph') || !this.schema.checkChild('paragraph', node)) {
      return false;
    }
    this._insertPartialFragment();
    const paragraph = this.writer.createElement('paragraph');
    this.writer.insert(paragraph, this.position);
    this._setAffectedBoundaries(this.position);
    this._lastAutoParagraph = paragraph;
    this.position = this.writer.createPositionAt(paragraph, 0);
    return true;
  }

  private _checkAndSplitToAllowedPosition(node: Node): boolean {
    const allowedIn = this._getAllowedIn(this.position.parent as Element, node);
    if (!allowedIn) return false;
    if (allowedIn !== this.position.parent) {
      this._insertPartialFragment();
    }
    while (allowedIn !== this.position.parent) {
      if (this.position.isAtStart) {
        const parent = this.position.parent as Element;
        this.position = this.writer.createPositionBefore(parent);
        if (parent.isEmpty && parent.parent === allowedIn) {
          this.writer.remove(parent);
        }
      } else if (this.position.isAtEnd) {
        this.position = this.writer.createPositionAfter(this.position.parent as Element);
      } else {
        const tempPos = this.writer.createPositionAfter(this.position.parent as Element);
        this._setAffectedBoundaries(this.position);
        this.writer.split(this.position);
        this.position = tempPos;
        this.canMergeWith.add(this.position.nodeAfter);
      }
    }
    return true;
  }

  private _getAllowedIn(contextElement: Element, node: Node): Element | null {
    if (this.schema.checkChild(contextElement, node)) return contextElement;
    if (this.schema.isLimit(contextElement)) return null;
    return this._getAllowedIn(contextElement.parent as Element, node);
  }
}

export { Text, LiveRange };
