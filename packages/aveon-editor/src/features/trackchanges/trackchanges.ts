/**
 * Track changes (suggestion mode): while it is on, typed or pasted text is marked as an insertion
 * and deleted text is kept but marked as a deletion, both with the author and time. Suggestions are
 * accepted or rejected one by one (from the comments panel or at the selection) or all at once.
 *
 * Saved as `<ins class="suggestion-insert" data-author="…" data-time="…">` and
 * `<del class="suggestion-delete" …>`, so pending suggestions survive saving and reloading.
 *
 * Tracked: text insertions and deletions. Not tracked: formatting changes and structural edits
 * (new paragraphs, merged blocks, tables and images), which apply directly.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { LiveRange } from '../../engine/model/liverange';
import { getEditorUser } from '../comments/comments';
import type { Editor } from '../../core/editor';
import type { Range as ModelRange } from '../../engine/model/range';

const INSERT = 'suggestionInsert';
const DELETE = 'suggestionDelete';

export interface Suggestion {
  index: number;
  type: 'insert' | 'delete';
  author: string;
  time: string;
  text: string;
  range: ModelRange;
}

/** `authorId|authorName|time` → parts. */
function parseValue(value: unknown): { id: string; name: string; time: string } {
  const [id = '', name = '', time = ''] = String(value || '').split('|');
  return { id, name: name || id, time };
}

export class TrackChangesCommand extends Command {
  constructor(editor: Editor) {
    super(editor);
    this.affectsData = false;
    this.value = false;
  }

  public override refresh(): void {
    this.isEnabled = true;
  }

  public override execute(options: { value?: boolean } = {}): void {
    this.value = options.value ?? !this.value;
    if (this.value) (this.editor.plugins.get('TrackChanges') as TrackChanges).startSession();
  }
}

/** Accepts or rejects the suggestions at the selection (or all of them). */
export class ResolveSuggestionsCommand extends Command {
  constructor(editor: Editor, private readonly _accept: boolean, private readonly _all: boolean) {
    super(editor);
  }

  public override refresh(): void {
    const plugin = this.editor.plugins.get('TrackChanges') as TrackChanges;
    this.isEnabled = this._all ? plugin.hasSuggestions() : plugin.suggestionRangesAtSelection().length > 0;
  }

  public override execute(): void {
    const plugin = this.editor.plugins.get('TrackChanges') as TrackChanges;
    const ranges = this._all ? plugin.getSuggestions().map(suggestion => suggestion.range) : plugin.suggestionRangesAtSelection();
    plugin.resolveRanges(ranges, this._accept);
  }
}

export class TrackChanges extends Plugin {
  private _value = '';
  private _applying = false;

