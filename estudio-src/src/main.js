// Estudio 3D — Etapas 1 y 2: visor, importación de GLB, cámara, biblioteca local y diseños sobre el modelo.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
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
  vaciarDisenos();
  modelo = obj;
  scene.add(modelo);
  modelo.updateMatrixWorld(true);
  prepararMallas();
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
  pintarDisenos();
  pintarLista();
}

function pintarModelo() {
  const hay = !!actual;
  $('sin-modelo').hidden = hay;
  $('con-modelo').hidden = !hay;
  $('bloque-camaras').hidden = !hay;
  $('bloque-disenos').hidden = !hay;
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
  if (marco) marco.visible = false;
  try { return fn(); } finally {
    if (rejilla) rejilla.visible = v;
    if (marco) marco.visible = true;
  }
}

function descargar(url, nombre) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
const nombreArchivo = () => (actual.nombre || 'modelo').replace(/[^\w\-áéíóúñ ]+/gi, '_');

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
  descargar(url, nombreArchivo() + '.png');
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
    await bd.ponerDisenos(actual.id, datosDisenos());
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
  const gen = generacion;
  const guardados = (await bd.disenos(id)) || [];
  for (const dato of guardados) {
    if (gen !== generacion) return;
    try { await montarDiseno(dato, gen); } catch (e) { console.error(e); }
  }
  pintarDisenos();
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
  const archivo = e.dataTransfer.files[0];
  if (archivo && /^image\//.test(archivo.type)) agregarDiseno(archivo, e.clientX, e.clientY);
  else abrirArchivo(archivo);
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
  else if (k === 'escape') seleccionar(null);
  else if ((k === 'delete' || k === 'backspace') && elegido) quitarDiseno(elegido);
});

// ---------------------------------------------------------------- Diseños sobre el modelo
// Cada diseño es una imagen proyectada sobre la superficie (calcomanía). Se mueve arrastrándola.
const lienzo = renderer.domElement;
const capa = new THREE.Group();
capa.name = 'Diseños';
scene.add(capa);
const rayo = new THREE.Raycaster();
const ayuda = new THREE.Object3D();
let mallas = [];
let disenos = [];
let elegido = null;
let marco = null;
let arrastre = null;
let puntero = null;
let generacion = 0;
let guardadoPendiente = 0;

function prepararMallas() {
  mallas = [];
  modelo.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    if (!o.geometry.attributes.normal) {
      // Sin normales el modelo se ve facetado; se conservan caras planas para no cambiar su aspecto.
      const plana = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      plana.computeVertexNormals();
      if (plana !== o.geometry) o.geometry.dispose();
      o.geometry = plana;
    }
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    mallas.push({ malla: o, caja: g.boundingBox.clone().applyMatrix4(o.matrixWorld) });
  });
}

function vaciarDisenos() {
  generacion++;
  clearTimeout(guardadoPendiente);
  for (const d of disenos) soltarDiseno(d);
  disenos = [];
  elegido = null;
  ponerMarco();
}
function soltarDiseno(d) {
  for (const m of d.grupo.children) m.geometry.dispose();
  capa.remove(d.grupo);
  d.material.map.dispose();
  d.material.dispose();
}

function ndc(x, y) {
  const r = lienzo.getBoundingClientRect();
  return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}
function golpeModelo() {
  const h = rayo.intersectObjects(mallas.map((m) => m.malla), false)[0];
  if (!h || !h.face) return null;
  return {
    pos: h.point.clone(), dist: h.distance,
    normal: h.face.normal.clone().transformDirection(h.object.matrixWorld),
  };
}
function tocarModelo(x, y) {
  rayo.setFromCamera(ndc(x, y), cam);
  return golpeModelo();
}
function tocarDiseno(x, y) {
  rayo.setFromCamera(ndc(x, y), cam);
  const hs = rayo.intersectObjects(capa.children, true);
  if (!hs.length) return null;
  const m = golpeModelo();
  const margen = radio * 0.03;
  if (m && m.dist < hs[0].distance - margen) return null; // el diseño está detrás del modelo
  let mejor = null;
  for (const h of hs) {
    if (h.distance > hs[0].distance + margen) break;
    const d = disenos.find((x) => x.grupo === h.object.parent);
    if (d && (!mejor || disenos.indexOf(d) > disenos.indexOf(mejor))) mejor = d;
  }
  return mejor;
}

