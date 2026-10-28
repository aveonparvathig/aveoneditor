import '@aveon/editor/theme.css';
import 'katex/dist/katex.min.css';
import { ClassicEditor, classicPreset, classicDefaultConfig } from '@aveon/editor';

const output = document.querySelector('#output') as HTMLPreElement;

/** Sample data for the Mailings tab; in a real app this comes from the record being edited. */
const mergeFields = {
  definitions: [
    {
      group: 'Customer',
      definitions: [
        { id: 'customer.name', label: 'Customer name' },
        { id: 'customer.contact', label: 'Contact person' },
        { id: 'customer.email', label: 'Email' }
      ]
    },
    {
      group: 'Quote',
      definitions: [
        { id: 'quote.number', label: 'Quote number' },
        { id: 'quote.total', label: 'Total' },
        { id: 'quote.validUntil', label: 'Valid until' }
      ]
    },
    { id: 'today', label: 'Today' }
  ],
  previewData: {
    customer: { name: 'Northwind Traders', contact: 'Maria Anders', email: 'maria@northwind.example' },
    quote: { number: 'Q-2026-0142', total: '€12,400.00', validUntil: '27 Nov 2026' },
    today: '28 Oct 2026'
  }
};

const field = (id: string) => `<span class="merge-field" data-field="${id}">{{${id}}}</span>`;

const templates = [
  {
    title: 'Quotation',
    description: 'Standard sales quotation with merge fields',
    data:
      `<h2>Quotation ${field('quote.number')}</h2>` +
      `<p>Dear ${field('customer.contact')},</p>` +
      `<p>Thank you for your interest. Please find our offer for ${field('customer.name')} below.</p>` +
      '<figure class="table"><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody><tr><td>Licence</td><td>10</td><td>€1,200.00</td></tr><tr><td>Support</td><td>1</td><td>€400.00</td></tr></tbody></table><figcaption>Table 1: Offer</figcaption></figure>' +
      `<p>Total: <strong>${field('quote.total')}</strong>. This offer is valid until ${field('quote.validUntil')}.</p>` +
      '<p>Kind regards,<br>Sales team</p>'
  },
  {
    title: 'Meeting notes',
    description: 'Agenda, decisions and action items',
    data: `<h2>Meeting notes – ${field('today')}</h2><h3>Agenda</h3><ol><li>&nbsp;</li></ol><h3>Decisions</h3><ul><li>&nbsp;</li></ul><h3>Action items</h3><ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled><span class="todo-list__label__description">&nbsp;</span></label></li></ul>`
  }
];

ClassicEditor.create(document.querySelector('#editor') as HTMLElement, {
  ...classicDefaultConfig,
  plugins: classicPreset,
  placeholder: 'Type something...',
  wordCount: { container: document.querySelector('#word-count') as HTMLElement },
  user: { id: 'u-1', name: 'Ranjith' },
  mergeFields,
  templates,
  export: { fileName: 'aveon-document' }
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
      document.querySelector('#toggle-readonly')!.setAttribute('aria-pressed', String(readOnly));
      if (readOnly) editor.enableReadOnlyMode('demo');
      else editor.disableReadOnlyMode('demo');
    });
  })
  .catch(err => {
    console.error(err);
    output.textContent = String(err && err.stack ? err.stack : err);
  });
