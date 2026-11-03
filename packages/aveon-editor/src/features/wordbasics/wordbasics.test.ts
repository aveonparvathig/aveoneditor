import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../../builds/presets';
import { convertCase } from './wordbasics';
import { Observable } from '../../utils/observable';

async function createEditor(html: string, config: Record<string, unknown> = {}) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset, ...config });
}

function selectAllText(editor: ClassicEditor): void {
  editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(0) as any, 'in'));
}

describe('convertCase', () => {
  it('converts every mode without changing the length', () => {
    expect(convertCase('hello WORLD. again', 'sentence')).toBe('Hello world. Again');
    expect(convertCase('Hello World', 'lower')).toBe('hello world');
    expect(convertCase('Hello World', 'upper')).toBe('HELLO WORLD');
    expect(convertCase('hello wide world', 'title')).toBe('Hello Wide World');
    expect(convertCase('Hello', 'toggle')).toBe('hELLO');
    // ß upper-cases to two letters; it is kept so the selection stays exact.
    expect(convertCase('straße', 'upper')).toBe('STRAßE');
  });
});

describe('observable multi-property binding', () => {
  it('binds each property to the matching source property', () => {
    const source = new Observable() as any;
    source.set({ value: false, isEnabled: true });
    const target = new Observable() as any;
    target.set({ isOn: undefined, isEnabled: undefined });
    target.bind('isOn', 'isEnabled').to(source, 'value', 'isEnabled');
    expect(target.isOn).toBe(false);
    expect(target.isEnabled).toBe(true);
    source.value = true;
    expect(target.isOn).toBe(true);
  });
});

describe('word basics', () => {
  it('changes case while keeping formatting', async () => {
    const editor = await createEditor('<p><strong>hello</strong> world</p>');
    selectAllText(editor);
    editor.execute('changeCase', { value: 'upper' });
    expect(editor.getData()).toBe('<p><strong>HELLO</strong> WORLD</p>');
    editor.execute('changeCase', { value: 'title' });
    expect(editor.getData()).toBe('<p><strong>Hello</strong> World</p>');
    expect(editor.model.document.selection.isCollapsed).toBe(false);
    await editor.destroy();
  });

  it('grows and shrinks the font through the configured sizes', async () => {
    const editor = await createEditor('<p>Text</p>');
    selectAllText(editor);
    editor.execute('fontSizeIncrease');
    expect(editor.commands.get('fontSize')!.value).toBe('big');
    editor.execute('fontSizeIncrease');
    expect(editor.commands.get('fontSize')!.value).toBe('huge');
    expect(editor.commands.get('fontSizeIncrease')!.isEnabled).toBe(false);
    editor.execute('fontSizeDecrease');
    editor.execute('fontSizeDecrease');
    expect(editor.commands.get('fontSize')!.value).toBeUndefined();
    await editor.destroy();
  });

  it('copies formatting with the Format Painter', async () => {
    const editor = await createEditor('<p><strong><i>styled</i></strong> plain</p>');
    const root = editor.model.document.getRoot()!;
    const paragraph = root.getChild(0) as any;
    editor.model.change(writer => writer.setSelection(writer.createRange(writer.createPositionAt(paragraph, 1), writer.createPositionAt(paragraph, 3))));
    editor.execute('formatPainter');
    expect(editor.commands.get('formatPainter')!.value).toBe(true);
    editor.model.change(writer => writer.setSelection(writer.createRange(writer.createPositionAt(paragraph, 7), writer.createPositionAt(paragraph, 12))));
    (editor.commands.get('formatPainter') as any).apply();
    expect(editor.getData()).toBe('<p><i><strong>styled</strong></i> <i><strong>plain</strong></i></p>');
    expect(editor.commands.get('formatPainter')!.value).toBe(false);
    await editor.destroy();
  });

  it('toggles full screen', async () => {
    const editor = await createEditor('<p>Text</p>');
    editor.execute('fullscreen');
    expect(editor.ui.element!.classList.contains('ck-editor_fullscreen')).toBe(true);
    editor.execute('fullscreen');
    expect(editor.ui.element!.classList.contains('ck-editor_fullscreen')).toBe(false);
    await editor.destroy();
  });
});

describe('list dropdowns', () => {
  it('have clickable items that apply the chosen option', async () => {
    const editor = await createEditor('<p>Text</p>');
    selectAllText(editor);
    const dropdown = editor.ui.componentFactory.create('fontSize') as any;
    dropdown.render();
    document.body.appendChild(dropdown.element);
    dropdown.isOpen = true;
    const big = [...dropdown.element.querySelectorAll('.ck-list .ck-button')].find((b: Element) => b.textContent === 'Big') as HTMLButtonElement;
    expect(big.classList.contains('ck-disabled')).toBe(false);
    big.click();
    expect(editor.getData()).toBe('<p><span class="text-big">Text</span></p>');
    dropdown.destroy();
    await editor.destroy();
  });
});

