# Aveon Editor

Aveon Editor is a rich text editor built on its own engine that mirrors the CKEditor 5 architecture: a document **model**, an editing **view**, **conversion** between them, **operations** with undo/redo, a **plugin** system, a UI framework and a theme. It ships the full CKEditor 5 classic-build feature set plus the commonly requested extras, uses the same `ck-*` class names and `--ck-*` CSS variables (so CKEditor styling guides apply), and comes with an Angular wrapper whose `<aveon-editor>` component mirrors `<ckeditor>`.

The code is an original, clean implementation. No CKEditor source is included.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/aveon-editor` | The editor library (`@aveon/editor`): engine, core, UI, features, builds, theme |
| `apps/demo` | Plain TypeScript demo (Vite) of the classic editor with every feature enabled |
| `apps/cms-angular` | Angular 22 workspace with the `aveon-angular` library and a demo CMS page |
| `apps/cms-angular/projects/aveon-angular` | The Angular integration library (`<aveon-editor>`) |

## Getting started

Requirements: Node 18+ (developed on Node 22) and npm.

```bash
npm install
```

Build the editor library, run its tests, or start the demo:

```bash
npm run build
```

```bash
npm test
```

```bash
npm run dev
```

The demo opens on http://localhost:5180.

Angular workspace (installs its own dependencies):

```bash
cd apps/cms-angular && npm install
```

```bash
npm run dev:angular
```

```bash
npm run build:angular
```

The Angular demo opens on http://localhost:4201. `build:angular` builds the `aveon-angular` library (ng-packagr, output in `apps/cms-angular/dist/aveon-angular`) and the demo app.

## Using the editor in plain JavaScript or TypeScript

```ts
import '@aveon/editor/theme.css';
import 'katex/dist/katex.min.css'; // equations (Math plugin)
import { ClassicEditor, classicPreset, classicDefaultConfig } from '@aveon/editor';

const editor = await ClassicEditor.create(document.querySelector('#editor'), {
  ...classicDefaultConfig,
  plugins: classicPreset,
  placeholder: 'Type something...'
});

editor.getData();                 // '<p>...</p>'
editor.setData('<p>Hello</p>');
editor.execute('bold');
editor.model.document.on('change:data', () => console.log('changed'));
editor.enableReadOnlyMode('my-lock');
await editor.destroy();
```

Editor types, like CKEditor 5: `ClassicEditor`, `InlineEditor`, `BalloonEditor`, `DecoupledEditor`.

Configuration keys mirror CKEditor 5: `plugins`, `extraPlugins`, `removePlugins`, `toolbar` (array or `{ items, shouldNotGroupWhenFull, removeItems }`), `placeholder`, `initialData`, `language`, `heading.options`, `image.toolbar`, `image.upload.types`, `table.contentToolbar`, `fontFamily.options`, `fontSize.options`, `fontColor.colors`, `codeBlock.languages`, `link.defaultProtocol`, `math.engine`, `math.outputType`, `math.katexOptions`, `math.altText`, `math.defaultMode`, `math.autoformat`, `math.toolbar`, `math.colors`, `math.numbering`, `math.handwriting`, `math.chemistry`, `math.speechLanguage`, `math.direction`, `math.decimalSeparator`, `math.imageRenderer`, `mediaEmbed.providers`, `wordCount.container`, `autosave.save`, and so on.

## Using the editor in Angular

Install the library build (or reference the source in your workspace) and import the standalone component:

```ts
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClassicEditor, classicPreset, classicDefaultConfig } from '@aveon/editor';
import { AveonEditorComponent } from 'aveon-angular';

