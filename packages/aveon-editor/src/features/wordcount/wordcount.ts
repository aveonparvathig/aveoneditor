import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { Template } from '../../ui/template';
import { debounce } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';

/** Counts words and characters; fires `update` and optionally renders a counter container. */
export class WordCount extends Plugin {
  declare public characters: number;
  declare public words: number;
  private _outputView: View | null = null;
  private _config: { displayWords?: boolean; displayCharacters?: boolean; container?: HTMLElement; onUpdate?: (stats: { words: number; characters: number }) => void };

  public static override get pluginName(): string {
    return 'WordCount';
  }

  constructor(editor: Editor) {
    super(editor);
    this.set('characters', 0);
    this.set('words', 0);
    this.set('_wordsLabel', undefined);
    this.set('_charactersLabel', undefined);
    this._config = (editor.config.get('wordCount') as any) || {};
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const debouncedRefresh = debounce(() => this._refreshStats(), 250);
    model.document.on('change:data', () => debouncedRefresh());
    editor.once('ready', () => this._refreshStats());
    if (typeof this._config.onUpdate === 'function') {
      this.on('update', (evt, data: any) => this._config.onUpdate!(data));
    }
    if (this._config.container) {
      this._config.container.appendChild(this.wordCountContainer);
    }
  }

  public override destroy(): void {
    if (this._outputView) {
      this._outputView.element!.remove();
      this._outputView.destroy();
    }
    super.destroy();
  }

  public get wordCountContainer(): HTMLElement {
    const editor = this.editor;
    const t = editor.t;
    const displayWords = this._config.displayWords === undefined ? true : this._config.displayWords;
    const displayCharacters = this._config.displayCharacters === undefined ? true : this._config.displayCharacters;
    const bind = Template.bind(this as any, this as any);
    const children: any[] = [];
    if (!this._outputView) {
      this._outputView = new View();
      if (displayWords) {
        (this as any).bind('_wordsLabel').to(this, 'words', (words: number) => t('Words: %0', words));
        children.push({ tag: 'div', children: [{ text: bind.to('_wordsLabel') }], attributes: { class: 'ck-word-count__words' } });
      }
      if (displayCharacters) {
        (this as any).bind('_charactersLabel').to(this, 'characters', (characters: number) => t('Characters: %0', characters));
        children.push({ tag: 'div', children: [{ text: bind.to('_charactersLabel') }], attributes: { class: 'ck-word-count__characters' } });
      }
      this._outputView.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-word-count'] }, children });
      this._outputView.render();
    }
    return this._outputView.element!;
  }

  private _getText(): string {
    let txt = '';
    for (const root of this.editor.model.document.getRoots()) {
      if (txt !== '') txt += '\n';
      txt += modelElementToPlainText(root);
    }
    return txt;
  }

  private _getCharacters(txt: string): number {
    return txt.replace(/\n/g, '').length;
  }

  private _getWords(txt: string): number {
    const detectedWords = txt.match(/[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*/gu) || [];
    return detectedWords.length;
  }

  private _refreshStats(): void {
    const txt = this._getText();
    const words = (this.words = this._getWords(txt));
    const characters = (this.characters = this._getCharacters(txt));
    this.fire('update', { words, characters });
  }
}

export function modelElementToPlainText(item: ModelElement | any): string {
  if (item.is('$text') || item.is('$textProxy')) return item.data;
  let text = '';
  let prev: any = null;
  for (const child of item.getChildren()) {
    const childText = modelElementToPlainText(child);
    if (prev && (prev.is('containerElement') || child.is('element'))) {
      text += '\n';
    }
    text += childText;
    prev = child;
  }
  return text;
}
