// ============================================================================
// Capa de acceso a datos: todas las llamadas a nuestro backend (Apps Script)
// pasan por aquí. Así, si algún día cambias de backend, solo tocas este archivo.
// ============================================================================

const API_URL = import.meta.env.VITE_API_URL;
const PUBLIC_KEY = import.meta.env.VITE_PUBLIC_KEY;

async function get(action, extraParams = {}) {
  const params = new URLSearchParams({ action, key: PUBLIC_KEY, ...extraParams });
  const res = await fetch(`${API_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Error de red: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Error desconocido del servidor');
  return data;
}

async function post(body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    // "text/plain" evita que el navegador dispare un preflight OPTIONS,
    // que Apps Script no maneja bien. El script igual lee el JSON del body.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: PUBLIC_KEY, ...body }),
  });
  if (!res.ok) throw new Error(`Error de red: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Error desconocido del servidor');
  return data;
}

// ---- Catálogo público ----
export function listarProductos() {
  return get('listarProductos');
}

export function crearPedido({ cliente, telefono, producto, productoId, cantidad, notas }) {
  return post({ action: 'crearPedido', cliente, telefono, producto, productoId, cantidad, notas });
}

// ---- Dashboard admin (requiere adminKey) ----
export function listarProductosAdmin(adminKey) {
  return get('listarProductosAdmin', { adminKey });
}

export function listarPedidos(adminKey) {
  return get('listarPedidos', { adminKey });
}

export function obtenerAlertas(adminKey) {
  return get('alertas', { adminKey });
}

export function actualizarStock({ adminKey, productoId, nuevoStock }) {
  return post({ action: 'actualizarStock', adminKey, productoId, nuevoStock });
}

// Actualiza cualquier combinación de estado/cantidad/teléfono/notas de un
// pedido. Solo manda los campos que le pases; los que omitas no se tocan.
// `montoReembolso` solo se usa cuando `estado` es "Reembolsado": si no se
// manda, el backend reembolsa el total del pedido por default.
export function actualizarPedido({ adminKey, pedidoId, estado, cantidad, telefono, notas, montoReembolso }) {
  return post({ action: 'actualizarPedido', adminKey, pedidoId, estado, cantidad, telefono, notas, montoReembolso });
}

// ---- Movimientos (abonos y cargos) para el "Estado de cuenta" ----
export function listarMovimientos(adminKey) {
  return get('listarMovimientos', { adminKey });
}
export function crearProducto({
  adminKey,
  nombre,
  categoria,
  marca,
  talla,
  color,
  precio,
  precioCompra,
  stock,
  stockMinimo,
  fotoUrl,
  descripcion,
  codigoPropio,
}) {
  return post({
    action: 'crearProducto',
    adminKey,
    nombre,
    categoria,
    marca,
    talla,
    color,
    precio,
    precioCompra,
    stock,
    stockMinimo,
    fotoUrl,
    descripcion,
    codigoPropio,
  });
}

// Igual que crearProducto, pero para editar uno que ya existe.
export function actualizarProducto({
  adminKey,
  productoId,
  nombre,
  categoria,
  marca,
  talla,
  color,
  precio,
  precioCompra,
  stock,
  stockMinimo,
  fotoUrl,
  descripcion,
  disponible,
  codigoPropio,
  orden,
}) {
  return post({
    action: 'actualizarProducto',
    adminKey,
    productoId,
    nombre,
    categoria,
    marca,
    talla,
    color,
    precio,
    precioCompra,
    stock,
    stockMinimo,
    fotoUrl,
    descripcion,
    disponible,
    codigoPropio,
    orden,
  });
}

// Muestra/oculta un producto del catálogo público sin borrar nada (se
// puede revertir en cualquier momento).
export function cambiarDisponibilidad({ adminKey, productoId, disponible }) {
  return post({ action: 'actualizarProducto', adminKey, productoId, disponible });
}

// Borra la fila del producto de forma permanente. No se puede deshacer
// desde la app.
export function eliminarProducto({ adminKey, productoId }) {
  return post({ action: 'eliminarProducto', adminKey, productoId });
}

// Sube una foto (como base64) a la carpeta de Google Drive del negocio y
// devuelve la URL pública para guardarla en el producto.
export function subirFoto({ adminKey, nombreArchivo, tipoMime, datosBase64 }) {
  return post({ action: 'subirFoto', adminKey, nombreArchivo, tipoMime, datosBase64 });
}

// ---- Orden del catálogo (arrastrar y acomodar, por categoría) ----

// Guarda de un jalón el nuevo número de "Orden" de varios productos a la
// vez (por ejemplo, todos los de una categoría después de arrastrar uno).
// cambios = [{ productoId, orden }, ...]
export function actualizarOrdenMultiple({ adminKey, cambios }) {
  return post({ action: 'actualizarOrdenMultiple', adminKey, cambios });
}

// Cambia el nombre de una categoría en TODOS los productos que la tengan,
// de un jalón (por ejemplo, "Bolsas" -> "Bolsos").
export function renombrarCategoria({ adminKey, categoriaAnterior, categoriaNueva }) {
  return post({ action: 'renombrarCategoria', adminKey, categoriaAnterior, categoriaNueva });
}

// Quita o borra una categoría completa.
// - Si borrarProductos es false (o no se manda): los productos de esa
//   categoría se CONSERVAN, solo se les vacía la Categoría (se van a
//   "Otros").
// - Si borrarProductos es true: se borran también, para siempre, TODOS
//   los productos de esa categoría (no se puede deshacer desde la app).
export function eliminarCategoria({ adminKey, categoria, borrarProductos }) {
  return post({ action: 'eliminarCategoria', adminKey, categoria, borrarProductos });
}

// ---- Opciones predeterminadas (Nombre, Categoría, Marca, Talla, Color,
// Código propio) que se muestran como sugerencia en "+ Agregar producto".
// A diferencia del Stock/Pedidos, esta lista NUNCA se llena sola: solo
// tiene los valores que se agregaron a propósito desde el Dashboard.
export function listarOpciones(adminKey) {
  return get('listarOpciones', { adminKey });
}

export function agregarOpcion({ adminKey, campo, valor }) {
  return post({ action: 'agregarOpcion', adminKey, campo, valor });
}

export function eliminarOpcion({ adminKey, campo, valor }) {
  return post({ action: 'eliminarOpcion', adminKey, campo, valor });
}
