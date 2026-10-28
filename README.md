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

Configuration keys mirror CKEditor 5: `plugins`, `extraPlugins`, `removePlugins`, `toolbar` (array or `{ items, shouldNotGroupWhenFull, removeItems }`), `placeholder`, `initialData`, `language`, `heading.options`, `image.toolbar`, `image.upload.types`, `table.contentToolbar`, `fontFamily.options`, `fontSize.options`, `fontColor.colors`, `codeBlock.languages`, `link.defaultProtocol`, `mediaEmbed.providers`, `wordCount.container`, `autosave.save`, and so on.

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
```

Inputs and outputs match the CKEditor 5 Angular component: `editor`, `config`, `data`, `tagName`, `disabled`, `disableTwoWayDataBinding`, and `ready`, `change`, `focus`, `blur`, `error`. The component implements `ControlValueAccessor`, so `ngModel`, `formControl` and `formControlName` work, including the disabled state. `AveonEditorModule` is available for module-based applications. Migrating a template from CKEditor means replacing the `<ckeditor>` tag and the editor class.

## Features

Everything in `classicPreset`, with the same command and toolbar item names as CKEditor 5:

- **Essentials**: typing with IME and autocorrect reconciliation, Enter and Shift+Enter, delete, undo and redo, select all, clipboard copy, cut and paste (HTML and plain text), keyboard navigation, autosave.
- **Text**: paragraph, headings (`heading` dropdown), bold, italic, underline, strikethrough, inline code, subscript, superscript, remove format, font family, font size, font color, font background color, highlight.
- **Blocks**: block quote, code block with language picker and newline-preserving round-trip, horizontal line, alignment, block indent, outdent and indent.
- **Lists**: bulleted, numbered and to-do lists with nesting (Tab and Shift+Tab, Enter on an empty item leaves the list, Backspace at the start outdents).
- **Links**: link balloon with preview, edit and unlink, autolink, keyboard shortcut.
- **Images**: insert via URL or file upload (Base64 adapter included, custom adapters supported), caption, alt text, inline, block and side styles, resize, widget toolbar.
- **Tables**: insert grid, header row and column, insert and delete rows and columns, Tab navigation, widget toolbar.
 / `1007…1007` are read back. Load `katex/dist/katex.min.css` in the page.

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

- Undo is linear with position-level transformation of operations. There is no real-time collaboration, track changes or comments.
- Tables do not support multi-cell selection, merging or splitting cells, or table and cell properties (borders, colors).
- Image resizing is offered through the toolbar option, not drag handles. Image upload to a server needs an upload adapter (the included adapter stores images as Base64).
- Pasting from Word or Google Docs keeps the semantic HTML but does not run the dedicated clean-up filters CKEditor ships for those sources.
- The UI is English only. Translations can be added through the locale's `t()` function.
- The built-in handwriting recogniser is basic (digits, Latin letters, common operators, fractions, roots, scripts); connect a recognition service for production handwriting. Image output embeds KaTeX HTML in SVG and needs the KaTeX fonts on the viewing page. The formula canvas needs physical key presses (no IME composition). See `docs/MATH_FEATURE_SPEC.md` for the remaining MathType items.
- No Markdown output, mentions, emoji, restricted editing, export to PDF or Word, or AI assistant features.
