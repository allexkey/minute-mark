import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** Generates sw.js at build time: precache every emitted file, serve cache-first (works offline in the gym). */
function serviceWorker() {
  return {
    name: 'minute-mark-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const publicDir = new URL('./public', import.meta.url).pathname;
      const files = [
        './',
        ...Object.keys(bundle).map((f) => `./${f}`),
        ...listFiles(publicDir).map((f) => `./${relative(publicDir, f).split('\\').join('/')}`),
      ];
      const hash = createHash('sha256');
      for (const f of Object.values(bundle)) hash.update(f.type === 'chunk' ? f.code : f.source);
      for (const f of listFiles(publicDir)) hash.update(readFileSync(f));
      const version = `mm-${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify([...new Set(files)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  plugins: [serviceWorker()],
});