@Component({
  selector: 'app-article',
  imports: [AveonEditorComponent, FormsModule],
  template: `
    <aveon-editor
      [editor]="Editor"
      [config]="config"
      [disabled]="locked"
      [(ngModel)]="body"
      (ready)="onReady($event)"
      (change)="onChange($event)"
      (focus)="onFocus($event)"
      (blur)="onBlur($event)">
    </aveon-editor>
  `
})
export class ArticleComponent {
  Editor = ClassicEditor;
  config = { ...classicDefaultConfig, plugins: classicPreset };
  body = '<p>Hello</p>';
  locked = false;
}
```

Add the theme once, for example in `styles.css`:

```css
@import '@aveon/editor/theme.css';
@import 'katex/dist/katex.min.css';
```

Inputs and outputs match the CKEditor 5 Angular component: `editor`, `config`, `data`, `tagName`, `disabled`, `disableTwoWayDataBinding`, and `ready`, `change`, `focus`, `blur`, `error`. The component implements `ControlValueAccessor`, so `ngModel`, `formControl` and `formControlName` work, including the disabled state. `AveonEditorModule` is available for module-based applications. Migrating a template from CKEditor means replacing the `<ckeditor>` tag and the editor class.

## Integrating into a CMS or ERP

Pick the route that matches the host application. All of them use the same presets.

### Presets

| Preset | For | What you get |
| --- | --- | --- |
| `basic` | Comments, short descriptions | Single toolbar: headings, bold, italic, underline, link, lists, quote |
| `cms` (default) | Articles, pages, product texts | Full ribbon: fonts, styles, tables, images, media, symbols, source view (no equations, so KaTeX is never loaded) |
| `erp` | Quotes, notes, emails, records | Compact ribbon (Home, Insert, View): fonts, Font dialog, tables, images, lists, find |
| `full` | Teaching, technical content | Everything, including equations, chemistry and handwriting |

### 1. A tag in any page: `<aveon-editor>`

Works in server-rendered pages (PHP, .NET, Java, Django, Rails…) and in React, Vue or Svelte. It is a real form field: it submits its HTML with the surrounding `<form>`, resets with it and can be disabled.

```html
<link rel="stylesheet" href="/assets/aveon/aveon-editor.standalone.css">
<script type="module" src="/assets/aveon/aveon-editor.standalone.js"></script>

<form method="post" action="/quotes/42">
  <aveon-editor name="terms" preset="erp" placeholder="Terms…" upload-url="/api/uploads" min-height="240">
    <template><p>Existing content from the database</p></template>
  </aveon-editor>
  <button>Save</button>
</form>
```

Copy `packages/aveon-editor/dist/standalone/` (after `npm run build`) to your static files. The script registers the element and exposes the API as `window.AveonEditor`.

| Attribute | Meaning |
| --- | --- |
| `name` | Form field name |
| `preset` | `basic`, `cms`, `erp` or `full` |
| `placeholder` | Text shown while empty |
| `upload-url` | Endpoint for image uploads (see below); add `upload-credentials` to send cookies |
| `readonly`, `disabled` | Read-only mode (also follows a disabled `<fieldset>`) |
| `toolbar="classic"` | Single toolbar instead of the ribbon |
| `min-height` | Minimum editing height (`240` or `20rem`) |

Initial content comes from a child `<template>` (recommended: it is not rendered before the editor starts), a `<textarea>` or the element's own HTML. In JavaScript: `element.value` (get or set HTML), `element.editor`, `await element.whenReady()`, and the bubbling `ready`, `input` and `change` events. Set `element.config = { … }` before the element is added to the page for any other `createEditor()` option.

With a bundler, register the element yourself:

```ts
import '@aveon/editor/theme.css';
import { defineEditorElement } from '@aveon/editor';

defineEditorElement(); // or defineEditorElement('my-editor')
```

In Vue, use it like any element (`<aveon-editor name="body" preset="cms" @change="…">`) and mark it as a custom element with `compilerOptions.isCustomElement`. In React, render `<aveon-editor name="body" preset="cms" />` and listen for `change` through a ref (`ref.current.addEventListener('change', …)`).

### 2. JavaScript: `createEditor()`

```ts
import '@aveon/editor/theme.css';
import { createEditor } from '@aveon/editor';

