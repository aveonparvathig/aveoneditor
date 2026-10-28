/**
 * Phases 3–5: merge fields, templates, export, table of contents, footnotes, table captions,
 * sketches, comments and track changes.
 */

import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../builds/presets';
import { renderMergeFields } from './mergefields/mergefields';
import { buildExportDocument } from './export/export';
import type { Comments } from './comments/comments';
import type { TrackChanges } from './trackchanges/trackchanges';

async function createEditor(html: string, config: Record<string, unknown> = {}) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset, ...config });
}

function caretAt(editor: ClassicEditor, blockIndex: number, offset: number | 'end'): void {
  editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(blockIndex) as any, offset));
}

function select(editor: ClassicEditor, blockIndex: number, start: number, end: number): void {
  editor.model.change(writer => {
    const block = editor.model.document.getRoot()!.getChild(blockIndex) as any;
    writer.setSelection(writer.createRange(writer.createPositionAt(block, start), writer.createPositionAt(block, end)));
  });
}

const mergeFields = {
  definitions: [{ group: 'Customer', definitions: [{ id: 'customer.name', label: 'Customer name' }] }, { id: 'today', label: 'Today' }],
  previewData: { customer: { name: 'Northwind <Traders>' }, today: '28 Oct 2026' }
};

describe('merge fields', () => {
  it('inserts, converts typed placeholders, round-trips and previews', async () => {
    const editor = await createEditor('<p>Dear</p>', { mergeFields });
    caretAt(editor, 0, 'end');
    editor.execute('mergeField', { id: 'customer.name' });
    expect(editor.getData()).toBe('<p>Dear<span class="merge-field" data-field="customer.name">{{customer.name}}</span></p>');

    editor.execute('insertText', { text: ', today is {{today}}' });
    expect(editor.getData()).toContain('<span class="merge-field" data-field="today">{{today}}</span>');

    const chip = () => editor.ui.getEditableElement()!.querySelector('[data-field="customer.name"]')!.textContent;
    expect(chip()).toBe('Customer name');
    editor.execute('mergeFieldsPreview');
    expect(chip()).toBe('Northwind <Traders>');

    editor.setData(editor.getData());
    expect(editor.getData()).toContain('data-field="customer.name"');
    await editor.destroy();
  });

  it('fills saved HTML with escaped values', () => {
    const html = '<p>Hi <span class="merge-field" data-field="customer.name">{{customer.name}}</span>, <span class="merge-field" data-field="missing">{{missing}}</span></p>';
    expect(renderMergeFields(html, { customer: { name: 'A & <B>' } })).toBe('<p>Hi A &amp; &lt;B&gt;, {{missing}}</p>');
    expect(renderMergeFields(html, { 'customer.name': 'Flat' }, { missing: 'empty' })).toBe('<p>Hi Flat, </p>');
  });
});

describe('templates and export', () => {
  it('fills an empty document with a template and inserts into a non-empty one', async () => {
    const templates = [{ title: 'Quote', data: '<h2>Quotation</h2><p>Valid for 30 days.</p>' }, { title: 'Signature', data: () => Promise.resolve('<p>Kind regards</p>') }];
    const editor = await createEditor('<p></p>', { templates });
    await editor.execute('insertTemplate', { title: 'Quote' });
    expect(editor.getData()).toBe('<h2>Quotation</h2><p>Valid for 30 days.</p>');
    caretAt(editor, 1, 'end');
    await editor.execute('insertTemplate', { index: 1 });
    expect(editor.getData()).toContain('Kind regards');
    expect(editor.getData()).toContain('Quotation');
    await editor.destroy();
  });

  it('builds standalone HTML and Word documents', async () => {
    const editor = await createEditor('<h2>Report</h2><p>Body <span class="merge-field" data-field="today">{{today}}</span></p>', { mergeFields });
    const html = buildExportDocument(editor);
    expect(html).toContain('<title>Report</title>');
    expect(html).toContain('<div class="document"><h2>Report</h2>');
    editor.execute('mergeFieldsPreview');
    expect(buildExportDocument(editor)).toContain('Body 28 Oct 2026');
    const word = editor.execute('exportWord') as unknown as string;
    expect(word).toContain('urn:schemas-microsoft-com:office:word');
    await editor.destroy();
  });
});

