# Aveon Editor

Aveon Editor is a rich text editor built on its own engine: a document **model**, an editing **view**, **conversion** between them, **operations** with undo/redo, a **plugin** system, a UI framework and a theme. It ships a full classic-build feature set plus the commonly requested extras, styles everything through `ck-*` class names and `--ck-*` CSS variables, and comes with an Angular wrapper, the `<aveon-editor>` component.

The code is an original, clean implementation.

**Live demo:** <https://aveoneditor.ceo-02c.workers.dev/> · **Downloads:** [latest release](https://github.com/aveonparvathig/aveoneditor/releases/latest) (offline zip, browser files and npm packages) · **Docs:** [integration kit](docs/INTEGRATION_KIT.md) · [deployment](docs/DEPLOYMENT.md) · [math](docs/MATH_FEATURE_SPEC.md)

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/aveon-editor` | The editor library (`@aveon/editor`): engine, core, UI, features, builds, theme |
| `apps/demo` | Plain TypeScript demo (Vite) of the classic editor with every feature enabled |
| `apps/cms-angular` | Angular 22 workspace with the `aveon-angular` library and a demo CMS page |
| `apps/cms-angular/projects/aveon-angular` | The Angular integration library (`<aveon-editor>`) |
| `packages/collab-server` | Real-time collaboration server (`@aveon/collab-server`, WebSocket) |
| `packages/api-connect` | Backend contract for all clients (`@aveon/api-connect`): tenant tokens, uploads, documents, editor hosting |
| `deploy` | Docker images, Helm chart and server setup scripts |
| `e2e` | Browser tests (Playwright) in Chromium, Firefox, WebKit and phone profiles |
| `docs/angular-14-21` | Forms support for `<aveon-editor>` in Angular 14–21 |
| `docs/angular-11-13` | Forms support for `<aveon-editor>` in Angular 11–13 (NgModule) |

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

Editor types: `ClassicEditor`, `InlineEditor`, `BalloonEditor`, `DecoupledEditor`.

Configuration keys: `plugins`, `extraPlugins`, `removePlugins`, `toolbar` (array or `{ items, shouldNotGroupWhenFull, removeItems }`), `placeholder`, `initialData`, `language`, `heading.options`, `image.toolbar`, `image.upload.types`, `table.contentToolbar`, `fontFamily.options`, `fontSize.options`, `fontColor.colors`, `codeBlock.languages`, `link.defaultProtocol`, `math.engine`, `math.outputType`, `math.katexOptions`, `math.altText`, `math.defaultMode`, `math.autoformat`, `math.toolbar`, `math.colors`, `math.numbering`, `math.handwriting`, `math.chemistry`, `math.speechLanguage`, `math.direction`, `math.decimalSeparator`, `math.imageRenderer`, `mediaEmbed.providers`, `wordCount.container`, `autosave.save`, and so on.

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

Inputs and outputs: `editor`, `config`, `data`, `tagName`, `disabled`, `disableTwoWayDataBinding`, and `ready`, `change`, `focus`, `blur`, `error`. The component implements `ControlValueAccessor`, so `ngModel`, `formControl` and `formControlName` work, including the disabled state. `AveonEditorModule` is available for module-based applications.

## Integrating into a CMS or ERP

Pick the route that matches the host application. All of them use the same presets. [docs/INTEGRATION_KIT.md](docs/INTEGRATION_KIT.md) is the guide to hand to a client team: packages, every route (including Angular 14–22), the API Connect endpoints and token format, API links and package builds.

### Presets

| Preset | For | What you get |
| --- | --- | --- |
| `basic` | Comments, short descriptions | Single toolbar: headings, bold, italic, underline, link, lists, quote |
| `cms` (default) | Articles, pages, product texts | Full ribbon: fonts, styles, tables, images, media, symbols, source view (no equations, so KaTeX is never loaded) |
| `erp` | Quotes, notes, emails, records | Compact ribbon (File, Home, Insert, Review, View): fonts, Font dialog, tables, images, lists, find, export |
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

`aveon-angular` needs Angular 22. For Angular 14–21, use the `<aveon-editor>` element with `CUSTOM_ELEMENTS_SCHEMA` and copy `docs/angular-14-21/aveon-editor-value-accessor.directive.ts` into your app: it makes `[(ngModel)]`, `[formControl]` and `formControlName` work on the element, including the disabled state. For Angular 11–13 (no standalone components), copy `docs/angular-11-13/aveon-editor-forms.module.ts` and import `AveonEditorFormsModule`; load the element with the standalone `<script>` in `index.html`, since those versions cannot compile the ES2022 library.

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
        { label: 'Font', priority: 2, items: ['bold', 'italic', 'underline', '-', 'fontColor', 'highlight'], launcher: { command: 'fontDialog' } }
      ]
    }
  ]
}
```

