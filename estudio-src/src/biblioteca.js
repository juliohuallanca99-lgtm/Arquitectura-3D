// Biblioteca local en IndexedDB: las fichas (datos ligeros) y los archivos GLB van en almacenes separados,
// para listar la biblioteca sin cargar los modelos en memoria.
const NOMBRE = 'estudio3d';
let conexion = null;

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((ok, mal) => {
    let pet;
    try {
      pet = indexedDB.open(NOMBRE, 1);
    } catch (e) {
      mal(e);
      return;
    }
    pet.onupgradeneeded = () => {
      pet.result.createObjectStore('fichas', { keyPath: 'id' });
      pet.result.createObjectStore('archivos');
    };
    pet.onsuccess = () => ok(pet.result);
    pet.onerror = () => mal(pet.error);
  });
  conexion.catch(() => { conexion = null; });
  return conexion;
}

async function tx(almacenes, modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(almacenes, modo);
    let res;
    t.oncomplete = () => ok(res);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
    const r = fn(t);
    if (r) r.onsuccess = () => { res = r.result; };
  });
}

export const bd = {
  fichas: () => tx(['fichas'], 'readonly', (t) => t.objectStore('fichas').getAll()),
  archivo: (id) => tx(['archivos'], 'readonly', (t) => t.objectStore('archivos').get(id)),
  guardar: (ficha, bytes) => tx(['fichas', 'archivos'], 'readwrite', (t) => {
    t.objectStore('fichas').put(ficha);
    t.objectStore('archivos').put(bytes, ficha.id);
  }),
  actualizar: (ficha) => tx(['fichas'], 'readwrite', (t) => { t.objectStore('fichas').put(ficha); }),
  borrar: (id) => tx(['fichas', 'archivos'], 'readwrite', (t) => {
    t.objectStore('fichas').delete(id);
    t.objectStore('archivos').delete(id);
  }),
};
