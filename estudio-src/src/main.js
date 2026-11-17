// Estudio 3D — Etapa 1: visor, importación de GLB, cámara completa y biblioteca local.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { bd } from './biblioteca.js';

const $ = (id) => document.getElementById(id);
const rad = THREE.MathUtils.degToRad;
const PESO_MAX = 200 * 1024 * 1024;

// ---------------------------------------------------------------- Escena
const cont = $('visor');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
cont.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const luz = new THREE.DirectionalLight(0xffffff, 1.1);
luz.position.set(3, 5, 4);
scene.add(luz);

const FOV = 40;
const persp = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
const orto = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
persp.position.set(2, 1.6, 2);
let cam = persp;
let aspecto = 1;
let ortoAlto = 1; // media altura visible en ortográfica con zoom 1

const controls = new OrbitControls(cam, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.autoRotateSpeed = 2.5;
controls.minZoom = 0.05;
controls.maxZoom = 60;

function ajustar() {
  const w = cont.clientWidth, h = cont.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  aspecto = w / h;
  persp.aspect = aspecto;
  persp.updateProjectionMatrix();
  orto.left = -ortoAlto * aspecto;
  orto.right = ortoAlto * aspecto;
  orto.top = ortoAlto;
  orto.bottom = -ortoAlto;
  orto.updateProjectionMatrix();
}
new ResizeObserver(ajustar).observe(cont);
ajustar();

// ---------------------------------------------------------------- Estado
let modelo = null;
let rejilla = null;
let rejillaVisible = true;
let radio = 1;
const centro = new THREE.Vector3();
const caja = new THREE.Box3();
/** Modelo abierto: { id, nombre, bytes, peso, camaras, datos } */
let actual = null;
let anim = null;

function estado(texto, clase = '') {
  const e = $('estado');
  e.textContent = texto || '';
  e.className = clase;
}

// ---------------------------------------------------------------- Cámara
const VISTAS = {
  frente: [0, 0, 1], atras: [0, 0, -1], derecha: [1, 0, 0], izquierda: [-1, 0, 0],
  arriba: [0, 1, 0.0002], abajo: [0, -1, 0.0002], iso: [1, 0.75, 1],
};

function distanciaEncuadre(asp = aspecto) {
  const v = rad(FOV) / 2;
  const h = Math.atan(Math.tan(v) * asp);
  return (radio / Math.sin(Math.min(v, h))) * 1.22;
}
function altoEncuadre() {
  return (radio * 1.22) / Math.min(1, aspecto);
}

function limites() {
  persp.near = radio / 100;
  persp.far = radio * 200;
  persp.updateProjectionMatrix();
  orto.near = -radio * 50;
  orto.far = radio * 200;
  controls.minDistance = radio * 0.05;
  controls.maxDistance = radio * 40;
}

function usarOrto(si) {
  if ((cam === orto) === si) return;
  const off = cam.position.clone().sub(controls.target);
  if (si) {
    ortoAlto = off.length() * Math.tan(rad(FOV) / 2);
    orto.zoom = 1;
    orto.position.copy(persp.position);
    orto.quaternion.copy(persp.quaternion);
    cam = orto;
  } else {
    const d = ortoAlto / orto.zoom / Math.tan(rad(FOV) / 2);
    persp.position.copy(controls.target).add(off.setLength(d));
    cam = persp;
  }
  controls.object = cam;
  ajustar();
  controls.update();
  const b = $('proyeccion');
  b.classList.toggle('activo', si);
  b.setAttribute('aria-pressed', String(si));
}

function estadoCamara() {
  return {
    pos: cam.position.toArray(), obj: controls.target.toArray(),
    orto: cam === orto, alto: ortoAlto, zoom: orto.zoom,
  };
}

/** Lleva la cámara a una posición y un objetivo, girando alrededor del modelo. */
function moverA(pos, obj, zoom, animar = true) {
  const a = {
    obj: controls.target.clone(),
    esf: new THREE.Spherical().setFromVector3(cam.position.clone().sub(controls.target)),
    zoom: cam.zoom,
  };
  const b = { obj: obj.clone(), esf: new THREE.Spherical().setFromVector3(pos.clone().sub(obj)), zoom };
  let dt = b.esf.theta - a.esf.theta; // giro por el camino corto
  dt = ((dt + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  b.esf.theta = a.esf.theta + dt;
  anim = { a, b, t0: performance.now(), ms: animar ? 420 : 0 };
  controls.enabled = false;
  if (!animar) pasoAnim(performance.now());
}

function pasoAnim(ahora) {
  const { a, b, t0, ms } = anim;
  const k = ms ? Math.min(1, (ahora - t0) / ms) : 1;
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const esf = new THREE.Spherical(
    a.esf.radius + (b.esf.radius - a.esf.radius) * e,
    a.esf.phi + (b.esf.phi - a.esf.phi) * e,
    a.esf.theta + (b.esf.theta - a.esf.theta) * e,
  );
  controls.target.lerpVectors(a.obj, b.obj, e);
  cam.position.setFromSpherical(esf).add(controls.target);
  cam.zoom = a.zoom + (b.zoom - a.zoom) * e;
  cam.updateProjectionMatrix();
  cam.lookAt(controls.target);
  if (k >= 1) finAnim();
}
function finAnim() {
  anim = null;
  controls.enabled = true;
  controls.update();
}
renderer.domElement.addEventListener('pointerdown', () => { if (anim) finAnim(); }, true);

function vista(nombre, animar = true) {
  if (!modelo) return;
  const dir = new THREE.Vector3(...VISTAS[nombre]).normalize();
  let dist = distanciaEncuadre();
  if (cam === orto) {
    ortoAlto = altoEncuadre();
    ajustar();
    dist = radio * 4;
  }
  moverA(centro.clone().addScaledVector(dir, dist), centro, 1, animar);
}

function encuadrar(animar = true) {
  if (!modelo) return;
  const dir = cam.position.clone().sub(controls.target).normalize();
  let dist = distanciaEncuadre();
  if (cam === orto) {
    ortoAlto = altoEncuadre();
    ajustar();
    dist = radio * 4;
  }
  moverA(centro.clone().addScaledVector(dir, dist), centro, 1, animar);
}

function aplicarCamara(c) {
  usarOrto(!!c.orto);
  if (c.orto) {
    ortoAlto = c.alto;
    ajustar();
  }
  moverA(new THREE.Vector3().fromArray(c.pos), new THREE.Vector3().fromArray(c.obj), c.orto ? c.zoom : 1);
}

// ---------------------------------------------------------------- Modelo
function liberar(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}

function medir(obj) {
  let tri = 0, mallas = 0;
  const mats = new Set(), tex = new Set();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    mallas++;
    const g = o.geometry;
    tri += g.index ? g.index.count / 3 : g.attributes.position ? g.attributes.position.count / 3 : 0;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      mats.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture) tex.add(v);
    }
  });
  return { tri: Math.round(tri), mallas, mats: mats.size, tex: tex.size };
}

