import '@aveon/editor/theme.css';
import 'katex/dist/katex.min.css';
import { defineEditorElement, type AveonEditorElement } from '@aveon/editor';

// Options the tag cannot express as attributes are set before the element is defined.
const terms = document.querySelector('aveon-editor[name="terms"]') as AveonEditorElement;
terms.config = {
  user: { id: 'u-1', name: 'Sales' },
  mergeFields: {
    definitions: [
      { id: 'customer.name', label: 'Customer name' },
      { id: 'quote.validUntil', label: 'Valid until' }
    ],
    previewData: { customer: { name: 'Northwind Traders' }, quote: { validUntil: '27 Nov 2026' } }
  }
};

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
