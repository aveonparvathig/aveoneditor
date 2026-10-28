import '@aveon/editor/theme.css';
import 'katex/dist/katex.min.css';
import { ClassicEditor, classicPreset, classicDefaultConfig } from '@aveon/editor';

const output = document.querySelector('#output') as HTMLPreElement;

ClassicEditor.create(document.querySelector('#editor') as HTMLElement, {
  ...classicDefaultConfig,
  plugins: classicPreset,
  placeholder: 'Type something...',
  wordCount: { container: document.querySelector('#word-count') as HTMLElement }
})
  .then(editor => {
    (window as any).editor = editor;
    const refresh = () => {
      output.textContent = editor.getData();
    };
    editor.model.document.on('change:data', refresh);
    refresh();
    document.querySelector('#get-data')!.addEventListener('click', refresh);
    document.querySelector('#set-data')!.addEventListener('click', () => {
      editor.setData('<h2>Sample</h2><p>Hello <b>world</b>!</p><ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>');
    });
    let readOnly = false;
    document.querySelector('#toggle-readonly')!.addEventListener('click', () => {
      readOnly = !readOnly;
      if (readOnly) editor.enableReadOnlyMode('demo');
      else editor.disableReadOnlyMode('demo');
    });
  })
  .catch(err => {
    console.error(err);
    output.textContent = String(err && err.stack ? err.stack : err);
  });
