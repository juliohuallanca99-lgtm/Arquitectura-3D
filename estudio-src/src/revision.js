// Revisar modelo — chequeos de calidad en el navegador.
// Reglas portadas del skill blender-asset-qa (qa_check.py) y de los presupuestos web del skill
// blender-game-optimization: producto/prop 1–10k triángulos, personaje 10–30k, 1–2 materiales, texturas ≤ 2048.
import * as THREE from 'three';

export const PRESUPUESTO_WEB = {
  tris: 30000, trisMax: 100000, mats: 2, matsMax: 8, textura: 2048, vramMB: 64, pesoMB: 5, pesoMaxMB: 15,
};
const TOPOLOGIA_MAX = 300000; // como el skill: con más triángulos se saltan los chequeos de topología

const fmt = (n) => Math.round(n).toLocaleString('es-PE');

/** Une vértices por posición (el GLB suele partirlos en costuras de UV) y analiza la malla en espacio mundo. */
function topologia(mallas, radio) {
  const tol = Math.max(radio * 1e-5, 1e-7);
  const claves = new Map();
  const vx = [];
  let mi = 0; // índice de malla: solo se unen vértices de la misma malla
  const id = (x, y, z) => {
    const k = mi + ':' + Math.round(x / tol) + ',' + Math.round(y / tol) + ',' + Math.round(z / tol);
    let i = claves.get(k);
    if (i === undefined) { i = vx.length / 3; claves.set(k, i); vx.push(x, y, z); }
    return i;
  };
  const tris = [];
  let degeneradas = 0, normalesOpuestas = 0, conNormal = 0;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nv = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3();
  const minArea = radio * radio * 1e-10;
  for (const m of mallas) {
    mi++;
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, I = g.index;
    const mw = m.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(mw);
    const espejo = mw.determinant() < 0;
    const n = I ? I.count : P.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const ix = [0, 1, 2].map((k) => (I ? I.getX(t + k) : t + k));
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(P, ix[k]).applyMatrix4(mw);
      ab.subVectors(v[1], v[0]); ac.subVectors(v[2], v[0]);
      fn.crossVectors(ab, ac);
      const area = fn.length() / 2;
      if (area < minArea) { degeneradas++; continue; }
      if (N) {
        nv.set(0, 0, 0);
        for (let k = 0; k < 3; k++) nv.add(new THREE.Vector3().fromBufferAttribute(N, ix[k]));
        nv.applyMatrix3(nm);
        conNormal++;
        // three.js invierte el sentido de giro en nodos espejados; la normal se compara con el giro real.
        if ((espejo ? -1 : 1) * fn.dot(nv) < 0) normalesOpuestas++;
      }
      const a = id(v[0].x, v[0].y, v[0].z), b = id(v[1].x, v[1].y, v[1].z), c = id(v[2].x, v[2].y, v[2].z);
      if (a === b || b === c || a === c) { degeneradas++; continue; }
      tris.push(espejo ? [a, c, b] : [a, b, c]);
    }
  }
  // Aristas: borde (1 cara), no-manifold (>2 caras), orientación inconsistente (misma arista dirigida 2 veces).
  const aristas = new Map();
  const dirigidas = new Map();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = p < q ? p + '_' + q : q + '_' + p;
      aristas.set(k, (aristas.get(k) || 0) + 1);
      const d = p + '>' + q;
      dirigidas.set(d, (dirigidas.get(d) || 0) + 1);
    }
  }
  let borde = 0, noManifold = 0, inconsistentes = 0;
  for (const c of aristas.values()) { if (c === 1) borde++; else if (c > 2) noManifold++; }
  for (const c of dirigidas.values()) if (c > 1) inconsistentes++;

  // Piezas: componentes conectados (union-find) con su caja y su volumen con signo.
  const padre = new Int32Array(vx.length / 3).map((_, i) => i);
  const raiz = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
  for (const [a, b, c] of tris) { padre[raiz(b)] = raiz(a); padre[raiz(c)] = raiz(a); }
  const piezas = new Map();
  const pv = (i) => new THREE.Vector3(vx[i * 3], vx[i * 3 + 1], vx[i * 3 + 2]);
  for (const t of tris) {
    const r = raiz(t[0]);
    let p = piezas.get(r);
    if (!p) { p = { caja: new THREE.Box3(), vol: 0, ref: pv(t[0]), tris: 0, borde: 0 }; piezas.set(r, p); }
    const A = pv(t[0]), B = pv(t[1]), C = pv(t[2]);
    p.caja.expandByPoint(A).expandByPoint(B).expandByPoint(C);
    // volumen respecto a un punto de la propia pieza (evita errores de precisión lejos del origen)
    A.sub(p.ref); B.sub(p.ref); C.sub(p.ref);
    p.vol += A.dot(B.cross(C)) / 6;
    p.tris++;
  }
  for (const [k, c] of aristas) {
    if (c !== 1) continue;
    const r = raiz(Number(k.split('_')[0]));
    const p = piezas.get(r);
    if (p) p.borde++;
  }
  const lista = [...piezas.values()];
  const alReves = lista.filter((p) => p.borde === 0 && p.vol < -1e-12).length;
  // Piezas flotantes: las que no llegan a tocar (directa o encadenadamente) a la pieza más grande.
  let flotantes = 0;
  if (lista.length > 1 && lista.length <= 400) {
    const margen = radio * 0.02;
    const cajas = lista.map((p) => p.caja.clone().expandByScalar(margen));
    let base = 0;
    lista.forEach((p, i) => { if (p.tris > lista[base].tris) base = i; });
    const unido = new Uint8Array(lista.length);
    unido[base] = 1;
    const cola = [base];
    while (cola.length) {
      const i = cola.pop();
      for (let j = 0; j < lista.length; j++) {
        if (!unido[j] && cajas[i].intersectsBox(lista[j].caja)) { unido[j] = 1; cola.push(j); }
      }
    }
    flotantes = lista.length - unido.reduce((a, b) => a + b, 0);
  }
  return {
    degeneradas, borde, noManifold, inconsistentes, piezas: lista.length, alReves, flotantes,
    normalesOpuestas, pctOpuestas: conNormal ? (normalesOpuestas / conNormal) * 100 : 0,
  };
}

