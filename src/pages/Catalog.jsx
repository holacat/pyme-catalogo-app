import { useEffect, useRef, useState } from 'react';
import ProductCard, { obtenerInfoOferta } from '../components/ProductCard.jsx';
import SolicitudModal from '../components/SolicitudModal.jsx';
import CarritoModal, { claveDeItem } from '../components/CarritoModal.jsx';
import { listarProductos, crearPedidoCarrito, consultarMarcaDeCambios, verTicketPublico } from '../api.js';
import { crearQR, descargarTicketPDF } from '../exportar.js';

// Refresco del catálogo (2026-10-06). Antes, cada catálogo abierto (cada
// pestaña, cada celular) le pedía TODOS los productos al servidor cada 5
// segundos, hubiera cambios o no, sin esperar a que contestara la vez
// anterior y aunque la página ni se estuviera viendo. Con varias clientas
// (más el panel) eso mantenía al servidor ocupado y todo se volvía lento.
// Ahora cada 5 s solo se pregunta "¿hay algo nuevo?" (el servidor lo contesta
// casi al instante); los productos se vuelven a pedir solo cuando algo
// cambió, o cada 2 minutos por si acaso. Con la página en segundo plano no
// se pide nada, y al volver a verla se revisa de inmediato.
const REVISION_CATALOGO_MS = 5000;
const RECARGA_COMPLETA_CATALOGO_MS = 120000;
// Con un servidor de antes (no sabe contestar "¿hay algo nuevo?") se piden
// los productos como antes, pero más espaciado y nunca encimado.
const RECARGA_SERVIDOR_VIEJO_MS = 10000;
// Una petición que lleva más de esto sin contestar se da por perdida.
const PETICION_PERDIDA_CATALOGO_MS = 60000;
// …pero si la clienta todavía no ve ningún producto, no se espera tanto.
const PETICION_PERDIDA_SIN_CATALOGO_MS = 12000;

const CLIENTE_STORAGE_KEY = 'pyme_cliente_info';

