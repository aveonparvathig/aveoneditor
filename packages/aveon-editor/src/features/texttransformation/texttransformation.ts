import { Plugin } from '../../core/plugin';
import { Delete } from '../typing/delete';
import type { Editor } from '../../core/editor';

interface TransformationDefinition {
  from: string | RegExp;
  to: string | Array<string | null> | ((matches: string[]) => Array<string | null>);
}

const TRANSFORMATIONS: Record<string, TransformationDefinition> = {
  copyright: { from: '(c)', to: '©' },
  registeredTrademark: { from: '(r)', to: '®' },
  trademark: { from: '(tm)', to: '™' },
  oneHalf: { from: /(^|[^/a-z0-9])(1\/2)([^/a-z0-9])$/i, to: [null, '½', null] },
  oneThird: { from: /(^|[^/a-z0-9])(1\/3)([^/a-z0-9])$/i, to: [null, '⅓', null] },
  twoThirds: { from: /(^|[^/a-z0-9])(2\/3)([^/a-z0-9])$/i, to: [null, '⅔', null] },
  oneForth: { from: /(^|[^/a-z0-9])(1\/4)([^/a-z0-9])$/i, to: [null, '¼', null] },
  threeQuarters: { from: /(^|[^/a-z0-9])(3\/4)([^/a-z0-9])$/i, to: [null, '¾', null] },
  lessThanOrEqual: { from: '<=', to: '≤' },
  greaterThanOrEqual: { from: '>=', to: '≥' },
  notEqual: { from: '!=', to: '≠' },
  arrowLeft: { from: '<-', to: '←' },
  arrowRight: { from: '->', to: '→' },
  horizontalEllipsis: { from: '...', to: '…' },
  enDash: { from: /(^| )(--)( )$/, to: [null, '–', null] },
  emDash: { from: /(^| )(---)( )$/, to: [null, '—', null] },
  quotesPrimary: { from: buildQuotesRegExp('"'), to: [null, '“', null, '”'] },
  quotesSecondary: { from: buildQuotesRegExp("'"), to: [null, '‘', null, '’'] }
};

const TRANSFORMATION_GROUPS: Record<string, string[]> = {
  symbols: ['copyright', 'registeredTrademark', 'trademark'],
  mathematical: ['oneHalf', 'oneThird', 'twoThirds', 'oneForth', 'threeQuarters', 'lessThanOrEqual', 'greaterThanOrEqual', 'notEqual', 'arrowLeft', 'arrowRight'],
  typography: ['horizontalEllipsis', 'enDash', 'emDash'],
  quotes: ['quotesPrimary', 'quotesSecondary']
};

const DEFAULT_TRANSFORMATIONS = ['symbols', 'mathematical', 'typography', 'quotes'];

/** Replaces typed text snippets like `(c)` or `->` with symbols. */
export class TextTransformation extends Plugin {
  public static override get requires() {
    return [Delete];
  }

  public static override get pluginName(): string {
    return 'TextTransformation';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('typing', { transformations: { include: DEFAULT_TRANSFORMATIONS } });
  }

  public override init(): void {
    const model = this.editor.model;
    const modelSelection = model.document.selection;
    modelSelection.on('change:range', () => {
      this.isEnabled = !modelSelection.anchor!.parent.is('element', 'codeBlock');
    });
    this._enableTransformationWatchers();
  }

  private _enableTransformationWatchers(): void {
    const editor = this.editor;
    const model = editor.model;
    const deletePlugin = editor.plugins.get('Delete') as Delete;
    const normalizedTransformations = normalizeTransformations(editor.config.get('typing.transformations') as any);
    void deletePlugin;

    this.listenTo(model.document, 'change:data', (evt, batch: any) => {
      if (!this.isEnabled || !batch.isTyping || batch.isUndo) return;
      const selection = model.document.selection;
      if (!selection.isCollapsed) return;
      const position = selection.focus!;
      const block = position.parent as any;
      if (!block.is('element') || !position.textNode) return;
      const text = getTextBefore(position);
      for (const normalizedTransformation of normalizedTransformations) {
        const { from, to } = normalizedTransformation;
        const match = from.exec(text);
        if (!match) continue;
        const replaces = to(match.slice(1));
        let changeIndex = match.index;
        model.enqueueChange(writer => {
          for (let i = 1; i < match.length; i++) {
            const replaceWith = replaces[i - 1];
            if (replaceWith === null) {
              changeIndex += match[i].length;
              continue;
            }
            const replacePosition = position.getShiftedBy(changeIndex - text.length);
            const replaceRange = model.createRange(replacePosition, replacePosition.getShiftedBy(match[i].length));
            const attributes = getTextAttributesAfterPosition(replacePosition);
            model.insertContent(writer.createText(replaceWith, attributes), replaceRange);
            changeIndex += replaceWith.length;
          }
        });
        break;
      }
    });
  }
}

function getTextBefore(position: any): string {
  const textNode = position.textNode;
  if (!textNode) return '';
  const offsetInText = position.offset - textNode.startOffset;
  let text = textNode.data.slice(0, offsetInText);
  let node = textNode.previousSibling;
  while (node && node.is('$text')) {
    text = node.data + text;
    node = node.previousSibling;
  }
  return text;
}

function normalizeTransformations(config: { include?: Array<string | TransformationDefinition>; extra?: Array<string | TransformationDefinition>; remove?: Array<string | TransformationDefinition> }): Array<{ from: RegExp; to: (matches: string[]) => Array<string | null> }> {
  const extra = config.extra || [];
  const remove = config.remove || [];
  const isNotRemoved = (transformation: any) => !remove.includes(transformation);
  const configured = (config.include || []).concat(extra).filter(isNotRemoved);
  return expandGroupsAndRemoveDuplicates(configured)
    .filter(isNotRemoved)
    .map(transformation => (typeof transformation === 'string' ? TRANSFORMATIONS[transformation] : transformation))
    .filter((t): t is TransformationDefinition => !!t)
    .map(transformation => ({ from: normalizeFrom(transformation.from), to: normalizeTo(transformation.to) }));
}

function normalizeFrom(from: string | RegExp): RegExp {
  if (typeof from === 'string') {
    return new RegExp(`(${escapeRegExp(from)})$`);
  }
  return from;
}

function normalizeTo(to: TransformationDefinition['to']): (matches: string[]) => Array<string | null> {
  if (typeof to === 'function') return to;
  if (typeof to === 'string') return () => [to];
  return () => to;
}

function expandGroupsAndRemoveDuplicates(definitions: Array<string | TransformationDefinition>): Array<string | TransformationDefinition> {
  const definedTransformations = new Set<string | TransformationDefinition>();
  for (const transformationOrGroup of definitions) {
    if (typeof transformationOrGroup === 'string' && TRANSFORMATION_GROUPS[transformationOrGroup]) {
      for (const transformation of TRANSFORMATION_GROUPS[transformationOrGroup]) {
        definedTransformations.add(transformation);
      }
    } else {
      definedTransformations.add(transformationOrGroup);
    }
  }
  return Array.from(definedTransformations);
}

function buildQuotesRegExp(quoteCharacter: string): RegExp {
  return new RegExp(`(^|\\s)(${quoteCharacter})([^${quoteCharacter}]*)(${quoteCharacter})$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTextAttributesAfterPosition(position: any): Record<string, unknown> {
  const textNode = position.textNode || position.nodeAfter;
  if (textNode && textNode.is && textNode.is('$text')) return Object.fromEntries(textNode.getAttributes());
  return {};
}
