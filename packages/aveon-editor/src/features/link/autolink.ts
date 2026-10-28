import { Plugin } from '../../core/plugin';
import { Delete } from '../typing/delete';
import { addLinkProtocolIfApplicable, linkHasProtocol } from './utils';
import type { Range } from '../../engine/model/range';
import type { Position } from '../../engine/model/position';

const MIN_LINK_LENGTH_WITH_SPACE_AT_END = 4;
const URL_REG_EXP = new RegExp(
  '(^|\\s)' +
    '(' +
    '(' +
    '(?:(?:(?:https?|ftp):)?\\/\\/)' +
    '(?:\\S+(?::\\S*)?@)?' +
    '(?:' +
    '(?!(?:10|127)(?:\\.\\d{1,3}){3})' +
    '(?!(?:169\\.254|192\\.168)(?:\\.\\d{1,3}){2})' +
    '(?!172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})' +
    '(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])' +
    '(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}' +
    '(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))' +
    '|' +
    '(' +
    '((?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)' +
    '(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*' +
    '(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))' +
    ')' +
    ')' +
    '(?::\\d{2,5})?' +
    '(?:[/?#]\\S*)?' +
    ')' +
    '|' +
    '(' +
    '(www.|(\\S+@))' +
    '((?![-_])(?:[-_a-z0-9\\u00a1-\\uffff]{1,63}\\.))+' +
    '(?:[a-z\\u00a1-\\uffff]{2,})' +
    ')' +
    ')$',
  'i'
);
const URL_GROUP_IN_MATCH = 2;

/** Turns typed URLs into links after a space or Enter. */
export class AutoLink extends Plugin {
  public static override get requires() {
    return [Delete];
  }

  public static override get pluginName(): string {
    return 'AutoLink';
  }

  public override init(): void {
    const editor = this.editor;
    const selection = editor.model.document.selection;
    selection.on('change:range', () => {
      this.isEnabled = !selection.anchor!.parent.is('element', 'codeBlock');
    });
    this._enableTypingHandling();
  }

  public override afterInit(): void {
    this._enableEnterHandling();
    this._enableShiftEnterHandling();
  }

  private _enableTypingHandling(): void {
    const editor = this.editor;
    const model = editor.model;
    const selection = model.document.selection;
    this.listenTo(model.document, 'change:data', (evt, batch: any) => {
      if (!this.isEnabled || !batch.isTyping || batch.isUndo) return;
      const position = selection.getFirstPosition()!;
      const block = position.parent as any;
      if (!block.is('element') || !position.textNode) return;
      const textBefore = getTextBeforePosition(position);
      if (!textBefore.endsWith(' ')) return;
      const url = getUrlAtTextEnd(textBefore.slice(0, -1));
      if (url) {
        this._applyAutoLink(url, position.getShiftedBy(-1), position.getShiftedBy(-url.length - 1));
      }
    });
  }

  private _enableEnterHandling(): void {
    const editor = this.editor;
    const model = editor.model;
    const enterCommand = editor.commands.get('enter');
    if (!enterCommand) return;
    this.listenTo(enterCommand, 'execute', () => {
      const position = model.document.selection.getFirstPosition()!;
      if (!position.parent.previousSibling) return;
      const rangeToCheck = model.createRangeIn(position.parent.previousSibling as any);
      this._checkAndApplyAutoLinkOnRange(rangeToCheck);
    });
  }

  private _enableShiftEnterHandling(): void {
    const editor = this.editor;
    const model = editor.model;
    const shiftEnterCommand = editor.commands.get('shiftEnter');
    if (!shiftEnterCommand) return;
    this.listenTo(shiftEnterCommand, 'execute', () => {
      const position = model.document.selection.getFirstPosition()!;
      const rangeToCheck = model.createRange(model.createPositionAt(position.parent, 0), position.getShiftedBy(-1));
      this._checkAndApplyAutoLinkOnRange(rangeToCheck);
    });
  }

  private _checkAndApplyAutoLinkOnRange(rangeToCheck: Range): void {
    const model = this.editor.model;
    const text = getText(rangeToCheck);
    const url = getUrlAtTextEnd(text);
    if (url) {
      this._applyAutoLink(url, rangeToCheck.end, rangeToCheck.end.getShiftedBy(-url.length));
    }
    void model;
  }

  private _applyAutoLink(link: string, end: Position, start: Position): void {
    const model = this.editor.model;
    const defaultProtocol = this.editor.config.get('link.defaultProtocol') as string | undefined;
    const fullLink = addLinkProtocolIfApplicable(link, defaultProtocol);
    if (!this.isEnabled || !isLinkAllowedOnRange(start, end, model) || (!linkHasProtocol(fullLink) && !isEmail(fullLink))) return;
    const range = model.createRange(start, end);
    model.enqueueChange({ isUndoable: true }, writer => {
      writer.setAttribute('linkHref', fullLink, range);
    });
  }
}

function getUrlAtTextEnd(text: string): string | null {
  const match = URL_REG_EXP.exec(text);
  return match ? match[URL_GROUP_IN_MATCH] : null;
}

function isLinkAllowedOnRange(start: Position, end: Position, model: any): boolean {
  return model.schema.checkAttributeInSelection(model.createSelection(model.createRange(start, end)), 'linkHref');
}

function getTextBeforePosition(position: Position): string {
  const textNode = position.textNode;
  if (!textNode) return '';
  const offsetInText = position.offset - textNode.startOffset!;
  let text = textNode.data.slice(0, offsetInText);
  let node: any = textNode.previousSibling;
  while (node && node.is('$text') && !node.hasAttribute('linkHref')) {
    text = node.data + text;
    node = node.previousSibling;
  }
  return text;
}

function getText(range: Range): string {
  let text = '';
  for (const item of range.getItems()) {
    if ((item as any).is('$textProxy')) {
      if ((item as any).hasAttribute('linkHref')) {
        text = '';
      } else {
        text += (item as any).data;
      }
    } else {
      text = '';
    }
  }
  return text;
}

function isEmail(value: string): boolean {
  return /^mailto:/.test(value) || /^[\S]+@[\S]+\.[a-z]{2,}$/i.test(value);
}

void MIN_LINK_LENGTH_WITH_SPACE_AT_END;
