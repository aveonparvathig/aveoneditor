/** Vite's `?inline` imports return the file's contents as a string. */
declare module '*?inline' {
  const content: string;
  export default content;
}
