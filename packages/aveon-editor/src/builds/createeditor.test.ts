import { describe, it, expect } from 'vitest';
import { createEditor, resolveEditorOptions } from './createeditor';
import { defineEditorElement, type AveonEditorElement } from '../integrations/editorelement';
import { Base64UploadAdapter, SimpleUploadAdapter } from '../features/image/image';
import { Math as MathPlugin } from '../features/math/math';

function host(html = ''): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
}

describe('presets and createEditor()', () => {
  it('resolves presets, uploads and plugin changes', () => {
    const cms = resolveEditorOptions();
    expect(cms.plugins).not.toContain(MathPlugin);
    expect(cms.plugins).toContain(Base64UploadAdapter);

    const full = resolveEditorOptions({ preset: 'full' });
    expect(full.plugins).toContain(MathPlugin);

    const headers = () => ({ Authorization: 'Bearer token' });
    const uploading = resolveEditorOptions({ preset: 'erp', upload: { url: '/api/uploads', headers, fieldName: 'file' } });
    expect(uploading.plugins).toContain(SimpleUploadAdapter);
    expect(uploading.plugins).not.toContain(Base64UploadAdapter);
    expect(uploading.simpleUpload).toEqual({ uploadUrl: '/api/uploads', headers, withCredentials: undefined, fieldName: 'file' });

    const trimmed = resolveEditorOptions({ preset: 'cms', removePlugins: ['MediaEmbed'] });
    expect(trimmed.plugins.some(plugin => (plugin as any).pluginName === 'MediaEmbed')).toBe(false);

    expect(() => resolveEditorOptions({ preset: 'nope' as any })).toThrow(/aveon-unknown-preset/);
  });

  it('creates a basic editor with a plain toolbar from a selector', async () => {
    const element = host('<p>Hello</p>');
    element.id = 'basic-target';
    const editor = await createEditor('#basic-target', { preset: 'basic' });
    expect(editor.getData()).toBe('<p>Hello</p>');
    expect(editor.ui.view.ribbon).toBeNull();
    expect(editor.plugins.has('Table')).toBe(false);
    await editor.destroy();
  });

  it('creates an ERP editor with a ribbon using large, medium and small items', async () => {
    const editor = await createEditor(host('<p>Quote</p>'), { preset: 'erp' });
    const ribbon = editor.ui.view.ribbon!;
    expect([...ribbon.element!.querySelectorAll('[role="tab"]:not(.ck-hidden)')].map(tab => tab.textContent)).toEqual(['Home', 'Insert', 'Review', 'View']);
    const paste = ribbon.element!.querySelector('.ck-ribbon__item_large')!;
    expect(paste.textContent).toBe('Paste');
    const medium = [...ribbon.element!.querySelectorAll('.ck-ribbon__item_medium')].map(item => item.textContent);
    expect(medium.slice(0, 3)).toEqual(['Cut', 'Copy', 'Format']);
    // The short label replaces the full name, which moves to the tooltip.
    const format = [...ribbon.element!.querySelectorAll<HTMLElement>('.ck-ribbon__item_medium')].find(item => item.textContent === 'Format')!;
    expect(format.getAttribute('data-cke-tooltip-text')).toBe('Format Painter');
    expect(ribbon.element!.querySelector('.ck-ribbon__launcher')).not.toBeNull();
    await editor.destroy();
  });

  it('opens the Font dialog from the launcher and applies it as one step', async () => {
    const editor = await createEditor(host('<p>Text</p>'), { preset: 'erp' });
    editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(0) as any, 'in'));
    (editor.ui.view.ribbon!.element!.querySelector('.ck-ribbon__launcher') as HTMLButtonElement).click();
    const dialog = document.querySelector('.ck-dialog')!;
    expect(dialog.querySelector('.ck-dialog__title')!.textContent).toBe('Font');
    const bold = dialog.querySelector<HTMLInputElement>('input[data-effect="bold"]')!;
    bold.checked = true;
    bold.dispatchEvent(new Event('change'));
    const underline = dialog.querySelector<HTMLInputElement>('input[data-effect="underline"]')!;
    underline.checked = true;
    underline.dispatchEvent(new Event('change'));
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'OK')!.click();
    expect(document.querySelector('.ck-dialog')).toBeNull();
    expect(editor.getData()).toBe('<p><strong><u>Text</u></strong></p>');
    editor.execute('undo');
    expect(editor.getData()).toBe('<p>Text</p>');
    await editor.destroy();
  });
});

describe('<aveon-editor> options', () => {
  it('keeps config assigned before the element is defined', async () => {
    const element = document.createElement('aveon-editor-late') as any;
    element.setAttribute('preset', 'basic');
    element.config = { placeholder: 'Set early' };
    document.body.appendChild(element);
    defineEditorElement('aveon-editor-late');
    const editor = await (element as AveonEditorElement).whenReady();
    expect(editor.config.get('placeholder')).toBe('Set early');
    element.remove();
  });
});

describe('<aveon-editor>', () => {
  it('starts from its content, exposes the value and follows readonly', async () => {
    defineEditorElement();
    defineEditorElement(); // Registering twice is harmless.
    const form = document.createElement('form');
    form.innerHTML = '<aveon-editor name="body" preset="basic"><template><p>Initial</p></template></aveon-editor>';
    document.body.appendChild(form);
    const element = form.querySelector('aveon-editor') as AveonEditorElement;
    const editor = await element.whenReady();
    expect(element.value).toBe('<p>Initial</p>');
    expect(element.form).toBe(form);

    element.value = '<p>Changed</p>';
    expect(editor.getData()).toBe('<p>Changed</p>');
    // Without ElementInternals (jsdom) a hidden input carries the form value.
    expect(new FormData(form).get('body')).toBe('<p>Changed</p>');

    element.setAttribute('readonly', '');
    expect(editor.isReadOnly).toBe(true);
    element.removeAttribute('readonly');
    expect(editor.isReadOnly).toBe(false);
    form.remove();
  });
});