/**
 * @returns {{ items: {nivel:'error'|'aviso'|'ok'|'info', titulo:string, detalle?:string}[], errores:number, avisos:number }}
 */
export function revisar(modelo, { peso = 0, radio = 1, caja } = {}) {
  const items = [];
  const add = (nivel, titulo, detalle) => items.push({ nivel, titulo, detalle });
  const P = PRESUPUESTO_WEB;

  modelo.updateMatrixWorld(true);
  const mallas = [];
  const mats = new Set(); // por nombre: el cargador clona materiales para piezas sin normales
  const texs = new Set();
  let tri = 0, sinUV = 0, sinUVconTextura = 0, espejos = 0, llamadas = 0;
  modelo.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      if (o.name === 'Diseños' || (o.parent && o.parent.parent && o.parent.parent.name === 'Diseños')) return;
      mallas.push(o);
      const g = o.geometry;
      tri += (g.index ? g.index.count : g.attributes.position.count) / 3;
      const ms = (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);
      llamadas += Math.max(1, ms.length);
      let usaTextura = false;
      for (const m of ms) {
        mats.add(m.name || m.uuid);
        for (const v of Object.values(m)) if (v && v.isTexture) { texs.add(v); usaTextura = true; }
      }
      if (!g.attributes.uv) { sinUV++; if (usaTextura) sinUVconTextura++; }
      if (o.matrixWorld.determinant() < 0) espejos++;
    }
  });

  // --- Presupuesto web
  if (tri <= P.tris) add('ok', `${fmt(tri)} triángulos`, 'Dentro del presupuesto web (hasta 30 000 para producto o personaje).');
  else if (tri <= P.trisMax) add('aviso', `${fmt(tri)} triángulos`, 'Pasa los 30 000 recomendados para web: en celulares puede ir lento. «Optimizar para web» puede reducirlos.');
  else add('error', `${fmt(tri)} triángulos`, 'Demasiado pesado para web (más de 100 000). Redúcelo con «Optimizar para web» marcando «Reducir triángulos».');

  if (mats.size <= P.mats) add('ok', `${mats.size} material${mats.size === 1 ? '' : 'es'}`);
  else add(mats.size > P.matsMax ? 'error' : 'aviso', `${mats.size} materiales`, 'Para web se recomiendan 1–2 por objeto: cada material extra es otra llamada de dibujo.');
  if (llamadas > 50) add('aviso', `${llamadas} llamadas de dibujo`, 'Muchas piezas con material propio. Unir mallas que comparten material lo aliviana.');

  // --- Texturas
  let mayor = 0, vram = 0;
  for (const t of texs) {
    const im = t.image;
    const w = (im && (im.width || im.naturalWidth)) || 0, h = (im && (im.height || im.naturalHeight)) || 0;
    mayor = Math.max(mayor, w, h);
    vram += w * h * 4 * 1.33;
  }
  if (texs.size) {
    if (mayor > P.textura) add('aviso', `Texturas de hasta ${mayor} px`, `Para web el máximo recomendado es ${P.textura} px. «Optimizar para web» las reduce.`);
    else add('ok', `${texs.size} textura${texs.size === 1 ? '' : 's'}, la mayor de ${mayor} px`);
    const mb = vram / 1048576;
    if (mb > P.vramMB) add('aviso', `${mb.toFixed(0)} MB de memoria de video en texturas`, 'Los celulares se quedan sin memoria con más de 64 MB por modelo. Optimiza eligiendo «1024 px (celular)».');
  }

  // --- Peso
  const pesoMB = peso / 1048576;
  if (peso) {
    if (pesoMB <= P.pesoMB) add('ok', `Archivo de ${pesoMB.toFixed(1)} MB`, 'Carga rápido en la tienda.');
    else add(pesoMB > P.pesoMaxMB ? 'error' : 'aviso', `Archivo de ${pesoMB.toFixed(1)} MB`, 'Para la tienda conviene menos de 5 MB. «Optimizar para web» lo comprime.');
  }

  // --- Escala y posición
  if (caja && !caja.isEmpty()) {
    const tam = caja.getSize(new THREE.Vector3());
    const mx = Math.max(tam.x, tam.y, tam.z);
    if (mx > 50) add('aviso', `Mide ${mx.toFixed(0)} m de largo`, '¿Se exportó en centímetros? Un producto debería medir en metros (una gorra ≈ 0.3 m).');
    else if (mx < 0.01) add('aviso', `Mide ${(mx * 1000).toFixed(1)} mm`, '¿Se exportó en metros cuando eran milímetros? Revisa la escala antes de publicarlo.');
    if (Math.abs(caja.min.y) > Math.max(tam.y * 0.05, 1e-4)) add('info', 'No está apoyado en el piso', `Su base está a ${caja.min.y.toFixed(3)} m del suelo. En la tienda puede verse flotando o hundido.`);
    const c = caja.getCenter(new THREE.Vector3());
    if (Math.hypot(c.x, c.z) > radio * 0.5) add('info', 'No está centrado', 'El modelo está lejos del origen; al girarlo en la tienda dará vueltas alrededor de otro punto.');
  }
  if (espejos) add('aviso', `${espejos} pieza${espejos > 1 ? 's' : ''} con escala negativa (espejo)`, 'Algunos visores muestran esas piezas con la luz al revés.');

  // --- UV
  if (sinUVconTextura) add('error', `${sinUVconTextura} pieza${sinUVconTextura > 1 ? 's' : ''} con textura pero sin UV`, 'La textura no se puede mostrar. Hay que hacer el UV (skill blender-retopology-uv).');
  else if (sinUV) add('info', `${sinUV} pieza${sinUV > 1 ? 's' : ''} sin UV`, 'Puedes ponerle diseños, pero no texturas de imagen completas.');

  // --- Topología
  if (tri > TOPOLOGIA_MAX) {
    add('info', 'Revisión de geometría omitida', `Con más de ${fmt(TOPOLOGIA_MAX)} triángulos se salta para no congelar el navegador. Optimiza primero y vuelve a revisar.`);
  } else if (mallas.length) {
    const t = topologia(mallas, radio);
    if (t.alReves) add('error', `${t.alReves} pieza${t.alReves > 1 ? 's' : ''} con las caras al revés`, 'Se ven oscuras o transparentes desde afuera. Usa «Ver normales»: lo rojo está invertido.');
    if (t.pctOpuestas > 1) add('error', `Normales opuestas en el ${t.pctOpuestas.toFixed(0)} % de las caras`, 'La luz se calcula al revés en esas caras. Hay que recalcular normales en Blender (Shift+N).');
    if (t.inconsistentes) add('aviso', `${fmt(t.inconsistentes)} aristas con orientación mezclada`, 'Caras vecinas apuntan a lados distintos.');
    if (t.noManifold) add('aviso', `${fmt(t.noManifold)} aristas no-manifold`, 'Más de dos caras comparten una arista. Puede dar sombras raras e impide imprimir en 3D.');
    if (t.degeneradas) add('aviso', `${fmt(t.degeneradas)} caras sin área`, 'Triángulos aplastados en una línea o un punto: no se ven y pueden manchar la luz.');
    if (t.flotantes) add('aviso', `${t.flotantes} pieza${t.flotantes > 1 ? 's' : ''} flotando`, 'Partes separadas que no tocan al resto del modelo. Puede ser un error de importación.');
    if (t.borde) add('info', `${fmt(t.borde)} bordes abiertos`, 'Normal en prendas, telas y planos. En objetos sólidos indica huecos.');
    add('info', `${fmt(t.piezas)} pieza${t.piezas === 1 ? '' : 's'} separada${t.piezas === 1 ? '' : 's'}`);
    if (!t.alReves && t.pctOpuestas <= 1 && !t.inconsistentes && !t.noManifold && !t.degeneradas && !t.flotantes) {
      add('ok', 'Geometría limpia', 'Sin caras invertidas, sin caras sin área y sin piezas flotando.');
    }
  }

  const orden = { error: 0, aviso: 1, info: 2, ok: 3 };
  items.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return {
    items,
    errores: items.filter((i) => i.nivel === 'error').length,
    avisos: items.filter((i) => i.nivel === 'aviso').length,
  };
}

/** Material de diagnóstico: azul = cara vista de frente, rojo = cara vista por detrás (normal invertida). */
export function materialNormales() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main(){ float l = 0.35 + 0.65 * abs(dot(normalize(vN), normalize(vV)));
        vec3 c = gl_FrontFacing ? vec3(0.32,0.52,0.86) : vec3(0.86,0.22,0.18);
        gl_FragColor = vec4(c * l, 1.0); }`,
  });
}