By default the ribbon uses the `tiles` layout: every item is one 36px icon tile on a single row, groups are separated by hairlines (their names stay in tooltips, the command search and for screen readers) and the tabs sit in a segmented strip. Item sizes are ignored there, and an item with `layout: 'word'` (cut, copy, paste, select all, subscript and superscript in the presets) is left to its keyboard shortcut so the row fits a 1180px page. Set `layout: 'word'` for the Word-style layout, where `large` shows a big icon above the label (one per column), `medium` an icon beside the label (stacked three high), and plain names are small icon buttons in rows (`-` starts a new row, `|` adds a separator). Unavailable items are skipped, and empty groups and tabs are hidden. `classicRibbon` and `erpRibbon` are exported as starting points: File (templates, Markdown import, export), Home, Insert, References, Mailings, Review and View, each command in one place, opening on Home (`startTab`).

In a narrow window the ribbon stays one row: groups collapse to a button with their icon that opens them as a drop-down. Groups with a lower `priority` collapse first, so give the everyday ones (Font, Paragraph) a higher one; `icon` picks the collapsed button's icon from `icons`. On a phone-width ribbon the tabs tighten and the command search shrinks to its magnifier until clicked.

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

### Export (File tab)

**PDF** opens the browser's print dialog with a clean copy of the document (choose "Save as PDF"). **Word** downloads a `.doc` file that Word opens natively. **HTML** downloads a standalone page. Configure with `export: { fileName, title, stylesheets, css }`; `buildExportDocument(editor)` returns the HTML for server-side PDF tools. While merge-field preview is on, exports contain the preview values. Equations are exported as self-contained images (SVG, or PNG in the Word file) with their spoken text as `alt`, so they look right without KaTeX or its fonts; `buildExportDocumentWithImages(editor)` returns that HTML.

### References tab

- **Table of Contents** lists the headings and updates as you type; click an entry to jump to it. Saved as `<nav class="table-of-contents">` with links, and headings get matching `id`s.
- **Insert Footnote** adds a numbered marker; the notes are listed in a footnotes section kept at the end of the document. Double-click a marker to edit or remove its note.
- **Insert Caption** adds a `<figcaption>` to the selected table. Images have their own caption button in the image toolbar.

### Sketch (Insert tab)

A drawing pad with colours, pen widths, undo and clear; saved as SVG (`<figure class="sketch">`). Double-click a sketch to edit it. Only stroked paths are accepted when content is loaded, so stored HTML cannot carry scripts through a sketch.

### Figure tools (images, sketches and diagrams)

Every picture-like block has the same tools, in the balloon under it and on the contextual **Picture** tab:

- **Resize**: drag a corner handle of the selected figure (the width snaps to 25, 33, 50, 67, 75 and 100 % of the text column) or pick a size from the Size menu. The width is stored as `style="width:50%"` on the `<figure>` (`resizedWidth` in the model).
- **Move**: drag the grip in the figure's top-left corner to another place in the text (a line shows where it lands), or press `Alt+Shift+↑/↓` to move it past the neighbouring block (`moveFigure` command).
- **Position**: Left, Center, Right and Side (text wraps around) share the image feature's `image-style-*` classes; In line is for images only.
- **Caption**: a `<figcaption>` under the figure (`toggleFigureCaption`; hidden text comes back when the caption is shown again).
- **Crop**: images and sketches. Images are cropped on a canvas and go through the configured upload adapter (a data URL with the Base64 adapter); images from another site that block canvas access cannot be cropped. A sketch's strokes are cut to the rectangle (`cropSketch()`).

The generic commands (`resizeFigure`, `figureAlign`, `toggleFigureCaption`, `cropFigure`, `moveFigure`) hand over to the image commands for images, so existing `image.*` configuration keeps working. Other block objects can join by calling `FigureEditing#register(name, { viewClass, crop })` and wrapping their view with `toFigureWidget()`. `config.figure.toolbar` sets the balloon items.

