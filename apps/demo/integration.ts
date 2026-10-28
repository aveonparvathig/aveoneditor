import '@aveon/editor/theme.css';
import 'katex/dist/katex.min.css';
import { defineEditorElement } from '@aveon/editor';

defineEditorElement();

// Show what a normal form submission would send to the server.
for (const [formId, outputId] of [['quote-form', 'quote-output'], ['comment-form', 'comment-output']]) {
  const form = document.getElementById(formId) as HTMLFormElement;
  const output = document.getElementById(outputId) as HTMLPreElement;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form).entries());
    output.textContent = JSON.stringify(fields, null, 2);
  });
}