/** Quita las caras que miran en contra del diseño y lo separa un pelo de la superficie. */
function ajustarCalco(g, normal) {
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const pos = [], nor = [], uv = [];
  const eps = radio * 0.002;
  for (let i = 0; i < P.count; i += 3) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += N.getX(i + k) * normal.x + N.getY(i + k) * normal.y + N.getZ(i + k) * normal.z;
    if (s < 0.3) continue;
    for (let k = 0; k < 3; k++) {
      const j = i + k;
      pos.push(P.getX(j) + N.getX(j) * eps, P.getY(j) + N.getY(j) * eps, P.getZ(j) + N.getZ(j) * eps);
      nor.push(N.getX(j), N.getY(j), N.getZ(j));
      uv.push(U.getX(j), U.getY(j));
    }
  }
  g.dispose();
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  r.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  r.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return r;
}

function reconstruir(d) {
  for (const m of d.grupo.children) m.geometry.dispose();
  d.grupo.clear();
  const alto = d.ancho / d.aspecto;
  const tam = new THREE.Vector3(d.ancho, alto, Math.max(d.ancho, alto));
  ayuda.position.copy(d.pos);
  ayuda.lookAt(d.pos.clone().add(d.normal));
  ayuda.rotateZ(rad(d.giro));
  const alcance = tam.length() / 2;
  for (const m of mallas) {
    if (m.caja.distanceToPoint(d.pos) > alcance) continue;
    const g = ajustarCalco(new DecalGeometry(m.malla, d.pos, ayuda.rotation, tam), d.normal);
    if (!g.attributes.position.count) { g.dispose(); continue; }
    const malla = new THREE.Mesh(g, d.material);
    malla.name = d.nombre;
    d.grupo.add(malla);
  }
  ordenar();
  if (d === elegido) ponerMarco();
}
function ordenar() {
  disenos.forEach((d, i) => { for (const m of d.grupo.children) m.renderOrder = i + 1; });
}

function ponerMarco() {
  if (marco) {
    scene.remove(marco);
    marco.geometry.dispose();
    marco.material.dispose();
    marco = null;
  }
  if (!elegido || !elegido.grupo.children.length) return;
  marco = new THREE.BoxHelper(elegido.grupo, 0xb5532f);
  scene.add(marco);
}

function seleccionar(d) {
  if (elegido === d) return;
  elegido = d;
  ponerMarco();
  pintarDisenos();
}

function cargarImagen(src) {
  return new Promise((ok, mal) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => mal(new Error('No se pudo leer la imagen'));
    i.src = src;
  });
}

/** Reduce la imagen a un máximo de 1536 px y la devuelve como texto, para guardarla junto al modelo. */
async function normalizarImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await cargarImagen(url);
    const esc = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * esc));
    c.height = Math.max(1, Math.round(img.naturalHeight * esc));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return archivo.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function montarDiseno(dato, gen = generacion) {
  const img = await cargarImagen(dato.src);
  if (gen !== generacion) return null;
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  const d = {
    id: dato.id, nombre: dato.nombre, src: dato.src,
    aspecto: img.naturalWidth / img.naturalHeight,
    pos: new THREE.Vector3().fromArray(dato.pos),
    normal: new THREE.Vector3().fromArray(dato.normal),
    ancho: dato.ancho, giro: dato.giro || 0,
    material: new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
    grupo: new THREE.Group(),
  };
  d.material.name = dato.nombre;
  capa.add(d.grupo);
  disenos.push(d);
  reconstruir(d);
  return d;
}

function datosDisenos() {
  return disenos.map((d) => ({
    id: d.id, nombre: d.nombre, src: d.src, pos: d.pos.toArray(), normal: d.normal.toArray(),
    ancho: d.ancho, giro: d.giro,
  }));
}