// Lee los datos del cliente guardados en ESTE navegador (si ya los dio antes).
// Usamos try/catch porque en algunos navegadores (modo privado, etc.)
// localStorage puede fallar, y no queremos que la app se rompa por eso.
function leerClienteGuardado() {
  try {
    const raw = localStorage.getItem(CLIENTE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function guardarCliente({ nombre, telefono }) {
  try {
    localStorage.setItem(CLIENTE_STORAGE_KEY, JSON.stringify({ nombre, telefono }));
  } catch {
    // si falla, no pasa nada grave: la próxima vez se le volverá a preguntar
  }
}

function borrarClienteGuardado() {
  try {
    localStorage.removeItem(CLIENTE_STORAGE_KEY);
  } catch {
    // sin problema
  }
}

// Precio que de verdad se cobra por unidad (2026-10-01, bug real
// encontrado al revisar los pendientes de Claudia): si el producto tiene
// un precio de oferta válido, se usa ESE — antes el carrito y el mensaje de
// WhatsApp usaban siempre el precio normal, aunque la tarjeta enseñara el
// de oferta. Misma regla que la tarjeta ("obtenerInfoOferta") y que el
// servidor al registrar el pedido (Code.gs, "crearPedido").
function precioQueSeCobra(producto) {
  const { precioOferta } = obtenerInfoOferta(producto);
  return precioOferta !== null ? precioOferta : Number(producto.Precio) || 0;
}

// Mensaje de WhatsApp para pedir VARIOS productos juntos (carrito).
// "telefonoDinamico" (2026-09-30, pedido por Claudia): el número ya NO está
// fijo en la variable de entorno de Vercel — el servidor lo manda junto con
// el catálogo (ver "cargarProductos" más abajo), leyéndolo del campo
// "Teléfono de pedidos" de quien esté marcado 👑 Admin Central en el
// Dashboard (pestaña 👤 Usuarios) — así Claudia lo puede cambiar ella
// misma, sin tocar Vercel ni volver a desplegar nada. Si por algún motivo
// todavía no está configurado (campo vacío), se usa la variable de entorno
// vieja como respaldo, para no dejar el catálogo sin número de un día para
// otro.
// "nombreSucursal" (2026-10-07): si el pedido se hace desde el catálogo de
// una sucursal, el mensaje lo dice arriba. Claudia tenía dos sucursales con
// el MISMO teléfono de pedidos y, al llegar el WhatsApp, no había forma de
// saber de cuál de las dos era (parecía que el pedido "se pasaba" de una a
// otra). En el catálogo Global el mensaje queda igual que siempre.
// (2026-10-09) Un pedido del catálogo general puede ser de VARIAS
// sucursales (Claudia: "se enviarán diferentes pedidos registrados con sus
// diferentes sucursales"). Se arma un WhatsApp por cada número: si dos
// sucursales comparten número, van juntas en el mismo mensaje, cada una con
// su título. Regresa [{ etiqueta, url }] (la etiqueta dice a quién va).
function enlacesDeWhatsAppDelPedido(items, nombre, telefonoGeneral, nombreSucursalDelLink) {
  if (!items.some((it) => it.sucursal)) {
    return [{ etiqueta: '', url: buildWhatsAppLinkCarrito(items, nombre, telefonoGeneral, nombreSucursalDelLink) }];
  }
  const porTelefono = new Map();
  items.forEach((it) => {
    const telefono = (it.sucursal && it.sucursal.telefono) || telefonoGeneral || '';
    if (!porTelefono.has(telefono)) porTelefono.set(telefono, new Map());
    const porSucursal = porTelefono.get(telefono);
    const llave = it.sucursal ? String(it.sucursal.id) : '';
    if (!porSucursal.has(llave)) porSucursal.set(llave, { sucursal: it.sucursal || null, items: [] });
    porSucursal.get(llave).items.push(it);
  });
  return Array.from(porTelefono.entries()).map(([telefono, porSucursal]) => {
    const secciones = Array.from(porSucursal.values());
    const etiqueta = secciones.map((x) => (x.sucursal ? x.sucursal.nombre : 'la tienda')).join(' y ');
    return { etiqueta, url: buildWhatsAppLinkSecciones(secciones, nombre, telefono) };
  });
}

function lineaDeWhatsApp({ producto, cantidad }) {
  const unitario = precioQueSeCobra(producto);
  const normal = Number(producto.Precio) || 0;
  const notaOferta = unitario < normal
    ? ` (oferta: $${unitario.toLocaleString('es-MX')} c/u, antes $${normal.toLocaleString('es-MX')})`
    : '';
  return `🛍️ ${producto.Nombre} x${cantidad} — $${(unitario * cantidad).toLocaleString('es-MX')}${notaOferta}`;
}

function buildWhatsAppLinkSecciones(secciones, nombre, telefonoDinamico) {
  const phone = telefonoDinamico || import.meta.env.VITE_WHATSAPP_NUMBER;
  const todos = secciones.flatMap((x) => x.items);
  const total = todos.reduce((acc, { producto, cantidad }) => acc + precioQueSeCobra(producto) * cantidad, 0);
  const piezas = todos.reduce((acc, { cantidad }) => acc + cantidad, 0);
  const cuerpo = secciones
    .map((x) => {
      const titulo = x.sucursal
        ? `🏪 Sucursal ${x.sucursal.nombre}${x.sucursal.zona ? ` (${x.sucursal.zona})` : ''}:`
        : '🏪 Tienda:';
      return `${titulo}\n${x.items.map(lineaDeWhatsApp).join('\n')}`;
    })
    .join('\n');
  const mensaje =
    `Hola, soy ${nombre}.\n` +
    `Me interesan estos productos:\n` +
    `${cuerpo}\n` +
    `📦 Total de piezas: ${piezas}\n` +
    `💲 Total aproximado: $${total.toLocaleString('es-MX')}\n` +
    `¿Siguen disponibles?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

function buildWhatsAppLinkCarrito(items, nombre, telefonoDinamico, nombreSucursal) {
  const phone = telefonoDinamico || import.meta.env.VITE_WHATSAPP_NUMBER;
  const lineas = items
    .map(({ producto, cantidad }) => {
      const unitario = precioQueSeCobra(producto);
      const normal = Number(producto.Precio) || 0;
      const notaOferta = unitario < normal
        ? ` (oferta: $${unitario.toLocaleString('es-MX')} c/u, antes $${normal.toLocaleString('es-MX')})`
        : '';
      return `🛍️ ${producto.Nombre} x${cantidad} — $${(unitario * cantidad).toLocaleString('es-MX')}${notaOferta}`;
    })
    .join('\n');
  const total = items.reduce((acc, { producto, cantidad }) => acc + precioQueSeCobra(producto) * cantidad, 0);
  const piezas = items.reduce((acc, { cantidad }) => acc + cantidad, 0);
  const mensaje =
    `Hola, soy ${nombre}.\n` +
    (nombreSucursal ? `🏪 Pedido del catálogo de la sucursal ${nombreSucursal}\n` : '') +
    `Me interesan estos productos:\n` +
    `${lineas}\n` +
    `📦 Total de piezas: ${piezas}\n` +
    `💲 Total aproximado: $${total.toLocaleString('es-MX')}\n` +
    `¿Siguen disponibles?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

// Agrupa la lista de productos (que YA viene ordenada por categoría y por
// "Orden" desde el backend) en bloques por categoría, conservando el orden
// en que vienen. Los productos sin categoría se juntan bajo "Otros", para
// que ninguno se quede sin mostrarse.
// ---- Buscador y filtros del catálogo (2026-10-01, pendiente P9 de
// Claudia: "añadir un buscador de productos o categorías y filtro por
// precio o marca o color para el catálogo público") ----
// Texto sin acentos ni mayúsculas, para que "camisa" encuentre "CAMISÁ".
function normalizarBusqueda(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Lista de valores distintos de un campo (ej. todas las marcas), sin
// repetir por mayúsculas/acentos, ordenada alfabéticamente.
function valoresDistintos(productos, campo) {
  const vistos = new Map();
  productos.forEach((p) => {
    const texto = String(p[campo] || '').trim();
    if (!texto) return;
    const clave = normalizarBusqueda(texto);
    if (!vistos.has(clave)) vistos.set(clave, texto);
  });
  return Array.from(vistos.entries())
    .map(([clave, texto]) => ({ clave, texto }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
}

// ---- Catálogos por sucursal (2026-10-02) ----
// Pedido por Claudia: cada persona con "Catálogo propio" prendido tiene su
// propio link, `/?sucursal=<su ID>`. Con ese link esta misma pantalla
// enseña SOLO lo de esa persona (con SUS piezas), dice arriba "CATÁLOGO DE
// SUCURSAL <NOMBRE>" y manda los pedidos a SU WhatsApp. Sin nada en el
// link es el catálogo Global de siempre. (También se acepta `?vendedor=`,
// que fue el nombre con el que se platicó la idea al principio.)
function leerSucursalDelLink() {
  try {
    const parametros = new URLSearchParams(window.location.search);
    return (parametros.get('sucursal') || parametros.get('vendedor') || '').trim();
  } catch {
    return '';
  }
}

// ---- Envío del pedido a WhatsApp (2026-10-05) ----
// Claudia, probando en vivo: "ya no redirecciona bien así como antes, lo
// hacía más rápido y directo; el navegador ahora dice 'bloqueando ventana
// emergente'… y en teléfono me lleva a WhatsApp en el navegador, me debe
// llevar directo a la app como antes".
// Por qué pasaba: desde el 2026-09-30 primero se ESPERABA la respuesta del
// servidor y hasta después se abría WhatsApp. Un navegador solo deja abrir
// otra ventana (y un celular solo salta directo a la app) si eso pasa EN
// EL MISMO TOQUE de la persona; unos segundos después ya lo trata como
// ventana emergente y lo bloquea, o lo abre como página web.
// Cómo queda: en el mismo toque (1) sale la petición para anotar el pedido
// y (2) se abre WhatsApp. La petición lleva "keepalive" (ver api.js) para
// que termine aunque el navegador se quede atrás, y un "idEnvio" para que
// reintentarla nunca duplique el pedido (ver Code.gs).

// Cuánto se espera la respuesta del servidor antes de cortar y reintentar
// (Apps Script suele contestar en 2 a 8 segundos).
const LIMITE_ESPERA_PEDIDO_MS = 60000;
// El servidor recuerda cada envío 6 horas. Pasadas 5, el catálogo ya no
// reintenta solo: no podría saber si el pedido había quedado anotado.
const LIMITE_REINTENTO_SOLO_MS = 5 * 60 * 60 * 1000;

// Número único de un envío. Se repite tal cual en los reintentos.
function nuevoIdEnvio() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch {
    // Sin esa función se arma uno con la hora y un número al azar.
  }
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// "Huella" de un pedido: si el carrito y la clienta no cambiaron, un nuevo
// intento es el MISMO pedido (y usa el mismo idEnvio).
function huellaDelPedido(items, cliente, sucursalId) {
  return JSON.stringify([
    sucursalId || '',
    cliente.nombre || '',
    cliente.telefono || '',
    items.map(({ producto, cantidad, sucursal }) => [String(producto.ID), cantidad, sucursal ? String(sucursal.id) : '']),
  ]);
}

function abrirWhatsApp(url) {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // Si el navegador no deja, el aviso central trae un botón para abrirlo.
  }
}

function pausa(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// En celular, mientras la clienta está en WhatsApp, el navegador puede
// tener la página "dormida": un reintento ahí fallaría otra vez. Se espera
// a que la página vuelva a estar a la vista.
function esperarPaginaALaVista() {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve();
  return new Promise((resolver) => {
    const revisar = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', revisar);
      resolver();
    };
    document.addEventListener('visibilitychange', revisar);
  });
}

// Una falla SIN respuesta del servidor (se cayó el internet, o el celular
// cortó la conexión): no se sabe si el pedido llegó o no. Cuando el
// servidor sí contestó con un rechazo, el error trae "datos".
function esFallaDeConexion(err) {
  return !(err && err.datos);
}

const FILTROS_VACIOS = { categoria: '', marca: '', color: '', precioMin: '', precioMax: '', soloOfertas: false };

function agruparPorCategoria(productos) {
  const grupos = [];
  const indicePorCategoria = {};
  productos.forEach((p) => {
    const nombreCategoria = String(p.Categoria || '').trim() || 'Otros';
    if (!(nombreCategoria in indicePorCategoria)) {
      indicePorCategoria[nombreCategoria] = grupos.length;
      grupos.push({ nombre: nombreCategoria, productos: [] });
    }
    grupos[indicePorCategoria[nombreCategoria]].productos.push(p);
  });
  return grupos;
}

// Envuelve la fila horizontal de productos de una categoría con flechas
// laterales ‹ › (igual que el carrusel de fotos de cada producto), en vez
// de dejar visible la barra de scroll del navegador. Las flechas solo se
// muestran cuando de verdad hay más productos para ese lado: si todos los
// productos de la categoría ya caben en pantalla, no se ve ninguna flecha.
function CategoriaCarrusel({ children }) {
  const scrollRef = useRef(null);
  // A diferencia de antes, esto YA NO cambia según hacia dónde te deslizaste:
  // una vez que hay más productos de los que caben en pantalla, las DOS
  // flechas se quedan visibles siempre, no se esconden nunca.
  const [hayDesbordamiento, setHayDesbordamiento] = useState(false);

  function actualizarDesbordamiento() {
    const el = scrollRef.current;
    if (!el) return;
    setHayDesbordamiento(el.scrollWidth > el.clientWidth + 4);
  }

  // Vuelve a calcular si hacen falta flechas cada vez que cambia la lista
  // de productos mostrados (por ejemplo, si uno se agota y desaparece).
  useEffect(() => {
    actualizarDesbordamiento();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  function desplazar(direccion) {
    const el = scrollRef.current;
    if (!el) return;
    const cantidad = Math.round(el.clientWidth * 0.8) * direccion;
    el.scrollBy({ left: cantidad, behavior: 'smooth' });
  }

  return (
    <div className="categoria-carrusel-envoltura">
      {hayDesbordamiento && (
        <button
          type="button"
          className="categoria-carrusel-flecha categoria-carrusel-flecha-izq"
          onClick={() => desplazar(-1)}
          aria-label="Ver productos anteriores"
        >
          ‹
        </button>
      )}
      <div className="categoria-carrusel" ref={scrollRef}>
        {children}
      </div>
      {hayDesbordamiento && (
        <button
          type="button"
          className="categoria-carrusel-flecha categoria-carrusel-flecha-der"
          onClick={() => desplazar(1)}
          aria-label="Ver más productos"
        >
          ›
        </button>
      )}
    </div>
  );
}

// Arreglo (2026-09-25, reportado por Claudia con captura: el nombre de una
// categoría de prueba, muy largo y sin espacios, se desbordaba fuera de la
// pantalla en el título de la sección). Igual que ya se hizo con el nombre
// del producto y su Categoría en ProductCard.jsx, aquí se recorta el título
// a un tamaño razonable con la posibilidad de verlo completo dándole
// "Ver más". Se usa tanto para el título de cada categoría en la vista
// normal como para el título grande de "Ver más de X".
function TituloCategoria({ nombre, className }) {
  const [abierto, setAbierto] = useState(false);
  const LIMITE = 40;
  const nombreCompleto = nombre || '';
  const esLargo = nombreCompleto.length > LIMITE;
  const mostrado = !esLargo || abierto ? nombreCompleto : nombreCompleto.slice(0, LIMITE) + '…';
  return (
    <div className="categoria-titulo-envoltura">
      <h2 className={className}>{mostrado}</h2>
      {esLargo && (
        <button
          type="button"
          className="link-button categoria-titulo-ver-mas"
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// EL TICKET QUE VE LA CLIENTA (2026-10-07)
// ============================================================================
// Claudia: "el QR de los tickets me lleva al panel de admin, eso es
// inconcebible… para el cliente debe acceder al ticket en digital, digamos
// en PDF de nuevo, pero ni de chiste al panel".
// Ahora el QR de un ticket abre ESTA página: se ve el ticket tal como salió
// impreso y se puede volver a descargar en PDF. No pide usuario ni
// contraseña, y desde aquí no se puede llegar a nada del panel.
// El enlace lleva el folio y una clave larga que no se puede adivinar
// (`/?ticket=T-00012&c=…`): sin la clave correcta el servidor no enseña
// nada, así que nadie puede ver tickets ajenos probando folios.
// Se abre aquí mismo (Catalog.jsx) cuando la dirección trae "?ticket=".
// (2026-10-08) Antes vivía en su propio archivo, TicketPublico.jsx; al
// subirlo a GitHub el nombre quedó con otras mayúsculas y Vercel no lo
// encontraba. Ahora va dentro de este archivo: un archivo menos que subir.

// Lo que trae el enlace: { folio, clave } (o null si no es un enlace de ticket).
function leerTicketDelLink() {
  try {
    const parametros = new URLSearchParams(window.location.search);
    const folio = (parametros.get('ticket') || '').trim();
    if (!folio) return null;
    return { folio, clave: (parametros.get('c') || '').trim() };
  } catch {
    return null;
  }
}

// El enlace público de un ticket (lo que lleva su QR). Lo usa también el
// panel para armar el QR. Sin clave no hay enlace: regresa ''.
function enlacePublicoDeTicket(folio, clave) {
  if (!folio || !clave) return '';
  try {
    return `${window.location.origin}/?ticket=${encodeURIComponent(folio)}&c=${encodeURIComponent(clave)}`;
  } catch {
    return '';
  }
}

function dinero(numero) {
  return `$${(Number(numero) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaConHora(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return `${fecha.toLocaleDateString('es-MX')} ${fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}

function CodigoQR({ texto, lado = 132 }) {
  const qr = texto ? crearQR(texto) : null;
  if (!qr) return null;
  const n = qr.lado + 8; // con su orilla blanca
  let trazo = '';
  qr.celdas.forEach((fila, y) => {
    fila.forEach((oscura, x) => {
      if (oscura) trazo += `M${x + 4} ${y + 4}h1v1h-1z`;
    });
  });
  return (
    <svg className="ticket-qr" width={lado} height={lado} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Código QR de este ticket">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={trazo} fill="#000000" />
    </svg>
  );
}

// El ticket en pantalla, con el mismo acomodo que el PDF.
function PapelDelTicket({ ticket, tienda, enlace }) {
  const cancelado = ticket.Estado === 'Cancelado';
  const items = (Array.isArray(ticket.Items) ? ticket.Items : []).filter((it) => it && typeof it === 'object');
  const piezas = items.reduce((suma, it) => suma + (Number(it.cantidad) || 0), 0);
  const diaDe = (valor) => (valor ? new Date(valor).toDateString() : '');
  const otroDia = !!(ticket.FechaCompra && ticket.Fecha && diaDe(ticket.FechaCompra) !== diaDe(ticket.Fecha));
  return (
    <div className={`ticket-papel ${cancelado ? 'ticket-papel-cancelado' : ''}`} data-ticket-publico-papel>
      {cancelado && <p className="ticket-papel-sello">*** TICKET CANCELADO ***</p>}
      {tienda.nombre && <p className="ticket-papel-tienda">{tienda.nombre}</p>}
      {tienda.direccion && <p className="ticket-papel-chico">{tienda.direccion}</p>}
      {tienda.telefono && <p className="ticket-papel-chico">Tel. {tienda.telefono}</p>}
      {(tienda.nombre || tienda.direccion || tienda.telefono) && <hr />}
      <p className="ticket-papel-titulo">TICKET DE COMPRA</p>
      <p className="ticket-papel-folio">Folio {ticket.Folio}</p>
      <p><strong>{otroDia ? 'Fecha de compra:' : 'Fecha:'}</strong> {fechaConHora(ticket.FechaCompra || ticket.Fecha)}</p>
      {otroDia && <p><strong>Ticket emitido:</strong> {fechaConHora(ticket.Fecha)}</p>}
      <p><strong>Cliente:</strong> {ticket.Cliente || 'Público en general'}</p>
      {ticket.Telefono && <p><strong>Tel.:</strong> {ticket.Telefono}</p>}
      {ticket.Vendedor && <p><strong>Le atendió:</strong> {ticket.Vendedor}</p>}
      <hr />
      <table className="ticket-papel-tabla">
        <thead>
          <tr><th>Cant.</th><th>Descripción</th><th>Importe</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>{Number(it.cantidad) || 0} x</td>
              <td>
                {it.descripcion}
                <span className="ticket-papel-detalle">
                  {it.codigo ? `Cód. ${it.codigo} · ` : ''}{dinero(it.precio)} c/u
                </span>
              </td>
              <td>{dinero(it.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <p className="ticket-papel-total"><span>TOTAL</span><span>{dinero(ticket.Total)}</span></p>
      <p className="ticket-papel-chico ticket-papel-izquierda">
        {piezas} pieza{piezas === 1 ? '' : 's'} en {items.length} producto{items.length === 1 ? '' : 's'}
      </p>
      {ticket.Notas && (
        <>
          <hr />
          <p><strong>Nota:</strong> {ticket.Notas}</p>
        </>
      )}
      <hr />
      <div className="ticket-papel-qr">
        <CodigoQR texto={enlace} />
        <p className="ticket-papel-folio-chico">Folio {ticket.Folio}</p>
      </div>
      {tienda.mensaje && <p className="ticket-papel-mensaje">{tienda.mensaje}</p>}
    </div>
  );
}

function TicketPublico({ folio, clave }) {
  // 'cargando' | 'listo' | 'noEsta' | 'sinConexion'
  const [estado, setEstado] = useState('cargando');
  const [datos, setDatos] = useState(null); // { ticket, tienda }
  const [intento, setIntento] = useState(0);
  const [avisoDescarga, setAvisoDescarga] = useState('');

  useEffect(() => {
    // Un QR de antes (sin clave) o un enlace recortado: ni se pregunta.
    if (!folio || !clave) {
      setEstado('noEsta');
      return undefined;
    }
    let vigente = true;
    setEstado('cargando');
    verTicketPublico({ folio, clave })
      .then((res) => {
        if (!vigente) return;
        setDatos({ ticket: res.ticket, tienda: res.tienda || {} });
        setEstado('listo');
      })
      .catch((err) => {
        if (!vigente) return;
        // El servidor contestó que ese ticket no existe (o que la clave del
        // enlace no es la suya)…
        if (err && err.datos && err.datos.ticketNoEncontrado) setEstado('noEsta');
        // …o no contestó, o contestó otra cosa (sin internet, servidor
        // ocupado): eso se puede volver a intentar.
        else setEstado('sinConexion');
      });
    return () => {
      vigente = false;
    };
  }, [folio, clave, intento]);

  useEffect(() => {
    const tituloAnterior = document.title;
    document.title = folio ? `Ticket ${folio}` : 'Ticket';
    return () => {
      document.title = tituloAnterior;
    };
  }, [folio]);

  const enlace = enlacePublicoDeTicket(folio, clave);

  function descargar() {
    if (!datos) return;
    setAvisoDescarga('');
    try {
      descargarTicketPDF(`ticket-${datos.ticket.Folio}`, [{ ticket: datos.ticket, tienda: datos.tienda, enlace }]);
      setAvisoDescarga('Listo: revisa tus descargas.');
    } catch (err) {
      setAvisoDescarga(`No se pudo armar el PDF: ${err.message || err}`);
    }
  }

  return (
    <div className="ticket-publico" data-ticket-publico={estado}>
      {estado === 'cargando' && <p className="info-msg">Buscando tu ticket…</p>}

      {estado === 'noEsta' && (
        <div className="ticket-publico-aviso">
          <h2>🎫 No encontramos este ticket</h2>
          <p>
            {clave
              ? 'Revisa que el enlace esté completo. Si lo copiaste de un mensaje, cópialo de nuevo entero.'
              : 'Este código es de una versión anterior del ticket y ya no se puede abrir en línea.'}
          </p>
          <p>Pídele a la tienda que te comparta tu ticket otra vez.</p>
        </div>
      )}

      {estado === 'sinConexion' && (
        <div className="ticket-publico-aviso">
          <h2>🎫 No se pudo cargar tu ticket</h2>
          <p>Puede ser tu conexión a internet. Inténtalo de nuevo en un momento.</p>
          <button type="button" className="btn btn-primary" onClick={() => setIntento((n) => n + 1)}>
            🔄 Volver a intentar
          </button>
        </div>
      )}

      {estado === 'listo' && datos && (
        <>
          <h2 className="ticket-publico-titulo">Tu ticket de compra</h2>
          <PapelDelTicket ticket={datos.ticket} tienda={datos.tienda} enlace={enlace} />
          <div className="ticket-publico-botones">
            <button type="button" className="btn btn-primary" onClick={descargar} data-ticket-publico-pdf>
              📄 Descargar en PDF
            </button>
          </div>
          {avisoDescarga && <p className="muted ticket-publico-nota" role="status">{avisoDescarga}</p>}
          <p className="muted ticket-publico-nota">
            Este enlace es solo de tu ticket. Guárdalo, o descarga el PDF, para tenerlo a la mano.
          </p>
        </>
      )}

      <p className="ticket-publico-pie">
        <a href="/">🛍️ Ver el catálogo de la tienda</a>
      </p>
    </div>
  );
}

// (2026-10-07) La dirección del catálogo también sirve para el ticket de la
// clienta: si trae "?ticket=…" (lo que lleva el QR de un ticket), en vez del
// catálogo se enseña SOLO ese ticket (ver "TicketPublico", arriba).
export default function Catalog() {
  const [ticketDelLink] = useState(leerTicketDelLink);
  if (ticketDelLink) return <TicketPublico folio={ticketDelLink.folio} clave={ticketDelLink.clave} />;
  return <CatalogoDeProductos />;
}

function CatalogoDeProductos() {
  const [productos, setProductos] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [error, setError] = useState('');

  // Qué se está mostrando ahorita: el catálogo dividido en categorías (lo
  // normal), una sola categoría abierta completa ("Ver más de esta
  // categoría"), o el catálogo entero mezclado ("Ver catálogo completo").
  const [vista, setVista] = useState({ tipo: 'categorias' });
  // Buscador y filtros (2026-10-01, pendiente P9). Mientras haya algo
  // escrito o algún filtro puesto, se enseña la lista de resultados (de
  // todas las categorías juntas) en vez de la vista normal.
  const [busqueda, setBusqueda] = useState('');
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [ordenResultados, setOrdenResultados] = useState('relevancia');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  // Carrito con VARIOS productos: lista de { producto, cantidad }.
  const [carrito, setCarrito] = useState([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  // true cuando el cliente ya revisó el carrito y le falta dar nombre/teléfono.
  const [pidiendoDatosCarrito, setPidiendoDatosCarrito] = useState(false);

  const [clienteGuardado, setClienteGuardado] = useState(() => leerClienteGuardado());

  // Estado del envío del pedido (ver "enviarPedidoPorWhatsApp" más abajo).
  // Historia: el 2026-09-30 Claudia reportó que un pedido de prueba no
  // apareció solo en la pestaña Pedidos; en ese entonces el pedido se
  // mandaba "al aire" después de abrir WhatsApp y, si fallaba, nadie se
  // enteraba. Desde entonces el catálogo SIEMPRE revisa la respuesta del
  // servidor y, si algo falla, lo avisa con un botón para "Reintentar".
  const [registrandoPedido, setRegistrandoPedido] = useState(false);
  const [errorRegistroPedido, setErrorRegistroPedido] = useState('');
  // 'red' (se puede reintentar tal cual) | 'existencia' (ya no hay tantas
  // piezas: se ajustó el pedido y hay que revisarlo antes de reenviar) |
  // 'cerrado' (el catálogo de esa sucursal se apagó: no hay nada que reintentar).
  const [tipoErrorRegistro, setTipoErrorRegistro] = useState('red');
  // Aviso central del envío (2026-10-05, pedido por Claudia: "avisar en
  // medio que se está enviando el pedido a WhatsApp, no solo arriba; debe
  // ser tipo modal central"). null = cerrado;
  // { fase: 'enviando' | 'listo' | 'error', url } — "url" es el link de
  // WhatsApp de ESE pedido, para el botón "Abrir WhatsApp" del aviso.
  const [envioPedido, setEnvioPedido] = useState(null);
  // El envío que está en curso o que falló: { id, huella }. Se suelta
  // cuando el pedido queda anotado.
  const envioRef = useRef(null);
  const enviandoRef = useRef(false);
  // ¿El servidor ya reconoce pedidos repetidos por su "idEnvio"? Lo avisa
  // junto con el catálogo. Solo entonces se reintenta solo.
  const servidorAceptaIdEnvioRef = useRef(false);

  // Catálogo de sucursal: el ID viene en el link y no cambia mientras la
  // página está abierta; el nombre lo contesta el servidor.
  const [sucursalId] = useState(leerSucursalDelLink);
  const [sucursal, setSucursal] = useState(null); // { id, nombre } | null
  const [sucursalNoDisponible, setSucursalNoDisponible] = useState(false);

  // Teléfono de pedidos del catálogo Global (2026-09-30) — viene del
  // servidor junto con el catálogo (ver "cargarProductos" más abajo), en
  // vez de estar fijo en una variable de entorno. Ver nota junto a
  // "buildWhatsAppLinkCarrito" arriba.
  const [telefonoPedidos, setTelefonoPedidos] = useState('');
  // (2026-10-09) El servidor avisa si en el catálogo general se escoge
  // sucursal por producto (ver ProductCard.jsx).
  const [eligeSucursal, setEligeSucursal] = useState(false);
  // Zona "🔥 Ofertas" (2026-10-01, pendiente P11): desde "Orden del
  // catálogo" se puede ocultar completa y acomodar el orden de su carrusel;
  // el servidor manda las dos cosas junto con el catálogo.
  const [ofertasOculta, setOfertasOculta] = useState(false);
  const [ofertasOrden, setOfertasOrden] = useState([]);
  // Título de la zona (se puede renombrar desde "Orden del catálogo").
  const [ofertasTitulo, setOfertasTitulo] = useState('');

  // Arreglo (2026-09-25, reportado por Claudia: "al salirme del catálogo y
  // volverme a meter tengo que actualizarlo manualmente, ya que si no dice
  // 'no se pudo cargar el catálogo, failed to fetch'... el usuario se va a
  // asustar"). Aquí había DOS problemas:
  // 1) Esta pantalla ya reintentaba sola cada 5 segundos en segundo plano
  //    (la idea siempre fue no depender de que el cliente actualice a
  //    mano), pero si esa recarga en SEGUNDO PLANO fallaba UNA sola vez
  //    (por ejemplo, el celular se queda sin señal un instante justo al
  //    volver de otra app o de segundo plano), el código borraba TODO el
  //    catálogo que ya se había cargado bien y lo reemplazaba con una
  //    pantalla de error — aunque los productos ya estuvieran ahí y
  //    perfectamente visibles un segundo antes. Ahora una recarga en
  //    segundo plano que falla ya NO borra el catálogo que ya se veía: se
  //    queda tal cual estaba, y el siguiente intento automático (5
  //    segundos después) lo repone solo, sin que el cliente note nada.
  // 2) La pantalla de error de la carga INICIAL (cuando todavía no hay
  //    nada en pantalla) sí puede aparecer — por ejemplo si el celular
  //    abre la página sin conexión — pero se veía como un error técnico
  //    ("Failed to fetch") sin ninguna pista de qué hacer. Ahora explica
  //    en palabras simples que puede ser la conexión, aclara que se sigue
  //    intentando solo, y agrega un botón "🔄 Actualizar" para reintentar
  //    de inmediato sin tener que refrescar la página completa a mano.
  // ---- Refresco de fondo (ver "REVISION_CATALOGO_MS" arriba) ----
  const cargasEnVueloRef = useRef([]); // [{ desde }]
  const numeroDeCargaRef = useRef(0);
  const ultimaCargaAplicadaRef = useRef(0);
  const ultimaCargaBuenaRef = useRef(0); // cuándo llegó bien la última
  const ultimoIntentoRef = useRef(0);
  const marcaVistaRef = useRef(''); // la "marca de cambios" de lo que se ve
  const servidorSinMarcaRef = useRef(false);
  const revisandoDesdeRef = useRef(0);
  const latidoRef = useRef(null);

  function cargarProductos() {
    const enVuelo = { desde: Date.now() };
    cargasEnVueloRef.current = cargasEnVueloRef.current.concat([enVuelo]);
    ultimoIntentoRef.current = enVuelo.desde;
    numeroDeCargaRef.current += 1;
    const miNumero = numeroDeCargaRef.current;
    listarProductos(sucursalId)
      .then((data) => {
        // Una respuesta que llega después de otra más nueva ya no se aplica.
        if (miNumero < ultimaCargaAplicadaRef.current) return;
        ultimaCargaAplicadaRef.current = miNumero;
        ultimaCargaBuenaRef.current = Date.now();
        marcaVistaRef.current = typeof data.marca === 'string' ? data.marca : '';
        servidorSinMarcaRef.current = !marcaVistaRef.current;
        setProductos(data.productos);
        setSucursal(data.sucursal || null);
        setSucursalNoDisponible(!!data.sucursalNoDisponible);
        // Arreglo (2026-09-30): si esta recarga en particular no trajera el
        // campo (por ejemplo, una respuesta vieja en caché), no borramos un
        // número que ya se había cargado bien antes — solo lo actualizamos
        // cuando de verdad viene algo.
        if (data.telefonoPedidos !== undefined) setTelefonoPedidos(data.telefonoPedidos || '');
        if (data.ofertasOculta !== undefined) setOfertasOculta(!!data.ofertasOculta);
        if (Array.isArray(data.ofertasOrden)) setOfertasOrden(data.ofertasOrden.map(String));
        if (data.ofertasTitulo !== undefined) setOfertasTitulo(String(data.ofertasTitulo || ''));
        if (data.aceptaIdEnvio !== undefined) servidorAceptaIdEnvioRef.current = !!data.aceptaIdEnvio;
        setEligeSucursal(!sucursalId && !!data.eligeSucursal);
        setEstado('listo');
      })
      .catch((err) => {
        setEstado((estadoPrevio) => {
          // Si ya había un catálogo cargado y visible, una falla de la
          // recarga silenciosa en segundo plano NO debe borrarlo de la
          // pantalla — se deja tal cual y el siguiente intento automático
          // (5s después) lo arregla solo.
          if (estadoPrevio === 'listo') return 'listo';
          setError(err.message);
          return 'error';
        });
      })
      .finally(() => {
        cargasEnVueloRef.current = cargasEnVueloRef.current.filter((x) => x !== enVuelo);
      });
  }

  // Cada REVISION_CATALOGO_MS: decide si toca pedir algo (ver arriba).
  function latido() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const ahora = Date.now();
    const esperaPorPerdida = ultimaCargaBuenaRef.current === 0 ? PETICION_PERDIDA_SIN_CATALOGO_MS : PETICION_PERDIDA_CATALOGO_MS;
    if (cargasEnVueloRef.current.some((x) => ahora - x.desde < esperaPorPerdida)) return;
    const desdeLaBuena = ahora - ultimaCargaBuenaRef.current;
    // Todavía no hay catálogo en pantalla (la primera carga falló): se
    // reintenta completo, sin encimar.
    if (ultimaCargaBuenaRef.current === 0) {
      if (ahora - ultimoIntentoRef.current >= REVISION_CATALOGO_MS) cargarProductos();
      return;
    }
    if (servidorSinMarcaRef.current) {
      if (desdeLaBuena >= RECARGA_SERVIDOR_VIEJO_MS) cargarProductos();
      return;
    }
    if (desdeLaBuena >= RECARGA_COMPLETA_CATALOGO_MS) {
      cargarProductos();
      return;
    }
    if (revisandoDesdeRef.current > 0 && ahora - revisandoDesdeRef.current < 20000) return;
    revisandoDesdeRef.current = ahora;
    consultarMarcaDeCambios()
      .then((r) => {
        const marca = r && typeof r.marca === 'string' ? r.marca : '';
        if (!marca) {
          servidorSinMarcaRef.current = true;
          return;
        }
        const yaHayCarga = cargasEnVueloRef.current.some((x) => Date.now() - x.desde < PETICION_PERDIDA_CATALOGO_MS);
        if (marca !== marcaVistaRef.current && !yaHayCarga) cargarProductos();
      })
      .catch((err) => {
        // Un servidor de antes contesta "Acción no reconocida".
        if (err && err.datos && err.datos.error === 'Acción no reconocida') servidorSinMarcaRef.current = true;
        // Otra falla (se fue la señal un momento): se pregunta otra vez en
        // el siguiente latido; el catálogo que ya se veía no se toca.
      })
      .finally(() => {
        if (revisandoDesdeRef.current === ahora) revisandoDesdeRef.current = 0;
      });
  }
  latidoRef.current = latido;

  useEffect(() => {
    cargarProductos();

    // En segundo plano se revisa si hay algo nuevo, para que si el
    // administrador cambia el stock, oculta o edita un producto, los
    // clientes lo vean reflejado solos sin tener que recargar la página.
    const intervalo = setInterval(() => {
      if (latidoRef.current) latidoRef.current();
    }, REVISION_CATALOGO_MS);
    // Al volver a ver la página (por ejemplo, al regresar de WhatsApp) se
    // revisa de una vez.
    function alVolver() {
      if (!document.hidden && latidoRef.current) latidoRef.current();
    }
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Carrito con varios productos ----

  // Agrega un producto al carrito. Si ya estaba, le suma la cantidad
  // (sin pasarse del stock disponible).
  // (2026-10-09) Un pedido es de UNA sola sucursal. Claudia: "solo debería
  // dejarte escoger una sucursal: haces el pedido y, si quieres de otra,
  // vuelves a hacer otro pedido seleccionando otra sucursal". La sucursal
  // del pedido es la del primer producto que se agregó.
  const sucursalDelCarrito = (carrito.find((it) => it.sucursal) || {}).sucursal || null;
  // Se intentó agregar algo de OTRA sucursal: { producto, cantidad, sucursalElegida }.
  const [avisoOtraSucursal, setAvisoOtraSucursal] = useState(null);

  // En el catálogo general cada renglón es "producto + la sucursal que se
  // escogió": su tope es lo que tiene ESA sucursal.
  function handleAgregarCarrito(producto, cantidad, sucursalElegida, empezarDeNuevo = false) {
    if (!empezarDeNuevo && sucursalElegida && sucursalDelCarrito && String(sucursalElegida.id) !== String(sucursalDelCarrito.id)) {
      setAvisoOtraSucursal({ producto, cantidad, sucursalElegida });
      return;
    }
    const sucursal = sucursalElegida
      ? { id: String(sucursalElegida.id), nombre: sucursalElegida.nombre, zona: sucursalElegida.zona || '', telefono: sucursalElegida.telefono || '' }
      : null;
    const productoDelRenglon = sucursalElegida ? { ...producto, Stock: Number(sucursalElegida.disponible) || 0 } : producto;
    const nuevo = { producto: productoDelRenglon, cantidad, sucursal };
    setCarrito((anterior) => {
      const prev = empezarDeNuevo ? [] : anterior;
      const stockDisponible = Number(productoDelRenglon.Stock) || 0;
      const clave = claveDeItem(nuevo);
      const idx = prev.findIndex((it) => claveDeItem(it) === clave);
      if (idx === -1) {
        return [...prev, { ...nuevo, cantidad: Math.min(cantidad, stockDisponible) }];
      }
      const copia = [...prev];
      copia[idx] = {
        ...copia[idx],
        producto: productoDelRenglon,
        cantidad: Math.min(stockDisponible, copia[idx].cantidad + cantidad),
      };
      return copia;
    });
  }

  function handleQuitarDelCarrito(clave) {
    setCarrito((prev) => prev.filter((it) => claveDeItem(it) !== clave));
  }

  function handleCambiarCantidadCarrito(clave, nuevaCantidad) {
    setCarrito((prev) =>
      prev.map((it) => {
        if (claveDeItem(it) !== clave) return it;
        const stockDisponible = Number(it.producto.Stock) || 0;
        const cantidad = Math.max(1, Math.min(stockDisponible, nuevaCantidad));
        return { ...it, cantidad };
      })
    );
  }

  // Manda el pedido: lo anota en la tienda y abre WhatsApp, las dos cosas
  // EN EL MISMO TOQUE (ver la nota "Envío del pedido a WhatsApp" arriba).
  // Historia: hasta el 2026-09-30 se abría WhatsApp y el pedido se mandaba
  // "al aire" sin revisar si llegó; del 2026-09-30 al 2026-10-05 se
  // esperaba al servidor y luego se abría WhatsApp (seguro, pero el
  // navegador lo bloqueaba como ventana emergente y en celular ya no
  // saltaba a la app). Ahora salen juntos y el aviso central dice cómo
  // terminó: si no se pudo anotar, la clienta lo ve y puede reintentar.
  // El carrito se manda en UNA sola petición que el servidor registra todo
  // o nada, y solo se quita del carrito cuando el pedido quedó anotado.
  //
  // Reglas:
  // - Cada pedido (misma clienta + mismo carrito) abre WhatsApp UNA vez.
  //   "Reintentar" el mismo pedido solo lo vuelve a anotar; si el carrito
  //   cambió, es otro pedido y sí se abre WhatsApp con el mensaje nuevo.
  // - Si el servidor todavía es uno "de antes" (no reconoce pedidos
  //   repetidos), se conserva el orden viejo: primero anotar y luego
  //   WhatsApp. Así nunca se arriesga un pedido duplicado por subir el
  //   catálogo antes que Code.gs.
  async function enviarPedidoPorWhatsApp(items, { nombre, telefono }) {
    // Evita el doble envío (dos toques seguidos, o "Reintentar" dos veces).
    // Se usa una marca inmediata además del estado, porque el estado tarda
    // un instante en cambiar y ahora WhatsApp se abre al momento.
    if (registrandoPedido || enviandoRef.current) return;
    if (items.length === 0) return;
    enviandoRef.current = true;
    let url = '';
    let enlaces = [];
    let envio = null;
    try {
      enlaces = enlacesDeWhatsAppDelPedido(items, nombre, telefonoPedidos, sucursalId && sucursal ? sucursal.nombre : '');
      url = enlaces[0].url;
      const huella = huellaDelPedido(items, { nombre, telefono }, sucursalId);
      if (!envioRef.current || envioRef.current.huella !== huella) {
        envioRef.current = { id: nuevoIdEnvio(), huella, desde: Date.now(), whatsAppAbierto: false };
      }
      envio = envioRef.current;
      const servidorNuevo = servidorAceptaIdEnvioRef.current;
      const pedido = {
        cliente: nombre,
        telefono,
        notas: '',
        sucursal: sucursalId,
        idEnvio: envio.id,
        // Con un servidor que reconoce repetidos se puede poner un límite
        // de espera: si se cuelga, se corta y se reintenta sin riesgo.
        limiteMs: servidorNuevo ? LIMITE_ESPERA_PEDIDO_MS : 0,
        items: items.map(({ producto, cantidad, sucursal: suc }) => ({
          productoId: producto.ID,
          producto: producto.Nombre,
          cantidad,
          ...(suc ? { sucursal: suc.id } : {}),
        })),
      };
      setErrorRegistroPedido('');
      setRegistrandoPedido(true);
      setEnvioPedido({ fase: 'enviando', url, enlaces });

      // 1) Sale la petición para anotar el pedido…
      let registro = crearPedidoCarrito(pedido);
      // 2) …y en este mismo toque se abre WhatsApp.
      if (servidorNuevo && !envio.whatsAppAbierto) {
        envio.whatsAppAbierto = true;
        abrirWhatsApp(url);
      }

      // Si falla por conexión (sin respuesta del servidor) se reintenta
      // solo, con el MISMO idEnvio: si el pedido sí había llegado, el
      // servidor contesta "ya lo tengo" y no lo duplica. El primer
      // reintento sale aunque la página esté atrás (la clienta en
      // WhatsApp); los demás esperan a que vuelva a la página.
      let reintentos = 0;
      for (;;) {
        try {
          await registro;
          break;
        } catch (err) {
          const aTiempo = () => Date.now() - envio.desde < LIMITE_REINTENTO_SOLO_MS;
          if (!esFallaDeConexion(err) || !servidorNuevo || reintentos >= 3 || !aTiempo()) throw err;
          reintentos += 1;
          if (reintentos > 1) await esperarPaginaALaVista();
          await pausa(1500 * reintentos);
          if (!aTiempo()) throw err; // la página durmió horas: ya no es seguro repetir solo
          registro = crearPedidoCarrito(pedido);
        }
      }
      envioRef.current = null;
      // Se quita del carrito SOLO lo que se envió (si mientras tanto la
      // clienta agregó algo más, eso se queda).
      const enviado = {};
      items.forEach((it) => { enviado[claveDeItem(it)] = it.cantidad; });
      setCarrito((prev) =>
        prev
          .map((it) => {
            const cuanto = enviado[claveDeItem(it)];
            return cuanto ? { ...it, cantidad: it.cantidad - cuanto } : it;
          })
          .filter((it) => it.cantidad > 0)
      );
      // Servidor "de antes": WhatsApp se abre hasta ahora, ya con el
      // pedido anotado (si el navegador lo bloquea, el aviso trae el botón).
      if (!envio.whatsAppAbierto) {
        envio.whatsAppAbierto = true;
        abrirWhatsApp(url);
      }
      // Si la clienta ya cerró el aviso, no se le vuelve a abrir.
      setEnvioPedido((previo) => (previo ? { ...previo, fase: 'listo' } : previo));
    } catch (err) {
      // El carrito NO se toca si algo falla, para que la clienta no tenga
      // que rehacer su pedido desde cero.
      const datos = (err && err.datos) || {};
      const yaSalioWhatsApp = !!(envio && envio.whatsAppAbierto);
      if (datos.sucursalNoDisponible) {
        // El catálogo de esta sucursal se apagó mientras la clienta pedía.
        setSucursalNoDisponible(true);
        setTipoErrorRegistro('cerrado');
        setErrorRegistroPedido(
          'Este catálogo ya no está disponible, así que tu pedido no quedó anotado.' +
            (yaSalioWhatsApp ? ' Si ya mandaste el mensaje de WhatsApp, ponte de acuerdo ahí mismo con quien te atiende.' : '')
        );
      } else if (datos.variasSucursales) {
        setTipoErrorRegistro('existencia');
        setErrorRegistroPedido(`${err.message} Revisa tu pedido: deja solo los productos de una sucursal.`);
      } else if (datos.sinExistencia) {
        // Catálogo de sucursal: alguien más se llevó piezas mientras tanto.
        // No se registró nada. Se ajusta el pedido a lo que de verdad queda
        // (o se quita el producto si ya no queda nada) y se le pide
        // revisarlo antes de volver a enviarlo.
        const faltantes = Array.isArray(datos.faltantes) && datos.faltantes.length > 0
          ? datos.faltantes
          : [{ productoId: datos.productoId, disponible: datos.disponible }];
        const queda = {};
        faltantes.forEach((f) => { queda[`${f.productoId}|${f.sucursal || ''}`] = Number(f.disponible) || 0; });
        setCarrito((prev) =>
          prev
            .map((it) => {
              const id = claveDeItem(it);
              if (!(id in queda)) return it;
              return { ...it, producto: { ...it.producto, Stock: queda[id] }, cantidad: Math.min(it.cantidad, queda[id]) };
            })
            .filter((it) => it.cantidad > 0)
        );
        setTipoErrorRegistro('existencia');
        setErrorRegistroPedido(
          `${err.message} Ya ajustamos tu pedido a lo que queda: revísalo y vuelve a enviarlo.` +
            (yaSalioWhatsApp ? ' Se abrirá WhatsApp con el pedido corregido; el mensaje anterior ya no cuenta.' : '')
        );
        cargarProductos();
      } else {
        setTipoErrorRegistro('red');
        setErrorRegistroPedido(
          'No pudimos anotar tu pedido en la tienda (puede ser tu conexión a internet). Tu pedido sigue guardado aquí: dale "Reintentar".' +
            (yaSalioWhatsApp ? ' No hace falta volver a mandar el WhatsApp.' : '')
        );
      }
      setEnvioPedido({ fase: 'error', url, enlaces });
    } finally {
      enviandoRef.current = false;
      setRegistrandoPedido(false);
    }
  }

  // Se llama al darle "Continuar" dentro del modal del carrito.
  function handleContinuarCarrito() {
    setCarritoAbierto(false);
    if (clienteGuardado) {
      enviarPedidoPorWhatsApp(carrito, clienteGuardado);
    } else {
      setPidiendoDatosCarrito(true);
    }
  }

  // Se llama cuando el cliente confirma nombre/teléfono para el carrito
  // (primera vez que pide algo en este navegador).
  function handleConfirmarCarritoDatos({ nombre, telefono }) {
    setPidiendoDatosCarrito(false);

    guardarCliente({ nombre, telefono });
    setClienteGuardado({ nombre, telefono });

    enviarPedidoPorWhatsApp(carrito, { nombre, telefono });
  }

  // Botón "Reintentar" del aviso de error: usa el carrito y los datos del
  // cliente tal como se quedaron (ninguno de los dos se borra si falla el
  // registro), así que reintentar es volver a llamar a la misma función
  // con lo que ya se tenía. Si es el mismo pedido, WhatsApp no se abre
  // otra vez (ya se abrió; solo faltó anotarlo).
  function handleReintentarRegistroPedido() {
    if (clienteGuardado) enviarPedidoPorWhatsApp(carrito, clienteGuardado);
  }

  // "Revisar mi pedido" del aviso central: lo cierra y abre el carrito.
  function handleRevisarPedidoTrasError() {
    setEnvioPedido(null);
    setCarritoAbierto(true);
  }

  function handleCambiarDatos() {
    borrarClienteGuardado();
    setClienteGuardado(null);
  }

  // Letrero del catálogo de una sucursal (pedido por Claudia: "CATÁLOGO DE
  // SUCURSAL GRISELDA"). En el catálogo Global no se dibuja nada.
  const letreroSucursal = sucursal ? (
    <div className="sucursal-letrero" role="heading" aria-level="1">
      <span className="sucursal-letrero-fijo">Catálogo de sucursal</span>{' '}
      <strong className="sucursal-letrero-nombre">{sucursal.nombre}</strong>
    </div>
  ) : null;

  // ---- Aviso central del envío a WhatsApp (2026-10-05) ----
  // Pedido por Claudia: "avisar en medio que se está enviando el pedido a
  // WhatsApp, no solo arriba; tipo modal central". Tres momentos:
  // enviando → listo, o error. Siempre trae un botón para abrir WhatsApp a
  // mano, por si el navegador de la clienta no lo abrió solo. Va en una
  // constante porque se dibuja en todas las salidas de esta pantalla
  // (también si el catálogo se quedó sin productos o se apagó a medio envío).
  // (2026-10-09) Pedido de varias sucursales: un WhatsApp para cada una. El
  // primero se abre solo; los demás, con su botón (un navegador solo deja
  // abrir uno por toque).
  const variosWhatsApps = !!(envioPedido && Array.isArray(envioPedido.enlaces) && envioPedido.enlaces.length > 1);
  const masWhatsApps = variosWhatsApps ? (
    <div className="aviso-envio-varias" data-aviso-varias-sucursales>
      <p>
        Tu pedido es de <strong>{envioPedido.enlaces.length} sucursales</strong>. Se abrió el WhatsApp de{' '}
        <strong>{envioPedido.enlaces[0].etiqueta}</strong>; manda también el de cada una:
      </p>
      <div className="aviso-envio-botones">
        {envioPedido.enlaces.slice(1).map((e) => (
          <a key={e.url} className="btn btn-whatsapp" href={e.url} target="_blank" rel="noopener noreferrer" data-whatsapp-sucursal>
            📲 Enviar a {e.etiqueta}
          </a>
        ))}
      </div>
    </div>
  ) : null;
  // Aviso al querer agregar algo de otra sucursal.
  const avisoDeOtraSucursal = avisoOtraSucursal && sucursalDelCarrito ? (
    <div className="modal-overlay" onClick={() => setAvisoOtraSucursal(null)}>
      <div className="modal-box aviso-otra-sucursal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} data-aviso-otra-sucursal>
        <p className="modal-check" aria-hidden="true">🏪</p>
        <h3>Tu pedido es de la sucursal {sucursalDelCarrito.nombre}</h3>
        <p>
          Un pedido es de una sola sucursal. Para pedir <strong>{avisoOtraSucursal.producto.Nombre}</strong> de{' '}
          <strong>{avisoOtraSucursal.sucursalElegida.nombre}</strong>, primero manda tu pedido de {sucursalDelCarrito.nombre} y
          luego haz otro con {avisoOtraSucursal.sucursalElegida.nombre}.
        </p>
        <div className="aviso-envio-botones">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setAvisoOtraSucursal(null); setCarritoAbierto(true); }}
            data-aviso-ver-pedido
          >
            🛒 Ver y mandar mi pedido
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const a = avisoOtraSucursal;
              setAvisoOtraSucursal(null);
              handleAgregarCarrito(a.producto, a.cantidad, a.sucursalElegida, true);
            }}
            data-aviso-empezar-otro
          >
            Vaciar mi pedido y empezar uno de {avisoOtraSucursal.sucursalElegida.nombre}
          </button>
          <button type="button" className="link-button" onClick={() => setAvisoOtraSucursal(null)}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const avisoEnvio = envioPedido ? (
    <div
      className="modal-overlay"
      onClick={envioPedido.fase === 'enviando' ? undefined : () => setEnvioPedido(null)}
    >
      <div
        className={`modal-box aviso-envio aviso-envio-fase-${envioPedido.fase}`}
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        onClick={(e) => e.stopPropagation()}
      >
        {envioPedido.fase === 'enviando' && (
          <>
            <div className="aviso-envio-rueda" aria-hidden="true" />
            <h3>Enviando tu pedido a WhatsApp…</h3>
            <p>
              Se va a abrir WhatsApp con tu pedido ya escrito. Ahí solo dale <strong>Enviar</strong>.
            </p>
            {masWhatsApps}
            <p className="aviso-envio-nota">Estamos anotando tu pedido en la tienda…</p>
            <a className="link-button aviso-envio-link" href={envioPedido.url} target="_blank" rel="noopener noreferrer">
              ¿No se abrió WhatsApp? Tócalo aquí
            </a>
            <button type="button" className="link-button aviso-envio-cerrar" onClick={() => setEnvioPedido(null)}>
              Cerrar este aviso
            </button>
          </>
        )}

        {envioPedido.fase === 'listo' && (
          <>
            <p className="modal-check" aria-hidden="true">✅</p>
            <h3>¡Tu pedido quedó anotado!</h3>
            <p>
              Si todavía no lo haces, dale <strong>Enviar</strong> al mensaje en WhatsApp para que te atiendan.
            </p>
            {masWhatsApps}
            <div className="aviso-envio-botones">
              <a className="btn btn-whatsapp" href={envioPedido.url} target="_blank" rel="noopener noreferrer">
                📲 Abrir WhatsApp{variosWhatsApps ? ` (${envioPedido.enlaces[0].etiqueta})` : ''}
              </a>
              <button type="button" className="btn btn-secondary" onClick={() => setEnvioPedido(null)}>
                Seguir viendo el catálogo
              </button>
            </div>
          </>
        )}

        {envioPedido.fase === 'error' && (
          <>
            <p className="modal-check" aria-hidden="true">⚠️</p>
            <h3>Tu pedido todavía no queda anotado</h3>
            <p className="aviso-envio-error">{errorRegistroPedido}</p>
            <div className="aviso-envio-botones">
              {tipoErrorRegistro === 'existencia' && carrito.length > 0 && (
                <button type="button" className="btn btn-primary" onClick={handleRevisarPedidoTrasError}>
                  🛒 Revisar mi pedido
                </button>
              )}
              {tipoErrorRegistro === 'red' && (
                <button type="button" className="btn btn-primary" onClick={handleReintentarRegistroPedido}>
                  🔄 Reintentar
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setEnvioPedido(null)}>
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  if (estado === 'cargando') return <p className="info-msg">Cargando catálogo…</p>;
  if (estado === 'error') {
    return (
      <div className="catalogo-error-carga">
        <p className="info-msg aviso">
          No se pudo cargar el catálogo — puede ser que se haya perdido la conexión un momento.
          Se está intentando de nuevo solo; si tarda mucho, dale clic a "Actualizar".
        </p>
        <button type="button" className="btn btn-secondary" onClick={cargarProductos}>
          🔄 Actualizar
        </button>
      </div>
    );
  }
  // El link es de una sucursal que ya no existe, está inhabilitada o tiene
  // su catálogo apagado: se dice claro, en vez de enseñar otro catálogo.
  if (sucursalNoDisponible) {
    return (
      <>
        {avisoEnvio}
        <div className="catalogo-error-carga">
          <p className="info-msg aviso">
            {errorRegistroPedido || 'Este catálogo ya no está disponible.'} Pídele el link nuevo a quien te lo compartió, o
            entra al catálogo general.
          </p>
          <a className="btn btn-secondary" href="/">Ver el catálogo general</a>
        </div>
      </>
    );
  }
  if (productos.length === 0) {
    return (
      <>
        {avisoEnvio}
        {letreroSucursal}
        <p className="info-msg">
          {sucursal ? 'Esta sucursal aún no tiene productos disponibles.' : 'Aún no hay productos disponibles.'}
        </p>
      </>
    );
  }

  const totalProductosEnCarrito = carrito.length;
  const grupos = agruparPorCategoria(productos);
  // Bug 10 (Ofertas, 2026-09): un producto en oferta aparece AQUÍ y TAMBIÉN
  // en su categoría normal de más abajo — no se quita de su categoría, la
  // zona de Ofertas es solo un acceso rápido a lo más llamativo.
  //
  // Arreglo (2026-09-23, pedido por Claudia): "productos" ya viene agrupado
  // por categoría (ver ordenarProductos_ en Code.gs), así que si se
  // filtraba directo de ahí, el orden dentro de Ofertas terminaba siendo
  // "por categoría" y no "por qué tan reciente es" — un producto nuevo en
  // una categoría que cae más adelante en esa lista podía verse hasta el
  // fondo del carrusel aunque fuera el más nuevo de todos. Aquí sí se
  // reordena por fecha de creación, de más nuevo a más viejo, sin importar
  // la categoría de cada uno.
  //
  // Orden a mano (2026-10-01, P11): si en "Orden del catálogo" se acomodó
  // el carrusel de Ofertas, se respeta ESE orden; las ofertas nuevas que
  // todavía no se han acomodado van al principio (la más nueva primero),
  // para que una oferta recién puesta nunca quede escondida al fondo. La
  // MISMA regla se usa en el Dashboard ("ordenarOfertas").
  const posicionOferta = (p) => {
    const i = ofertasOrden.indexOf(String(p.ID));
    return i === -1 ? -1 : i;
  };
  const productosEnOferta = productos
    .filter((p) => obtenerInfoOferta(p).enOferta)
    .slice()
    .sort((a, b) => {
      const pa = posicionOferta(a);
      const pb = posicionOferta(b);
      if (pa === -1 && pb === -1) return new Date(b.FechaCreacion) - new Date(a.FechaCreacion);
      if (pa === -1) return -1;
      if (pb === -1) return 1;
      return pa - pb;
    });
  const grupoAbierto = vista.tipo === 'categoria' ? grupos.find((g) => g.nombre === vista.nombre) : null;

  // ---- Buscador y filtros (P9) ----
  const opcionesCategoria = grupos.map((g) => g.nombre);
  const opcionesMarca = valoresDistintos(productos, 'Marca');
  const opcionesColor = valoresDistintos(productos, 'Color');
  const textoBuscado = normalizarBusqueda(busqueda);
  const precioMinimo = filtros.precioMin === '' ? null : Number(filtros.precioMin);
  const precioMaximo = filtros.precioMax === '' ? null : Number(filtros.precioMax);
  const cantidadFiltrosActivos =
    (filtros.categoria ? 1 : 0) +
    (filtros.marca ? 1 : 0) +
    (filtros.color ? 1 : 0) +
    (precioMinimo !== null || precioMaximo !== null ? 1 : 0) +
    (filtros.soloOfertas ? 1 : 0);
  const buscando = textoBuscado !== '' || cantidadFiltrosActivos > 0;

  function puntajeBusqueda(p) {
    if (!textoBuscado) return 0;
    const nombre = normalizarBusqueda(p.Nombre);
    if (nombre.startsWith(textoBuscado)) return 3;
    if (nombre.includes(textoBuscado)) return 2;
    return 1; // coincidió en otro campo (categoría, marca, color, descripción…)
  }
  const resultados = buscando
    ? productos
        .filter((p) => {
          if (textoBuscado) {
            const donde = normalizarBusqueda(
              [p.Nombre, p.Categoria, p.Marca, p.Color, p.Talla, p.Descripcion, p.CodigoPropio].join(' ')
            );
            if (!textoBuscado.split(/\s+/).every((palabra) => donde.includes(palabra))) return false;
          }
          if (filtros.categoria && (String(p.Categoria || '').trim() || 'Otros') !== filtros.categoria) return false;
          if (filtros.marca && normalizarBusqueda(p.Marca) !== filtros.marca) return false;
          if (filtros.color && normalizarBusqueda(p.Color) !== filtros.color) return false;
          const precio = precioQueSeCobra(p);
          if (precioMinimo !== null && precio < precioMinimo) return false;
          if (precioMaximo !== null && precio > precioMaximo) return false;
          if (filtros.soloOfertas && !obtenerInfoOferta(p).enOferta) return false;
          return true;
        })
        .sort((a, b) => {
          if (ordenResultados === 'precioMenor') return precioQueSeCobra(a) - precioQueSeCobra(b);
          if (ordenResultados === 'precioMayor') return precioQueSeCobra(b) - precioQueSeCobra(a);
          if (ordenResultados === 'nuevos') return new Date(b.FechaCreacion) - new Date(a.FechaCreacion);
          return puntajeBusqueda(b) - puntajeBusqueda(a);
        })
    : [];

  function cambiarFiltro(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
  }
  function limpiarBusqueda() {
    setBusqueda('');
    setFiltros(FILTROS_VACIOS);
    setOrdenResultados('relevancia');
  }

  // Chiquita función de ayuda para no repetir el mismo bloque de
  // ProductCard en las tres vistas (categorías, una categoría, todo).
  function tarjetas(listaProductos) {
    return listaProductos.map((p) => (
      <ProductCard
        key={p.ID}
        producto={p}
        onAgregarCarrito={handleAgregarCarrito}
        escogerSucursal={eligeSucursal}
        sucursalPreferida={sucursalDelCarrito ? sucursalDelCarrito.id : ''}
      />
    ));
  }

  return (
    <>
      {letreroSucursal}

      {clienteGuardado && (
        <p className="cliente-actual">
          Vas a pedir como <strong>{clienteGuardado.nombre}</strong> ({clienteGuardado.telefono}).{' '}
          <button type="button" className="link-button" onClick={handleCambiarDatos}>
            ¿No eres tú? Cambiar datos
          </button>
        </p>
      )}

      {/* Si el registro falla, se avisa claramente y se ofrece reintentar
          con el mismo carrito (que NO se borra en ese caso) en vez de
          fallar en silencio. Mientras el aviso central está abierto, el
          error se ve AHÍ; este de arriba queda como recordatorio si la
          clienta cierra el aviso sin resolverlo. */}
      {errorRegistroPedido && !envioPedido && (
        <div className="catalogo-error-carga">
          <p className="info-msg error">{errorRegistroPedido}</p>
          {tipoErrorRegistro === 'red' ? (
            <button type="button" className="btn btn-secondary" onClick={handleReintentarRegistroPedido}>
              🔄 Reintentar
            </button>
          ) : (
            carrito.length > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => setCarritoAbierto(true)}>
                🛒 Revisar mi pedido
              </button>
            )
          )}
        </div>
      )}

      {/* ---- Buscador y filtros (2026-10-01, pendiente P9) — arriba de
          todas las vistas. ---- */}
      <div className="catalogo-buscador">
        <div className="catalogo-buscador-fila">
          <div className="catalogo-buscador-campo">
            <span className="catalogo-buscador-icono" aria-hidden="true">🔍</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto, categoría, marca, color…"
              aria-label="Buscar en el catálogo"
            />
            {busqueda && (
              <button type="button" className="catalogo-buscador-borrar" onClick={() => setBusqueda('')} aria-label="Borrar búsqueda">
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            className={`btn btn-secondary catalogo-filtros-btn${cantidadFiltrosActivos > 0 ? ' activo' : ''}`}
            onClick={() => setFiltrosAbiertos((v) => !v)}
            aria-expanded={filtrosAbiertos}
          >
            ⚙️ Filtros{cantidadFiltrosActivos > 0 ? ` (${cantidadFiltrosActivos})` : ''}
          </button>
        </div>
        {filtrosAbiertos && (
          <div className="catalogo-filtros-panel">
            <label>
              Categoría
              <select value={filtros.categoria} onChange={(e) => cambiarFiltro('categoria', e.target.value)}>
                <option value="">Todas</option>
                {opcionesCategoria.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {opcionesMarca.length > 0 && (
              <label>
                Marca
                <select value={filtros.marca} onChange={(e) => cambiarFiltro('marca', e.target.value)}>
                  <option value="">Todas</option>
                  {opcionesMarca.map((m) => <option key={m.clave} value={m.clave}>{m.texto}</option>)}
                </select>
              </label>
            )}
            {opcionesColor.length > 0 && (
              <label>
                Color
                <select value={filtros.color} onChange={(e) => cambiarFiltro('color', e.target.value)}>
                  <option value="">Todos</option>
                  {opcionesColor.map((c) => <option key={c.clave} value={c.clave}>{c.texto}</option>)}
                </select>
              </label>
            )}
            <label>
              Precio desde
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={filtros.precioMin}
                onChange={(e) => cambiarFiltro('precioMin', e.target.value)}
                placeholder="$ mín."
              />
            </label>
            <label>
              hasta
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={filtros.precioMax}
                onChange={(e) => cambiarFiltro('precioMax', e.target.value)}
                placeholder="$ máx."
              />
            </label>
            {productosEnOferta.length > 0 && (
              <label className="catalogo-filtro-check">
                <input
                  type="checkbox"
                  checked={filtros.soloOfertas}
                  onChange={(e) => cambiarFiltro('soloOfertas', e.target.checked)}
                />
                Solo ofertas 🔥
              </label>
            )}
          </div>
        )}
      </div>

      {/* ---- Resultados de búsqueda/filtros: reemplazan a la vista normal
          mientras haya algo escrito o algún filtro puesto. ---- */}
      {buscando && (
        <>
          <div className="catalogo-resultados-encabezado">
            <h2 className="categoria-titulo-completo">
              {resultados.length} resultado{resultados.length === 1 ? '' : 's'}
            </h2>
            <label className="catalogo-orden">
              Ordenar:
              <select value={ordenResultados} onChange={(e) => setOrdenResultados(e.target.value)}>
                <option value="relevancia">Más parecidos</option>
                <option value="precioMenor">Precio: menor a mayor</option>
                <option value="precioMayor">Precio: mayor a menor</option>
                <option value="nuevos">Más nuevos</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={limpiarBusqueda}>
              ✕ Quitar búsqueda y filtros
            </button>
          </div>
          {resultados.length > 0 ? (
            <div className="catalog-grid">{tarjetas(resultados)}</div>
          ) : (
            <p className="info-msg">
              No encontramos productos con eso. Prueba con otra palabra o quita algún filtro.
            </p>
          )}
        </>
      )}

      {/* ---- Vista normal: categorías, cada una en su propia cajita con
          su propio carrusel horizontal ---- */}
      {!buscando && vista.tipo === 'categorias' && (
        <>
          <div className="catalogo-barra-superior">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setVista({ tipo: 'todo' })}
            >
                         🗂️ Ver catálogo completo
            </button>
          </div>

          {productosEnOferta.length > 0 && !ofertasOculta && (
            <section className="categoria-seccion categoria-seccion-ofertas">
              <h2 className="categoria-titulo categoria-titulo-ofertas">🔥 {ofertasTitulo || 'Ofertas'}</h2>
              <CategoriaCarrusel>{tarjetas(productosEnOferta)}</CategoriaCarrusel>
            </section>
          )}

          {grupos.map((grupo) => (
            <section key={grupo.nombre} className="categoria-seccion">
              <TituloCategoria nombre={grupo.nombre} className="categoria-titulo" />
              <CategoriaCarrusel>{tarjetas(grupo.productos)}</CategoriaCarrusel>
              <div className="categoria-pie">
                <button
                  type="button"
                  className="link-button categoria-ver-mas"
                  onClick={() => setVista({ tipo: 'categoria', nombre: grupo.nombre })}
                >
                  Ver más de {grupo.nombre} →
                </button>
              </div>
            </section>
          ))}
        </>
      )}

      {/* ---- Vista de UNA categoría abierta completa, en cuadrícula ---- */}
      {!buscando && vista.tipo === 'categoria' && (
        <>
          <button
            type="button"
            className="btn btn-secondary volver-btn"
            onClick={() => setVista({ tipo: 'categorias' })}
          >
            ← Volver a categorías
          </button>
          <TituloCategoria nombre={vista.nombre} className="categoria-titulo-completo" />
          {grupoAbierto && grupoAbierto.productos.length > 0 ? (
            <div className="catalog-grid">{tarjetas(grupoAbierto.productos)}</div>
          ) : (
            <p className="info-msg">Ya no hay productos disponibles en esta categoría.</p>
          )}
        </>
      )}

      {/* ---- Vista del catálogo completo, todas las categorías mezcladas ---- */}
      {!buscando && vista.tipo === 'todo' && (
        <>
          <button
            type="button"
            className="btn btn-secondary volver-btn"
            onClick={() => setVista({ tipo: 'categorias' })}
          >
            ← Volver a categorías
          </button>
          <h2 className="categoria-titulo-completo">Catálogo completo</h2>
          <div className="catalog-grid">{tarjetas(productos)}</div>
        </>
      )}

      {/* Oculto mientras se está registrando un pedido (2026-09-30): el
          carrito modal ya se cerró en ese momento, así que no hay nada que
          "reabrir" — y evita que alguien le dé doble clic por accidente
          mientras espera. */}
      {avisoEnvio}
      {avisoDeOtraSucursal}

      {/* El botón del carrito se esconde mientras se envía y mientras el
          aviso central está abierto (flota por encima de todo y estorbaba). */}
      {totalProductosEnCarrito > 0 && !registrandoPedido && !envioPedido && (
        <button type="button" className="carrito-flotante" onClick={() => setCarritoAbierto(true)}>
          🛒 {totalProductosEnCarrito} producto{totalProductosEnCarrito === 1 ? '' : 's'}
          {sucursalDelCarrito ? ` de ${sucursalDelCarrito.nombre}` : ''} — Ver pedido
        </button>
      )}

      {carritoAbierto && (
        <CarritoModal
          items={carrito}
          onQuitar={handleQuitarDelCarrito}
          onCambiarCantidad={handleCambiarCantidadCarrito}
          onClose={() => setCarritoAbierto(false)}
          onContinuar={handleContinuarCarrito}
        />
      )}

      {pidiendoDatosCarrito && (
        <SolicitudModal
          items={carrito}
          onClose={() => setPidiendoDatosCarrito(false)}
          onConfirm={handleConfirmarCarritoDatos}
        />
      )}
    </>
  );
}