### Diagrams (Insert tab)

Diagrams written as text, the same four kinds GitHub draws:

| Type | Draws |
| --- | --- |
| `mermaid` | Flowcharts, sequence, class, state, Gantt, pie and other [Mermaid](https://mermaid.js.org) diagrams (`info` shows the Mermaid version) |
| `geojson`, `topojson` | Maps: drag to move, + / − or Ctrl+wheel to zoom, click a shape for its properties; `stroke`, `fill`, `marker-color` and the other simplestyle properties are used |
| `stl` | 3D models (ASCII STL): drag to turn; Solid, Surface angle and Wireframe views |

**Diagram** opens an editor with a live preview and a sample for each type; double-click a diagram to edit it. Diagrams are saved as their source, `<figure class="diagram" data-diagram="mermaid"><pre><code class="language-mermaid">…</code></pre></figure>`, and `<pre><code class="language-mermaid">` (a GitHub or Markdown code block) is read the same way. PDF, Word and HTML exports contain the drawing.

Mermaid (about 650 KB) is downloaded only when a document contains a Mermaid diagram and always runs in its `strict` security mode. Maps and models are drawn without any library, so they work offline; maps have no background map unless you configure a tile server you are allowed to use:

```ts
diagrams: {
  types: ['mermaid', 'geojson', 'topojson', 'stl'],
  mermaid: { theme: 'neutral' },
  map: { tiles: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' }
}
```

### GitHub-style math and Markdown

- **Typing math**: `$a^2+b^2$` (or `` $`…`$ `` when the formula has a `$`) becomes an equation when the closing `$` is typed, and a paragraph of `$$…$$` becomes a display equation. Prices stay text ("$5 and $10"), as does a dollar typed after a backslash. Ctrl+Z gives the text back; `math: { dollarSyntax: false }` turns it off. A ```` ```math ```` code block is read as a display equation.
- **Pasting Markdown**: plain text that looks like Markdown (headings, lists, task lists, tables, code blocks, math, diagrams) is converted when pasted. Ctrl+Shift+V still pastes plain text; `markdown: { paste: 'never' }` turns it off (`'always'` converts every plain-text paste).
- **Markdown files**: **Insert → Markdown** inserts a `.md` file at the cursor; **View → Export → Markdown** downloads the document as GitHub-flavoured Markdown, with equations as `$…$` / `$$…$$` and diagrams as fenced code blocks, ready for a README, wiki or issue. In code: `editor.plugins.get('Markdown').getMarkdown()`, `.setMarkdown(text)` and `.insertMarkdown(text)`. Colours, fonts and alignment have no Markdown form and are left out; underline, subscript, superscript and highlight become `<ins>`, `<sub>`, `<sup>` and `<mark>`.
### Equations outside the editor

- **Read-only pages**: saved content keeps equations as `<span class="math-tex">\(…\)</span>`. Add one script to the page that shows it and they are drawn with the browser's own MathML (no download, no fonts, read by screen readers): `<script type="module" src="aveon-math-viewer.js"></script>` (from `dist/standalone`), or `renderEquations(element)` from the package. Add `?output=svg` (or `{ output: 'svg' }`) for images, or `katex` when the page loads KaTeX's stylesheet. Call `AveonMathViewer.renderEquations(element)` again for content added later.
- **Images**: `math: { outputType: 'image' }` stores each equation as a self-contained SVG (drawn as paths, no fonts needed), sized and aligned to the text line. `renderEquationSvg()`, `renderEquationImageTag()` and `svgToPng()` make images in code; `replaceEquationsWithImages(html)` converts a whole document. The drawing uses MathJax, downloaded only when an image is made, and it also draws `\ce{…}` chemistry.
- **MathType (WIRIS) content**: formula images with `data-mathml` (including MathType's « » ¨ § encoding) and MathType's MathML load as editable equations, using the LaTeX annotation when there is one.
- **Word**: equations pasted from Word (Office Math) arrive as editable equations instead of a broken picture.

### Code blocks

- **Code blocks** also offer JSON, SQL, YAML, Shell and Markdown, and read the short names Markdown uses (`js`, `ts`, `py`, `sh`, `yml`…).

### Comments and track changes (Review tab)

Set the current user with `user: { id, name }`.

- **New Comment** on selected text opens the comments panel, with replies, Resolve/Reopen and Delete. The content stores only anchors (`<span class="comment-anchor" data-comment="c-…">`); the threads are your application's data:

  ```ts
  const comments = editor.plugins.get('Comments');
  comments.on('change', () => save(comments.getThreads()));   // store with the record
  // When loading: comments: { threads: savedThreads }
  ```

- **Track Changes** records typed and pasted text as insertions and deleted text as deletions (author and time), saved as `<ins class="suggestion-insert">` / `<del class="suggestion-delete">`, so pending suggestions survive saving. Accept or reject them in the panel, at the cursor, or all at once. Deleting your own suggested text removes it. Formatting changes and structural edits (new paragraphs, merged blocks, tables and images) apply directly and are not tracked.

## Real-time collaboration

Several people can edit the same document at once. Each sees the others' cursors and selections (with name and colour) and who is connected, and comment threads stay in sync. Edits made while offline are kept and sent after reconnecting.

**1. Run the server** (`packages/collab-server`, Node 18+):

```bash
npm run collab:server
```

This listens on `ws://localhost:1234` and keeps documents in `./collab-data`. To host it (and the demo site) for free, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In your own Node application:

```js
import { createCollaborationServer, FileStorage } from '@aveon/collab-server';

createCollaborationServer({
  port: 1234,                                  // or `server: existingHttpServer`
  storage: new FileStorage('./collab-data'),   // or your own { load, save }
  authenticate: async ({ token, documentId }) => {
    const user = await verifySession(token);   // your auth
    return user && (await canEdit(user, documentId)) ? { id: user.id, name: user.name } : null;
  },
  onSnapshot: async ({ documentId, data }) => saveHtml(documentId, data) // latest HTML for your database
});
```

**2. Connect the editor** (any preset; set the current user):

```ts
createEditor('#editor', {
  preset: 'erp',
  user: { id: 'u-17', name: 'Asha Rao' },
  collaboration: { url: 'wss://collab.example.com', documentId: 'quote-42', token: () => getToken() }
});
```

The first person to open a document provides its initial content; everyone after that gets the shared copy. The editor is read-only until the shared copy has arrived. The ribbon's quick-access bar shows the connection state ("Live", "Offline: edits will sync") and everyone's initials.

**How it stays consistent.** The server keeps one ordered list of editing operations per document and accepts a client's operations only when they are based on its latest version. If someone else's edits arrive first, the client rolls back its unconfirmed edits, applies theirs, and replays its own on top (positions adjusted) before sending again. So every copy applies the same operations in the same order and stays identical. When two edits truly conflict (for example typing inside text someone else just deleted), the later edit is dropped. Undo history is cleared when a client has to replay its edits. The demo page `/collaboration.html` shows two people side by side; add `?as=Name` in another browser to join as a third.

**Tested** with real WebSocket connections (concurrent typing in the same paragraph, deleting text another person is editing, presence, comments, offline edits) and with a deterministic simulation of three people editing at random with randomly delayed and reordered messages. Every run has to converge without any client falling back to a full reload.

## Hosting for many clients (cloud and on-premises)

One release serves every client. Editor files come from a central host (or a client's own web server), and every client's editor talks to the same backend contract, **API Connect**, wherever it runs.

### API Connect (`packages/api-connect`)

Uploads, documents, templates and merge data for all clients (tenants), with the editor files and co-editing on the same port:

```bash
ACME_JWT_SECRET=… npm run api:connect
```

`api-connect.config.json`:

```json
{
  "port": 8080,
  "dataDir": "./api-data",
  "publicUrl": "https://api.example.com",
  "editorDir": "./release/0.1.1/editor",
  "collaboration": { "dataDir": "./collab-data" },
  "tenants": {
    "acme": { "secretEnv": "ACME_JWT_SECRET", "origins": ["https://cms.acme.com"] },
    "globex": { "publicKeyFile": "./keys/globex.pem", "issuer": "https://erp.globex.com", "origins": ["https://erp.globex.com"] }
  }
}
```

Each client's backend signs a short-lived JWT (HS256 with a shared secret, or RS256 / ES256 with its own key) with `tenant`, `sub` (user id), `name`, `exp` and optionally `docs` (document ids the user may open; `quote-*` matches a prefix). API Connect never sees the clients' passwords.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/uploads` | Image upload (field `upload`); the real file type is checked, not the declared one. Returns `{ "url": … }` |
| `GET /v1/files/<tenant>/…` | Uploaded files (random names, `nosniff`, sandboxed, cached for a year) |
| `GET` / `PUT /v1/documents/<id>` | Load and save a document; saved HTML is sanitised to what the editor produces |
| `GET /v1/templates`, `GET /v1/merge-data/<record>` | Per-tenant templates; merge data from your `mergeData()` hook |
| `wss://…/v1/collab?doc=<tenant>:<id>` | Co-editing with the same tokens; document ids start with the tenant |
| `GET /editor/v<version>/…` | The editor files (immutable cache, CORS) |
| `GET /health` | Health check |

Each tenant's tokens only work from its own `origins`, and only on its own documents and files. In Node you can also mount it in an existing server: `createApiConnect({ … }).handle(request, response)`.

The editor side:

```ts
AveonEditor.createEditor('#body', {
  preset: 'cms',
  user: { id: session.userId, name: session.userName },
  upload: { url: 'https://api.example.com/v1/uploads', headers: () => ({ Authorization: `Bearer ${getToken()}` }) },
  collaboration: { url: 'wss://api.example.com/v1/collab', documentId: `acme:${recordId}`, token: () => getToken() }
});
```

### Collaboration server options

`aveon-collab` (or the `collab-server` image) keeps documents in a shared database so any server can open any document:

```bash
node packages/collab-server/bin/aveon-collab.js --port 1234 --workers 4 --postgres postgres://user:pass@db/aveon
```

Also `--sqlite FILE`, `--mssql "<connection string>"`, `--mysql URL` or `--data DIR` (install `pg`, `mssql` or `mysql2` for those databases). In code: `SqlStorage.postgres(pool)`, `SqlStorage.mssql(pool)`, `SqlStorage.mysql(pool)`, `SqlStorage.sqlite(db)`. A worker process that stops is started again. `GET /health` and `GET /metrics` (Prometheus) answer on the same port. Behind a load balancer, route by the `doc` query parameter (Nginx `hash $arg_doc consistent;`) so everyone in a document reaches the same server.

### Releases, Docker and Kubernetes

```bash
npm run release
```

builds `release/<version>/`: the editor files for the central host with `integrity.json` and a ready-to-paste `snippet.html` (SHA-384 integrity attributes), npm packages for a private registry, `SHA256SUMS`, and `aveon-offline-v<version>.zip` for air-gapped clients.

```bash
docker build -f deploy/docker/api-connect.Dockerfile -t aveon/api-connect:0.1.1 .
```

```bash
docker build -f deploy/docker/collab-server.Dockerfile -t aveon/collab-server:0.1.1 .
```

Both images run as a non-root user and have health checks. `deploy/helm/aveon` installs both on Kubernetes or OpenShift behind one host: API Connect at `/` (editor files, uploads, documents) and co-editing at `/collab`, with the ingress hashing on `?doc=` and long WebSocket timeouts. Tenants and their secrets go in the chart's values (or an existing Secret); more than one co-editing pod requires `collab.database`.

## Features

Everything in `classicPreset`, with these command and toolbar item names:

- **Essentials**: typing with IME and autocorrect reconciliation, Enter and Shift+Enter, delete, undo and redo, select all, clipboard copy, cut and paste (HTML and plain text), keyboard navigation, autosave.
- **Text**: paragraph, headings (`heading` dropdown), bold, italic, underline, strikethrough, inline code, subscript, superscript, remove format, font family, font size, font color, font background color, highlight.
- **Blocks**: block quote, code block with language picker and newline-preserving round-trip, horizontal line, alignment, block indent, outdent and indent.
- **Lists**: bulleted, numbered and to-do lists with nesting (Tab and Shift+Tab, Enter on an empty item leaves the list, Backspace at the start outdents).
- **Links**: link balloon with preview, edit and unlink, autolink, keyboard shortcut.
- **Images**: insert via URL or file upload (Base64 adapter included, custom adapters supported), caption, alt text, inline, block and side styles, resize handles and crop, drag to move, widget toolbar (see "Figure tools").
- **Tables**: insert grid, header row and column, insert and delete rows and columns, Tab navigation, widget toolbar.
- **Media embed**, **special characters**, **find and replace**, **source editing**, **word count**, **autoformat** (Markdown-like shortcuts), **text transformation**.
- **GitHub-style content**: Markdown import, export and paste; `$…$` and `$$…$$` math while typing; Mermaid diagrams, GeoJSON and TopoJSON maps, and STL 3D models (see "Diagrams" above).
- **Math equations**: a visual formula editor with ten toolbar tabs (General, Symbols, Arrows, Greek, Matrices, Scripts and layouts, Decorations, Big operators, Chemistry, Contextual, plus an opt-in Publishers tab), slot navigation, selection, smart delete, autoformat, clipboard, undo, formatting (bold, italic, colour, background, size, display style), matrix frames, lines, alignment and spacing, elementary arithmetic layouts, fence editing, nudging and equation numbering. Four input modes: Visual, LaTeX, MathML and Handwriting (built-in basic recogniser, or your own service through `math.handwriting.recognizer`), all with a live KaTeX preview. A `chemType` button opens chemistry mode with upright element symbols, a periodic table, charges, states of matter and reaction arrows. Output is `<span class="math-tex">\(…\)</span>` by default (display mode `\[…\]`, numbered equations carry `\tag{n}`), `<script type="math/tex">`, presentation MathML with a TeX annotation, or an `<img>` with an SVG data URI (`math.outputType`); every form is read back. Every equation carries `role="math"` and a spoken description in English, Spanish, French or German (`addSpeechDictionary()` for more). Right-to-left notation, a decimal comma, custom toolbars and colours are configurable. Load `katex/dist/katex.min.css` in the page.

The theme in `packages/aveon-editor/src/theme/index.css` uses `ck-*` class names and `--ck-*` variables; override the variables to restyle the editor.

Every control (toolbar and ribbon buttons, menu rows, dialog buttons and inputs) is one tile, sized by `--ck-tile-size` (36px; 44px on a phone-width ribbon) with a `--ck-icon-size` (20px) icon and `--ck-tile-radius` (8px) corners. Toggled tiles show a tinted background with a short accent bar; a corner caret marks a menu. The colours come from `--ck-color-accent`, `--ck-color-accent-tint`, `--ck-color-ground`, `--ck-color-surface-hover`, `--ck-color-surface-pressed`, `--ck-color-text-muted` and the `--ck-color-base-*` set; override them on `:root` or on a wrapper. A dark set ships for `data-theme="dark"` (put it on `<html>`, on a wrapper, or use `<aveon-editor theme="dark">`); dialogs, balloons and tooltips follow the editor's theme. The UI font is `Inter` when the page loads it, otherwise the system font.

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

`npm run test:servers` runs the collaboration server and API Connect tests (Node's test runner). `npm run test:browsers` runs the Playwright tests against the demo in desktop Chromium, Firefox and WebKit and in Android and iPhone profiles (install the browsers once with `npx playwright install`).

## Known limitations

- Undo is linear with position-level transformation of operations. In real-time collaboration each person undoes their own recent edits; undo history is cleared when edits have to be replayed after a conflict, and conflicting edits (e.g. typing inside text someone else deleted) are dropped. Collaboration needs the `@aveon/collab-server` service running.
- Tables do not support multi-cell selection, merging or splitting cells, or table and cell properties (borders, colors).
- Image resizing is offered through the toolbar option, not drag handles. Without the `upload` option images are stored inside the HTML as Base64.
- Pasting from Word or Google Docs keeps the semantic HTML but does not run dedicated clean-up filters for those sources.
- The UI is English only. Translations can be added through the locale's `t()` function.
- The built-in handwriting recogniser is basic (digits, Latin letters, common operators, fractions, roots, scripts); connect a recognition service for production handwriting. The formula canvas needs physical key presses (no IME composition). See `docs/MATH_FEATURE_SPEC.md` for the remaining MathType items.
- Diagrams: only ASCII STL is read (not binary STL); maps use the Web Mercator projection and show no background map unless `diagrams.map.tiles` is set; Word may not show the SVG drawings in a `.doc` export. Math is drawn with KaTeX, which covers fewer LaTeX commands than the MathJax that GitHub uses (`math.engine` can plug MathJax in).
- No mentions, emoji, restricted editing or AI assistant features. PDF export goes through the browser's print dialog, and Word export is a `.doc` (HTML) file rather than `.docx`, so equations in it are pictures, not editable Word equations. The equation viewer's default MathML output looks as good as the browser's maths fonts.
