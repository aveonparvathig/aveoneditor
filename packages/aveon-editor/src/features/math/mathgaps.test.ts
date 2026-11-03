/**
 * Equations outside the editor: MathType content in, Word equations pasted, self-contained images,
 * exports and the read-only page viewer.
 */

import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../../builds/presets';
import { decodeMathTypeMathML, mathTypeMathMLToLatex } from './mathediting';
import { ommlToMathML, extractWordEquations } from './omml';
import { renderEquationSvg, renderEquationImageTag } from './mathimage';
import { replaceEquationsWithImages } from './mathexport';
import { renderEquations } from './mathviewer';
import { buildExportDocumentWithImages } from '../export/export';
import { normalizeClipboardHtml } from '../clipboard/clipboard';

async function createEditor(html: string, config: Record<string, unknown> = {}) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset, ...config });
}

/** How MathType stores x² in an image's `data-mathml` (its "modified XML encoding"). */
const MATHTYPE_X2 = '«math xmlns=¨http://www.w3.org/1998/Math/MathML¨»«msup»«mi»x«/mi»«mn»2«/mn»«/msup»«/math»';

describe('MathType content', () => {
  it('decodes the modified XML encoding and leaves plain MathML alone', () => {
    expect(decodeMathTypeMathML(MATHTYPE_X2)).toBe('<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>');
    expect(decodeMathTypeMathML('<math><mi>a</mi></math>')).toBe('<math><mi>a</mi></math>');
  });

  it('prefers the LaTeX annotation MathType keeps', () => {
    const value = '<math display="block"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="LaTeX">\\frac{a}{b}</annotation></semantics></math>';
    expect(mathTypeMathMLToLatex(value)).toEqual({ equation: '\\frac{a}{b}', display: true });
  });

  it('loads MathType image formulas as editable equations', async () => {
    const editor = await createEditor(`<p>Area <img class="Wirisformula" src="formula.png" data-mathml="${MATHTYPE_X2}" alt="x squared"> here</p>`);
    const data = editor.getData();
    expect(data).toMatch(/<span class="math-tex"[^>]*>\\\(x\^\{?2\}?\\\)<\/span>/);
    expect(data).not.toContain('Wirisformula');
    await editor.destroy();
  });
});

describe('Word equations', () => {
  const omml =
    '<m:oMathPara><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>' +
    '<m:r><m:t>+</m:t></m:r><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
    '<m:r><m:t>+</m:t></m:r><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary>' +
    '<m:r><m:t>+</m:t></m:r><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad></m:oMath></m:oMathPara>';

  it('turns Office Math into MathML', () => {
    const mathml = ommlToMathML(omml);
    expect(mathml).toContain('display="block"');
    expect(mathml).toContain('<mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac>');
    expect(mathml).toContain('<msup><mrow><mi>x</mi></mrow><mrow><mn>2</mn></mrow></msup>');
    expect(mathml).toContain('<munderover><mo>∑</mo>');
    expect(mathml).toContain('<msqrt><mrow><mi>y</mi></mrow></msqrt>');
  });

  it('replaces the equation and its fallback picture in clipboard HTML', () => {
    const html = `<p>Before <!--[if gte msEquation 12]>${omml}<![endif]--><![if !msEquation]><img src="file:///C:/tmp/clip_image001.png"><![endif]> after</p>`;
    const result = normalizeClipboardHtml(html);
    expect(result).toContain('<math');
    expect(result).not.toContain('clip_image001');
    expect(extractWordEquations('<p>No equations</p>')).toBe('<p>No equations</p>');
  });

  it('pastes a Word equation as an editable equation', async () => {
    const editor = await createEditor('<p>Start</p><p></p>');
    editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(1) as any, 0));
    const html = `<html><body><!--StartFragment--><p class=MsoNormal><!--[if gte msEquation 12]><m:oMath><m:sSup><m:e><m:r><m:t>e</m:t></m:r></m:e><m:sup><m:r><m:t>x</m:t></m:r></m:sup></m:sSup></m:oMath><![endif]--><![if !msEquation]><img src="file:///C:/clip.png"><![endif]></p><!--EndFragment--></body></html>`;
    const dataTransfer = { getData: (type: string) => (type === 'text/html' ? html : ''), types: ['text/html'], files: [] };
    editor.editing.view.document.fire('clipboardInput', { dataTransfer, method: 'paste' });
    expect(editor.getData()).toMatch(/\\\(e\^\{?x\}?\\\)/);
    await editor.destroy();
  });
});

