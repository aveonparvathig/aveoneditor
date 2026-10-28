/**
 * Script-tag build: everything in one minified bundle plus a stylesheet, for pages without a
 * bundler (server-rendered CMS and ERP screens).
 *
 *   <link rel="stylesheet" href="aveon-editor.standalone.css">
 *   <script type="module" src="aveon-editor.standalone.js"></script>
 *   <aveon-editor name="body" preset="cms"></aveon-editor>
 *
 * `<aveon-editor>` is registered automatically and the whole API is available as `window.AveonEditor`
 * (e.g. `AveonEditor.createEditor('#notes', { preset: 'erp' })`). KaTeX is a separate chunk that is
 * only downloaded when an editor with equations starts.
 */

import './theme/index.css';
import * as AveonEditor from './index';

// KaTeX's stylesheet (with its fonts inlined) travels in the lazily loaded math chunk.
AveonEditor.setKatexStylesLoader(() =>
  import('katex/dist/katex.min.css?inline').then(module => {
    if (document.getElementById('aveon-katex-styles')) return;
    const style = document.createElement('style');
    style.id = 'aveon-katex-styles';
    style.textContent = module.default;
    document.head.appendChild(style);
  })
);
AveonEditor.defineEditorElement();

declare global {
  interface Window {
    AveonEditor: typeof AveonEditor;
  }
}

if (typeof window !== 'undefined') window.AveonEditor = AveonEditor;

export * from './index';
