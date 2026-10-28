/**
 * Comments: select text, add a comment, discuss it in the comments panel (replies, resolve, delete).
 *
 * The content only stores anchors (`<span class="comment-anchor" data-comment="c-…">`); the threads
 * are application data. Load them with `comments.threads` (or `setThreads()`), save them from
 * `getThreads()`, and listen to the plugin's `change` event to save as people comment.
 *
 *   user: { id: 'u-17', name: 'Asha Rao' },
 *   comments: { threads: savedThreads, panel: true }
 *
 * One piece of text carries at most one comment (a new comment on commented text replaces the
 * anchor there).
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { promptDialog } from '../shared/dialog';
import { escapeHtml } from '../shared/upcast';
import type { Editor } from '../../core/editor';
import type { Range as ModelRange } from '../../engine/model/range';

export interface EditorUser {
  id: string;
  name: string;
}

export interface CommentReply {
  author: EditorUser;
  createdAt: string;
  text: string;
}

export interface CommentThread {
  id: string;
  author: EditorUser;
  createdAt: string;
  text: string;
  replies: CommentReply[];
  resolved: boolean;
}

export interface CommentsConfig {
  threads?: CommentThread[];
  /** Show the comments panel when the editor starts. Default: when there are threads. */
  panel?: boolean;
}

const ATTRIBUTE = 'comment';

/** The current user from `config.user` (shared by comments and track changes). */
export function getEditorUser(editor: Editor): EditorUser {
  const user = editor.config.get('user') as Partial<EditorUser> | undefined;
  return { id: (user && user.id) || 'user', name: (user && user.name) || editor.t('You') };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export class AddCommentCommand extends Command {
  public override refresh(): void {
    const selection = this.editor.model.document.selection;
    this.isEnabled = !selection.isCollapsed && this.editor.model.schema.checkAttributeInSelection(selection, ATTRIBUTE);
  }

  /** Comments on the selection; asks for the text when it is not given. Resolves with the thread id. */
  public override async execute(options: { text?: string } = {}): Promise<string | null> {
    const editor = this.editor;
    const comments = editor.plugins.get('Comments') as Comments;
    const text = options.text ?? (await promptDialog(editor, { title: editor.t('New comment'), label: editor.t('Comment'), multiline: true, submitLabel: editor.t('Comment') }));
    if (!text) return null;
    return comments.addThread(text);
  }
}

export class ToggleCommentsPanelCommand extends Command {
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
    (this.editor.plugins.get('Comments') as Comments).render();
  }
}

export class Comments extends Plugin {
  private readonly _threads = new Map<string, CommentThread>();
  private _panel: HTMLElement | null = null;
  private _renderQueued = false;

  public static override get pluginName(): string {
    return 'Comments';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const config = (editor.config.get('comments') as CommentsConfig | undefined) || {};
    for (const thread of config.threads || []) this._threads.set(thread.id, normalizeThread(thread));

    editor.model.schema.extend('$text', { allowAttributes: ATTRIBUTE });
    editor.model.schema.setAttributeProperties(ATTRIBUTE, { isFormatting: false, copyOnEnter: false });
    editor.conversion.for('upcast').elementToAttribute({
      view: { name: 'span', attributes: { 'data-comment': /^[\w-]+$/ } },
      model: { key: ATTRIBUTE, value: (viewElement: any) => String(viewElement.getAttribute('data-comment')) }
    });
    editor.conversion.for('dataDowncast').attributeToElement({
      model: ATTRIBUTE,
      view: (value: unknown, { writer }: any) => (value ? writer.createAttributeElement('span', { class: 'comment-anchor', 'data-comment': String(value) }, { priority: 4 }) : null)
    });
    editor.conversion.for('editingDowncast').attributeToElement({
      model: ATTRIBUTE,
      view: (value: unknown, { writer }: any) => {
        if (!value) return null;
        const thread = this._threads.get(String(value));
        const classes = `ck-comment-marker${thread && thread.resolved ? ' ck-comment-marker_resolved' : ''}`;
        return writer.createAttributeElement('span', { class: classes, 'data-comment': String(value) }, { priority: 4 });
      }
    });

    // Typing right after commented text does not extend the comment.
    const insertText = editor.commands.get('insertText');
    if (insertText) {
      this.listenTo(insertText, 'execute', () => {
        if (editor.model.document.selection.hasAttribute(ATTRIBUTE)) editor.model.change(writer => writer.removeSelectionAttribute(ATTRIBUTE));
      }, { priority: 'high' });
    }

    editor.commands.add('addComment', new AddCommentCommand(editor));
    editor.commands.add('toggleComments', new ToggleCommentsPanelCommand(editor));
    if (config.panel ?? config.threads?.length) editor.commands.get('toggleComments')!.value = true;

    this._addButtons();
    editor.model.document.on('change:data', () => this._queueRender());
    editor.model.document.selection.on('change:range', () => this._queueRender());
    const attach = () => {
      const editable = editor.ui.getEditableElement();
      if (!editable || !editable.parentElement) return;
      this._panel = editable.ownerDocument.createElement('aside');
      this._panel.className = 'ck ck-reset_all-excluded ck-comments-panel';
      this._panel.setAttribute('aria-label', t('Comments'));
      editable.parentElement.appendChild(this._panel);
      this.render();
    };
    if ((editor.ui as any).isReady) attach();
    else editor.ui.once('ready', attach);
  }

