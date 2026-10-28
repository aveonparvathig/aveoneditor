import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../../builds/presets';
import { parseDelimitedEquation } from './mathediting';

async function createEditor(html: string, extraConfig: Record<string, unknown> = {}) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset, math: { altText: false }, ...extraConfig });
}

describe('math', () => {
  it('parses delimiters', () => {
    expect(parseDelimitedEquation('\\(x^2\\)')).toEqual({ equation: 'x^2', display: false });
    expect(parseDelimitedEquation('\\[x^2\\]')).toEqual({ equation: 'x^2', display: true });
    expect(parseDelimitedEquation('$$ e=mc^2 $$')).toEqual({ equation: 'e=mc^2', display: true });
    expect(parseDelimitedEquation('$a$')).toEqual({ equation: 'a', display: false });
    expect(parseDelimitedEquation('a+b')).toEqual({ equation: 'a+b', display: false });
  });

  it('round-trips inline and display equations', async () => {
    const data = '<p>Pythagoras: <span class="math-tex">\\(a^2 + b^2 = c^2\\)</span> holds.</p><span class="math-tex">\\[\\int_0^1 x\\,dx\\]</span><p>After</p>';
    const editor = await createEditor(data);
    expect(editor.getData()).toBe(data);
    const root = editor.model.document.getRoot()!;
    expect((root.getChild(1) as any).name).toBe('mathtex-display');
    await editor.destroy();
  });

  it('upcasts script tags and can output them', async () => {
    const editor = await createEditor('<p>x <script type="math/tex">\\frac{1}{2}</script></p><script type="math/tex; mode=display">\\sum_i a_i</script>', { math: { outputType: 'script' } });
    expect(editor.getData()).toBe('<p>x <script type="math/tex">\\frac{1}{2}</script></p><script type="math/tex; mode=display">\\sum_i a_i</script>');
    await editor.destroy();
  });

  it('adds spoken descriptions and can output MathML', async () => {
    const editor = await createEditor('<p><span class="math-tex">\\(\\frac{1}{2}\\)</span></p>', { math: {} });
    expect(editor.getData()).toBe('<p><span class="math-tex" role="math" aria-label="1 half">\\(\\frac{1}{2}\\)</span></p>');
    const widget = editor.editing.view.getDomRoot()!.querySelector('.ck-math-tex')!;
    expect(widget.getAttribute('role')).toBe('math');
    expect(widget.getAttribute('aria-label')).toBe('1 half');
    await editor.destroy();

    const mathmlEditor = await createEditor('<p>x <span class="math-tex">\\(a^2\\)</span></p>', { math: { outputType: 'mathml' } });
    expect(mathmlEditor.getData()).toBe('<p>x <math xmlns="http://www.w3.org/1998/Math/MathML" alttext="a squared"><semantics><mrow><msup><mi>a</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">a^2</annotation></semantics></math></p>');
    await mathmlEditor.destroy();
  });

  it('upcasts MathML with and without a TeX annotation', async () => {
    const withAnnotation = await createEditor('<p><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">\\sqrt{x}</annotation></semantics></math></p>');
    expect(withAnnotation.getData()).toBe('<p><span class="math-tex">\\(\\sqrt{x}\\)</span></p>');
    await withAnnotation.destroy();

    const plain = await createEditor('<math display="block"><mfrac><mi>a</mi><mrow><mi>b</mi><mo>+</mo><mn>1</mn></mrow></mfrac></math>');
    expect(plain.getData()).toBe('<span class="math-tex">\\[\\frac{a}{b+1}\\]</span>');
    await plain.destroy();
  });

  it('numbers display equations and writes \\tag in the output', async () => {
    const editor = await createEditor('<p>a</p><span class="math-tex" data-numbered="true">\\[x\\]</span><p>b</p><span class="math-tex">\\[y\\]</span><span class="math-tex">\\[z\\tag{7}\\]</span>');
    expect(editor.getData()).toBe('<p>a</p><span class="math-tex" data-numbered="true">\\[x\\tag{1}\\]</span><p>b</p><span class="math-tex">\\[y\\]</span><span class="math-tex" data-numbered="true">\\[z\\tag{2}\\]</span>');
    const root = editor.model.document.getRoot()!;
    expect((root.getChild(4) as any).getAttribute('number')).toBe(2);
    editor.model.change(writer => {
      writer.setSelection(root.getChild(3) as any, 'on');
    });
    editor.execute('math', { equation: 'y', display: true, numbered: true });
    expect(editor.getData()).toBe('<p>a</p><span class="math-tex" data-numbered="true">\\[x\\tag{1}\\]</span><p>b</p><span class="math-tex" data-numbered="true">\\[y\\tag{2}\\]</span><span class="math-tex" data-numbered="true">\\[z\\tag{3}\\]</span>');
    const widget = editor.editing.view.getDomRoot()!.querySelector('.ck-math-tex-display[data-numbered="3"]');
    expect(widget).not.toBeNull();
    await editor.destroy();

    const roman = await createEditor('<span class="math-tex" data-numbered="true">\\[x\\]</span><span class="math-tex" data-numbered="true">\\[y\\]</span>', { math: { altText: false, numbering: { format: 'roman', template: '[{n}]' } } });
    expect(roman.getData()).toBe('<span class="math-tex" data-numbered="true">\\[x\\tag*{[i]}\\]</span><span class="math-tex" data-numbered="true">\\[y\\tag*{[ii]}\\]</span>');
    await roman.destroy();
  });

  it('outputs images, speaks other languages and offers the chemType button', async () => {
    const editor = await createEditor('<p><span class="math-tex">\\(\\frac{1}{2}\\)</span></p>', { math: { outputType: 'image', speechLanguage: 'es' } });
    const data = editor.getData();
    expect(data.startsWith('<p><img class="math-tex" src="data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(data).toContain('data-equation="\\frac{1}{2}"');
    expect(data).toContain('alt="1 medio"');
    expect(data).toContain('role="math"');
    expect(editor.ui.componentFactory.has('chemType')).toBe(true);
    await editor.destroy();

    const roundTrip = await createEditor('<p><img src="data:image/svg+xml,x" class="math-tex math-tex-display" data-equation="a+b" alt="a plus b"></p>', { math: { altText: false } });
    expect(roundTrip.getData()).toBe('<span class="math-tex">\\[a+b\\]</span>');
    await roundTrip.destroy();
  });

  it('renders KaTeX in the editing view', async () => {
    const editor = await createEditor('<p><span class="math-tex">\\(x^2\\)</span></p>');
    const dom = editor.editing.view.getDomRoot()!;
    const widget = dom.querySelector('.ck-math-tex') as HTMLElement;
    expect(widget).not.toBeNull();
    expect(widget.classList.contains('ck-widget')).toBe(true);
    expect(widget.querySelector('.katex')).not.toBeNull();
    expect(widget.querySelector('math')).not.toBeNull();
    await editor.destroy();
  });

  it('inserts, updates and switches equations through the command', async () => {
    const editor = await createEditor('<p>Hello</p>');
    editor.model.change(writer => {
      writer.setSelection(editor.model.document.getRoot()!.getChild(0) as any, 'end');
    });
    editor.execute('math', { equation: 'a+b' });
    expect(editor.getData()).toBe('<p>Hello<span class="math-tex">\\(a+b\\)</span></p>');
    const command = editor.commands.get('math')!;
    expect(command.value).toEqual({ equation: 'a+b', display: false, numbered: false });

    editor.execute('math', { equation: 'a-b' });
    expect(editor.getData()).toBe('<p>Hello<span class="math-tex">\\(a-b\\)</span></p>');

    editor.execute('math', { equation: 'a-b', display: true });
    expect(editor.getData()).toBe('<p>Hello</p><span class="math-tex">\\[a-b\\]</span>');
    expect(command.value).toEqual({ equation: 'a-b', display: true, numbered: false });

    editor.execute('undo');
    expect(editor.getData()).toBe('<p>Hello<span class="math-tex">\\(a-b\\)</span></p>');
    await editor.destroy();
  });
});
