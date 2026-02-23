import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      watch: {
        ignored: ['**/backend/**']
      }
    },
    plugins: [react()],
    // SECURITY: API keys are NEVER injected into the frontend.
    // All Gemini calls go through the backend proxy (VITE_BACKEND_URL).
    define: {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});

// Note: Supabase vars use VITE_ prefix so they're automatically available via import.meta.env
