import '@aveon/editor/theme.css';
import 'katex/dist/katex.min.css';
import { createEditor } from '@aveon/editor';

const params = new URLSearchParams(location.search);
// Set VITE_COLLAB_URL (e.g. wss://collab.example.com) when building for a hosted site.
const url = import.meta.env.VITE_COLLAB_URL || `ws://${location.hostname}:1234`;
const documentId = params.get('doc') || 'demo-collaboration';
const initialData = '<h2>Project brief</h2><p>Edit this text in both editors at the same time.</p><ul><li>Goals</li><li>Timeline</li></ul>';

// Each "screen" is a separate editor with its own user, as people in different browsers would be.
// With ?as=Name the page joins as that one person instead.
const extra = params.get('as');
const people: Array<[string, string]> = extra
  ? [[`guest-${extra.toLowerCase().replace(/\W+/g, '-')}`, extra]]
  : [
      ['asha', 'Asha Rao'],
      ['ben', 'Ben Okafor']
    ];

const grid = document.querySelector('.grid')!;
grid.innerHTML = '';
for (const [id, name] of people) {
  const card = document.createElement('section');
  card.className = 'card';
  if (extra) card.style.gridColumn = '1 / -1';
  const title = document.createElement('h2');
  title.textContent = `${name}'s screen`;
  const host = document.createElement('div');
  host.innerHTML = initialData;
  card.append(title, host);
  grid.appendChild(card);
  createEditor(host, { preset: 'full', user: { id, name }, collaboration: { url, documentId } }).then(editor => {
    (window as any)[id.replace(/\W/g, '_')] = editor;
  });
}