/** Tras un cambio: guarda los diseños y refresca la miniatura, si el modelo está en la biblioteca. */
function cambioDisenos() {
  clearTimeout(guardadoPendiente);
  if (!actual || !actual.id) return;
  const gen = generacion;
  guardadoPendiente = setTimeout(async () => {
    if (gen !== generacion || arrastre) return;
    try {
      await bd.ponerDisenos(actual.id, datosDisenos());
      actual.miniatura = miniatura();
      await actualizarFicha();
    } catch (e) {
      console.error(e);
      estado('No se pudieron guardar los diseños en la biblioteca.', 'error');
    }
  }, 700);
}

async function agregarDiseno(archivo, x, y) {
  if (!archivo) return;
  if (!modelo) {
    estado('Abre primero un modelo; después agrega el diseño.', 'error');
    return;
  }
  if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) {
    estado('Usa una imagen JPG, PNG o WebP.', 'error');
    return;
  }
  let golpe = x != null ? tocarModelo(x, y) : null;
  if (!golpe) {
    // Busca superficie desde el centro de la vista hacia afuera.
    const r = lienzo.getBoundingClientRect();
    const puntos = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) puntos.push([i, j]);
    puntos.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]));
    for (const [i, j] of puntos) {
      golpe = tocarModelo(r.left + r.width * (0.5 + i * 0.09), r.top + r.height * (0.5 + j * 0.09));
      if (golpe) break;
    }
  }
  if (!golpe) {
    estado('Gira el modelo para tenerlo de frente y vuelve a agregar el diseño.', 'error');
    return;
  }
  const gen = generacion;
  try {
    const src = await normalizarImagen(archivo);
    const d = await montarDiseno({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      nombre: archivo.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Diseño',
      src, pos: golpe.pos.toArray(), normal: golpe.normal.toArray(), ancho: radio * 0.45, giro: 0,
    }, gen);
    if (!d) return;
    elegido = null;
    seleccionar(d);
    cambioDisenos();
    estado('Diseño agregado. Arrástralo sobre el modelo para moverlo.', 'ok');
  } catch (e) {
    console.error(e);
    estado('No se pudo leer esa imagen.', 'error');
  }
}

function quitarDiseno(d) {
  soltarDiseno(d);
  disenos = disenos.filter((x) => x !== d);
  if (elegido === d) elegido = null;
  ordenar();
  ponerMarco();
  pintarDisenos();
  cambioDisenos();
}

async function duplicarDiseno(d) {
  const p = d.pos.clone().project(cam);
  const r = lienzo.getBoundingClientRect();
  const golpe = tocarModelo(((p.x + 1) / 2) * r.width + r.left + 48, ((1 - p.y) / 2) * r.height + r.top + 24);
  const n = await montarDiseno({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nombre: d.nombre, src: d.src, ancho: d.ancho, giro: d.giro,
    pos: (golpe ? golpe.pos : d.pos).toArray(), normal: (golpe ? golpe.normal : d.normal).toArray(),
  });
  if (!n) return;
  seleccionar(n);
  cambioDisenos();
}

function pintarDisenos() {
  const ul = $('disenos');
  ul.textContent = '';
  for (const d of disenos) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'boton dis' + (d === elegido ? ' activo' : '');
    b.setAttribute('aria-pressed', String(d === elegido));
    const img = document.createElement('img');
    img.alt = '';
    img.src = d.src;
    const t = document.createElement('span');
    t.textContent = d.nombre;
    b.append(img, t);
    b.addEventListener('click', () => seleccionar(d === elegido ? null : d));
    li.append(b);
    ul.append(li);
  }
  $('dis-vacio').hidden = disenos.length > 0;
  $('dis-controles').hidden = !elegido;
  if (elegido) {
    const pct = Math.round((elegido.ancho / (2 * radio)) * 100);
    $('dis-tam').value = pct;
    $('dis-tam-v').textContent = textoTam(elegido.ancho);
    $('dis-giro').value = elegido.giro;
    $('dis-giro-v').textContent = Math.round(elegido.giro) + '°';
  }
}
const textoTam = (ancho) => (ancho * 100 >= 10 ? (ancho * 100).toFixed(0) : (ancho * 100).toFixed(1)) + ' cm de ancho';