describe('references', () => {
  it('builds a table of contents with links and heading ids', async () => {
    const editor = await createEditor('<p>Intro</p><h2>Scope</h2><h3>Details</h3><h2>Scope</h2>');
    caretAt(editor, 0, 0);
    editor.execute('insertTableOfContents');
    const data = editor.getData();
    expect(data).toContain('<nav class="table-of-contents">');
    expect(data).toContain('<a href="#scope">Scope</a>');
    expect(data).toContain('<a href="#details">Details</a>');
    expect(data).toContain('<h2 id="scope">Scope</h2>');
    expect(data).toContain('<h2 id="scope-2">Scope</h2>');
    // Reloading keeps one contents block.
    editor.setData(data);
    expect(editor.getData().match(/table-of-contents"/g)!.length).toBe(1);
    await editor.destroy();
  });

  it('numbers footnotes and keeps their list at the end', async () => {
    const editor = await createEditor('<p>First</p><p>Second</p>');
    caretAt(editor, 1, 'end');
    await editor.execute('insertFootnote', { note: 'Second note' });
    caretAt(editor, 0, 'end');
    await editor.execute('insertFootnote', { note: 'First note' });
    const data = editor.getData();
    expect(data).toContain('<sup class="footnote-ref" data-footnote="First note"><a href="#fn-1" id="fnref-1">1</a></sup>');
    expect(data).toMatch(/<section class="footnotes"><ol><li id="fn-1">First note .*<\/li><li id="fn-2">Second note/);
    expect(data.trim().endsWith('</section>')).toBe(true);

    editor.setData(data);
    expect(editor.getData()).toBe(data);

    // Removing the last footnotes removes the list.
    editor.setData('<p>Only text<sup class="footnote-ref" data-footnote="x"><a>1</a></sup></p>');
    editor.model.change(writer => {
      const paragraph = editor.model.document.getRoot()!.getChild(0) as any;
      writer.remove(paragraph.getChild(1));
    });
    expect(editor.getData()).toBe('<p>Only text</p>');
    await editor.destroy();
  });

  it('adds table captions', async () => {
    const editor = await createEditor('<figure class="table"><table><tbody><tr><td>A</td></tr></tbody></table></figure>');
    editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(0) as any, 'on'));
    await editor.execute('tableCaption', { caption: 'Table 1: Prices' });
    const data = editor.getData();
    expect(data).toBe('<figure class="table"><table><tbody><tr><td>A</td></tr></tbody></table><figcaption>Table 1: Prices</figcaption></figure>');
    expect(editor.ui.getEditableElement()!.querySelector('.ck-table-caption')!.textContent).toBe('Table 1: Prices');
    editor.setData(data);
    expect(editor.getData()).toBe(data);
    await editor.execute('tableCaption', { caption: '' });
    expect(editor.getData()).not.toContain('figcaption');
    await editor.destroy();
  });
});

describe('sketch', () => {
  it('saves drawings as SVG and drops anything else when loading', async () => {
    const editor = await createEditor('<p>x</p>');
    caretAt(editor, 0, 'end');
    await editor.execute('insertSketch', { data: { width: 100, height: 50, strokes: [{ color: '#cf222e', width: 4, points: [[1, 2], [30, 40]] }] } });
    const data = editor.getData();
    expect(data).toContain('<figure class="sketch"><svg');
    expect(data).toContain('d="M1 2L30 40"');
    expect(data).toContain('stroke="#cf222e"');

    editor.setData('<figure class="sketch"><svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><path d="M1 1L5 5" stroke="red;background:url(x)" onclick="x()"/></svg></figure>');
    const cleaned = editor.getData();
    expect(cleaned).not.toContain('script');
    expect(cleaned).not.toContain('onload');
    expect(cleaned).not.toContain('onclick');
    expect(cleaned).toContain('stroke="#000000"');
    expect(cleaned).toContain('d="M1 1L5 5"');
    await editor.destroy();
  });
});

