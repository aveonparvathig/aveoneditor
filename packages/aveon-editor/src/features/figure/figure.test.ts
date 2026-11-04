/**
 * Figure tools: width, alignment and captions on sketches, diagrams and images; cropping a sketch;
 * moving a block object with the keyboard command.
 */

import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../../builds/presets';
import { cropSketch } from '../sketch/sketch';
import type { Diagrams } from '../diagrams/diagrams';

async function createEditor(html: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = await ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset, initialData: html });
  return editor;
}

function selectFirstObject(editor: ClassicEditor, name: string) {
  const root = editor.model.document.getRoot()!;
  const element = [...root.getChildren()].find((child: any) => child.is('element', name)) as any;
  editor.model.change(writer => writer.setSelection(element, 'on'));
  return element;
}

const SKETCH = '<figure class="sketch"><svg viewBox="0 0 100 50" width="100" height="50"><path d="M1 2L30 40" fill="none" stroke="#cf222e" stroke-width="4"/></svg></figure>';
const DIAGRAM = '<figure class="diagram" data-diagram="mermaid"><pre><code class="language-mermaid">graph LR; A--&gt;B</code></pre></figure>';
const IMAGE = '<figure class="image"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></figure>';

describe('figure tools', () => {
  it('sizes, aligns and captions a sketch and keeps all three in the HTML', async () => {
    const editor = await createEditor(`<p>x</p>${SKETCH}`);
    selectFirstObject(editor, 'sketch');
    editor.execute('resizeFigure', { width: '50%' });
    editor.execute('figureAlign', { value: 'right' });
    editor.execute('toggleFigureCaption');
    const data = editor.getData();
    expect(data).toContain('<figure class="sketch figure_resized image-style-align-right" style="width:50%;"><svg');
    expect(data).toContain('d="M1 2L30 40"');
    expect(data).toContain('<figcaption>&nbsp;</figcaption>');

    // Everything survives a round trip.
    editor.setData(data.replace('<figcaption>&nbsp;</figcaption>', '<figcaption>A drawing</figcaption>'));
    const sketch = selectFirstObject(editor, 'sketch');
    expect(sketch.getAttribute('resizedWidth')).toBe('50%');
    expect(sketch.getAttribute('figureAlign')).toBe('right');
    expect(editor.getData()).toContain('<figcaption>A drawing</figcaption>');
    expect((editor.commands.get("resizeFigure") as any).value.width).toBe('50%');
    expect(editor.commands.get('figureAlign')!.value).toBe('right');
    expect(editor.commands.get('toggleFigureCaption')!.value).toBe(true);

    // The same alignment again clears it; hiding the caption keeps its text for later.
    editor.execute('figureAlign', { value: 'right' });
    editor.execute('toggleFigureCaption');
    expect(editor.getData()).not.toContain('image-style');
    expect(editor.getData()).not.toContain('figcaption');
    editor.execute('toggleFigureCaption');
    expect(editor.getData()).toContain('<figcaption>A drawing</figcaption>');
    editor.execute('resizeFigure', { width: null });
    expect(editor.getData()).not.toContain('figure_resized');
    await editor.destroy();
  });

  it('sizes, aligns and captions a diagram, and the export keeps them around the drawing', async () => {
    const editor = await createEditor(`<p>x</p>${DIAGRAM}`);
    selectFirstObject(editor, 'diagram');
    editor.execute('resizeFigure', { width: '75%' });
    editor.execute('figureAlign', { value: 'center' });
    editor.execute('toggleFigureCaption');
    const data = editor.getData();
    expect(data).toContain('<figure class="diagram figure_resized image-style-align-center" style="width:75%;" data-diagram="mermaid"><pre><code class="language-mermaid">graph LR; A--&gt;B</code></pre><figcaption>&nbsp;</figcaption></figure>');
    editor.setData(data);
    const diagram = selectFirstObject(editor, 'diagram');
    expect(diagram.getAttribute('resizedWidth')).toBe('75%');
    expect(diagram.getAttribute('figureAlign')).toBe('center');
    expect(diagram.getAttribute('diagramSource')).toBe('graph LR; A-->B');
    // Diagrams are drawn, not cropped.
    expect(editor.commands.get('cropFigure')!.isEnabled).toBe(false);
    // The static export keeps the figure's classes, width and caption when it swaps in a drawing.
    const diagrams = editor.plugins.get('Diagrams') as Diagrams;
    (diagrams as any)._drawings.set('mermaid\ngraph LR; A-->B', () => '<svg data-drawn="1"></svg>');
    expect(diagrams.toStaticHtml(editor.getData())).toContain('<figure class="diagram figure_resized image-style-align-center" data-diagram="mermaid" style="width:75%;"><svg data-drawn="1"></svg><figcaption>&nbsp;</figcaption></figure>');
    await editor.destroy();
  });

  it('hands the generic commands over to the image feature for an image', async () => {
    const editor = await createEditor(`<p>x</p>${IMAGE}`);
    const image = selectFirstObject(editor, 'imageBlock');
    editor.execute('resizeFigure', { width: '25%' });
    editor.execute('figureAlign', { value: 'left' });
    editor.execute('toggleFigureCaption');
    expect(image.getAttribute('resizedWidth')).toBe('25%');
    expect(image.getAttribute('imageStyle')).toBe('alignLeft');
    expect([...image.getChildren()].some((child: any) => child.is('element', 'caption'))).toBe(true);
    expect(editor.commands.get('figureAlign')!.value).toBe('left');
    expect((editor.commands.get("resizeFigure") as any).value.width).toBe('25%');
    expect(editor.commands.get('cropFigure')!.isEnabled).toBe(true);
    const data = editor.getData();
    expect(data).toContain('image-style-align-left');
    expect(data).toContain('width:25%');
    expect(data).toContain('<figcaption>');
    await editor.destroy();
  });

  it('moves a block object past its neighbours with the moveFigure command', async () => {
    const editor = await createEditor(`<p>one</p>${SKETCH}<p>two</p>`);
    selectFirstObject(editor, 'sketch');
    editor.execute('moveFigure', { direction: 'down' });
    expect(editor.getData().replace(/<figure[\s\S]*?<\/figure>/, '[sketch]')).toBe('<p>one</p><p>two</p>[sketch]');
    editor.execute('moveFigure', { direction: 'up' });
    editor.execute('moveFigure', { direction: 'up' });
    expect(editor.getData().replace(/<figure[\s\S]*?<\/figure>/, '[sketch]')).toBe('[sketch]<p>one</p><p>two</p>');
    // Still selected, so Alt+Shift+Arrow can go on moving it.
    expect(editor.model.document.selection.getSelectedElement()!.name).toBe('sketch');
    await editor.destroy();
  });

  it('renders the drag grip and resize handles on block images, sketches and diagrams', async () => {
    const editor = await createEditor(`${IMAGE}${SKETCH}${DIAGRAM}`);
    const editable = editor.ui.getEditableElement()!;
    expect(editable.querySelectorAll('.ck-widget__selection-handle[draggable="true"]').length).toBe(3);
    expect(editable.querySelectorAll('.ck-widget__resizer').length).toBe(3);
    expect(editable.querySelectorAll('.ck-widget__resizer__handle').length).toBe(12);
    await editor.destroy();
  });
});

describe('cropSketch', () => {
  it('moves the strokes to the new origin, sizes the drawing and drops strokes outside the cut', () => {
    const data = { width: 200, height: 100, strokes: [{ color: '#000000', width: 3, points: [[50, 40], [120, 60]] as Array<[number, number]> }, { color: '#000000', width: 3, points: [[5, 5]] as Array<[number, number]> }] };
    const cropped = cropSketch(data, { x: 40, y: 30, width: 100, height: 50 });
    expect(cropped.width).toBe(100);
    expect(cropped.height).toBe(50);
    expect(cropped.strokes).toHaveLength(1);
    expect(cropped.strokes[0].points).toEqual([[10, 10], [80, 30]]);
    // The input is left alone.
    expect(data.strokes[0].points[0]).toEqual([50, 40]);
  });
});