  public static override get pluginName(): string {
    return 'TrackChanges';
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const t = editor.t;
    model.schema.extend('$text', { allowAttributes: [INSERT, DELETE] });
    model.schema.setAttributeProperties(INSERT, { isFormatting: false, copyOnEnter: false });
    model.schema.setAttributeProperties(DELETE, { isFormatting: false, copyOnEnter: false });

    for (const [key, tag, className] of [
      [INSERT, 'ins', 'suggestion-insert'],
      [DELETE, 'del', 'suggestion-delete']
    ] as const) {
      editor.conversion.for('downcast').attributeToElement({
        model: key,
        view: (value: unknown, { writer }: any) => {
          if (!value) return null;
          const { id, name, time } = parseValue(value);
          return writer.createAttributeElement(tag, { class: className, 'data-author': name, 'data-author-id': id, 'data-time': time }, { priority: 3 });
        }
      });
      editor.conversion.for('upcast').elementToAttribute({
        view: { name: tag, classes: className },
        model: { key, value: (view: any) => `${view.getAttribute('data-author-id') || view.getAttribute('data-author') || 'unknown'}|${view.getAttribute('data-author') || ''}|${view.getAttribute('data-time') || ''}` },
        // Before Strikethrough and Underline, which also read <del> and <ins>.
        converterPriority: 'high'
      });
    }

    // New text while tracking becomes a suggested insertion: the text is marked as it is inserted
    // (typing, paste, inserted content). Undo and redo restore text exactly as it was.
    this.listenTo(model, 'applyOperation', (evt: any, args: any[]) => {
      const operation = args[0];
      const batch = operation.batch;
      // Only the user's own edits: not loading data (non-undoable), undo/redo or remote changes.
      if (!this.isTracking || this._applying || operation.type !== 'insert' || !batch || batch.isUndo || !batch.isUndoable || !batch.isLocal) return;
      for (const node of operation.nodes) {
        if (!node.is('$text') || node.hasAttribute(INSERT)) continue;
        // Text typed next to a deletion must not inherit the deletion mark.
        node._removeAttribute(DELETE);
        node._setAttribute(INSERT, this._value);
      }
    }, { priority: 'high' });

    // Deleting while tracking marks text instead of removing it (one's own insertions are removed).
    this.listenTo(model, 'deleteContent', (evt: any, args: any[]) => {
      if (!this.isTracking || this._applying) return;
      const [selection, options] = args as [any, { direction?: string } | undefined];
      if (selection.isCollapsed) return;
      const ranges = [...selection.getRanges()] as ModelRange[];
      const hasText = ranges.some(range => [...range.getItems()].some((item: any) => item.is('$textProxy') || item.is('$text')));
      // Pure block boundaries (merging paragraphs) are not tracked.
      if (!hasText) return;
      evt.stop();
      const userId = getEditorUser(editor).id;
      model.change(writer => {
        const live = ranges.map(range => LiveRange.fromRange(range));
        const removals: ModelRange[] = [];
        for (const range of ranges) {
          for (const item of range.getItems()) {
            const node = item as any;
            if (!node.is('$textProxy') && !node.is('$text')) continue;
            const itemRange = writer.createRangeOn(node);
            if (node.getAttribute(INSERT) && parseValue(node.getAttribute(INSERT)).id === userId) removals.push(itemRange);
            else if (!node.getAttribute(DELETE)) writer.setAttribute(DELETE, this._value, itemRange);
          }
        }
        for (const range of removals.reverse()) writer.remove(range);
        const target = options && options.direction === 'forward' ? live[live.length - 1].end : live[0].start;
        if (selection.is && selection.is('documentSelection')) writer.setSelection(target);
        else selection.setTo(target);
        live.forEach(range => range.detach());
      });
    }, { priority: 'high' });

    editor.commands.add('trackChanges', new TrackChangesCommand(editor));
    editor.commands.add('acceptSuggestion', new ResolveSuggestionsCommand(editor, true, false));
    editor.commands.add('rejectSuggestion', new ResolveSuggestionsCommand(editor, false, false));
    editor.commands.add('acceptAllSuggestions', new ResolveSuggestionsCommand(editor, true, true));
    editor.commands.add('rejectAllSuggestions', new ResolveSuggestionsCommand(editor, false, true));
    this.startSession();

    const buttons: Array<[string, string, string, boolean]> = [
      ['trackChanges', t('Track changes'), icons.trackChanges, true],
      ['acceptSuggestion', t('Accept'), icons.accept, false],
      ['rejectSuggestion', t('Reject'), icons.reject, false],
      ['acceptAllSuggestions', t('Accept all'), icons.acceptAll, false],
      ['rejectAllSuggestions', t('Reject all'), icons.rejectAll, false]
    ];
    for (const [name, label, icon, toggle] of buttons) {
      editor.ui.componentFactory.add(name, locale => {
        const command = editor.commands.get(name)!;
        const button = new ButtonView(locale);
        button.set({ label, icon, tooltip: true, isToggleable: toggle });
        if (toggle) button.bind('isOn').to(command, 'value', (value: unknown) => !!value);
        else button.bind('isEnabled').to(command, 'isEnabled');
        this.listenTo(button, 'execute', () => {
          editor.execute(name);
          editor.editing.view.focus();
        });
        return button;
      });
    }
  }

  public get isTracking(): boolean {
    return !!this.editor.commands.get('trackChanges')?.value;
  }