describe('equation images', () => {
  it('draws self-contained SVG (paths, no fonts) sized in pixels', async () => {
    const svg = await renderEquationSvg('\\frac{a}{b}', true);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('foreignObject');
    expect(svg).toMatch(/width="[\d.]+"/);
    // The number of a tagged equation is drawn beside it.
    const tagged = await renderEquationImageTag('E=mc^2\\tag{1}', true, { alt: 'E equals m c squared' });
    expect(tagged).toContain('alt="E equals m c squared"');
    expect(tagged).toMatch(/^<img[^>]*src="data:image\/svg\+xml/);
  });

  it('also draws mhchem chemistry', async () => {
    const svg = await renderEquationSvg('\\ce{H2O}', false);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('merror');
  });

  it('writes self-contained images for outputType: image', async () => {
    const editor = await createEditor('<p>Area <span class="math-tex">\\(\\pi r^2\\)</span></p>', { math: { outputType: 'image' } });
    const data = editor.getData();
    const src = decodeURIComponent((/src="([^"]+)"/.exec(data) || [])[1] || '');
    expect(src).toContain('<path');
    expect(src).not.toContain('foreignObject');
    expect(data).toMatch(/width="\d+" height="\d+"/);
    // It still loads back as an equation.
    editor.setData(data);
    expect(editor.getData()).toContain('data-equation="\\pi r^2"');
    await editor.destroy();
  });
});

describe('exports and read-only pages', () => {
  it('replaces every equation form with an image', async () => {
    const html = await replaceEquationsWithImages(
      '<p><span class="math-tex" aria-label="x squared">\\(x^2\\)</span> and <script type="math/tex; mode=display">a+b</script> and ' +
        `<math><mi>y</mi></math> and <img class="Wirisformula" data-mathml="${MATHTYPE_X2}"></p>`
    );
    expect(html.match(/<img class="math-tex/g)).toHaveLength(4);
    expect(html).toContain('alt="x squared"');
    expect(html).toContain('math-tex math-tex-display');
    expect(html).not.toContain('\\(x^2\\)');
  });

  it('exports equations as images, not LaTeX source', async () => {
    const editor = await createEditor('<p>Area <span class="math-tex">\\(\\pi r^2\\)</span></p>');
    const html = await buildExportDocumentWithImages(editor);
    expect(html).toContain('src="data:image/svg+xml');
    expect(html).not.toContain('\\(\\pi r^2\\)');
    await editor.destroy();
  });

  it('shows saved equations on a page as native MathML', async () => {
    const page = document.createElement('article');
    page.innerHTML = '<p>Area <span class="math-tex">\\(\\pi r^2\\)</span></p><span class="math-tex">\\[E=mc^2\\tag{3}\\]</span>';
    document.body.appendChild(page);
    expect(await renderEquations(page)).toBe(2);
    const maths = page.querySelectorAll('math');
    expect(maths).toHaveLength(2);
    expect(maths[1].getAttribute('display')).toBe('block');
    expect(maths[0].getAttribute('alttext')).toBeTruthy();
    expect(page.querySelector('.math-tex-number')!.textContent).toBe('(3)');
    // Already rendered equations are left alone.
    expect(await renderEquations(page)).toBe(0);
    page.remove();
  });

  it('can show them as images instead', async () => {
    const page = document.createElement('div');
    page.innerHTML = '<span class="math-tex">\\(a^2\\)</span>';
    expect(await renderEquations(page, { output: 'svg' })).toBe(1);
    expect(page.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
});
