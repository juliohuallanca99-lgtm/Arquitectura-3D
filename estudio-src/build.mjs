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
