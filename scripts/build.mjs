import { build } from 'esbuild';
import { rm, mkdir, cp, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/_worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
// All asset requests must pass through operator authentication as well.
await writeFile('dist/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
