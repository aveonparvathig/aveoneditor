import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../builds/presets';

async function createEditor(html: string) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  const editor = await ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset });
  return editor;
}

describe('features', () => {
  it('round-trips nested lists', async () => {
    const editor = await createEditor('<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li><li>Three</li></ul><p>After</p>');
    expect(editor.getData()).toBe('<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li><li>Three</li></ul><p>After</p>');
    await editor.destroy();
  });

  it('round-trips code blocks with newlines', async () => {
    const editor = await createEditor('<pre><code class="language-javascript">const a = 1;\nconst b = 2;</code></pre>');
    expect(editor.getData()).toBe('<pre><code class="language-javascript">const a = 1;\nconst b = 2;</code></pre>');
    await editor.destroy();
  });

  it('round-trips tables without wrapping single paragraphs', async () => {
    const editor = await createEditor('<figure class="table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></figure>');
    expect(editor.getData()).toBe('<figure class="table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></figure>');
    await editor.destroy();
  });

  it('executes list, heading and formatting commands', async () => {
    const editor = await createEditor('<p>Hello world</p>');
    editor.model.change(writer => {
      writer.setSelection(editor.model.document.getRoot()!.getChild(0) as any, 'in');
    });
    editor.execute('bold');
    editor.execute('bulletedList');
    expect(editor.getData()).toBe('<ul><li><strong>Hello world</strong></li></ul>');
    editor.execute('indentList');
    editor.execute('bulletedList');
    editor.execute('heading', { value: 'heading1' });
    expect(editor.getData()).toBe('<h2><strong>Hello world</strong></h2>');
    editor.execute('alignment', { value: 'center' });
    expect(editor.getData()).toBe('<h2 style="text-align:center;"><strong>Hello world</strong></h2>');
    editor.execute('undo');
    editor.execute('undo');
    expect(editor.getData()).toBe('<p><strong>Hello world</strong></p>');
    editor.execute('undo');
    expect(editor.getData()).toBe('<ul><li><strong>Hello world</strong></li></ul>');
    editor.execute('redo');
    expect(editor.getData()).toBe('<p><strong>Hello world</strong></p>');
    await editor.destroy();
  });

  it('inserts images and tables through commands', async () => {
    const editor = await createEditor('<p></p>');
    editor.execute('insertImage', { source: 'https://example.com/a.png' });
    expect(editor.getData()).toContain('<figure class="image"><img src="https://example.com/a.png"></figure>');
    editor.execute('insertTable', { rows: 2, columns: 2 });
    expect(editor.getData()).toContain('<figure class="table"><table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table></figure>');
    await editor.destroy();
  });

  it('links selected text', async () => {
    const editor = await createEditor('<p>Hello world</p>');
    editor.model.change(writer => {
      const p = editor.model.document.getRoot()!.getChild(0) as any;
      writer.setSelection(writer.createRange(writer.createPositionAt(p, 0), writer.createPositionAt(p, 5)));
    });
    editor.execute('link', 'https://example.com');
    expect(editor.getData()).toBe('<p><a href="https://example.com">Hello</a> world</p>');
    editor.execute('unlink');
    expect(editor.getData()).toBe('<p>Hello world</p>');
    await editor.destroy();
  });
});