const fmt = (n) => n.toLocaleString('es-PE');
const metros = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
function fmtPeso(b) {
  if (!b) return '—';
  return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}

function ponerRejilla() {
  if (rejilla) {
    scene.remove(rejilla);
    rejilla.geometry.dispose();
    rejilla.material.dispose();
  }
  const celda = Math.pow(10, Math.floor(Math.log10(radio))) / 2;
  rejilla = new THREE.GridHelper(celda * 40, 40, 0x8d877a, 0xb3ad9f);
  rejilla.material.transparent = true;
  rejilla.material.opacity = 0.55;
  rejilla.position.set(centro.x, caja.min.y, centro.z);
  rejilla.visible = rejillaVisible;
  scene.add(rejilla);
}

function ponerModelo(obj, info) {
  if (modelo) {
    scene.remove(modelo);
    liberar(modelo);
  }
  modelo = obj;
  scene.add(modelo);
  modelo.updateMatrixWorld(true);
  caja.setFromObject(modelo);
  if (caja.isEmpty()) caja.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  caja.getCenter(centro);
  const tam = caja.getSize(new THREE.Vector3());
  radio = Math.max(tam.length() / 2, 1e-4);
  limites();
  ponerRejilla();

  const datos = medir(modelo);
  datos.dim = [tam.x, tam.y, tam.z];
  actual = { id: null, camaras: [], ...info, datos };

  controls.autoRotate = false;
  $('giro').classList.remove('activo');
  usarOrto(false);
  controls.target.copy(centro);
  persp.position.copy(centro).add(new THREE.Vector3(1, 0.75, 1).setLength(distanciaEncuadre()));
  vista('iso', false);

  $('inicio').hidden = true;
  $('barra').hidden = false;
  $('pista').hidden = false;
  setTimeout(() => { $('pista').hidden = true; }, 7000);
  pintarModelo();
  pintarCamaras();
  pintarLista();
}

