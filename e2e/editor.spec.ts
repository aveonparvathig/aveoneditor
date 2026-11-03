import { test, expect, type Page } from '@playwright/test';

/** The demo editor's HTML. */
const data = (page: Page) => page.evaluate(() => (window as any).editor.getData() as string);

async function openDemo(page: Page, html = '<p>Start</p>') {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).editor);
  await page.evaluate(content => (window as any).editor.setData(content), html);
}

/** The shortcut key the page's platform uses (Playwright's Safari profiles report a Mac on any host). */
const modifier = (page: Page) => page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Meta' : 'Control'));

/** Puts the cursor at the end of the first paragraph with this text. */
async function clickEndOf(page: Page, text: string) {
  await page.locator('.ck-editor__editable p', { hasText: text }).first().click();
  await page.keyboard.press('End');
}

test('typing, Enter and Backspace change the document', async ({ page }) => {
  await openDemo(page);
  await clickEndOf(page, 'Start');
  await page.keyboard.type(' typed here');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second linee');
  await page.keyboard.press('Backspace');
  await expect.poll(() => data(page)).toBe('<p>Start typed here</p><p>Second line</p>');
});

test('keyboard formatting and undo', async ({ page }) => {
  await openDemo(page);
  await clickEndOf(page, 'Start');
  const mod = await modifier(page);
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type(' bold');
  await expect.poll(() => data(page)).toBe('<p>Start<strong> bold</strong></p>');
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => data(page)).toBe('<p>Start</p>');
});

test('ribbon: font boxes show the value at the cursor', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Ribbon checks run at desktop sizes.');
  await openDemo(page, '<h2>Title</h2><p>Body</p>');
  await clickEndOf(page, 'Body');
  const size = page.locator('.ck-ribbon .ck-font-size-dropdown .ck-button__label');
  await expect(size).toHaveText(/^\d+$/);
  const bodySize = Number(await size.textContent());
  await page.locator('.ck-editor__editable h2').click();
  await expect.poll(async () => Number(await size.textContent())).toBeGreaterThan(bodySize);
});

test('ribbon: command search finds and runs a command', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Ribbon checks run at desktop sizes.');
  await openDemo(page, '<p>Make this bold</p>');
  await page.evaluate(() => {
    const editor = (window as any).editor;
    editor.model.change((writer: any) => writer.setSelection(editor.model.document.getRoot().getChild(0), 'in'));
  });
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await search.fill('bold');
  await expect(page.locator('.ck-ribbon__search-result').first()).toContainText('Bold');
  await search.press('Enter');
  await expect.poll(() => data(page)).toBe('<p><strong>Make this bold</strong></p>');
});

test('ribbon: the Table tab appears only inside a table', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Ribbon checks run at desktop sizes.');
  await openDemo(page, '<p>Text</p><figure class="table"><table><tbody><tr><td>Cell</td></tr></tbody></table></figure>');
  const tableTab = page.getByRole('tab', { name: 'Table', exact: true });
  await clickEndOf(page, 'Text');
  await expect(tableTab).toBeHidden();
  await page.locator('.ck-editor__editable td').first().click();
  await expect(tableTab).toBeVisible();
  await tableTab.click();
  await expect(page.getByRole('tabpanel').filter({ hasText: 'Rows & Columns' })).toBeVisible();
});

test('the equation dialog stays inside the window', async ({ page }) => {
  await openDemo(page, '<p>x</p>');
  await clickEndOf(page, 'x');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLElement>('.ck-ribbon .ck-button, .ck-toolbar .ck-button')].find(b => (b.getAttribute('data-cke-tooltip-text') || '').startsWith('Insert math equation'));
    button!.click();
  });
  const dialog = page.locator('.ck-balloon-panel_visible .ck-math-form');
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});

test('a selected formula is removed with Delete', async ({ page }) => {
  await openDemo(page, '<p>Before <span class="math-tex">\\(x^2\\)</span> after</p>');
  await page.locator('.ck-editor__editable .ck-math-tex').first().click();
  await page.keyboard.press('Delete');
  await expect.poll(() => data(page)).not.toContain('math-tex');
});

test('<aveon-editor> posts its HTML with the form', async ({ page }) => {
  await page.goto('/integration.html');
  const editable = page.locator('#comment-form .ck-editor__editable');
  await editable.click();
  await page.keyboard.type('Great product');
  await page.locator('#comment-form button[type="submit"]').click();
  await expect(page.locator('#comment-output')).toContainText('<p>Great product</p>');
});

