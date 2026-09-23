// Vite turns an imported image into its bundled URL; tsc needs to be told.
declare module '*.svg' {
  const src: string;
  export default src;
}