function pintarModelo() {
  const hay = !!actual;
  $('sin-modelo').hidden = hay;
  $('con-modelo').hidden = !hay;
  $('bloque-camaras').hidden = !hay;
  if (!hay) return;
  const d = actual.datos;
  $('nombre').value = actual.nombre;
  $('d-dim').textContent = d.dim.map(metros).join(' × ') + ' m';
  $('d-tri').textContent = fmt(d.tri);
  $('d-mallas').textContent = fmt(d.mallas);
  $('d-mat').textContent = fmt(d.mats);
  $('d-tex').textContent = fmt(d.tex);
  $('d-peso').textContent = fmtPeso(actual.peso);
  const g = $('guardar');
  g.disabled = !!actual.id || !actual.bytes;
  g.textContent = actual.id ? 'Guardado en biblioteca' : 'Guardar en biblioteca';
}

// ---------------------------------------------------------------- Importar
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function mensajeError(e) {
  const m = String((e && e.message) || e);
  if (/DRACO/i.test(m)) return 'Este GLB usa compresión Draco, que esta etapa aún no abre. Expórtalo sin Draco.';
  if (/KTX2/i.test(m)) return 'Este GLB usa texturas KTX2, que esta etapa aún no abre.';
  return 'No se pudo abrir el archivo. Comprueba que sea un GLB válido.';
}

async function abrirBytes(bytes, info) {
  estado('Abriendo modelo…');
  let gltf;
  try {
    gltf = await new Promise((ok, mal) => loader.parse(bytes, '', ok, mal));
  } catch (e) {
    console.error(e);
    estado(mensajeError(e), 'error');
    return false;
  }
  ponerModelo(gltf.scene, { bytes, peso: bytes.byteLength, ...info });
  estado('');
  return true;
}

async function abrirArchivo(archivo) {
  if (!archivo) return;
  if (!/\.(glb|gltf)$/i.test(archivo.name)) {
    estado('Formato no admitido en esta etapa. Usa un archivo .glb.', 'error');
    return;
  }
  if (archivo.size > PESO_MAX) {
    estado('El archivo pesa más de 200 MB; es demasiado para el navegador.', 'error');
    return;
  }
  const bytes = await archivo.arrayBuffer();
  await abrirBytes(bytes, { nombre: archivo.name.replace(/\.(glb|gltf)$/i, '') });
}

function abrirEjemplo() {
  const g = new THREE.Group();
  const madera = new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.65 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.35, metalness: 0.8 });
  const asiento = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 48), madera);
  asiento.position.y = 0.47;
  g.add(asiento);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const pata = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.47, 16), metal);
    pata.position.set(Math.cos(a) * 0.15, 0.235, Math.sin(a) * 0.15);
    pata.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    g.add(pata);
  }
  const aro = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.008, 12, 48), metal);
  aro.rotation.x = Math.PI / 2;
  aro.position.y = 0.16;
  g.add(aro);
  ponerModelo(g, { nombre: 'Banqueta de ejemplo', bytes: null, peso: 0 });
  estado('Modelo de ejemplo: sirve para probar la cámara y no se guarda.');
}

// ---------------------------------------------------------------- Imágenes
function conRejillaOculta(fn) {
  const v = rejilla && rejilla.visible;
  if (rejilla) rejilla.visible = false;
  try { return fn(); } finally { if (rejilla) rejilla.visible = v; }
}

