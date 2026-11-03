import { Plugin } from '../../core/plugin';
import { MathEditing } from './mathediting';
import { MathUI } from './mathui';
import { MathTyping } from './mathtyping';

/**
 * Math equations: inline and display LaTeX equations rendered with KaTeX (or a custom engine),
 * inserted and edited through a balloon form with live preview.
 *
 * Data format (configurable through `math.outputType`):
 * - `span` (default): `<span class="math-tex">\(a^2 + b^2 = c^2\)</span>` (display mode uses `\[ \]`)
 * - `script`: `<script type="math/tex">a^2 + b^2 = c^2</script>` (`math/tex; mode=display` for display mode)
 *
 * Remember to load the KaTeX stylesheet (`katex/dist/katex.min.css`) in your page.
 */
export class Math extends Plugin {
  public static override get pluginName(): string {
    return 'Math';
  }

  public static override get requires() {
    return [MathEditing, MathUI, MathTyping];
  }
}
