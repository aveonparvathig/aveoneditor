/**
 * Merge fields: placeholders such as `{{customer.name}}` for templates (quotes, invoices, emails).
 *
 * - Shown as chips in the editor; inserted from the "Insert merge field" dropdown or by typing
 *   `{{customer.name}}` (known ids only).
 * - Saved as `<span class="merge-field" data-field="customer.name">{{customer.name}}</span>`.
 * - "Preview results" shows `mergeFields.previewData` values in place of the labels.
 * - `renderMergeFields(html, data)` fills saved HTML with real values (server or browser).
 *
 *   mergeFields: {
 *     definitions: [
 *       { group: 'Customer', definitions: [{ id: 'customer.name', label: 'Customer name' }] },
 *       { id: 'today', label: 'Today' }
 *     ],
 *     previewData: { customer: { name: 'Northwind Traders' }, today: '28 Oct 2026' }
 *   }
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import { Widget } from '../widget/widget';
import { toWidget } from '../widget/utils';
import { upcastAtomic, escapeHtml } from '../shared/upcast';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Editor } from '../../core/editor';

export interface MergeFieldDefinition {
  id: string;
  label?: string;
}

export interface MergeFieldGroup {
  group: string;
  definitions: MergeFieldDefinition[];
}

export interface MergeFieldsConfig {
  definitions?: Array<MergeFieldDefinition | MergeFieldGroup>;
  /** Values shown by "Preview results" (nested objects or flat `{ 'customer.name': … }`). */
  previewData?: Record<string, unknown>;
}

const MODEL = 'mergeField';
const ID_PATTERN = /^[\w.-]+$/;

/** Value of `id` in `data`: flat keys first (`'customer.name'`), then nested paths. */
export function resolveMergeValue(data: Record<string, unknown> | undefined, id: string): unknown {
  if (!data) return undefined;
  if (id in data) return data[id];
  let value: any = data;
  for (const part of id.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = value[part];
  }
  return value;
}

export interface RenderMergeFieldsOptions {
  /** What to output for fields without a value: keep `{{id}}` (default), an empty string, or a custom text. */
  missing?: 'keep' | 'empty' | ((id: string) => string);
  /** Values are HTML-escaped unless this is true (only for trusted HTML values). */
  allowHtml?: boolean;
}

/** Replaces merge-field spans in saved HTML with values from `data`. */
export function renderMergeFields(html: string, data: Record<string, unknown>, options: RenderMergeFieldsOptions = {}): string {
  return html.replace(/<span\b([^>]*)>[\s\S]*?<\/span>/g, (match, attributes: string) => {
    if (!/\bclass="[^"]*\bmerge-field\b/.test(attributes)) return match;
    const idMatch = /\bdata-field="([^"]*)"/.exec(attributes);
    if (!idMatch) return match;
    const id = idMatch[1].replace(/&amp;/g, '&');
    const value = resolveMergeValue(data, id);
    if (value === undefined || value === null) {
      const missing = options.missing || 'keep';
      if (missing === 'empty') return '';
      if (typeof missing === 'function') return escapeHtml(missing(id));
      return escapeHtml(`{{${id}}}`);
    }
    return options.allowHtml ? String(value) : escapeHtml(String(value));
  });
}

/** Inserts a merge field at the selection. */
export class MergeFieldCommand extends Command {
  public override refresh(): void {
    this.isEnabled = this.editor.model.schema.findAllowedParent(this.editor.model.document.selection.getFirstPosition()!, MODEL) !== null;
  }

  public override execute(options: { id: string }): void {
    const model = this.editor.model;
    if (!options || !options.id || !ID_PATTERN.test(options.id)) return;
    model.change(writer => {
      const element = writer.createElement(MODEL, { fieldId: options.id });
      model.insertContent(element);
      writer.setSelection(element, 'after');
    });
  }
}