  public override destroy(): void {
    this._panel?.remove();
    super.destroy();
  }

  /** Threads whose text is still in the document (what to save). */
  public getThreads(): CommentThread[] {
    const anchored = new Set(this._anchoredIds());
    return [...this._threads.values()].filter(thread => anchored.has(thread.id)).map(thread => JSON.parse(JSON.stringify(thread)));
  }

  public getThread(id: string): CommentThread | undefined {
    return this._threads.get(id);
  }

  public setThreads(threads: CommentThread[]): void {
    this._threads.clear();
    for (const thread of threads) this._threads.set(thread.id, normalizeThread(thread));
    this._changed();
  }

  /** Comments on the current selection. Returns the new thread id. */
  public addThread(text: string): string | null {
    const editor = this.editor;
    const selection = editor.model.document.selection;
    if (selection.isCollapsed) return null;
    const id = newId('c');
    this._threads.set(id, { id, author: getEditorUser(editor), createdAt: new Date().toISOString(), text, replies: [], resolved: false });
    editor.model.change(writer => {
      for (const range of editor.model.schema.getValidRanges(selection.getRanges(), ATTRIBUTE)) writer.setAttribute(ATTRIBUTE, id, range);
    });
    editor.commands.get('toggleComments')!.value = true;
    this._changed();
    return id;
  }

  public reply(id: string, text: string): void {
    const thread = this._threads.get(id);
    if (!thread || !text.trim()) return;
    thread.replies.push({ author: getEditorUser(this.editor), createdAt: new Date().toISOString(), text: text.trim() });
    this._changed();
  }

  public setResolved(id: string, resolved: boolean): void {
    const thread = this._threads.get(id);
    if (!thread) return;
    thread.resolved = resolved;
    this._redrawMarkers(id);
    this._changed();
  }

  /** Deletes the thread and its highlight (the text stays). */
  public removeThread(id: string): void {
    const editor = this.editor;
    editor.model.change(writer => {
      for (const range of this._rangesOf(id)) writer.removeAttribute(ATTRIBUTE, range);
    });
    this._threads.delete(id);
    this._changed();
  }

  /** Selects the commented text. */
  public select(id: string): void {
    const ranges = this._rangesOf(id);
    if (!ranges.length) return;
    this.editor.model.change(writer => writer.setSelection(ranges[0]));
    this.editor.editing.view.focus();
    this.editor.editing.view.scrollToTheSelection?.();
  }