test('a Bold request from the browser itself (iOS text menu) goes through the editor', async ({ page }) => {
  await openDemo(page);
  await clickEndOf(page, 'Start');
  const prevented = await page.evaluate(() => {
    const event = new InputEvent('beforeinput', { inputType: 'formatBold', bubbles: true, cancelable: true });
    document.querySelector('.ck-editor__editable')!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.keyboard.type('x');
  await expect.poll(() => data(page)).toBe('<p>Start<strong>x</strong></p>');
});

test('typing $…$ inserts an equation, but prices stay text', async ({ page }) => {
  await openDemo(page);
  await clickEndOf(page, 'Start');
  await page.keyboard.type(' area $\\pi r^2$ costs $5 and $10');
  await expect.poll(() => data(page)).toContain('\\(\\pi r^2\\)');
  expect(await data(page)).toContain('costs $5 and $10</p>');
});

test('pasted GitHub Markdown becomes headings, tasks, maths and drawn diagrams', async ({ page }) => {
  await openDemo(page, '<p>Start</p><p></p>');
  const markdown = [
    '## Notes',
    '',
    '- [x] Done',
    '',
    '```math',
    'E=mc^2',
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '    A --> B',
    '```',
    '',
    '```geojson',
    '{"type":"Point","coordinates":[2.35,48.85]}',
    '```',
    '',
    '```stl',
    'solid t',
    'facet normal 0 0 1',
    'outer loop',
    'vertex 0 0 0',
    'vertex 1 0 0',
    'vertex 0 1 0',
    'endloop',
    'endfacet',
    'endsolid t',
    '```'
  ].join('\n');
  await page.evaluate(text => {
    const editor = (window as any).editor;
    editor.editing.view.focus();
    editor.model.change((writer: any) => writer.setSelection(editor.model.document.getRoot().getChild(1), 0));
    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    editor.ui.getEditableElement().dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, markdown);
  const editable = page.locator('.ck-editor__editable');
  await expect(editable.locator('h2, h3').filter({ hasText: 'Notes' })).toBeVisible();
  await expect(editable.locator('.ck-diagram_mermaid svg')).toBeVisible({ timeout: 15000 });
  await expect(editable.locator('.ck-diagram_geojson circle')).toBeVisible();
  await expect(editable.locator('.ck-diagram_stl canvas')).toBeVisible();
  const html = await data(page);
  expect(html).toContain('checked');
  expect(html).toContain('\\[E=mc^2\\]');
  const back = await page.evaluate(() => (window as any).editor.plugins.get('Markdown').getMarkdown());
  expect(back).toContain('```mermaid\nflowchart LR\n    A --> B\n```');
});

test('an equation pasted from Word arrives as an editable equation', async ({ page }) => {
  await openDemo(page, '<p>Start</p><p></p>');
  await page.evaluate(() => {
    const editor = (window as any).editor;
    editor.editing.view.focus();
    editor.model.change((writer: any) => writer.setSelection(editor.model.document.getRoot().getChild(1), 0));
    // What Word puts on the clipboard: Office Math in a conditional comment, then a picture of it.
    const html =
      '<html><body><!--StartFragment--><p class=MsoNormal>Energy: <!--[if gte msEquation 12]><m:oMath><m:r><m:t>E=m</m:t></m:r>' +
      '<m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath><![endif]-->' +
      '<![if !msEquation]><img src="file:///C:/Temp/msohtmlclip1/01/clip_image001.png"><![endif]></p><!--EndFragment--></body></html>';
    const transfer = new DataTransfer();
    transfer.setData('text/html', html);
    editor.ui.getEditableElement().dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => data(page)).toContain('\\(E=mc^{2}\\)');
  expect(await data(page)).not.toContain('clip_image001');
});

test('ribbon: in a narrow window groups collapse to buttons instead of wrapping', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Ribbon checks run at desktop sizes.');
  await page.setViewportSize({ width: 840, height: 700 });
  await openDemo(page);
  const ribbon = page.locator('.ck-ribbon');
  // Tab row plus one row of groups.
  await expect.poll(async () => (await ribbon.boundingBox())!.height).toBeLessThan(180);
  // The everyday groups stay open; the less used ones collapse first.
  await expect(page.locator('.ck-ribbon__group:not(.ck-ribbon__group_compact) .ck-ribbon__group-label', { hasText: 'Font' })).toBeVisible();
  const clipboard = page.locator('.ck-ribbon__group_compact > .ck-ribbon__group-toggle', { hasText: 'Clipboard' });
  await expect(clipboard).toBeVisible();
  await clipboard.click();
  await expect(page.locator('.ck-ribbon__group_open .ck-ribbon__group-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ck-ribbon__group_open')).toHaveCount(0);
});

test('ribbon: on a phone-width ribbon every tab fits and search opens from its icon', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Ribbon checks run at desktop sizes.');
  await page.setViewportSize({ width: 560, height: 700 });
  await openDemo(page);
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('.ck-ribbon__tab:not(.ck-hidden)')]
      .filter(tab => tab.getBoundingClientRect().right > tab.parentElement!.getBoundingClientRect().right + 1)
      .map(tab => tab.textContent)
  );
  expect(cut).toEqual([]);
  const search = page.getByRole('combobox', { name: 'Search commands' });
  expect((await search.boundingBox())!.width).toBeLessThan(40);
  await search.click();
  await expect.poll(async () => (await search.boundingBox())!.width).toBeGreaterThan(120);
});
