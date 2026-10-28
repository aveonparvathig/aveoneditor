/**
 * `<aveon-editor>`: the editor as a custom element, for server-rendered pages (CMS, ERP) and any
 * framework (React, Vue, Svelte…). It behaves like a form field: it has a `name`, submits its HTML
 * with the surrounding `<form>`, resets, and can be disabled.
 *
 *   <form method="post">
 *     <aveon-editor name="body" preset="cms" upload-url="/api/uploads"><p>Initial content</p></aveon-editor>
 *   </form>
 *
 * Attributes: `name`, `preset` (basic | cms | erp | full), `placeholder`, `upload-url`,
 * `upload-credentials`, `readonly`, `disabled`, `toolbar="classic"` (single toolbar instead of the
 * ribbon), `min-height`. Initial content comes from a child `<template>`, `<textarea>` or the
 * element's own HTML. Properties: `value` (HTML), `editor`, `config` (extra options, set before the
 * element is connected). Events: `ready`, `change`, `input` (bubbling).
 */

import { createEditor, type CreateEditorOptions, type PresetName } from '../builds/createeditor';
import type { ClassicEditor } from '../builds/classiceditor';

const READ_ONLY_LOCK = 'aveon-editor-element';

/** Waits this long after typing before syncing the form value and firing `change`. */
const SYNC_DELAY = 150;

type BaseElement = typeof HTMLElement;
const Base: BaseElement = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as BaseElement;

export class AveonEditorElement extends Base {
  public static formAssociated = true;

  public static get observedAttributes(): string[] {
    return ['readonly', 'disabled', 'placeholder'];
  }

  /** Extra `createEditor()` options; set before the element is added to the page (or defined). */
  declare public config: CreateEditorOptions;
  private _editor: ClassicEditor | null = null;
  private _creating: Promise<ClassicEditor> | null = null;
  private _initialValue = '';
  private _pendingValue: string | null = null;
  private _internals: ElementInternals | null = null;
  private _hiddenInput: HTMLInputElement | null = null;
  private _host: HTMLElement | null = null;
  private _syncTimer: ReturnType<typeof setTimeout> | null = null;
  private _formDisabled = false;

  constructor() {
    super();
    // A value assigned before the element was upgraded is kept (no class field overwrites it).
    if (!Object.prototype.hasOwnProperty.call(this, 'config')) this.config = {};
    try {
      const internals: ElementInternals | null = typeof (this as any).attachInternals === 'function' ? (this as any).attachInternals() : null;
      // Partial implementations (no setFormValue) fall back to a hidden input.
      this._internals = internals && typeof internals.setFormValue === 'function' ? internals : null;
    } catch {
      this._internals = null;
    }
  }

  /** The editor instance (null until `ready`). */
  public get editor(): ClassicEditor | null {
    return this._editor;
  }

  /** The editor's HTML. Setting it before the editor is ready replaces the initial content. */
  public get value(): string {
    return this._editor ? this._editor.getData() : this._pendingValue ?? this._initialValue;
  }

  public set value(html: string) {
    if (this._editor) {
      this._editor.setData(html || '');
      this._syncFormValue();
    } else {
      this._pendingValue = html || '';
    }
  }

  /** The form this field belongs to. */
  public get form(): HTMLFormElement | null {
    return this._internals ? this._internals.form : this.closest('form');
  }

  public get name(): string {
    return this.getAttribute('name') || '';
  }

  /** Resolves with the editor once it has been created. */
  public whenReady(): Promise<ClassicEditor> {
    if (this._editor) return Promise.resolve(this._editor);
    return new Promise(resolve => this.addEventListener('ready', () => resolve(this._editor!), { once: true }));
  }

  public override focus(): void {
    if (this._editor) this._editor.editing.view.focus();
  }

