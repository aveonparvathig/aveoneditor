# Aveon Editor integration kit

Everything a client team needs to add Aveon Editor to a CMS, ERP or any web application: the packages, every way to integrate (plain pages, JavaScript, Angular 11–22, React, Vue), the backend API, and how to build the packages.

Source: <https://github.com/aveonparvathig/aveoneditor>

## Downloads and documentation

All releases: <https://github.com/aveonparvathig/aveoneditor/releases/latest>

New in 0.1.1: Angular 11–13 support (`angular-11-13/aveon-editor-forms.module.ts`, [section 3.5](#35-angular-1113)), and `aveon-angular` now shares the editor's version number.

| Download (0.1.1) | Contains |
|---|---|
| [aveon-offline-v0.1.1.zip](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-offline-v0.1.1.zip) | Everything: browser files, all npm packages, Angular 11–21 forms support, deploy files, docs |
| [aveon-editor-browser-v0.1.1.zip](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-editor-browser-v0.1.1.zip) | Browser files only (`<script>` tag route) |
| [aveon-editor-0.1.1.tgz](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-editor-0.1.1.tgz) | `@aveon/editor` |
| [aveon-angular-0.1.1.tgz](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-angular-0.1.1.tgz) | `aveon-angular` (Angular 22) |
| [aveon-api-connect-0.1.1.tgz](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-api-connect-0.1.1.tgz) | `@aveon/api-connect` |
| [aveon-collab-server-0.1.1.tgz](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-collab-server-0.1.1.tgz) | `@aveon/collab-server` |
| [SHA256SUMS](https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/SHA256SUMS) | Checksums of the files above |

npm can install straight from these links:

```bash
npm install https://github.com/aveonparvathig/aveoneditor/releases/download/v0.1.1/aveon-editor-0.1.1.tgz
```

| Document | Link |
|---|---|
| Live demo | <https://aveoneditor.ceo-02c.workers.dev/> ([integration examples](https://aveoneditor.ceo-02c.workers.dev/integration.html)) |
| Integration kit (this guide) | <https://github.com/aveonparvathig/aveoneditor/blob/master/docs/INTEGRATION_KIT.md> |
| Full reference (README) | <https://github.com/aveonparvathig/aveoneditor#readme> |
| Hosting and deployment | <https://github.com/aveonparvathig/aveoneditor/blob/master/docs/DEPLOYMENT.md> |
| Math and equations | <https://github.com/aveonparvathig/aveoneditor/blob/master/docs/MATH_FEATURE_SPEC.md> |
| Angular 14–21 directive | <https://github.com/aveonparvathig/aveoneditor/blob/master/docs/angular-14-21/aveon-editor-value-accessor.directive.ts> |
| Angular 11–13 module | <https://github.com/aveonparvathig/aveoneditor/blob/master/docs/angular-11-13/aveon-editor-forms.module.ts> |

## 1. What is in the kit

`npm run release` builds all of it into `release/<version>/` (see [section 8](#8-package-builds)).

| Package / file | What it is | Use it when |
|---|---|---|
| `editor/v<version>/aveon-editor.standalone.js` + `.css` | Ready-made browser files; registers `<aveon-editor>` and `window.AveonEditor` | Any page, no build tools (PHP, .NET, Java, Django, Rails, plain HTML) |
| `editor/v<version>/aveon-math-viewer.js` | Shows saved equations on read-only pages | Public pages that display saved content |
| `editor/v<version>/snippet.html` | The two tags to paste, with integrity hashes | Loading the editor from the central host |
| `packages/aveon-editor-<version>.tgz` | `@aveon/editor`: the library for bundlers (Vite, webpack, Angular CLI) | Apps built with npm |
| `packages/aveon-angular-<version>.tgz` | `aveon-angular`: the `<aveon-editor>` Angular component | Angular 22 apps |
| `angular-14-21/aveon-editor-value-accessor.directive.ts` | Forms support for the element (standalone directive) | Angular 14–21 apps |
| `angular-11-13/aveon-editor-forms.module.ts` | Forms support for the element (NgModule) | Angular 11–13 apps |
| `packages/aveon-api-connect-<version>.tgz` | `@aveon/api-connect`: uploads, documents, templates, merge data, co-editing | The backend all clients talk to |
| `packages/aveon-collab-server-<version>.tgz` | `@aveon/collab-server`: real-time co-editing server only | Co-editing without API Connect |
| `aveon-offline-v<version>.zip` | All of the above, plus deploy files and these docs | Air-gapped or on-premises clients |

## 2. Pick a route

| Your application | Route | Section |
|---|---|---|
| Server-rendered pages, or no build step | `<aveon-editor>` tag from the standalone files | [3.1](#31-a-tag-in-any-page) |
| JavaScript / TypeScript app with a bundler | `createEditor()` from `@aveon/editor` | [3.2](#32-javascript-or-typescript) |
| Angular 22 | `aveon-angular` component | [3.3](#33-angular-22-aveon-angular) |
| Angular 14–21 | `<aveon-editor>` element + value accessor directive | [3.4](#34-angular-1421) |
| Angular 11–13 | `<aveon-editor>` element + forms module | [3.5](#35-angular-1113) |
| React, Vue, Svelte | `<aveon-editor>` element | [3.6](#36-react-and-vue) |

Every route takes the same presets:

| Preset | For |
|---|---|
| `basic` | Comments, short descriptions (single toolbar) |
| `cms` (default) | Articles, pages, product texts (full ribbon, no equations) |
| `erp` | Quotes, notes, emails, records (compact ribbon: File, Home, Insert, Review, View) |
| `full` | Everything, including equations, chemistry and handwriting |

## 3. Add the editor

### 3.1 A tag in any page

```html
<link rel="stylesheet" href="https://editor.example.com/v0.1.1/aveon-editor.standalone.css">
<script type="module" src="https://editor.example.com/v0.1.1/aveon-editor.standalone.js"></script>

<form method="post" action="/quotes/42">
  <aveon-editor name="terms" preset="erp" placeholder="Terms…"
                upload-url="https://api.example.com/v1/uploads" min-height="240">
    <template><p>Existing content from the database</p></template>
  </aveon-editor>
  <button>Save</button>
</form>
```

Use the tags from `snippet.html` in production: they carry `integrity` hashes. The field submits its HTML with the form like a `<textarea>`.

| Attribute | Meaning |
|---|---|
| `name` | Form field name |
| `preset` | `basic`, `cms`, `erp` or `full` |
| `placeholder` | Text shown while empty |
| `upload-url` | Image upload endpoint; add `upload-credentials` to send cookies |
| `readonly`, `disabled` | Read-only (also follows a disabled `<fieldset>`) |
| `toolbar="classic"` | Single toolbar instead of the ribbon |
| `min-height` | Minimum editing height (`240` or `20rem`) |
| `theme="dark"` | Dark colour set (or put `data-theme="dark"` on `<html>` for the whole page) |

In JavaScript: `element.value` (get or set the HTML), `element.editor`, `await element.whenReady()`, and the `ready`, `input` and `change` events. Set `element.config = { … }` before adding the element for any `createEditor()` option (for example a bearer token for uploads, or co-editing).

### 3.2 JavaScript or TypeScript

```bash
npm install ./aveon-editor-0.1.1.tgz
```

```ts
import '@aveon/editor/theme.css';
import { createEditor } from '@aveon/editor';

const editor = await createEditor('#description', {
  preset: 'erp',
  placeholder: 'Describe the task…',
  upload: { url: 'https://api.example.com/v1/uploads', headers: () => ({ Authorization: `Bearer ${getToken()}` }) }
});

editor.model.document.on('change:data', () => save(editor.getData()));
```

For the `full` preset, also import `katex/dist/katex.min.css`.

### 3.3 Angular 22: `aveon-angular`

```bash
npm install ./aveon-editor-0.1.1.tgz ./aveon-angular-0.1.1.tgz
```

`styles.css`:

```css
@import '@aveon/editor/theme.css';
@import 'katex/dist/katex.min.css'; /* only for the full preset */
```

```ts
import { Component } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ClassicEditor, resolveEditorOptions, type Editor } from '@aveon/editor';
import { AveonEditorComponent } from 'aveon-angular';

@Component({
  selector: 'app-quote',
  imports: [AveonEditorComponent, FormsModule, ReactiveFormsModule],
  template: `
    <aveon-editor [editor]="Editor" [config]="config" [formControl]="terms"
                  (ready)="onReady($event)" (change)="onChange()" (error)="onError($event)">
    </aveon-editor>
  `
})
export class QuoteComponent {
  Editor = ClassicEditor;
  config = resolveEditorOptions({
    preset: 'erp',
    upload: { url: 'https://api.example.com/v1/uploads', headers: () => ({ Authorization: `Bearer ${this.auth.token()}` }) }
  });
  terms = new FormControl('<p>Payment within 30 days.</p>');

  constructor(private readonly auth: AuthService) {}

  onReady(editor: Editor) {}
  onChange() {}
  onError(error: unknown) { console.error(error); }
}
```

| Input | Meaning |
|---|---|
| `editor` | Editor class (required): `ClassicEditor`, `InlineEditor`, `BalloonEditor`, `DecoupledEditor` |
| `config` | Editor configuration; `resolveEditorOptions({ preset, … })` builds one from a preset |
| `data` | Initial HTML (prefer `ngModel` or a form control) |
| `disabled` | Read-only; forms' disabled state works too |
| `tagName` | Element the editor is created on (default `div`) |
| `disableTwoWayDataBinding` | Stop updating the form on every change (large documents) |

| Output | Payload |
|---|---|
| `ready` | The editor instance |
| `change` | `{ event, editor }` on every change |
| `focus`, `blur` | `{ event, editor }` |
| `error` | The error when the editor could not start |

`ngModel`, `formControl` and `formControlName` all work. For NgModule apps, import `AveonEditorModule`.

### 3.4 Angular 14–21

`aveon-angular` needs Angular 22. In older versions, use the element:

1. Load the element: the standalone `<script>` and `<link>` from 3.1 in `index.html`, or `import { defineEditorElement } from '@aveon/editor'; defineEditorElement();` in `main.ts` (plus the theme in `styles.css`).
2. Copy `angular-14-21/aveon-editor-value-accessor.directive.ts` into the app.

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AveonEditorValueAccessor } from './aveon-editor-value-accessor.directive';

@Component({
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, AveonEditorValueAccessor],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<aveon-editor preset="cms" [(ngModel)]="body"></aveon-editor>`
})
export class ArticleComponent {
  body = '<p>Hello</p>';
}
```

### 3.5 Angular 11–13

These versions have no standalone components, and their build cannot compile the library itself (it is ES2022), so:

1. Load the element with the standalone files in `index.html`: the `<link>` and `<script type="module">` from 3.1 (from your host, or copied into `src/assets/aveon/`). Do not import `@aveon/editor` in TypeScript.
2. Copy `angular-11-13/aveon-editor-forms.module.ts` into the app and import `AveonEditorFormsModule`.

```ts
import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AveonEditorFormsModule } from './aveon-editor-forms.module';
import { AppComponent } from './app.component';

@NgModule({
  imports: [BrowserModule, FormsModule, ReactiveFormsModule, AveonEditorFormsModule],
  declarations: [AppComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  bootstrap: [AppComponent]
})
export class AppModule {}
```

Templates are the same as in 3.4: `<aveon-editor preset="erp" [formControl]="terms"></aveon-editor>`, with `ngModel`, `formControlName` and the disabled state working. To reach the editor itself, use a template reference: `<aveon-editor #terms … (ready)="onReady(terms)">` and `onReady(element: any) { element.editor.execute('bold'); }`.

The editor needs a current browser (Chrome, Edge, Firefox, Safari); Internet Explorer 11, which Angular 11 can still target, is not supported.

For NgModule apps, add the directive to the module's `imports` and `CUSTOM_ELEMENTS_SCHEMA` to its `schemas`.

### 3.6 React and Vue

```tsx
// React
const ref = useRef<HTMLElement & { value: string }>(null);
useEffect(() => {
  const element = ref.current!;
  const onChange = () => setBody(element.value);
  element.addEventListener('change', onChange);
  return () => element.removeEventListener('change', onChange);
}, []);
return <aveon-editor ref={ref} name="body" preset="cms" />;
```

```html
<!-- Vue: set compilerOptions.isCustomElement = tag => tag === 'aveon-editor' -->
<aveon-editor name="body" preset="cms" @change="body = $event.target.value"></aveon-editor>
```

## 4. Backend: API Connect

API Connect is the one backend every client's editor talks to: image uploads, saved documents, templates, merge data and co-editing, separated per client (tenant).

### 4.1 Run it

```bash
npm install ./aveon-api-connect-0.1.1.tgz ./aveon-collab-server-0.1.1.tgz
```

```bash
ACME_JWT_SECRET=… npx aveon-api-connect --config api-connect.config.json
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

Or inside an existing Node server: `createApiConnect({ … }).handle(request, response)`.

### 4.2 Tokens

Each client's own backend signs a short-lived JWT for the logged-in user and gives it to the page. API Connect never sees passwords.

| Claim | Meaning |
|---|---|
| `tenant` | Client id from the config (`acme`) |
| `sub` | User id |
| `name` | User name (shown to co-editors) |
| `exp` | Expiry; keep it short (5–15 minutes) |
| `docs` | Optional: document ids this user may open; `quote-*` matches a prefix |

HS256 uses the shared `secret`. RS256 and ES256 use the client's own key pair; API Connect only holds the public key.

```js
// The client's backend (Node, with the jsonwebtoken package)
import jwt from 'jsonwebtoken';

app.get('/editor-token', requireLogin, (req, res) => {
  const token = jwt.sign(
    { tenant: 'acme', sub: req.user.id, name: req.user.name, docs: ['quote-*'] },
    process.env.ACME_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '10m' }
  );
  res.json({ token });
});
```

Send it as `Authorization: Bearer <token>`. A tenant's tokens only work from that tenant's `origins`, and only on its own documents and files.

### 4.3 Endpoints

Base URL: `https://api.example.com` (locally `http://localhost:8080`).

| Method | Endpoint | Auth | Request | Response |
|---|---|---|---|---|
| `POST` | `/v1/uploads` | Bearer | `multipart/form-data`, file in field `upload`; PNG, JPEG, GIF, WebP up to 10 MB (the real type is checked) | `{ "url": "https://api.example.com/v1/files/acme/…" }` |
| `GET` | `/v1/files/<tenant>/<key>` | None | | The uploaded file (random name, cached for a year) |
| `GET` | `/v1/documents/<id>` | Bearer | | `{ "id", "html", "savedAt", "savedBy" }` |
| `PUT` | `/v1/documents/<id>` | Bearer | `{ "html": "…" }` (JSON) or the HTML as `text/html`; up to 20 MB | `{ "id", "savedAt", "changed" }`; `changed: true` means the sanitiser removed something |
| `GET` | `/v1/templates` | Bearer | | The tenant's templates (from its config) |
| `GET` | `/v1/merge-data/<record>` | Bearer | | Merge field values from your `mergeData()` hook |
| `WSS` | `/v1/collab?doc=<tenant>:<id>` | Token in the connection | | Co-editing (section 5) |
| `GET` | `/editor/v<version>/<file>` | None | | Editor files (immutable cache, CORS) |
| `GET` | `/health` | None | | `{ "status": "ok" }` |

Document ids: letters, digits, `_ . : -`, up to 128 characters.

Errors are JSON, `{ "error": { "message": "…" } }`, with status 400 (bad request), 401 (missing or expired token), 403 (wrong origin or document), 404, 413 (too large) or 500. The editor shows upload errors to the user.

```bash
curl -X PUT https://api.example.com/v1/documents/quote-42 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"html":"<p>Payment within 30 days.</p>"}'
```

### 4.4 Your own upload endpoint instead

Any server can take uploads: accept `POST multipart/form-data` with the file in `upload` (change it with `upload.fieldName`) and answer `{ "url": "…" }`, or `{ "urls": { "default": "…", "800": "…" } }` for responsive sizes. On failure answer `{ "error": { "message": "File too large" } }`.

Whatever stores the HTML: sanitise it on the server before saving or showing it, as for any user-submitted HTML. API Connect's document endpoint already does.

## 5. Real-time co-editing

```ts
createEditor('#body', {
  preset: 'cms',
  user: { id: session.userId, name: session.userName },
  upload: { url: 'https://api.example.com/v1/uploads', headers: () => ({ Authorization: `Bearer ${getToken()}` }) },
  collaboration: { url: 'wss://api.example.com/v1/collab', documentId: `acme:${recordId}`, token: () => getToken() }
});
```

In Angular, put the same `user` and `collaboration` options in `resolveEditorOptions({ … })`. Document ids start with the tenant (`acme:quote-42`). The `token` function is called on every reconnect, so it can fetch a fresh token.

Without API Connect, run `@aveon/collab-server` on its own (`npx aveon-collab --port 1234 --data ./collab-data`, or `--postgres`, `--mssql`, `--mysql`, `--sqlite`) and connect to `wss://collab.example.com`. It needs a server that keeps WebSocket connections open (a VM or container, not Vercel).

## 6. Editor API reference

### `createEditor(target, options)` → `Promise<Editor>`

| Option | Meaning |
|---|---|
| `preset` | `basic`, `cms` (default), `erp`, `full` |
| `placeholder`, `initialData`, `language` | As named |
| `upload` | `{ url, headers?, withCredentials?, fieldName? }`; `headers` can be a function |
| `user` | `{ id, name }` for comments, track changes and co-editing |
| `collaboration` | `{ url, documentId, token }` |
| `extraPlugins`, `removePlugins` | Plugin classes or names |
| `toolbar`, `ribbon`, `fontFamily`, `fontSize`, `heading`, `table`, `image`, `math`, … | Any editor configuration |

`target` is an element or CSS selector; a `<textarea>` is replaced and kept in sync. `resolveEditorOptions(options)` returns the same configuration without creating an editor (for `ClassicEditor.create()` or Angular).

### The editor instance

| Call | Does |
|---|---|
| `editor.getData()` / `editor.setData(html)` | Read or replace the HTML |
| `editor.execute(name, args?)` | Run a command: `bold`, `heading`, `insertTable`, `math`, `exportPdf`, `exportWord`, … |
| `editor.commands.get(name)` | `.value`, `.isEnabled` |
| `editor.model.document.on('change:data', fn)` | Content changed |
| `editor.editing.view.document.on('change:isFocused', fn)` | Focus changed |
| `editor.enableReadOnlyMode(id)` / `disableReadOnlyMode(id)` | Lock and unlock |
| `editor.plugins.get('Markdown').getMarkdown()` | The content as Markdown |
| `await editor.destroy()` | Remove the editor |

Classes: `ClassicEditor`, `InlineEditor`, `BalloonEditor`, `DecoupledEditor`, all with `static create(element, config)`.

### Other exports

| Export | Does |
|---|---|
| `defineEditorElement(tagName?)` | Registers `<aveon-editor>` (bundler builds) |
| `buildExportDocumentWithImages(editor, options)` | Full HTML document with equations as images, for Word or email |
| `replaceEquationsWithImages(html)` | Same for HTML stored elsewhere |
| `renderEquations(root?, { output })` | Shows saved equations in a page: `mathml` (default), `svg` or `katex` |

On read-only pages without the editor, load the viewer instead:

```html
<script type="module" src="https://editor.example.com/v0.1.1/aveon-math-viewer.js"></script>
```

It renders every saved equation once the page loads; add `?output=svg` to the script URL for images.

## 7. API links

| What | Development | Production (example) |
|---|---|---|
| Editor script | `http://localhost:8080/editor/v0.1.1/aveon-editor.standalone.js` | `https://editor.example.com/v0.1.1/aveon-editor.standalone.js` |
| Editor styles | `http://localhost:8080/editor/v0.1.1/aveon-editor.standalone.css` | `https://editor.example.com/v0.1.1/aveon-editor.standalone.css` |
| Equation viewer | `http://localhost:8080/editor/v0.1.1/aveon-math-viewer.js` | `https://editor.example.com/v0.1.1/aveon-math-viewer.js` |
| Uploads | `http://localhost:8080/v1/uploads` | `https://api.example.com/v1/uploads` |
| Documents | `http://localhost:8080/v1/documents/<id>` | `https://api.example.com/v1/documents/<id>` |
| Templates | `http://localhost:8080/v1/templates` | `https://api.example.com/v1/templates` |
| Merge data | `http://localhost:8080/v1/merge-data/<record>` | `https://api.example.com/v1/merge-data/<record>` |
| Co-editing | `ws://localhost:8080/v1/collab` | `wss://api.example.com/v1/collab` |
| Health | `http://localhost:8080/health` | `https://api.example.com/health` |
| Demo | `http://localhost:5180` (`npm run dev`) | <https://aveoneditor.ceo-02c.workers.dev/> |
| Angular demo | `http://localhost:4201` (`npm run dev:angular`) | |

Replace `editor.example.com` and `api.example.com` with your hosts. The editor files can also be served by API Connect itself (`https://api.example.com/editor/v0.1.1/…`).

## 8. Package builds

Requirements: Node 18+ (22 recommended) and npm. Once:

```bash
npm install
```

```bash
cd apps/cms-angular && npm install
```

| Command | Builds |
|---|---|
| `npm run release` | Everything in section 1, after running the tests, into `release/<version>/` |
| `npm run build` | `@aveon/editor` only, into `packages/aveon-editor/dist` (`standalone/` holds the browser files) |
| `npm run build:angular` | `aveon-angular` into `apps/cms-angular/dist/aveon-angular`, and the Angular demo |
| `npm run build:demo` | The demo site, into `apps/demo/dist` |
| `docker build -f deploy/docker/api-connect.Dockerfile -t aveon/api-connect:0.1.1 .` | API Connect image |
| `docker build -f deploy/docker/collab-server.Dockerfile -t aveon/collab-server:0.1.1 .` | Co-editing server image |

`npm run release -- --skip-tests` skips the tests; `--skip-build` reuses the last build.

**Publishing the downloads:** after raising the version in `packages/aveon-editor/package.json`, push a matching tag. The *Release* workflow (`.github/workflows/release.yml`) runs the tests, builds everything and publishes a GitHub Release with the files attached:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

It can also be run by hand from the repository's *Actions* tab; it then updates the release for the current version.

**Installing the packages:** `npm install ./<file>.tgz`, or publish them to a private registry (GitHub Packages, Azure Artifacts, Verdaccio):

```bash
npm publish ./release/0.1.1/packages/aveon-editor-0.1.1.tgz --registry https://npm.example.com
```

**Checking downloads:** `release/<version>/SHA256SUMS` lists the archives' checksums; `editor/v<version>/integrity.json` lists each browser file's SHA-384 hash.

**Kubernetes / OpenShift:** `deploy/helm/aveon` installs API Connect and the co-editing server behind one host.

## 9. Go-live checklist

- [ ] Editor files served over HTTPS, loaded with the `integrity` tags from `snippet.html`
- [ ] Each client added to `tenants` with its `origins` and a secret or public key
- [ ] The client's backend issues short-lived tokens (`/editor-token` or similar)
- [ ] Uploads point at `/v1/uploads` (or your own endpoint) with a bearer token
- [ ] Saved HTML is sanitised on the server
- [ ] `/health` is monitored
- [ ] `api-data` and `collab-data` (or the database) are backed up
