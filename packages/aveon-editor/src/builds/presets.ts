import type { PluginConstructor } from '../core/plugin';
import type { EditorConfig } from '../core/editor';
import { Essentials } from '../features/essentials/essentials';
import { Paragraph } from '../features/paragraph/paragraph';
import { Heading } from '../features/heading/heading';
import { Bold, Italic, Underline, Strikethrough, Code, Subscript, Superscript } from '../features/basicstyles/basicstyles';
import { Link } from '../features/link/link';
import { List, TodoList } from '../features/list/list';
import { BlockQuote } from '../features/blockquote/blockquote';
import { Image, ImageCaption, ImageStyle, ImageToolbar, ImageUpload, ImageInsert, ImageResize, Base64UploadAdapter } from '../features/image/image';
import { Table, TableToolbar } from '../features/table/table';
import { Alignment } from '../features/alignment/alignment';
import { Indent, IndentBlock } from '../features/indent/indent';
import { Font } from '../features/font/font';
import { HorizontalLine } from '../features/horizontalline/horizontalline';
import { CodeBlock } from '../features/codeblock/codeblock';
import { RemoveFormat } from '../features/removeformat/removeformat';
import { Highlight } from '../features/highlight/highlight';
import { Autoformat } from '../features/autoformat/autoformat';
import { SourceEditing } from '../features/sourceediting/sourceediting';
import { MediaEmbed } from '../features/mediaembed/mediaembed';
import { SpecialCharacters } from '../features/specialcharacters/specialcharacters';
import { FindAndReplace } from '../features/findandreplace/findandreplace';
import { TextTransformation } from '../features/texttransformation/texttransformation';
import { WordCount } from '../features/wordcount/wordcount';
import { Math } from '../features/math/math';
import { WordBasics } from '../features/wordbasics/wordbasics';
import type { RibbonConfig } from '../ui/ribbon/ribbonview';

/** Plugins matching the CKEditor 5 classic build, plus the commonly requested extras. */
export const classicPreset: PluginConstructor[] = [
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Subscript,
  Superscript,
  Link,
  List,
  TodoList,
  BlockQuote,
  Image,
  ImageCaption,
  ImageStyle,
  ImageToolbar,
  ImageUpload,
  ImageInsert,
  ImageResize,
  Base64UploadAdapter,
  Table,
  TableToolbar,
  Alignment,
  Indent,
  IndentBlock,
  Font,
  HorizontalLine,
  CodeBlock,
  RemoveFormat,
  Highlight,
  Autoformat,
  SourceEditing,
  MediaEmbed,
  SpecialCharacters,
  FindAndReplace,
  TextTransformation,
  WordCount,
  Math,
  WordBasics
];

/** Toolbar matching the CKEditor 5 classic build defaults, extended with the extra features. */
export const classicToolbar: string[] = [
  'undo',
  'redo',
  '|',
  'heading',
  '|',
  'fontFamily',
  'fontSize',
  'fontColor',
  'fontBackgroundColor',
  '|',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'subscript',
  'superscript',
  'code',
  'removeFormat',
  '|',
  'link',
  'insertImage',
  'mediaEmbed',
  'insertTable',
  'blockQuote',
  'codeBlock',
  'horizontalLine',
  'specialCharacters',
  'math',
  'chemType',
  '|',
  'alignment',
  'bulletedList',
  'numberedList',
  'todoList',
  'outdent',
  'indent',
  '|',
  'highlight',
  'findAndReplace',
  'sourceEditing'
];

/** Word-style ribbon: everyday tools on Home, everything you can add on Insert. */
export const classicRibbon: RibbonConfig = {
  quickAccess: ['undo', 'redo'],
  tabs: [
    {
      label: 'Home',
      groups: [
        { label: 'Clipboard', items: ['paste', 'cut', '-', 'copy', 'formatPainter'] },
        { label: 'Font', items: ['fontFamily', 'fontSize', 'fontSizeIncrease', 'fontSizeDecrease', 'changeCase', 'removeFormat', '-', 'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', '|', 'fontColor', 'fontBackgroundColor', 'highlight'] },
        { label: 'Paragraph', items: ['bulletedList', 'numberedList', 'todoList', 'outdent', 'indent', '-', 'alignment', 'blockQuote', 'codeBlock', 'horizontalLine'] },
        { label: 'Styles', items: ['styleGallery'] },
        { label: 'Editing', items: ['findAndReplace', '-', 'selectAll'] }
      ]
    },
    {
      label: 'Insert',
      groups: [
        { label: 'Tables', items: ['insertTable'] },
        { label: 'Media', items: ['insertImage', 'mediaEmbed'] },
        { label: 'Links', items: ['link'] },
        { label: 'Text', items: ['blockQuote', 'codeBlock', 'horizontalLine', 'code'] },
        { label: 'Symbols', items: ['math', 'chemType', 'specialCharacters'] }
      ]
    },
    {
      label: 'Layout',
      groups: [
        { label: 'Alignment', items: ['alignment'] },
        { label: 'Indent', items: ['outdent', 'indent'] },
        { label: 'Lists', items: ['bulletedList', 'numberedList', 'todoList'] }
      ]
    },
    {
      label: 'Review',
      groups: [
        { label: 'Find', items: ['findAndReplace'] },
        { label: 'Formatting', items: ['removeFormat', 'formatPainter'] }
      ]
    },
    {
      label: 'View',
      groups: [
        { label: 'Views', items: ['fullscreen'] },
        { label: 'Source', items: ['sourceEditing'] }
      ]
    }
  ]
};

export const classicDefaultConfig: EditorConfig = {
  toolbar: classicToolbar,
  ribbon: classicRibbon,
  image: {
    toolbar: ['imageTextAlternative', 'toggleImageCaption', '|', 'imageStyle:inline', 'imageStyle:block', 'imageStyle:side', '|', 'resizeImage']
  },
  table: {
    contentToolbar: ['tableColumn', 'tableRow']
  }
};
