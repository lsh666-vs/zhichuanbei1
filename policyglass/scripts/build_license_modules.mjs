// Capture actual Rollup output modules before selecting redistribution notices.
// https://vite.dev/guide/api-javascript#build
// https://rollupjs.org/plugin-development/#generatebundle
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const outDir = resolve(root, process.argv[2] || '.runtime/license-build');
const reportPath = resolve(root, process.argv[3] || '.runtime/release-rendered-modules.json');
if (!/^D:\\/i.test(outDir) || !/^D:\\/i.test(reportPath)) throw Error('All outputs must stay on D:');
if (!outDir.startsWith(root + '\\') || !reportPath.startsWith(root + '\\')) throw Error('Outputs must stay inside PolicyGlass');
const { build } = await import(pathToFileURL(join(frontend, 'node_modules/vite/dist/node/index.js')).href);
const sha = value => createHash('sha256').update(value).digest('hex');
const packageCache = new Map();
function owner(id) {
  const cleaned = id.replace(/^\0/, '').split('?')[0];
  if (!isAbsolute(cleaned) || !cleaned.includes('node_modules')) return null;
  let current = dirname(cleaned);
  while (current !== dirname(current)) {
    if (packageCache.has(current)) return packageCache.get(current);
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      const p = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!p.name || !p.version) { current = dirname(current); continue; }
      const value = { name: p.name, version: p.version, license: p.license,
        path: relative(root, current).replaceAll('\\', '/'), manifest_sha256: sha(readFileSync(manifest)) };
      packageCache.set(current, value);
      return value;
    }
    current = dirname(current);
  }
  return null;
}
await build({ root: frontend, configFile: join(frontend, 'vite.config.ts'),
  build: { outDir, emptyOutDir: true }, plugins: [{ name: 'policyglass-redistribution-evidence', enforce: 'post',
    writeBundle(_options, bundle) {
      const modules = [], outputs = [], packages = new Map();
      for (const [filename, output] of Object.entries(bundle)) {
        outputs.push({ filename, type: output.type,
          sha256: sha(output.type === 'chunk' ? output.code : output.source),
          originalFileNames: output.originalFileNames || [] });
        if (output.type !== 'chunk') continue;
        for (const [id, rendered] of Object.entries(output.modules)) {
          const p = owner(id);
          const cssSideEffect = /\.css(?:\?|$)/.test(id) && !!this.getModuleInfo(id)?.isIncluded;
          const distributed = rendered.renderedLength > 0 || cssSideEffect;
          modules.push({ id: relative(root, id).replaceAll('\\', '/'), package: p,
            originalLength: rendered.originalLength, renderedLength: rendered.renderedLength,
            renderedExports: rendered.renderedExports, removedExports: rendered.removedExports,
            cssSideEffect, distributed });
          if (distributed && p) packages.set(p.name + '@' + p.version, p);
        }
      }
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify({ schema: 'policyglass.rendered-modules.v1',
        scope: 'Actual Rollup chunk.modules renderedLength; included CSS effects retained for fonts/assets',
        outDir: relative(root, outDir).replaceAll('\\', '/'),
        packages: [...packages.values()], modules, outputs }, null, 2));
    }
  }] });
console.log('Actual module attribution: ' + reportPath);
