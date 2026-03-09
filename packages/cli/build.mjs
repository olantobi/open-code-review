import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const { version } = JSON.parse(readFileSync('package.json', 'utf-8'))

const cjsBanner = 'import { createRequire as _cjsReq } from "module"; const require = _cjsReq(import.meta.url);'

// Main CLI entry point
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  minify: false,
  external: ['sql.js'],
  banner: {
    js: ['#!/usr/bin/env node', cjsBanner].join('\n'),
  },
  define: { __CLI_VERSION__: JSON.stringify(version) },
  tsconfig: 'tsconfig.json',
})

// Shared DB subpath export (used by @open-code-review/dashboard)
await build({
  entryPoints: ['src/lib/db/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/lib/db/index.js',
  minify: false,
  external: ['sql.js'],
  banner: { js: cjsBanner },
  tsconfig: 'tsconfig.json',
})