/** Toggles showing preview values instead of field labels. */
export class MergeFieldsPreviewCommand extends Command {
  constructor(editor: Editor, private readonly _onChange: () => void) {
    super(editor);
    this.affectsData = false;
    this.value = false;
  }

  public override refresh(): void {
    this.isEnabled = true;
  }

  public override execute(options: { value?: boolean } = {}): void {
    this.value = options.value ?? !this.value;
    this._onChange();
  }
}

export class MergeFields extends Plugin {
  private _definitions: MergeFieldDefinition[] = [];
  private _groups: MergeFieldGroup[] = [];
  private _previewData: Record<string, unknown> | undefined;

  public static override get pluginName(): string {
    return 'MergeFields';
  }

  public static override get requires() {
    return [Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const config = (editor.config.get('mergeFields') as MergeFieldsConfig | undefined) || {};
    this._readDefinitions(config.definitions || []);
    this._previewData = config.previewData;

    editor.model.schema.register(MODEL, { allowWhere: '$text', isInline: true, isObject: true, allowAttributesOf: '$text', allowAttributes: ['fieldId'] });

    editor.conversion.for('upcast').add(dispatcher => {
      dispatcher.on(
        'element:span',
        upcastAtomic(
          view => view.hasClass('merge-field') && ID_PATTERN.test(String(view.getAttribute('data-field') || '')),
          (view, writer) => writer.createElement(MODEL, { fieldId: String(view.getAttribute('data-field')) })
        ),
        { priority: 'high' }
      );
    });
    editor.conversion.for('dataDowncast').elementToElement({
      model: MODEL,
      view: (element: ModelElement, { writer }: any) => {
        const id = String(element.getAttribute('fieldId'));
        const span = writer.createContainerElement('span', { class: 'merge-field', 'data-field': id });
        writer.insert(writer.createPositionAt(span, 0), writer.createText(`{{${id}}}`));
        return span;
      }
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: MODEL,
      view: (element: ModelElement, { writer }: any) => {
        const id = String(element.getAttribute('fieldId'));
        const preview = this.isPreviewing ? resolveMergeValue(this._previewData, id) : undefined;
        const known = this._definitions.some(definition => definition.id === id);
        const text = preview !== undefined && preview !== null ? String(preview) : this.getLabel(id);
        const classes = ['ck-merge-field', preview !== undefined ? 'ck-merge-field_preview' : '', known ? '' : 'ck-merge-field_unknown'].filter(Boolean).join(' ');
        const span = writer.createContainerElement('span', { class: classes, 'data-field': id, title: `{{${id}}}` });
        writer.insert(writer.createPositionAt(span, 0), writer.createText(text));
        return toWidget(span, writer, { label: `${editor.t('Merge field')}: ${this.getLabel(id)}` });
      }
    });

    editor.commands.add('mergeField', new MergeFieldCommand(editor));
    editor.commands.add('mergeFieldsPreview', new MergeFieldsPreviewCommand(editor, () => this._refreshFields()));
    this._convertTypedFields();
    this._addUI();
  }

  /** All known fields (flattened). */
  public get definitions(): MergeFieldDefinition[] {
    return this._definitions.slice();
  }

  public get isPreviewing(): boolean {
    const command = this.editor.commands.get('mergeFieldsPreview');
    return !!(command && command.value);
  }

  public getLabel(id: string): string {
    const definition = this._definitions.find(item => item.id === id);
    return definition ? definition.label || definition.id : id;
  }

  /** Values shown by "Preview results". */
  public get previewData(): Record<string, unknown> | undefined {
    return this._previewData;
  }

  /** Replaces the preview values (e.g. after the user picks a customer). */
  public setPreviewData(data: Record<string, unknown> | undefined): void {
    this._previewData = data;
    (this as any).hasPreviewData = !!data;
    if (this.isPreviewing) this._refreshFields();
  }

  private _readDefinitions(entries: Array<MergeFieldDefinition | MergeFieldGroup>): void {
    const ungrouped: MergeFieldDefinition[] = [];
    for (const entry of entries) {
      if ('group' in entry) this._groups.push({ group: entry.group, definitions: entry.definitions.filter(d => ID_PATTERN.test(d.id)) });
      else if (ID_PATTERN.test(entry.id)) ungrouped.push(entry);
    }
    if (ungrouped.length) this._groups.unshift({ group: '', definitions: ungrouped });
    this._definitions = this._groups.flatMap(group => group.definitions);
  }

  private _refreshFields(): void {
    const editor = this.editor;
    for (const root of editor.model.document.roots) {
      if (root.rootName === '$graveyard') continue;
      for (const item of editor.model.createRangeIn(root).getItems()) {
        if ((item as any).is('element', MODEL)) editor.editing.reconvertItem(item as ModelElement);
      }
    }
  }

  /** Typing `{{known.id}}` turns the text into a field. */
  private _convertTypedFields(): void {
    const editor = this.editor;
    const insertText = editor.commands.get('insertText');
    if (!insertText) return;
    this.listenTo(insertText, 'execute', () => {
      const selection = editor.model.document.selection;
      if (!selection.isCollapsed) return;
      const position = selection.getFirstPosition()!;
      const parent = position.parent as any;
      let text = '';
      for (const child of parent.getChildren()) {
        if (child.is('$text')) text += child.data;
        else text += '￼';
      }
      text = text.slice(0, position.offset);
      const match = /\{\{\s*([\w.-]+)\s*\}\}$/.exec(text);
      if (!match || !this._definitions.some(definition => definition.id === match[1])) return;
      editor.model.change(writer => {
        const start = writer.createPositionAt(parent, position.offset - match[0].length);
        writer.remove(writer.createRange(start, writer.createPositionAt(parent, position.offset)));
        const element = writer.createElement(MODEL, { fieldId: match[1] });
        writer.insert(element, start);
        writer.setSelection(element, 'after');
      });
    }, { priority: 'low' });
  }

  private _addUI(): void {
    const editor = this.editor;
    const t = editor.t;
    (this as any).set('hasPreviewData', !!this._previewData);
    if (this._definitions.length) {
      editor.ui.componentFactory.add('mergeFields', locale => {
        const command = editor.commands.get('mergeField')!;
        const dropdown = createDropdown(locale);
        dropdown.buttonView.set({ label: t('Insert merge field'), icon: icons.mergeField, tooltip: true });
        dropdown.bind('isEnabled').to(command);
        addListToDropdown(
          dropdown,
          () => {
            const items = new Collection<ListDropdownItemDefinition>();
            for (const group of this._groups) {
              if (group.group) {
                if (items.length) items.add({ type: 'separator' });
                const header = new Observable() as any;
                header.set({ label: group.group, withText: true, isEnabled: false, class: 'ck-merge-field-group' });
                items.add({ type: 'button', model: header });
              }
              for (const definition of group.definitions) {
                const model = new Observable() as any;
                model.set({ label: definition.label || definition.id, withText: true, fieldId: definition.id, tooltip: `{{${definition.id}}}`, role: 'menuitem' });
                items.add({ type: 'button', model });
              }
            }
            return items;
          },
          { role: 'menu', ariaLabel: t('Merge fields') }
        );
        this.listenTo(dropdown, 'execute', (evt: any) => {
          if (!evt.source.fieldId) return;
          editor.execute('mergeField', { id: evt.source.fieldId });
          editor.editing.view.focus();
        });
        return dropdown;
      });
    }
    if (!this._definitions.length) return;
    editor.ui.componentFactory.add('mergeFieldsPreview', locale => {
      const command = editor.commands.get('mergeFieldsPreview')!;
      const button = new ButtonView(locale);
      button.set({ label: t('Preview results'), icon: icons.preview, tooltip: true, isToggleable: true });
      button.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      button.bind('isEnabled').to(this, 'hasPreviewData' as any);
      this.listenTo(button, 'execute', () => editor.execute('mergeFieldsPreview'));
      return button;
    });
  }
}
