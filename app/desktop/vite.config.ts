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
        // Monaco is gone (lean build): the Local screen uses a plain textarea.
        // Keep the diagram/mermaid stack split so chat-only boots stay small.
        // katex is mermaid's transitive dep for math diagrams this app never
        // renders -- no manual chunk, so Vite tree-shakes it out of dist.
        manualChunks: {
          'vendor-diagram': ['mermaid', 'cytoscape', 'd3', 'dagre-d3-es'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
});
