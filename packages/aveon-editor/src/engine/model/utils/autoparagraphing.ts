import type { Writer } from '../writer';
import type { Position } from '../position';
import type { Element } from '../element';
import type { Schema } from '../schema';
import type { Node } from '../node';

/** Post-fixer: ensures every attached root has at least one block. */
export function autoParagraphEmptyRoots(writer: Writer): boolean {
  const { schema, document } = writer.model;
  for (const root of document.getRoots()) {
    if (root.isEmpty && !schema.checkChild(root, '$text')) {
      if (schema.checkChild(root, 'paragraph')) {
        writer.insertElement('paragraph', root);
        return true;
      }
    }
  }
  return false;
}

/** Wraps the node in a paragraph if it is not allowed at the position but a paragraph is. */
export function wrapInParagraph(position: Position, writer: Writer): Position {
  const paragraph = writer.createElement('paragraph');
  writer.insert(paragraph, position);
  return writer.createPositionAt(paragraph, 0);
}

export function isParagraphable(position: Position, nodeOrType: Node | string, schema: Schema): boolean {
  const context = schema.createContext(position);
  if (!schema.checkChild(context, 'paragraph')) return false;
  if (!schema.checkChild(context.push('paragraph'), nodeOrType as any)) return false;
  return true;
}

export type { Element };