describe('comments', () => {
  it('anchors threads in the text and keeps them as application data', async () => {
    const editor = await createEditor('<p>Please review this paragraph.</p>', { user: { id: 'u1', name: 'Asha Rao' } });
    const comments = editor.plugins.get('Comments') as Comments;
    const changes: number[] = [];
    comments.on('change', (evt, threads: unknown[]) => changes.push(threads.length));
    select(editor, 0, 7, 13);
    const id = (await editor.execute('addComment', { text: 'Is this the final wording?' })) as unknown as string;
    expect(editor.getData()).toBe(`<p>Please <span class="comment-anchor" data-comment="${id}">review</span> this paragraph.</p>`);
    comments.reply(id, 'Yes, approved.');
    comments.setResolved(id, true);
    const [thread] = comments.getThreads();
    expect(thread).toMatchObject({ id, text: 'Is this the final wording?', resolved: true, author: { id: 'u1', name: 'Asha Rao' } });
    expect(thread.replies[0].text).toBe('Yes, approved.');
    expect(changes.length).toBeGreaterThan(0);

    // Reloading the content with saved threads restores them.
    const saved = comments.getThreads();
    const data = editor.getData();
    await editor.destroy();
    const again = await createEditor(data, { comments: { threads: saved } });
    expect((again.plugins.get('Comments') as Comments).getThreads()[0].replies).toHaveLength(1);
    (again.plugins.get('Comments') as Comments).removeThread(id);
    expect(again.getData()).toBe('<p>Please review this paragraph.</p>');
    await again.destroy();
  });
});

describe('track changes', () => {
  it('records insertions and deletions as suggestions and resolves them', async () => {
    const editor = await createEditor('<p>The price is final.</p>', { user: { id: 'u1', name: 'Asha' } });
    const track = editor.plugins.get('TrackChanges') as TrackChanges;
    editor.execute('trackChanges');

    // Delete "final" (selected text is kept and marked).
    select(editor, 0, 13, 18);
    editor.execute('delete');
    expect(editor.getData()).toMatch(/<p>The price is <del class="suggestion-delete" data-author="Asha" data-author-id="u1" data-time="[^"]*">final<\/del>\.<\/p>/);

    // Type a replacement.
    caretAt(editor, 0, 13);
    editor.execute('insertText', { text: 'fixed ' });
    expect(editor.getData()).toMatch(/<ins class="suggestion-insert" data-author="Asha" data-author-id="u1" data-time="[^"]*">fixed <\/ins>/);
    expect(track.getSuggestions().map(s => [s.type, s.text])).toEqual([
      ['insert', 'fixed '],
      ['delete', 'final']
    ]);

    // Deleting one's own suggested text removes it for real.
    caretAt(editor, 0, 19);
    editor.execute('delete');
    expect(track.getSuggestions()[0].text).toBe('fixed');

    // Suggestions survive saving and reloading.
    editor.setData(editor.getData());
    expect(track.getSuggestions()).toHaveLength(2);

    editor.execute('acceptAllSuggestions');
    expect(editor.getData()).toBe('<p>The price is fixed.</p>');

    // Rejecting restores the original text.
    select(editor, 0, 0, 3);
    editor.execute('delete');
    editor.execute('rejectAllSuggestions');
    expect(editor.getData()).toBe('<p>The price is fixed.</p>');

    // Without tracking, editing is direct.
    editor.execute('trackChanges');
    select(editor, 0, 0, 4);
    editor.execute('delete');
    expect(editor.getData()).toBe('<p>price is fixed.</p>');
    await editor.destroy();
  });
});