const editor = await createEditor('#description', {
  preset: 'erp',
  placeholder: 'Describe the task…',
  upload: { url: '/api/uploads', headers: () => ({ Authorization: `Bearer ${getToken()}` }) },
  removePlugins: ['MediaEmbed']
});

editor.model.document.on('change:data', () => save(editor.getData()));
```

`target` is an element or a CSS selector; a `<textarea>` inside a form is replaced and kept in sync. Other options: `extraPlugins`, `removePlugins` (constructors or plugin names), plus any editor configuration (`toolbar`, `ribbon`, `fontFamily`, `language`…). `resolveEditorOptions()` returns the plugin list and config without creating an editor, for use with `ClassicEditor.create()` or the Angular component.

### 3. Angular

Use `<aveon-editor>` from `aveon-angular` (see above) with the same presets: `[editor]="ClassicEditor" [config]="erpConfig"` where `erpConfig = resolveEditorOptions({ preset: 'erp' })`.

### Image uploads

With `upload` (or `upload-url`), images are sent to your server instead of being stored inside the HTML as base64:

- **Request:** `POST` with `multipart/form-data`; the file is in the field `upload` (change it with `upload.fieldName`). Headers come from `upload.headers` (an object, or a function called for every upload so tokens stay fresh); `withCredentials` sends cookies.
- **Response:** `{ "url": "https://cdn.example.com/images/abc.png" }`, or `{ "urls": { "default": "…", "800": "…" } }` for responsive sizes. On failure: `{ "error": { "message": "File too large" } }`, which the editor shows to the user.

### Saving and security

`editor.getData()` (or the form field) returns clean semantic HTML. Always sanitise it on the server before storing or displaying it (for example with an HTML sanitiser that allows the tags and styles listed in the Features section), as you would for any user-submitted HTML.

### The ribbon

The classic editor shows a Word-style ribbon (`ribbon` config); set `ribbon: false` for the single toolbar. Items are component names, or objects that give them a size and a short label; groups can have a "more options" corner button that runs a command:

```ts
ribbon: {
  quickAccess: ['undo', 'redo'],
  tabs: [
    {
      label: 'Home',
      groups: [
        { label: 'Clipboard', items: [{ name: 'paste', size: 'large' }, { name: 'cut', size: 'medium' }, { name: 'copy', size: 'medium' }] },
        { label: 'Font', items: ['bold', 'italic', 'underline', '-', 'fontColor', 'highlight'], launcher: { command: 'fontDialog' } }
      ]
    }
  ]
}
```

`large` shows a big icon above the label (one per column), `medium` an icon beside the label (stacked three high), and plain names are small icon buttons in rows (`-` starts a new row, `|` adds a separator). Unavailable items are skipped, and empty groups and tabs are hidden. `classicRibbon` and `erpRibbon` are exported as starting points.

## Business documents, references and review

All of these are in `classicPreset` (and the `cms`, `erp` and `full` presets). Tabs and buttons appear when the feature is configured.

### Merge fields (Mailings tab)

```ts
mergeFields: {
  definitions: [
    { group: 'Customer', definitions: [{ id: 'customer.name', label: 'Customer name' }, { id: 'customer.email', label: 'Email' }] },
    { id: 'today', label: 'Today' }
  ],
  previewData: { customer: { name: 'Northwind Traders' }, today: '28 Oct 2026' }
}
```

Fields are inserted from **Insert Merge Field** or by typing `{{customer.name}}`, shown as chips, and saved as `<span class="merge-field" data-field="customer.name">{{customer.name}}</span>`. **Preview Results** shows `previewData` (change it with `editor.plugins.get('MergeFields').setPreviewData(record)`). To produce the final document, fill the saved HTML on the server or in the browser:

```ts
import { renderMergeFields } from '@aveon/editor';
const html = renderMergeFields(savedHtml, { customer: { name: 'Northwind Traders' } }); // values are HTML-escaped
```

### Templates

```ts
templates: [
  { title: 'Quotation', description: 'Standard quote', data: '<h2>Quotation</h2>…' },
  { title: 'Welcome email', data: () => fetch('/templates/welcome').then(r => r.text()) }
]
```

**Templates** fills an empty document or inserts at the cursor. Templates can contain merge fields.

### Export (View tab)

**PDF** opens the browser's print dialog with a clean copy of the document (choose "Save as PDF"). **Word** downloads a `.doc` file that Word opens natively. **HTML** downloads a standalone page. Configure with `export: { fileName, title, stylesheets, css }`; `buildExportDocument(editor)` returns the HTML for server-side PDF tools. While merge-field preview is on, exports contain the preview values.

### References tab

- **Table of Contents** lists the headings and updates as you type; click an entry to jump to it. Saved as `<nav class="table-of-contents">` with links, and headings get matching `id`s.
- **Insert Footnote** adds a numbered marker; the notes are listed in a footnotes section kept at the end of the document. Double-click a marker to edit or remove its note.
- **Insert Caption** adds a `<figcaption>` to the selected table. Images have their own caption button in the image toolbar.

### Sketch (Insert tab)

A drawing pad with colours, pen widths, undo and clear; saved as SVG (`<figure class="sketch">`). Double-click a sketch to edit it. Only stroked paths are accepted when content is loaded, so stored HTML cannot carry scripts through a sketch.

### Comments and track changes (Review tab)

Set the current user with `user: { id, name }`.

- **New Comment** on selected text opens the comments panel, with replies, Resolve/Reopen and Delete. The content stores only anchors (`<span class="comment-anchor" data-comment="c-…">`); the threads are your application's data:

  ```ts
  const comments = editor.plugins.get('Comments');
  comments.on('change', () => save(comments.getThreads()));   // store with the record
  // When loading: comments: { threads: savedThreads }
  ```

- **Track Changes** records typed and pasted text as insertions and deleted text as deletions (author and time), saved as `<ins class="suggestion-insert">` / `<del class="suggestion-delete">`, so pending suggestions survive saving. Accept or reject them in the panel, at the cursor, or all at once. Deleting your own suggested text removes it. Formatting changes and structural edits (new paragraphs, merged blocks, tables and images) apply directly and are not tracked.

## Features

Everything in `classicPreset`, with the same command and toolbar item names as CKEditor 5:

- **Essentials**: typing with IME and autocorrect reconciliation, Enter and Shift+Enter, delete, undo and redo, select all, clipboard copy, cut and paste (HTML and plain text), keyboard navigation, autosave.
- **Text**: paragraph, headings (`heading` dropdown), bold, italic, underline, strikethrough, inline code, subscript, superscript, remove format, font family, font size, font color, font background color, highlight.
- **Blocks**: block quote, code block with language picker and newline-preserving round-trip, horizontal line, alignment, block indent, outdent and indent.
- **Lists**: bulleted, numbered and to-do lists with nesting (Tab and Shift+Tab, Enter on an empty item leaves the list, Backspace at the start outdents).
- **Links**: link balloon with preview, edit and unlink, autolink, keyboard shortcut.
- **Images**: insert via URL or file upload (Base64 adapter included, custom adapters supported), caption, alt text, inline, block and side styles, resize, widget toolbar.
- **Tables**: insert grid, header row and column, insert and delete rows and columns, Tab navigation, widget toolbar.
- **Media embed**, **special characters**, **find and replace**, **source editing**, **word count**, **autoformat** (Markdown-like shortcuts), **text transformation**.
- **Math equations**: a visual formula editor with ten toolbar tabs (General, Symbols, Arrows, Greek, Matrices, Scripts and layouts, Decorations, Big operators, Chemistry, Contextual, plus an opt-in Publishers tab), slot navigation, selection, smart delete, autoformat, clipboard, undo, formatting (bold, italic, colour, background, size, display style), matrix frames, lines, alignment and spacing, elementary arithmetic layouts, fence editing, nudging and equation numbering. Four input modes: Visual, LaTeX, MathML and Handwriting (built-in basic recogniser, or your own service through `math.handwriting.recognizer`), all with a live KaTeX preview. A `chemType` button opens chemistry mode with upright element symbols, a periodic table, charges, states of matter and reaction arrows. Output is `<span class="math-tex">\(…\)</span>` by default (display mode `\[…\]`, numbered equations carry `\tag{n}`), `<script type="math/tex">`, presentation MathML with a TeX annotation, or an `<img>` with an SVG data URI (`math.outputType`); every form is read back. Every equation carries `role="math"` and a spoken description in English, Spanish, French or German (`addSpeechDictionary()` for more). Right-to-left notation, a decimal comma, custom toolbars and colours are configurable. Load `katex/dist/katex.min.css` in the page.

The theme in `packages/aveon-editor/src/theme/index.css` uses `ck-*` class names and `--ck-*` variables: the CKEditor 5 theme customization docs apply directly.

## Architecture

- `src/engine/model`: nodes, positions, ranges, live positions, markers, schema, selection, document, operations (insert, move, attribute, rename, split, merge, marker, root attribute, no-op), batches, writer, `model.change()` with post-fixers.
- `src/engine/view`: typed view elements (container, attribute, empty, UI, raw, editable), downcast writer, renderer with DOM reconciliation, DOM converter with whitespace handling, observers (typing via `beforeinput`, mutations, composition, selection, focus, clipboard, keys, arrows, Tab), bubbling event contexts.
- `src/engine/conversion`: mapper, upcast and downcast dispatchers, helpers (`elementToElement`, `elementToStructure`, `attributeToElement`, `attributeToAttribute`, markers), auto-paragraphing.
- `src/engine/controller`: data controller (`getData`, `setData`, `toView`, `toModel`) and editing controller.
- `src/core`: editor base class, plugin and command collections, component factory, editor UI with toolbar focus (Alt+F10, Esc).
- `src/ui`: template bindings, view collections, buttons, dropdowns, toolbars with overflow grouping, balloon panels, contextual balloon, sticky panel, tooltips, color grid, labeled fields.
- `src/features`: one folder per feature, each a plugin with commands and converters.
- `src/builds`: classic, inline, balloon and decoupled editors plus the presets.

## Tests

`npm test` runs Vitest (jsdom) in `packages/aveon-editor`: engine tests (round-trips, editing view updates, content insertion and deletion, undo, auto-paragraphing, selection mapping) and feature tests (nested lists, code blocks, tables, formatting commands with undo and redo, images, tables and links through commands).

## Known limitations

- Undo is linear with position-level transformation of operations. There is no real-time collaboration (several people editing the same document at once): it needs a collaboration server. Comments and track changes work for one editor at a time, with threads stored by the host application.
- Tables do not support multi-cell selection, merging or splitting cells, or table and cell properties (borders, colors).
- Image resizing is offered through the toolbar option, not drag handles. Without the `upload` option images are stored inside the HTML as Base64.
- Pasting from Word or Google Docs keeps the semantic HTML but does not run the dedicated clean-up filters CKEditor ships for those sources.
- The UI is English only. Translations can be added through the locale's `t()` function.
- The built-in handwriting recogniser is basic (digits, Latin letters, common operators, fractions, roots, scripts); connect a recognition service for production handwriting. Image output embeds KaTeX HTML in SVG and needs the KaTeX fonts on the viewing page. The formula canvas needs physical key presses (no IME composition). See `docs/MATH_FEATURE_SPEC.md` for the remaining MathType items.
- No Markdown output, mentions, emoji, restricted editing or AI assistant features. PDF export goes through the browser's print dialog, and Word export is a `.doc` (HTML) file rather than `.docx`.
