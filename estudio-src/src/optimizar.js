// Optimizar para web — se carga bajo demanda (archivo aparte: estudio-optimizar.js).
// Reglas tomadas de los skills blender-export-pipelines (preset web: GLB + meshopt + WebP)
// y blender-game-optimization (presupuesto web: texturas ≤ 2048 px).
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, simplify, listTextureSlots, getTextureColorSpace } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const tris = (doc) => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      if (p.getMode() !== 4) continue; // solo triángulos
      const i = p.getIndices();
      const pos = p.getAttribute('POSITION');
      n += (i ? i.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  }
  return Math.round(n);
};

let webpOk = null;
async function soportaWebP() {
  if (webpOk !== null) return webpOk;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const b = await new Promise((ok) => c.toBlob(ok, 'image/webp', 0.8));
  webpOk = !!b && b.type === 'image/webp';
  return webpOk;
}

/** Reduce una textura a `max` px por lado y la pasa a WebP (o la deja en su formato si el navegador no codifica WebP). */
async function procesarTextura(tex, max, webp) {
  const bytes = tex.getImage();
  const tipo = tex.getMimeType();
  if (!bytes || !/^image\/(png|jpeg|webp)$/.test(tipo)) return null;
  const bmp = await createImageBitmap(new Blob([bytes], { type: tipo }), {
    premultiplyAlpha: 'none', colorSpaceConversion: 'none',
  });
  const esc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * esc));
  const h = Math.max(1, Math.round(bmp.height * esc));
  const ranuras = listTextureSlots(tex);
  const esColor = getTextureColorSpace(tex) === 'srgb';
  const esNormal = ranuras.some((r) => /normal/i.test(r));
  // Los mapas de datos (normal, rugosidad/metal) toleran menos compresión que el color.
  const calidad = esNormal ? 0.95 : esColor ? 0.86 : 0.92;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const destino = webp ? 'image/webp' : tipo;
  if (esc === 1 && destino === tipo) return null; // nada que ganar
  const blob = await new Promise((ok) => c.toBlob(ok, destino, destino === 'image/png' ? undefined : calidad));
  if (!blob) return null;
  const nuevo = new Uint8Array(await blob.arrayBuffer());
  if (nuevo.byteLength >= bytes.byteLength && esc === 1) return null; // no mejoró: se queda la original
  tex.setImage(nuevo).setMimeType(blob.type);
  const uri = tex.getURI();
  if (uri) tex.setURI(uri.replace(/\.(png|jpe?g|webp)$/i, '') + (blob.type === 'image/webp' ? '.webp' : blob.type === 'image/png' ? '.png' : '.jpg'));
  return { antes: bytes.byteLength, despues: nuevo.byteLength };
}

/**
 * @param {ArrayBuffer} entrada GLB original
 * @param {{ texturaMax?: number, reducir?: boolean, trisMeta?: number, avisar?: (t:string)=>void }} op
 * @returns {Promise<{ bytes: Uint8Array, informe: string[], antes: number, despues: number, trisAntes: number, trisDespues: number }>}
 */
export async function optimizar(entrada, op = {}) {
  const { texturaMax = 2048, reducir = false, trisMeta = 30000, avisar = () => {} } = op;
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  avisar('Leyendo el modelo…');
  const doc = await io.readBinary(new Uint8Array(entrada));
  const informe = [];
  const trisAntes = tris(doc);

  avisar('Limpiando datos repetidos y sin uso…');
  await doc.transform(dedup(), prune(), weld());

  if (reducir && trisAntes > trisMeta) {
    avisar('Reduciendo triángulos…');
    const ratio = Math.max(0.05, (trisMeta * 0.95) / trisAntes); // margen: el simplificador no es exacto
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: true }), prune());
    informe.push(`Triángulos: ${trisAntes.toLocaleString('es-PE')} → ${tris(doc).toLocaleString('es-PE')}`);
  }

  const texturas = doc.getRoot().listTextures();
  if (texturas.length) {
    avisar('Comprimiendo texturas…');
    const webp = await soportaWebP();
    let n = 0, ahorro = 0;
    for (const t of texturas) {
      try {
        const r = await procesarTextura(t, texturaMax, webp);
        if (r) { n++; ahorro += r.antes - r.despues; }
      } catch (e) {
        console.warn('Textura sin cambios', e);
      }
    }
    if (webp && texturas.some((t) => t.getMimeType() === 'image/webp')) {
      doc.createExtension(EXTTextureWebP).setRequired(true);
    }
    if (n) {
      informe.push(`${n} textura${n > 1 ? 's' : ''} ${webp ? 'pasada' + (n > 1 ? 's' : '') + ' a WebP' : 'reducida' + (n > 1 ? 's' : '')}, máximo ${texturaMax} px (−${(ahorro / 1048576).toFixed(1)} MB)`);
    }
    if (!webp) informe.push('Este navegador no crea WebP (Safari): las texturas solo se redujeron de tamaño. Usa Chrome o Edge para comprimir más.');
  }

  avisar('Comprimiendo la geometría (meshopt)…');
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  informe.push('Geometría comprimida con meshopt');

  avisar('Escribiendo el GLB…');
  const bytes = await io.writeBinary(doc);
  return {
    bytes, informe, antes: entrada.byteLength, despues: bytes.byteLength, trisAntes, trisDespues: tris(doc),
  };
}