describe('ribbon', () => {
  it('builds tabs and labelled groups, skipping unavailable items', async () => {
    const editor = await createEditor('<p>Text</p>', {
      ribbon: {
        quickAccess: ['undo', 'redo'],
        tabs: [
          { label: 'Home', groups: [{ label: 'Font', items: ['bold', 'italic', '-', 'underline'] }, { label: 'Missing', items: ['doesNotExist'] }] },
          { label: 'Insert', groups: [{ label: 'Tables', items: ['insertTable'] }] },
          { label: 'Empty', groups: [{ label: 'Nothing', items: ['nope'] }] }
        ]
      }
    });
    const ribbon = editor.ui.view.ribbon!;
    expect(ribbon).not.toBeNull();
    const element = ribbon.element!;
    const tabs = [...element.querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
    expect(tabs).toEqual(['Home', 'Insert']);
    expect([...element.querySelectorAll('.ck-ribbon__group-label')].map(label => label.textContent)).toEqual(['Font', 'Tables']);
    expect(element.querySelectorAll('.ck-ribbon__quick-access .ck-button').length).toBe(2);
    expect(element.querySelectorAll('.ck-ribbon__panel:not(.ck-hidden)').length).toBe(1);

    (ribbon.tabs.get(1)!.element as HTMLElement).click();
    expect(ribbon.activeTab).toBe(1);
    expect(ribbon.tabs.get(1)!.element!.getAttribute('aria-selected')).toBe('true');
    expect(ribbon.panels.get(1)!.element!.classList.contains('ck-hidden')).toBe(false);
    expect(ribbon.panels.get(0)!.element!.classList.contains('ck-hidden')).toBe(true);

    ribbon.toggleCollapsed();
    expect(element.classList.contains('ck-ribbon_collapsed')).toBe(true);
    await editor.destroy();
  });

  it('shows the font name and size as boxes with the current value', async () => {
    const editor = await createEditor('<p>Text</p>');
    const element = editor.ui.view.ribbon!.element!;
    const family = element.querySelector('.ck-ribbon__item_combo.ck-font-family-dropdown .ck-button__label')!;
    const size = element.querySelector('.ck-ribbon__item_combo.ck-font-size-dropdown .ck-button__label')!;
    selectAllText(editor);
    editor.execute('fontFamily', { value: 'Georgia, serif' });
    editor.execute('fontSize', { value: 'big' });
    expect(family.textContent).toBe('Georgia');
    expect(size.textContent).toBe('Big');
    // The box keeps its name in the tooltip.
    expect(element.querySelector('.ck-font-size-dropdown > .ck-button')!.getAttribute('data-cke-tooltip-text')).toBe('Font Size');
    await editor.destroy();
  });

  it('shows the Table and Picture tabs only in their context', async () => {
    const editor = await createEditor('<p>Text</p><figure class="table"><table><tbody><tr><td>Cell</td></tr></tbody></table></figure>');
    const ribbon = editor.ui.view.ribbon!;
    const visibleTabs = () => [...ribbon.element!.querySelectorAll('[role="tab"]:not(.ck-hidden)')].map(tab => tab.textContent);
    expect(visibleTabs()).not.toContain('Table');

    const root = editor.model.document.getRoot()!;
    const cell = (root.getChild(1) as any).getChild(0).getChild(0).getChild(0);
    editor.model.change(writer => writer.setSelection(cell, 0));
    expect(visibleTabs()).toContain('Table');
    expect(visibleTabs()).not.toContain('Picture');

    // Opening the Table tab and then leaving the table returns to the last normal tab.
    ribbon.activeTab = visibleTabs().indexOf('Insert');
    const tableTab = [...ribbon.tabs].findIndex(tab => tab.label === 'Table');
    ribbon.activeTab = tableTab;
    editor.model.change(writer => writer.setSelection(root.getChild(0) as any, 0));
    expect(visibleTabs()).not.toContain('Table');
    expect(ribbon.tabs.get(ribbon.activeTab)!.label).toBe('Insert');
    await editor.destroy();
  });

  it('finds and runs commands from the search box', async () => {
    const editor = await createEditor('<p>Text</p>');
    const search = editor.ui.view.ribbon!.searchView;
    const results = search.search('bold');
    expect(results[0].label).toBe('Bold');
    expect(results[0].path).toBe('Home › Font');
    expect(search.search('zzz')).toEqual([]);
    // A command on another tab opens that tab.
    const exportResult = search.search('pdf')[0];
    expect(exportResult.path).toMatch(/^File/);

    selectAllText(editor);
    results[0].run();
    expect(editor.getData()).toBe('<p><strong>Text</strong></p>');
    await editor.destroy();
  });

  it('falls back to the toolbar when the ribbon is turned off', async () => {
    const editor = await createEditor('<p>Text</p>', { ribbon: false });
    expect(editor.ui.view.ribbon).toBeNull();
    expect(editor.ui.view.toolbar.element!.isConnected).toBe(true);
    await editor.destroy();
  });
});