  /** Redraws the panel. */
  public render(): void {
    this._renderQueued = false;
    const panel = this._panel;
    if (!panel) return;
    const editor = this.editor;
    const t = editor.t;
    const open = !!editor.commands.get('toggleComments')!.value;
    panel.hidden = !open;
    panel.parentElement?.classList.toggle('ck-editor__main_with-comments', open);
    if (!open) return;
    const active = editor.model.document.selection.getAttribute(ATTRIBUTE) || firstAttributeInSelection(editor);
    const ids = this._anchoredIds();
    const suggestions = editor.plugins.has('TrackChanges') ? (editor.plugins.get('TrackChanges') as any).getSuggestions() : [];
    const parts: string[] = [`<div class="ck-comments-panel__header"><span>${escapeHtml(t('Comments'))}</span><button type="button" class="ck-comments-panel__close" data-action="close" aria-label="${escapeHtml(t('Close'))}">×</button></div>`];
    if (!ids.length && !suggestions.length) {
      parts.push(`<p class="ck-comments-panel__empty">${escapeHtml(t('Select text and choose New Comment to start a discussion.'))}</p>`);
    }
    for (const id of ids) {
      const thread = this._threads.get(id);
      if (!thread) continue;
      const quote = this._rangesOf(id).map(range => textOf(range)).join(' … ');
      parts.push(
        `<article class="ck-comment-thread${thread.resolved ? ' ck-comment-thread_resolved' : ''}${active === id ? ' ck-comment-thread_active' : ''}" data-thread="${escapeHtml(id)}">` +
          `<blockquote class="ck-comment-thread__quote" data-action="select">${escapeHtml(quote.slice(0, 140))}</blockquote>` +
          entryHtml(thread.author, thread.createdAt, thread.text) +
          thread.replies.map(reply => entryHtml(reply.author, reply.createdAt, reply.text, true)).join('') +
          (thread.resolved
            ? ''
            : `<form class="ck-comment-thread__reply" data-action="reply"><textarea rows="1" placeholder="${escapeHtml(t('Reply…'))}" aria-label="${escapeHtml(t('Reply'))}"></textarea><button type="submit">${escapeHtml(t('Reply'))}</button></form>`) +
          `<div class="ck-comment-thread__actions"><button type="button" data-action="${thread.resolved ? 'reopen' : 'resolve'}">${escapeHtml(thread.resolved ? t('Reopen') : t('Resolve'))}</button><button type="button" data-action="delete">${escapeHtml(t('Delete'))}</button></div>` +
          `</article>`
      );
    }
    if (suggestions.length) {
      parts.push(`<div class="ck-comments-panel__section">${escapeHtml(t('Suggested changes'))}</div>`);
      for (const suggestion of suggestions) {
        parts.push(
          `<article class="ck-suggestion-card ck-suggestion-card_${suggestion.type}" data-suggestion="${suggestion.index}">` +
            `<div class="ck-comment__meta"><strong>${escapeHtml(suggestion.author)}</strong> ${escapeHtml(suggestion.type === 'insert' ? t('inserted') : t('deleted'))}</div>` +
            `<div class="ck-suggestion-card__text" data-action="select-suggestion">${escapeHtml(suggestion.text.slice(0, 140))}</div>` +
            `<div class="ck-comment-thread__actions"><button type="button" data-action="accept">${escapeHtml(t('Accept'))}</button><button type="button" data-action="reject">${escapeHtml(t('Reject'))}</button></div>` +
            `</article>`
        );
      }
    }
    // Keep a reply being typed when the panel redraws.
    const focused = panel.ownerDocument.activeElement;
    const typing = focused instanceof HTMLTextAreaElement && panel.contains(focused) ? { thread: focused.closest('[data-thread]')?.getAttribute('data-thread'), value: focused.value } : null;
    panel.innerHTML = parts.join('');
    if (typing && typing.thread) {
      const textarea = panel.querySelector<HTMLTextAreaElement>(`[data-thread="${CSS.escape(typing.thread)}"] textarea`);
      if (textarea) {
        textarea.value = typing.value;
        textarea.focus();
      }
    }
    if (!panel.dataset.bound) {
      panel.dataset.bound = 'true';
      panel.addEventListener('click', event => this._onPanelClick(event));
      panel.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target as HTMLFormElement;
        const id = form.closest('[data-thread]')?.getAttribute('data-thread');
        const textarea = form.querySelector('textarea');
        if (id && textarea && textarea.value.trim()) {
          const text = textarea.value;
          textarea.value = '';
          this.reply(id, text);
        }
      });
      panel.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target instanceof HTMLTextAreaElement) {
          event.preventDefault();
          event.target.form?.requestSubmit();
        }
      });
    }
  }

  private _onPanelClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.closest('[data-thread]')?.getAttribute('data-thread') || '';
    const suggestion = target.closest('[data-suggestion]')?.getAttribute('data-suggestion');
    const trackChanges = this.editor.plugins.has('TrackChanges') ? (this.editor.plugins.get('TrackChanges') as any) : null;
    if (action === 'close') this.editor.execute('toggleComments', { value: false });
    else if (action === 'select') this.select(id);
    else if (action === 'resolve') this.setResolved(id, true);
    else if (action === 'reopen') this.setResolved(id, false);
    else if (action === 'delete') this.removeThread(id);
    else if (trackChanges && suggestion !== undefined && suggestion !== null) {
      const index = Number(suggestion);
      if (action === 'accept') trackChanges.resolveSuggestion(index, true);
      else if (action === 'reject') trackChanges.resolveSuggestion(index, false);
      else if (action === 'select-suggestion') trackChanges.selectSuggestion(index);
    }
  }

  private _addButtons(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('addComment', locale => {
      const command = editor.commands.get('addComment')!;
      const button = new ButtonView(locale);
      button.set({ label: t('New comment'), icon: icons.comment, tooltip: true });
      button.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(button, 'execute', () => editor.execute('addComment'));
      return button;
    });
    editor.ui.componentFactory.add('toggleComments', locale => {
      const command = editor.commands.get('toggleComments')!;
      const button = new ButtonView(locale);
      button.set({ label: t('Show comments'), icon: icons.commentsPanel, tooltip: true, isToggleable: true });
      button.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      this.listenTo(button, 'execute', () => editor.execute('toggleComments'));
      return button;
    });
  }

  private _changed(): void {
    this.fire('change', this.getThreads());
    this.render();
  }

  private _queueRender(): void {
    if (this._renderQueued) return;
    this._renderQueued = true;
    setTimeout(() => this.render(), 0);
  }

  /** Redraws the blocks holding the comment so the highlight picks up the resolved style. */
  private _redrawMarkers(id: string): void {
    const blocks = new Set<any>();
    for (const range of this._rangesOf(id)) {
      for (const item of range.getItems()) if ((item as any).parent) blocks.add((item as any).parent);
    }
    for (const block of blocks) this.editor.editing.reconvertItem(block);
  }

  /** Thread ids in document order. */
  private _anchoredIds(): string[] {
    const ids: string[] = [];
    const root = this.editor.model.document.getRoot();
    if (!root) return ids;
    for (const item of this.editor.model.createRangeIn(root).getItems()) {
      const value = (item as any).getAttribute?.(ATTRIBUTE);
      if (value && !ids.includes(String(value))) ids.push(String(value));
    }
    return ids;
  }

  private _rangesOf(id: string): ModelRange[] {
    const model = this.editor.model;
    const root = model.document.getRoot();
    const ranges: ModelRange[] = [];
    if (!root) return ranges;
    for (const item of model.createRangeIn(root).getItems()) {
      if ((item as any).getAttribute?.(ATTRIBUTE) !== id) continue;
      const range = model.createRangeOn(item as any);
      const last = ranges[ranges.length - 1];
      if (last && last.end.isEqual(range.start)) ranges[ranges.length - 1] = model.createRange(last.start, range.end);
      else ranges.push(range);
    }
    return ranges;
  }
}