function miniatura() {
  const L = 224;
  const c = new THREE.PerspectiveCamera(FOV, 1, radio / 100, radio * 200);
  c.position.copy(centro).add(new THREE.Vector3(1, 0.75, 1).setLength(distanciaEncuadre(1)));
  c.lookAt(centro);
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(L, L, false);
  const url = conRejillaOculta(() => {
    renderer.render(scene, c);
    return renderer.domElement.toDataURL('image/png');
  });
  renderer.setPixelRatio(pr);
  ajustar();
  renderer.render(scene, cam);
  return url;
}

function captura() {
  if (!modelo) return;
  const url = conRejillaOculta(() => {
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/png');
  });
  const a = document.createElement('a');
  a.href = url;
  a.download = (actual.nombre || 'modelo').replace(/[^\w\-áéíóúñ ]+/gi, '_') + '.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  estado('Captura descargada con fondo transparente.', 'ok');
}

// ---------------------------------------------------------------- Biblioteca
let fichas = [];

function ficha() {
  return {
    id: actual.id, nombre: actual.nombre, fecha: actual.fecha, peso: actual.peso,
    datos: actual.datos, camaras: actual.camaras, miniatura: actual.miniatura,
  };
}

async function guardar() {
  if (!actual || !actual.bytes || actual.id) return;
  try {
    actual.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    actual.fecha = Date.now();
    actual.miniatura = miniatura();
    await bd.guardar(ficha(), actual.bytes);
    estado('Guardado en la biblioteca de este navegador.', 'ok');
  } catch (e) {
    console.error(e);
    actual.id = null;
    estado('No se pudo guardar: el navegador no dio espacio de almacenamiento.', 'error');
  }
  pintarModelo();
  await cargarLista();
}

async function actualizarFicha() {
  if (!actual || !actual.id) return;
  try { await bd.actualizar(ficha()); } catch (e) { console.error(e); }
  await cargarLista();
}

async function cargarLista() {
  try {
    fichas = (await bd.fichas()).sort((a, b) => b.fecha - a.fecha);
  } catch (e) {
    console.error(e);
    fichas = [];
    $('vacia').textContent = 'Este navegador no permite guardar modelos (almacenamiento desactivado).';
  }
  pintarLista();
}

function pintarLista() {
  const ul = $('lista');
  ul.textContent = '';
  $('vacia').hidden = fichas.length > 0;
  $('cuenta').textContent = fichas.length ? '(' + fichas.length + ')' : '';
  for (const f of fichas) {
    const li = document.createElement('li');
    if (actual && actual.id === f.id) li.className = 'actual';
    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'abrir-btn';
    abrir.title = 'Abrir ' + f.nombre;
    const img = document.createElement('img');
    img.alt = '';
    img.src = f.miniatura || '';
    const txt = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = f.nombre;
    const s = document.createElement('small');
    s.textContent = fmt(f.datos.tri) + ' triángulos · ' + fmtPeso(f.peso);
    txt.append(b, s);
    abrir.append(img, txt);
    abrir.addEventListener('click', () => abrirDeBiblioteca(f.id));
    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'boton mini';
    borrar.textContent = 'Borrar';
    borrar.addEventListener('click', async () => {
      if (borrar.dataset.seguro !== '1') {
        borrar.dataset.seguro = '1';
        borrar.textContent = '¿Seguro?';
        setTimeout(() => { borrar.dataset.seguro = ''; borrar.textContent = 'Borrar'; }, 3000);
        return;
      }
      await bd.borrar(f.id);
      if (actual && actual.id === f.id) {
        actual.id = null;
        pintarModelo();
      }
      await cargarLista();
    });
    li.append(abrir, borrar);
    ul.append(li);
  }
}

async function abrirDeBiblioteca(id) {
  if (actual && actual.id === id) return;
  const f = fichas.find((x) => x.id === id);
  const bytes = await bd.archivo(id);
  if (!f || !bytes) {
    estado('No se encontró el archivo de ese modelo.', 'error');
    return;
  }
  const ok = await abrirBytes(bytes, { nombre: f.nombre });
  if (!ok) return;
  Object.assign(actual, { id: f.id, fecha: f.fecha, miniatura: f.miniatura, camaras: f.camaras || [] });
  pintarModelo();
  pintarCamaras();
  pintarLista();
}

