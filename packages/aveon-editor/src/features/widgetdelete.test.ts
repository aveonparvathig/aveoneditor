import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../builds/presets';

async function createEditor(html: string) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset });
}

/** Presses a key the way a browser does on a selected widget: keydown only, no `beforeinput`. */
function press(editor: ClassicEditor, key: 'Delete' | 'Backspace'): void {
  const keyCode = key === 'Delete' ? 46 : 8;
  editor.ui.getEditableElement()!.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as any));
}

describe('deleting widgets with the keyboard', () => {
  it('removes selected horizontal lines inside a quote with Delete and Backspace', async () => {
    const editor = await createEditor('<blockquote><p>A quote.</p><hr><hr></blockquote><p>After</p>');
    const quote = editor.model.document.getRoot()!.getChild(0) as any;
    editor.model.change(writer => writer.setSelection(quote.getChild(1), 'on'));
    expect(editor.editing.view.document.selection.isFake).toBe(true);

    press(editor, 'Delete');
    // The line is gone without a blank paragraph; the next line is selected.
    expect(editor.getData()).toBe('<blockquote><p>A quote.</p><hr></blockquote><p>After</p>');
    expect(editor.model.document.selection.getSelectedElement()?.name).toBe('horizontalLine');

    press(editor, 'Backspace');
    expect(editor.getData()).toBe('<blockquote><p>A quote.</p></blockquote><p>After</p>');
    await editor.destroy();
  });

  it('selects a line with Backspace from the next paragraph, then removes it', async () => {
    const editor = await createEditor('<p>Before</p><hr><p>After</p>');
    editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(2) as any, 0));
    const fireDelete = () => {
      const data: any = { direction: 'backward', unit: 'codePoint', sequence: 1, preventDefault() {}, domEvent: { preventDefault() {} } };
      editor.editing.view.document.fire('delete', data);
    };
    fireDelete();
    expect(editor.model.document.selection.getSelectedElement()?.name).toBe('horizontalLine');
    press(editor, 'Backspace');
    expect(editor.getData()).toBe('<p>Before</p><p>After</p>');
    await editor.destroy();
  });

  it('keeps a paragraph when the removed widget was the only content', async () => {
    const editor = await createEditor('<hr>');
    editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(0) as any, 'on'));
    press(editor, 'Delete');
    expect(editor.getData()).toBe('');
    expect(editor.model.document.getRoot()!.childCount).toBe(1);
    await editor.destroy();
  });
});