// Arrastre directo sobre el modelo. Va en fase de captura para adelantarse al giro de cámara.
lienzo.addEventListener('pointerdown', (e) => {
  if (anim) finAnim();
  if (!modelo || e.button !== 0 || !disenos.length || arrastre) return;
  const d = tocarDiseno(e.clientX, e.clientY);
  if (!d) return;
  seleccionar(d);
  const p = d.pos.clone().project(cam);
  const r = lienzo.getBoundingClientRect();
  arrastre = {
    d, id: e.pointerId, movido: false,
    dx: ((p.x + 1) / 2) * r.width + r.left - e.clientX,
    dy: ((1 - p.y) / 2) * r.height + r.top - e.clientY,
  };
  controls.enabled = false;
  lienzo.setPointerCapture(e.pointerId);
  lienzo.style.cursor = 'grabbing';
}, true);
lienzo.addEventListener('pointermove', (e) => {
  if (arrastre && e.pointerId !== arrastre.id) return;
  if (!arrastre && e.pointerType !== 'mouse') return;
  puntero = { x: e.clientX, y: e.clientY };
});
function finArrastre(e) {
  if (!arrastre || e.pointerId !== arrastre.id) return;
  pasoPuntero();
  const movido = arrastre.movido;
  arrastre = null;
  controls.enabled = true;
  lienzo.style.cursor = '';
  if (movido) cambioDisenos();
}
lienzo.addEventListener('pointerup', finArrastre);
lienzo.addEventListener('pointercancel', finArrastre);

/** Una vez por cuadro: mueve el diseño arrastrado o cambia el cursor al pasar sobre uno. */
function pasoPuntero() {
  if (!puntero) return;
  const { x, y } = puntero;
  puntero = null;
  if (arrastre) {
    const golpe = tocarModelo(x + arrastre.dx, y + arrastre.dy);
    if (!golpe) return;
    arrastre.d.pos.copy(golpe.pos);
    arrastre.d.normal.copy(golpe.normal);
    arrastre.movido = true;
    reconstruir(arrastre.d);
  } else if (disenos.length && !anim) {
    lienzo.style.cursor = tocarDiseno(x, y) ? 'grab' : '';
  }
}

function exportarGLB() {
  if (!modelo) return;
  estado('Preparando el GLB…');
  new GLTFExporter().parse([modelo, capa], (buf) => {
    const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    descargar(url, nombreArchivo() + '.glb');
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    estado(disenos.length ? 'GLB descargado con los diseños incluidos.' : 'GLB descargado.', 'ok');
  }, (e) => {
    console.error(e);
    estado('No se pudo exportar el GLB.', 'error');
  }, { binary: true });
}

$('dis-archivo').addEventListener('change', async (e) => {
  const archivos = [...e.target.files];
  e.target.value = '';
  for (const a of archivos) await agregarDiseno(a);
});
$('dis-tam').addEventListener('input', () => {
  if (!elegido) return;
  elegido.ancho = (Number($('dis-tam').value) / 100) * 2 * radio;
  $('dis-tam-v').textContent = textoTam(elegido.ancho);
  reconstruir(elegido);
  cambioDisenos();
});
$('dis-giro').addEventListener('input', () => {
  if (!elegido) return;
  elegido.giro = Number($('dis-giro').value);
  $('dis-giro-v').textContent = Math.round(elegido.giro) + '°';
  reconstruir(elegido);
  cambioDisenos();
});
$('dis-duplicar').addEventListener('click', () => elegido && duplicarDiseno(elegido));
$('dis-quitar').addEventListener('click', () => elegido && quitarDiseno(elegido));
$('exportar').addEventListener('click', exportarGLB);

// ---------------------------------------------------------------- Bucle
function cuadro(t) {
  requestAnimationFrame(cuadro);
  if (anim) pasoAnim(t);
  else controls.update();
  pasoPuntero();
  renderer.render(scene, cam);
}
requestAnimationFrame(cuadro);
pintarModelo();
cargarLista();
