/**
 * One-call setup for host applications (CMS, ERP, admin panels):
 *
 *   const editor = await createEditor('#body', { preset: 'cms', upload: { url: '/api/uploads' } });
 *
 * Presets bundle the plugins and toolbar for a use case, so integrators do not assemble plugin lists.
 */

import { ClassicEditor } from './classiceditor';
import { classicPreset, classicDefaultConfig, classicRibbon, erpRibbon } from './presets';
import type { EditorConfig } from '../core/editor';
import type { PluginConstructor } from '../core/plugin';
import { Essentials } from '../features/essentials/essentials';
import { Paragraph } from '../features/paragraph/paragraph';
import { Heading } from '../features/heading/heading';
import { Bold, Italic, Underline, Strikethrough, Subscript, Superscript } from '../features/basicstyles/basicstyles';
import { Link } from '../features/link/link';
import { List, TodoList } from '../features/list/list';
import { BlockQuote } from '../features/blockquote/blockquote';
import { Image, ImageCaption, ImageStyle, ImageToolbar, ImageUpload, ImageInsert, ImageResize, Base64UploadAdapter, SimpleUploadAdapter } from '../features/image/image';
import { Table, TableToolbar } from '../features/table/table';
import { Alignment } from '../features/alignment/alignment';
import { Indent, IndentBlock } from '../features/indent/indent';
import { Font } from '../features/font/font';
import { HorizontalLine } from '../features/horizontalline/horizontalline';
import { RemoveFormat } from '../features/removeformat/removeformat';
import { Highlight } from '../features/highlight/highlight';
import { Autoformat } from '../features/autoformat/autoformat';
import { SpecialCharacters } from '../features/specialcharacters/specialcharacters';
import { FindAndReplace } from '../features/findandreplace/findandreplace';
import { TextTransformation } from '../features/texttransformation/texttransformation';
import { WordCount } from '../features/wordcount/wordcount';
import { WordBasics } from '../features/wordbasics/wordbasics';
import { Math as MathPlugin } from '../features/math/math';
import { MergeFields } from '../features/mergefields/mergefields';
import { Templates } from '../features/templates/templates';
import { ExportDocument } from '../features/export/export';
import { Diagrams } from '../features/diagrams/diagrams';
import { Figure } from '../features/figure/figure';
import { Markdown } from '../features/markdown/markdown';
import { References } from '../features/references/references';
import { Comments } from '../features/comments/comments';
import { TrackChanges } from '../features/trackchanges/trackchanges';
import { RealTimeCollaboration } from '../features/collaboration/collaboration';

export type PresetName = 'basic' | 'cms' | 'erp' | 'full';

export interface EditorPreset {
  plugins: PluginConstructor[];
  config: EditorConfig;
}

const imageConfig = {
  toolbar: ['imageTextAlternative', 'toggleFigureCaption', '|', 'figureAlign:left', 'figureAlign:center', 'figureAlign:right', 'imageStyle:inline', '|', 'resizeFigure', 'cropFigure']
};

/** Comments, short descriptions, chat-like fields: a plain toolbar with the essentials. */
export const basicPreset: EditorPreset = {
  plugins: [Essentials, Paragraph, Heading, Bold, Italic, Underline, Link, List, BlockQuote, Autoformat, RemoveFormat, TextTransformation],
  config: {
    ribbon: false,
    toolbar: ['undo', 'redo', '|', 'heading', '|', 'bold', 'italic', 'underline', 'link', '|', 'bulletedList', 'numberedList', 'blockQuote', '|', 'removeFormat']
  }
};

/** Web content (articles, pages, product descriptions): everything except equations. */
export const cmsPreset: EditorPreset = {
  plugins: classicPreset.filter(plugin => plugin !== MathPlugin),
  config: { ...classicDefaultConfig, ribbon: classicRibbon }
};

