/**
 * Script-tag equation viewer (`dist/standalone/aveon-math-viewer.js`): shows the equations of saved
 * editor content on a read-only page, without the editor.
 *
 *   <script type="module" src="aveon-math-viewer.js"></script>
 *   <script type="module" src="aveon-math-viewer.js?output=svg"></script>
 *
 * The page is rendered once it has loaded; call `AveonMathViewer.renderEquations(element)` for
 * content added later. `output` is `mathml` (default), `svg` or `katex` (see `renderEquations`).
 */

import { renderEquations, type EquationViewerOutput } from './features/math/mathviewer';

declare global {
  interface Window {
    AveonMathViewer: { renderEquations: typeof renderEquations };
  }
}

if (typeof window !== 'undefined') {
  window.AveonMathViewer = { renderEquations };
  const output = (new URL(import.meta.url).searchParams.get('output') || undefined) as EquationViewerOutput | undefined;
  const run = () => void renderEquations(document.body, { output });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

export { renderEquations };
