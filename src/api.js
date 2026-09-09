// ============================================================================
// Capa de acceso a datos: todas las llamadas a nuestro backend (Apps Script)
// pasan por aquí. Así, si algún día cambias de backend, solo tocas este archivo.
// ============================================================================

const API_URL = import.meta.env.VITE_API_URL;
const PUBLIC_KEY = import.meta.env.VITE_PUBLIC_KEY;

// Convierte una respuesta { ok: false, error, sesionInvalida } del backend
// en un Error de JavaScript, pero CONSERVANDO la bandera `sesionInvalida`
// (como propiedad del propio Error) para que el Dashboard pueda cerrar la
// sesión automáticamente cuando el problema es justo ese, sin tener que
// adivinarlo comparando el texto exacto del mensaje.
function errorDelServidor_(data) {
  const err = new Error(data.error || 'Error desconocido del servidor');
  if (data.sesionInvalida) err.sesionInvalida = true;
  return err;
}

async function get(action, extraParams = {}) {
  const params = new URLSearchParams({ action, key: PUBLIC_KEY, ...extraParams });
  const res = await fetch(`${API_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Error de red: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw errorDelServidor_(data);
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
  if (!data.ok) throw errorDelServidor_(data);
  return data;
}

// ---- Catálogo público ----
export function listarProductos() {
  return get('listarProductos');
}

export function crearPedido({ cliente, telefono, producto, productoId, cantidad, notas }) {
  return post({ action: 'crearPedido', cliente, telefono, producto, productoId, cantidad, notas });
}

// ---- Inicio de sesión del Dashboard ----
// Ya no existe una sola "clave de administrador" compartida: cada persona
// tiene su propio usuario y contraseña (ver hoja "Usuarios"). Si todo sale
// bien, el servidor regresa un "token" de sesión (sesionToken) que hay que
// mandar en TODAS las demás llamadas del Dashboard, junto con el rol y el
// nombre de esa persona.
export function login({ usuario, contrasena }) {
  return post({ action: 'login', usuario, contrasena });
}

// ---- Dashboard admin (requiere sesionToken) ----
export function listarProductosAdmin(sesionToken) {
  return get('listarProductosAdmin', { sesionToken });
}

export function listarPedidos(sesionToken) {
  return get('listarPedidos', { sesionToken });
}

export function obtenerAlertas(sesionToken) {
  return get('alertas', { sesionToken });
}

export function actualizarStock({ sesionToken, productoId, nuevoStock }) {
  return post({ action: 'actualizarStock', sesionToken, productoId, nuevoStock });
}

// Actualiza cualquier combinación de estado/cantidad/teléfono/notas de un
// pedido. Solo manda los campos que le pases; los que omitas no se tocan.
// `montoReembolso` solo se usa cuando `estado` es "Reembolsado": si no se
// manda, el backend reembolsa el total del pedido por default.
export function actualizarPedido({ sesionToken, pedidoId, estado, cantidad, telefono, notas, montoReembolso }) {
  return post({ action: 'actualizarPedido', sesionToken, pedidoId, estado, cantidad, telefono, notas, montoReembolso });
}

// ---- Movimientos (abonos y cargos) para el "Estado de cuenta" ----
// Solo lo puede ver un Administrador (el backend lo revisa también).
export function listarMovimientos(sesionToken) {
  return get('listarMovimientos', { sesionToken });
}

// ---- Bitácora de cambios (quién hizo qué y cuándo) ----
// Solo lo puede ver un Administrador (el backend lo revisa también).
export function listarBitacora(sesionToken) {
  return get('listarBitacora', { sesionToken });
}

// ---- Analítica de ventas (Bloque 3, ítem 4) ----
// Solo lo puede ver un Administrador (el backend lo revisa también).
// `desde`/`hasta` van como texto "YYYY-MM-DD".
export function analiticaVentas({ sesionToken, desde, hasta }) {
  return get('analiticaVentas', { sesionToken, desde, hasta });
}

export function crearProducto({
  sesionToken,
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
    sesionToken,
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
  sesionToken,
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
    sesionToken,
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
export function cambiarDisponibilidad({ sesionToken, productoId, disponible }) {
  return post({ action: 'actualizarProducto', sesionToken, productoId, disponible });
}

// Borra la fila del producto de forma permanente. No se puede deshacer
// desde la app.
export function eliminarProducto({ sesionToken, productoId }) {
  return post({ action: 'eliminarProducto', sesionToken, productoId });
}

// Sube una foto (como base64) a la carpeta de Google Drive del negocio y
// devuelve la URL pública para guardarla en el producto.
export function subirFoto({ sesionToken, nombreArchivo, tipoMime, datosBase64 }) {
  return post({ action: 'subirFoto', sesionToken, nombreArchivo, tipoMime, datosBase64 });
}

// ---- Orden del catálogo (arrastrar y acomodar, por categoría) ----

// Guarda de un jalón el nuevo número de "Orden" de varios productos a la
// vez (por ejemplo, todos los de una categoría después de arrastrar uno).
// cambios = [{ productoId, orden }, ...]
export function actualizarOrdenMultiple({ sesionToken, cambios, resumen }) {
  return post({ action: 'actualizarOrdenMultiple', sesionToken, cambios, resumen });
}

// Cambia el nombre de una categoría en TODOS los productos que la tengan,
// de un jalón (por ejemplo, "Bolsas" -> "Bolsos").
export function renombrarCategoria({ sesionToken, categoriaAnterior, categoriaNueva }) {
  return post({ action: 'renombrarCategoria', sesionToken, categoriaAnterior, categoriaNueva });
}

// Quita o borra una categoría completa.
// - Si borrarProductos es false (o no se manda): los productos de esa
//   categoría se CONSERVAN, solo se les vacía la Categoría (se van a
//   "Otros").
// - Si borrarProductos es true: se borran también, para siempre, TODOS
//   los productos de esa categoría (no se puede deshacer desde la app).
export function eliminarCategoria({ sesionToken, categoria, borrarProductos }) {
  return post({ action: 'eliminarCategoria', sesionToken, categoria, borrarProductos });
}

// ---- Opciones predeterminadas (Nombre, Categoría, Marca, Talla, Color,
// Código propio) que se muestran como sugerencia en "+ Agregar producto".
// A diferencia del Stock/Pedidos, esta lista NUNCA se llena sola: solo
// tiene los valores que se agregaron a propósito desde el Dashboard.
export function listarOpciones(sesionToken) {
  return get('listarOpciones', { sesionToken });
}

export function agregarOpcion({ sesionToken, campo, valor }) {
  return post({ action: 'agregarOpcion', sesionToken, campo, valor });
}

export function eliminarOpcion({ sesionToken, campo, valor }) {
  return post({ action: 'eliminarOpcion', sesionToken, campo, valor });
}

// ---- Gestión de usuarios del Dashboard (solo Administrador; el backend
// también lo revisa, así que aunque alguien intentara llamar esto sin ser
// Administrador, el servidor lo rechaza). ----
export function listarUsuarios(sesionToken) {
  return get('listarUsuarios', { sesionToken });
}

export function crearUsuario({ sesionToken, nombre, usuario, contrasena, rol }) {
  return post({ action: 'crearUsuario', sesionToken, nombre, usuario, contrasena, rol });
}

export function actualizarUsuario({ sesionToken, usuarioId, nombre, rol }) {
  return post({ action: 'actualizarUsuario', sesionToken, usuarioId, nombre, rol });
}

export function cambiarContrasenaUsuario({ sesionToken, usuarioId, contrasenaNueva }) {
  return post({ action: 'cambiarContrasenaUsuario', sesionToken, usuarioId, contrasenaNueva });
}

export function inhabilitarUsuario({ sesionToken, usuarioId }) {
  return post({ action: 'inhabilitarUsuario', sesionToken, usuarioId });
}

export function habilitarUsuario({ sesionToken, usuarioId }) {
  return post({ action: 'habilitarUsuario', sesionToken, usuarioId });
}