function normalizeThread(thread: CommentThread): CommentThread {
  return { ...thread, replies: Array.isArray(thread.replies) ? thread.replies : [], resolved: !!thread.resolved };
}

function firstAttributeInSelection(editor: Editor): unknown {
  for (const range of editor.model.document.selection.getRanges()) {
    for (const item of range.getItems()) {
      const value = (item as any).getAttribute?.(ATTRIBUTE);
      if (value) return value;
    }
  }
  return undefined;
}

function textOf(range: ModelRange): string {
  let text = '';
  for (const item of range.getItems()) if ((item as any).is('$textProxy') || (item as any).is('$text')) text += (item as any).data;
  return text;
}

function entryHtml(author: EditorUser, createdAt: string, text: string, reply = false): string {
  const date = new Date(createdAt);
  const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const initials = author.name
    .split(/\s+/)
    .map(part => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    `<div class="ck-comment${reply ? ' ck-comment_reply' : ''}">` +
    `<div class="ck-comment__meta"><span class="ck-comment__avatar" aria-hidden="true">${escapeHtml(initials)}</span><strong>${escapeHtml(author.name)}</strong><time datetime="${escapeHtml(createdAt)}">${escapeHtml(when)}</time></div>` +
    `<div class="ck-comment__text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>` +
    `</div>`
  );
}
