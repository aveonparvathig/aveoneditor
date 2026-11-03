/**
 * Mermaid diagrams. The library (about 1 MB) is loaded on first use, as a separate chunk, and always
 * runs in Mermaid's `strict` security mode (no scripts, no clickable links, labels sanitised).
 */

export type MermaidLoader = () => Promise<any>;

export interface MermaidConfig {
  /** Returns the `mermaid` module. Default: the bundled copy. */
  loader?: MermaidLoader;
  /** Mermaid theme: `default`, `neutral`, `dark`, `forest` or `base`. Default `default`. */
  theme?: string;
  /** Extra Mermaid settings (security settings cannot be changed). */
  config?: Record<string, unknown>;
}

// Mermaid's own pre-built bundle: self-contained, so bundlers need no special settings for its parsers.
// @ts-ignore -- the bundle has no type declarations of its own.
const defaultLoader: MermaidLoader = () => import('mermaid/dist/mermaid.esm.min.mjs');

let loaded: { loader: MermaidLoader; promise: Promise<any> } | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/** Loads Mermaid once (per loader). */
export function loadMermaid(loader: MermaidLoader = defaultLoader): Promise<any> {
  if (!loaded || loaded.loader !== loader) {
    const promise = loader().then(module => module.default || module);
    promise.catch(() => {
      if (loaded?.promise === promise) loaded = null;
    });
    loaded = { loader, promise };
  }
  return loaded.promise;
}

/**
 * Renders Mermaid source to SVG markup; rejects with Mermaid's message when the source is invalid.
 * Renders run one at a time (Mermaid keeps global state while it draws).
 */
export function renderMermaid(source: string, options: MermaidConfig = {}): Promise<string> {
  const run = async () => {
    const mermaid = await loadMermaid(options.loader);
    mermaid.initialize({
      startOnLoad: false,
      theme: options.theme || 'default',
      ...(options.config || {}),
      securityLevel: 'strict',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize']
    });
    const id = `aveon-mermaid-${++counter}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return String(svg);
    } finally {
      // Mermaid leaves its scratch element (or an error picture) in the page.
      if (typeof document !== 'undefined') {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