  /** Starts a new suggestion group (same author and time) so adjacent edits merge. */
  public startSession(): void {
    const user = getEditorUser(this.editor);
    const time = new Date().toISOString().slice(0, 16);
    this._value = `${user.id.replace(/\|/g, '')}|${user.name.replace(/\|/g, '')}|${time}`;
  }

  public hasSuggestions(): boolean {
    const root = this.editor.model.document.getRoot();
    if (!root) return false;
    for (const item of this.editor.model.createRangeIn(root).getItems()) {
      if ((item as any).hasAttribute?.(INSERT) || (item as any).hasAttribute?.(DELETE)) return true;
    }
    return false;
  }

  /** Pending suggestions in document order (adjacent text of the same suggestion is merged). */
  public getSuggestions(): Suggestion[] {
    const model = this.editor.model;
    const root = model.document.getRoot();
    const suggestions: Suggestion[] = [];
    if (!root) return suggestions;
    for (const item of model.createRangeIn(root).getItems()) {
      const node = item as any;
      if (!node.is('$textProxy') && !node.is('$text')) continue;
      const type = node.getAttribute(INSERT) ? 'insert' : node.getAttribute(DELETE) ? 'delete' : null;
      if (!type) continue;
      const value = node.getAttribute(type === 'insert' ? INSERT : DELETE);
      const range = model.createRangeOn(node);
      const last = suggestions[suggestions.length - 1];
      if (last && last.type === type && last.range.end.isEqual(range.start) && (last as any)._value === value) {
        last.range = model.createRange(last.range.start, range.end);
        last.text += node.data;
        continue;
      }
      const { name, time } = parseValue(value);
      const suggestion: Suggestion & { _value?: unknown } = { index: suggestions.length, type, author: name, time, text: node.data, range };
      Object.defineProperty(suggestion, '_value', { value, enumerable: false });
      suggestions.push(suggestion);
    }
    return suggestions;
  }

  /** Suggestion ranges touched by the selection (the whole suggestion under a collapsed caret). */
  public suggestionRangesAtSelection(): ModelRange[] {
    const selection = this.editor.model.document.selection;
    const all = this.getSuggestions();
    const result: ModelRange[] = [];
    for (const range of selection.getRanges()) {
      for (const suggestion of all) {
        const touches = range.isCollapsed ? suggestion.range.containsPosition(range.start) || suggestion.range.start.isEqual(range.start) || suggestion.range.end.isEqual(range.start) : !!suggestion.range.getIntersection(range);
        if (touches && !result.includes(suggestion.range)) result.push(suggestion.range);
      }
    }
    return result;
  }

  /** Accepts or rejects suggestion `index` from `getSuggestions()`. */
  public resolveSuggestion(index: number, accept: boolean): void {
    const suggestion = this.getSuggestions()[index];
    if (suggestion) this.resolveRanges([suggestion.range], accept);
  }

  public selectSuggestion(index: number): void {
    const suggestion = this.getSuggestions()[index];
    if (!suggestion) return;
    this.editor.model.change(writer => writer.setSelection(suggestion.range));
    this.editor.editing.view.focus();
  }

  /** Accepting keeps insertions and drops deletions; rejecting does the opposite. */
  public resolveRanges(ranges: ModelRange[], accept: boolean): void {
    if (!ranges.length) return;
    const model = this.editor.model;
    this._applying = true;
    try {
      model.change(writer => {
        const removals: ModelRange[] = [];
        for (const range of ranges) {
          for (const item of range.getItems()) {
            const node = item as any;
            if (!node.is('$textProxy') && !node.is('$text')) continue;
            const itemRange = writer.createRangeOn(node);
            if (node.getAttribute(INSERT)) {
              if (accept) writer.removeAttribute(INSERT, itemRange);
              else removals.push(itemRange);
            } else if (node.getAttribute(DELETE)) {
              if (accept) removals.push(itemRange);
              else writer.removeAttribute(DELETE, itemRange);
            }
          }
        }
        // Remove from the end so earlier ranges stay valid.
        removals.sort((a, b) => (a.start.isBefore(b.start) ? 1 : -1));
        for (const range of removals) writer.remove(range);
      });
    } finally {
      this._applying = false;
    }
  }
}
