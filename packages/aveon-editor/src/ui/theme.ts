/**
 * The colour theme an editor lives in: the `theme` attribute of its `<aveon-editor>` element or the
 * `data-theme` of the nearest ancestor (`<html data-theme="dark">`, a wrapper, …). Panels that are
 * mounted in `document.body` (dialogs, balloons, tooltips) copy it so they match the editor.
 */

import type { Editor } from '../core/editor';

/** The theme name in force at the editor's element (`''` when none is set). */
export function themeOf(editor: Editor): string {
  const element = editor.ui.element;
  if (!element || typeof element.closest !== 'function') return '';
  const scope = element.closest<HTMLElement>('[data-theme], aveon-editor[theme]');
  if (!scope) return '';
  return scope.getAttribute('data-theme') || scope.getAttribute('theme') || '';
}

/** Gives `element` the editor's theme (as `data-theme`), so it matches when mounted elsewhere. */
export function applyTheme(editor: Editor, element: HTMLElement): void {
  const theme = themeOf(editor);
  if (theme) element.setAttribute('data-theme', theme);
  else element.removeAttribute('data-theme');
}
