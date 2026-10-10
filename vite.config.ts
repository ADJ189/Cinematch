import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the optional in-browser LLM module in its own chunk so it
        // never ships to users who don't opt into it.
        manualChunks(id) {
          if (id.includes('src/lib/llm.ts')) return 'llm';
          if (id.includes('src/lib/ambient.ts')) return 'ambient';
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
