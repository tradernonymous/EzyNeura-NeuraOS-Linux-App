import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // ../shared holds modules the web app loads too (docs/adr/0002);
    // ../../pc is the Linux Mint pack, imported ?raw for B10.
    fs: { allow: ['.', '../shared', '../../pc'] },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // The biggest chunks are the editor (monaco) and the diagram/mermaid
        // stack. Keeping them separate from the app code avoids shipping the
        // full editor to everyone who only opens the chat screen.
        manualChunks: {
          'vendor-editor': ['monaco-editor'],
          'vendor-diagram': ['mermaid', 'cytoscape', 'd3', 'dagre-d3-es'],
          'vendor-katex': ['katex'],
        },
      },
    },
    // The editor chunk is expected to exceed 500 kB -- it is the full
    // monaco-editor, and users who never open the Local screen never load it.
    chunkSizeWarningLimit: 800,
  },
});