  public connectedCallback(): void {
    if (this._editor || this._creating) return;
    this._initialValue = this._readInitialContent();
    this.textContent = '';
    this.classList.add('aveon-editor-element');
    const minHeight = this.getAttribute('min-height');
    if (minHeight) this.style.setProperty('--aveon-editor-min-height', /^\d+$/.test(minHeight) ? `${minHeight}px` : minHeight);
    this._host = document.createElement('div');
    this.appendChild(this._host);
    if (!this._internals && this.name) {
      // Older browsers without form-associated custom elements: a hidden input carries the value.
      this._hiddenInput = document.createElement('input');
      this._hiddenInput.type = 'hidden';
      this._hiddenInput.name = this.name;
      this.appendChild(this._hiddenInput);
    }
    this._creating = createEditor(this._host, this._options());
    this._creating
      .then(editor => {
        this._creating = null;
        if (!this.isConnected) {
          void editor.destroy();
          return;
        }
        this._editor = editor;
        if (this._pendingValue !== null) {
          editor.setData(this._pendingValue);
          this._pendingValue = null;
        }
        this._applyReadOnly();
        editor.model.document.on('change:data', () => this._scheduleSync());
        this._syncFormValue();
        this.dispatchEvent(new CustomEvent('ready', { detail: editor, bubbles: true }));
      })
      .catch(error => {
        this._creating = null;
        console.error(error);
        this.dispatchEvent(new CustomEvent('error', { detail: error, bubbles: true }));
      });
  }

  public disconnectedCallback(): void {
    // Moving the element (detach + re-attach in one task) keeps the editor.
    queueMicrotask(() => {
      if (this.isConnected || !this._editor) return;
      const editor = this._editor;
      this._editor = null;
      this._initialValue = editor.getData();
      void editor.destroy();
    });
  }

  public attributeChangedCallback(name: string): void {
    if (!this._editor) return;
    // The placeholder is read when the editor is created.
    if (name === 'readonly' || name === 'disabled') this._applyReadOnly();
  }

  // Form-associated custom element callbacks.
  public formResetCallback(): void {
    this.value = this._initialValue;
  }

  public formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled;
    this._applyReadOnly();
  }

  public formStateRestoreCallback(state: string): void {
    this.value = state;
  }

  private _options(): CreateEditorOptions {
    const options: CreateEditorOptions = { ...this.config };
    const preset = this.getAttribute('preset') as PresetName | null;
    if (preset) options.preset = preset;
    const placeholder = this.getAttribute('placeholder');
    if (placeholder) options.placeholder = placeholder;
    const uploadUrl = this.getAttribute('upload-url');
    if (uploadUrl) options.upload = { ...(options.upload || {}), url: uploadUrl, withCredentials: this.hasAttribute('upload-credentials') || options.upload?.withCredentials };
    if (this.getAttribute('toolbar') === 'classic') options.ribbon = false;
    const label = this.getAttribute('aria-label');
    if (label) options.label = label;
    options.initialData = this._pendingValue ?? this._initialValue;
    this._pendingValue = null;
    return options;
  }

  private _readInitialContent(): string {
    const template = this.querySelector(':scope > template');
    if (template) return (template as HTMLTemplateElement).innerHTML.trim();
    const textarea = this.querySelector(':scope > textarea');
    if (textarea) return (textarea as HTMLTextAreaElement).value.trim();
    return this.innerHTML.trim();
  }

  private _applyReadOnly(): void {
    const editor = this._editor;
    if (!editor) return;
    const readOnly = this.hasAttribute('readonly') || this.hasAttribute('disabled') || this._formDisabled;
    if (readOnly) editor.enableReadOnlyMode(READ_ONLY_LOCK);
    else editor.disableReadOnlyMode(READ_ONLY_LOCK);
  }

  private _scheduleSync(): void {
    this.dispatchEvent(new Event('input', { bubbles: true }));
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this._syncTimer = null;
      this._syncFormValue();
      this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value }, bubbles: true }));
    }, SYNC_DELAY);
  }

  private _syncFormValue(): void {
    const value = this._editor ? this._editor.getData() : this._initialValue;
    if (this._internals) this._internals.setFormValue(value);
    if (this._hiddenInput) this._hiddenInput.value = value;
  }
}

/**
 * Registers `<aveon-editor>` (or another tag name). Safe to call more than once.
 * Remember to load the theme stylesheet (and `katex/dist/katex.min.css` for equations).
 */
export function defineEditorElement(tagName = 'aveon-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(tagName)) return;
  // A subclass per tag name: one constructor cannot be registered twice.
  customElements.define(tagName, class extends AveonEditorElement {});
}
