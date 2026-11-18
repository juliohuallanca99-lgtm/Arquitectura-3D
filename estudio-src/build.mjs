// Empaqueta src/main.js con Three.js dentro de un solo archivo: ../estudio.html
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = await readFile('plantilla.html', 'utf8');
const marca = '/*__JS__*/';
const i = html.indexOf(marca);
if (i < 0) throw new Error('Falta el marcador en plantilla.html');
await writeFile('../estudio.html', html.slice(0, i) + js + html.slice(i + marca.length));
console.log('estudio.html', Math.round((html.length + js.length) / 1024) + ' KB');

// Optimizador para web: módulo aparte que el estudio descarga solo al pulsar «Optimizar para web».
const opt = await build({
  entryPoints: ['src/optimizar.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  external: ['node:*'], // solo los usa NodeIO, que aquí no se usa
  write: false,
  legalComments: 'none',
});
await writeFile('../estudio-optimizar.js', opt.outputFiles[0].contents);
console.log('estudio-optimizar.js', Math.round(opt.outputFiles[0].contents.length / 1024) + ' KB');
