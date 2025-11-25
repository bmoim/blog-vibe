import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Cast process to any to avoid "Property 'cwd' does not exist on type 'Process'" error
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    base: './', // GitHub Pages 및 Electron 상대 경로 지원
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    define: {
      // 웹 빌드 시 process.env.API_KEY를 코드에 주입 (보안 주의: 클라이언트 측에 키가 노출됨)
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    },
    server: {
      port: 5173,
    }
  };
});