export const erpPreset: EditorPreset = {
  plugins: [
    Essentials,
    Paragraph,
    Heading,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    Subscript,
    Superscript,
    Font,
    Highlight,
    Alignment,
    List,
    TodoList,
    Indent,
    IndentBlock,
    BlockQuote,
    HorizontalLine,
    Link,
    Table,
    TableToolbar,
    Image,
    ImageCaption,
    ImageStyle,
    ImageToolbar,
    ImageUpload,
    ImageInsert,
    ImageResize,
    Base64UploadAdapter,
    RemoveFormat,
    Autoformat,
    SpecialCharacters,
    FindAndReplace,
    TextTransformation,
    WordCount,
    WordBasics,
    MergeFields,
    Templates,
    ExportDocument,
    References,
    Figure,
    Diagrams,
    Markdown,
    Comments,
    TrackChanges,
    RealTimeCollaboration
  ],
  config: {
    ribbon: erpRibbon,
    toolbar: classicDefaultConfig.toolbar,
    image: imageConfig,
    table: { contentToolbar: ['tableColumn', 'tableRow'] }
  }
};

/** Every feature, including equations, chemistry and handwriting. */
export const fullPreset: EditorPreset = {
  plugins: classicPreset,
  config: classicDefaultConfig
};

export const editorPresets: Record<PresetName, EditorPreset> = { basic: basicPreset, cms: cmsPreset, erp: erpPreset, full: fullPreset };

export interface UploadOptions {
  /** Endpoint receiving a multipart POST; it answers `{ "url": "https://…/image.png" }`. */
  url: string;
  /** Extra headers; a function is called for every upload (e.g. a fresh auth token). */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Send cookies with the upload (same-site session auth). */
  withCredentials?: boolean;
  /** Name of the file field. Default `upload`. */
  fieldName?: string;
}

export interface CreateEditorOptions extends EditorConfig {
  /** Feature set: `basic`, `cms` (default), `erp` or `full`. */
  preset?: PresetName;
  /** Upload images to your server instead of embedding them as base64 data. */
  upload?: UploadOptions;
  /** Plugins added to the preset's. */
  extraPlugins?: PluginConstructor[];
  /** Plugins removed from the preset's (constructors or plugin names). */
  removePlugins?: Array<PluginConstructor | string>;
}

/** Builds the plugin list and configuration that `createEditor()` would use. */
export function resolveEditorOptions(options: CreateEditorOptions = {}): EditorConfig & { plugins: PluginConstructor[] } {
  const { preset = 'cms', upload, extraPlugins = [], removePlugins = [], ...rest } = options;
  const chosen = editorPresets[preset];
  if (!chosen) throw new Error(`aveon-unknown-preset: "${preset}" is not one of ${Object.keys(editorPresets).join(', ')}.`);
  const removed = (plugin: PluginConstructor) => removePlugins.some(entry => entry === plugin || (typeof entry === 'string' && (plugin as any).pluginName === entry));
  let plugins = [...chosen.plugins, ...extraPlugins].filter(plugin => !removed(plugin));
  const config: EditorConfig = { ...chosen.config, ...rest };
  if (upload) {
    if (!upload.url) throw new Error('aveon-upload-missing-url: upload.url is required.');
    plugins = plugins.filter(plugin => plugin !== Base64UploadAdapter);
    if (!plugins.includes(SimpleUploadAdapter)) plugins.push(SimpleUploadAdapter);
    config.simpleUpload = { uploadUrl: upload.url, headers: upload.headers, withCredentials: upload.withCredentials, fieldName: upload.fieldName };
  }
  return { ...config, plugins: [...new Set(plugins)] };
}

/**
 * Creates a classic editor in `target` (an element or a CSS selector). The element's content, or the
 * value of a `<textarea>`, becomes the initial data; a textarea inside a form is kept in sync.
 */
export function createEditor(target: HTMLElement | string, options: CreateEditorOptions = {}): Promise<ClassicEditor> {
  const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!element) return Promise.reject(new Error(`aveon-target-not-found: No element matches "${String(target)}".`));
  return ClassicEditor.create(element, resolveEditorOptions(options));
}
