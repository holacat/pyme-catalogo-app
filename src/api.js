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

export function actualizarEstadoPedido({ adminKey, pedidoId, nuevoEstado }) {
  return post({ action: 'actualizarEstadoPedido', adminKey, pedidoId, nuevoEstado });
}

export function crearProducto({ adminKey, nombre, categoria, precio, stock, stockMinimo, fotoUrl, descripcion }) {
  return post({ action: 'crearProducto', adminKey, nombre, categoria, precio, stock, stockMinimo, fotoUrl, descripcion });
}
