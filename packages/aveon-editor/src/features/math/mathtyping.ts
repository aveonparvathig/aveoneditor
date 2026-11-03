/**
 * GitHub's math syntax while typing:
 * - `$a^2+b^2$` or `` $`a^2+b^2`$ `` inserts an inline equation when the closing `$` is typed;
 * - a paragraph that reads `$$…$$` becomes a display equation.
 *
 * Prices stay text: the dollar form needs no space just inside the dollars and something that looks
 * like maths (a letter, `\`, `^`, `_`, `{`, `}` or `=`), so "$5 and $10" or "$5-$10" are left alone.
 * A dollar typed after a backslash (`\$`) never starts an equation. Undo (Ctrl+Z) brings back the text.
 */

import { Plugin } from '../../core/plugin';
import { MathEditing, MATH_INLINE, MATH_DISPLAY } from './mathediting';
import type { Element as ModelElement } from '../../engine/model/element';

const DISPLAY = /^\$\$([\s\S]+?)\$\$$/;
const INLINE_BACKTICK = /(?:^|[^\\])\$`([^`]+)`\$$/;
const INLINE_DOLLAR = /(?:^|[^\\$\w])\$([^\s$`](?:[^$]*[^\s\\$])?)\$$/;
const LOOKS_LIKE_MATH = /[A-Za-z\\^_{}=]/;

export class MathTyping extends Plugin {
  public static override get pluginName(): string {
    return 'MathTyping';
  }

  public static override get requires() {
    return [MathEditing];
  }

  public override init(): void {
    const editor = this.editor;
    if (editor.config.get('math.dollarSyntax') === false) return;
    const model = editor.model;

    model.document.on('change:data', (evt, batch: any) => {
      if (batch.isUndo || !batch.isLocal || !batch.isTyping || editor.isReadOnly) return;
      const selection = model.document.selection;
      if (!selection.isCollapsed) return;
      const focus = selection.focus!;
      const block = focus.parent as ModelElement;
      if (!block.is('element') || block.name === 'codeBlock' || selection.getAttribute('code')) return;

      // The text typed so far in this block, back to the last equation, image or inline code.
      let text = '';
      let start = model.createPositionAt(block, 0);
      for (const item of model.createRange(start, focus).getItems()) {
        const node = item as any;
        if (!node.is('$textProxy') || node.getAttribute('code')) {
          text = '';
          start = model.createPositionAfter(node);
        } else {
          text += node.data;
        }
      }
      if (!text.endsWith('$')) return;

      const command = editor.commands.get('math')!;
      const display = DISPLAY.exec(text);
      if (display && start.offset === 0 && focus.isAtEnd && display[1].trim() && model.schema.checkChild(block.parent as any, MATH_DISPLAY)) {
        model.enqueueChange(writer => {
          const element = writer.createElement(MATH_DISPLAY, { equation: display[1].trim() });
          writer.insert(element, block, 'after');
          writer.remove(block);
          const after = writer.createElement('paragraph');
          if (!element.nextSibling && model.schema.checkChild(element.parent as any, 'paragraph')) writer.insert(after, element, 'after');
          writer.setSelection(element.nextSibling ? writer.createPositionAt(element.nextSibling, 0) : writer.createPositionAfter(element));
        });
        return;
      }

      const backtick = INLINE_BACKTICK.exec(text);
      const dollar = backtick ? null : INLINE_DOLLAR.exec(text);
      const match = backtick || (dollar && LOOKS_LIKE_MATH.test(dollar[1]) ? dollar : null);
      if (!match || !command.isEnabled) return;
      const equation = match[1].trim();
      const rangeStart = focus.getShiftedBy(-(match[1].length + (backtick ? 4 : 2)));
      if (!model.schema.checkChild(block, MATH_INLINE)) return;
      model.enqueueChange(writer => {
        const attributes = Object.fromEntries(selection.getAttributes());
        writer.remove(writer.createRange(rangeStart, focus));
        const element = writer.createElement(MATH_INLINE, { equation });
        writer.insert(element, rangeStart);
        writer.setSelection(writer.createPositionAfter(element));
        writer.setSelectionAttribute(attributes);
      });
    });
  }
}