// ---------------------------------------------------------------- Cámaras guardadas
function pintarCamaras() {
  const ul = $('camaras');
  ul.textContent = '';
  if (!actual) return;
  actual.camaras.forEach((c, i) => {
    const li = document.createElement('li');
    const ir = document.createElement('button');
    ir.type = 'button';
    ir.className = 'boton ir';
    ir.textContent = c.nombre;
    ir.addEventListener('click', () => aplicarCamara(c));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'boton mini';
    x.textContent = 'Quitar';
    x.setAttribute('aria-label', 'Quitar ' + c.nombre);
    x.addEventListener('click', () => {
      actual.camaras.splice(i, 1);
      pintarCamaras();
      actualizarFicha();
    });
    li.append(ir, x);
    ul.append(li);
  });
}

function guardarCamara() {
  if (!actual) return;
  let n = actual.camaras.length + 1;
  while (actual.camaras.some((c) => c.nombre === 'Cámara ' + n)) n++;
  actual.camaras.push({ nombre: 'Cámara ' + n, ...estadoCamara() });
  pintarCamaras();
  actualizarFicha();
}

// ---------------------------------------------------------------- Controles de la interfaz
function alternarGiro() {
  controls.autoRotate = !controls.autoRotate;
  $('giro').classList.toggle('activo', controls.autoRotate);
  $('giro').setAttribute('aria-pressed', String(controls.autoRotate));
}
function alternarRejilla() {
  rejillaVisible = !rejillaVisible;
  if (rejilla) rejilla.visible = rejillaVisible;
  $('rejilla').classList.toggle('activo', rejillaVisible);
  $('rejilla').setAttribute('aria-pressed', String(rejillaVisible));
}
$('rejilla').classList.add('activo');

for (const b of document.querySelectorAll('[data-vista]')) b.addEventListener('click', () => vista(b.dataset.vista));
$('encuadrar').addEventListener('click', () => encuadrar());
$('proyeccion').addEventListener('click', () => usarOrto(cam !== orto));
$('giro').addEventListener('click', alternarGiro);
$('rejilla').addEventListener('click', alternarRejilla);
$('captura').addEventListener('click', captura);
$('guardar').addEventListener('click', guardar);
$('cam-guardar').addEventListener('click', guardarCamara);
$('ejemplo').addEventListener('click', abrirEjemplo);
$('ejemplo2').addEventListener('click', abrirEjemplo);
for (const id of ['archivo', 'archivo2']) {
  $(id).addEventListener('change', (e) => {
    abrirArchivo(e.target.files[0]);
    e.target.value = '';
  });
}
$('nombre').addEventListener('change', () => {
  if (!actual) return;
  actual.nombre = $('nombre').value.trim() || 'Sin nombre';
  $('nombre').value = actual.nombre;
  actualizarFicha();
});

const escena = $('escena');
let dentro = 0;
escena.addEventListener('dragenter', (e) => { e.preventDefault(); dentro++; escena.classList.add('arrastrando'); });
escena.addEventListener('dragleave', () => { if (--dentro <= 0) { dentro = 0; escena.classList.remove('arrastrando'); } });
escena.addEventListener('dragover', (e) => e.preventDefault());
escena.addEventListener('drop', (e) => {
  e.preventDefault();
  dentro = 0;
  escena.classList.remove('arrastrando');
  abrirArchivo(e.dataTransfer.files[0]);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

const TECLAS = { 1: 'frente', 2: 'atras', 3: 'derecha', 4: 'izquierda', 7: 'arriba', 0: 'iso' };
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey || !modelo) return;
  const k = e.key.toLowerCase();
  if (TECLAS[k]) vista(TECLAS[k]);
  else if (k === 'f') encuadrar();
  else if (k === '5') usarOrto(cam !== orto);
  else if (k === 'g') alternarRejilla();
  else if (k === 'r') alternarGiro();
});

// ---------------------------------------------------------------- Bucle
function cuadro(t) {
  requestAnimationFrame(cuadro);
  if (anim) pasoAnim(t);
  else controls.update();
  renderer.render(scene, cam);
}
requestAnimationFrame(cuadro);
pintarModelo();
cargarLista();
