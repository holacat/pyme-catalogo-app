import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  login,
  // Arreglo de rendimiento (2026-09-25): `cargarPanelCompleto` reemplaza a
  // las 8 llamadas sueltas que antes se usaban aquí (listarProductosAdmin,
  // listarPedidos, obtenerAlertas, listarOpciones, listarMovimientos,
  // listarBitacora, listarUsuarios, listarTransferencias) — todas siguen
  // existiendo en api.js/Code.gs por si algún día hacen falta sueltas, pero
  // el Dashboard ya no las usa una por una.
  cargarPanelCompleto,
  consultarMarcaDeCambios,
  agregarOpcion,
  eliminarOpcion,
  actualizarStock,
  actualizarPedido,
  actualizarPedidosJuntos,
  crearProducto,
  actualizarProducto,
  cambiarDisponibilidad,
  eliminarProducto,
    actualizarOrdenMultiple,
  actualizarOrdenCategorias,
  actualizarOrdenOfertas,
  guardarOrdenSucursal,
  renombrarZonaOfertas,
  quitarTodasLasOfertas,
  restaurarCambio,
  listarEntradasSalidas,
  // Tickets (2026-10-06).
  crearTickets,
  actualizarTicket,
  rehacerTicket,
  cancelarTicket,
  guardarConfiguracionTickets,
  renombrarCategoria,
  eliminarCategoria,
  crearUsuario,
  actualizarUsuario,
  cambiarContrasenaUsuario,
  inhabilitarUsuario,
  habilitarUsuario,
  analiticaVentas,
  listarPermisos,
  actualizarPermisoRol,
  actualizarPermisoUsuario,
  solicitarTransferencia,
  ofrecerTransferencia,
  responderTransferencia,
  marcarTransferenciaVista,
  asignarStockDueno,
  // NUEVO (2026-09-30, candado de Reembolsos → solicitud/aprobación):
  // estas dos funciones todavía no existen en api.js — hay que agregarlas
  // a mano ahí (ver instrucciones aparte), copiando exactamente el mismo
  // patrón de "responderTransferencia"/"marcarTransferenciaVista" que ya
  // están arriba en este mismo import.
  responderSolicitudReembolso,
  marcarSolicitudReembolsoVista,
  // Catálogos por sucursal (2026-10-02).
  actualizarCatalogoPropio,
  actualizarCatalogoSucursal,
} from '../api.js';
import ImageUploader from '../components/ImageUploader.jsx';
import ImageLightbox from '../components/ImageLightbox.jsx';
// Descargas en Excel y PDF (2026-10-05). Archivo nuevo: src/exportar.js
import { descargarExcel, descargarPDF, fechaParaArchivo, crearQR, descargarTicketPDF } from '../exportar.js';

// Un producto puede tener Disponible guardado como booleano real (true/false)
// o como texto ("TRUE"/"SI") si alguien lo escribió a mano en el Sheet. Esta
// función lo normaliza, igual que hace el backend para el catálogo público.
function esProductoVisible(producto) {
  return (
    producto.Disponible === true ||
    String(producto.Disponible).toUpperCase() === 'TRUE' ||
    String(producto.Disponible).toUpperCase() === 'SI'
  );
}

// Toma solo la primera foto de la lista (separada por "|") para mostrarla
// como miniatura chiquita en la tabla de Stock.
function primeraFoto(fotoUrl) {
  return String(fotoUrl || '').split('|').map((u) => u.trim()).filter(Boolean)[0] || '';
}

// Convierte a texto de forma segura. OJO: NUNCA usar "valor || ''" para
// esto — si `valor` es el número 0 (por ejemplo un teléfono guardado sin
// querer como número 0), "0 || ''" da '' por error, porque 0 cuenta como
// "falso" en JavaScript. Esta función sí distingue "no hay valor" de "0".
function textoSeguro(valor) {
  return valor === undefined || valor === null ? '' : String(valor);
}

// Texto viejo que se guardaba automáticamente antes en los pedidos hechos
// desde el catálogo. Ya no se usa, pero pedidos antiguos todavía lo tienen
// guardado — lo tratamos igual que "sin notas" para que se vean limpios.
const NOTA_VIEJA_AUTOMATICA = 'Generado desde el catálogo web';

function notasIniciales(pedido) {
  const valor = textoSeguro(pedido.Notas);
  return valor === NOTA_VIEJA_AUTOMATICA ? '' : valor;
}

// Evita que se puedan escribir números absurdamente grandes en los campos
// de precio/stock/cantidad (por ejemplo, llenar el cuadro de puros ceros y
// que la app se rompa). Corta el texto a una cantidad máxima de dígitos,
// dejando escribir el punto decimal para precios.
// Nota (2026-09-24, bug real reportado por Claudia): estos campos usaban
// <input type="number">, que tiene una rareza conocida del navegador — si
// en algún momento el texto que llevas escrito deja de ser un número
// "válido" (por ejemplo al escribir letras, o al mantener una tecla
// presionada y presionar otra al mismo tiempo), el navegador puede
// devolver el valor como VACÍO en vez de lo que en verdad está escrito en
// pantalla. Como este recorte se calcula sobre ese valor (potencialmente
// vacío), el límite se "olvidaba" momentáneamente y luego dejaba escribir
// de más. Por eso estos campos ahora son <input type="text"
// inputMode="numeric|decimal"> (se ve y se comporta casi igual, con
// teclado numérico en el celular) en vez de type="number" — así el valor
// que llega aquí siempre es el texto real, nunca se vacía solo, y este
// recorte sí puede confiar en él siempre.
function limitarDigitos(valorTexto, maxDigitos) {
  const texto = String(valorTexto);
  const partes = texto.split('.');
  const entero = partes[0].replace(/[^0-9]/g, '').slice(0, maxDigitos);
  const decimal = partes.length > 1 ? '.' + partes[1].replace(/[^0-9]/g, '').slice(0, 2) : '';
  return entero + decimal;
}

// Igual, pero para teléfonos: solo dígitos, sin punto decimal.
function limitarTelefono(valorTexto) {
  return String(valorTexto).replace(/[^0-9]/g, '').slice(0, 13);
}

// Fecha y hora en la que se dio de alta un producto. Van en dos columnas
// separadas ("Fecha agregado" / "Hora agregado"), por eso son dos funciones.
function formatearFechaSolo(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-MX');
}

function formatearHoraSolo(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// ---- Helpers de fecha para la pestaña "📈 Analítica de ventas" ----
// Convierte una fecha a texto "YYYY-MM-DD" usando la fecha LOCAL del
// navegador (no UTC) — con toISOString() el día se podía recorrer si
// Claudia lo usa por la noche, porque JavaScript lo pasa a UTC primero.
function fechaISOLocal(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

// Lunes de la semana de `fecha` (semana de lunes a domingo).
function inicioDeSemana(fecha) {
  const copia = new Date(fecha);
  const diaSemana = copia.getDay(); // 0 = domingo, 1 = lunes, ...
  const diasDesdeElLunes = (diaSemana + 6) % 7;
  copia.setDate(copia.getDate() - diasDesdeElLunes);
  return copia;
}

function inicioDeMes(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}

// Nombre de categoría tal como se muestra en toda la app: si el producto no
// tiene categoría guardada, se muestra como "Otros" (igual que el catálogo
// público y el backend).
function categoriaDeProducto(producto) {
  return String(producto?.Categoria || '').trim() || 'Otros';
}

// Dice si un producto "hace match" con lo que Claudia escribió en el
// buscador de la pestaña Stock: revisa el texto (sin importar mayúsculas o
// minúsculas) dentro del nombre, la categoría, el código propio, el precio
// o el stock.
function coincideBusquedaStock(producto, textoBusqueda) {
  const texto = textoBusqueda.trim().toLowerCase();
  if (!texto) return true;

  // Si Claudia escribe "$" al inicio (por ejemplo "$150"), buscamos
  // ÚNICAMENTE en el precio. Así puede buscar por precio sin que se
  // confunda con un código o una cantidad de stock que tenga el mismo
  // número.
  if (texto.startsWith('$')) {
    const textoPrecio = texto.slice(1).trim();
    if (!textoPrecio) return true;
    return String(producto.Precio ?? '').toLowerCase().includes(textoPrecio);
  }

  const campos = [
    producto.Nombre,
    categoriaDeProducto(producto),
    producto.CodigoPropio,
    producto.Stock,
  ];
  return campos.some((campo) => String(campo ?? '').toLowerCase().includes(texto));
}

// Valor "comparable" de un producto según la columna por la que se está
// ordenando la tabla de Stock (al darle clic a un encabezado).
function valorOrdenableStock(producto, campo) {
  switch (campo) {
    case 'fecha':
      return new Date(producto.FechaCreacion || 0).getTime();
    case 'hora': {
      // Hora del día en que se agregó (sin importar qué día fue): sirve
      // para ordenar la columna "Hora agregado" de más temprano a más
      // tarde o al revés. Los que no tienen fecha se van al principio.
      const fecha = new Date(producto.FechaCreacion || '');
      if (Number.isNaN(fecha.getTime())) return -1;
      return fecha.getHours() * 3600 + fecha.getMinutes() * 60 + fecha.getSeconds();
    }
    case 'nombre':
      return String(producto.Nombre || '').toLowerCase();
    case 'categoria':
      return categoriaDeProducto(producto).toLowerCase();
    case 'codigo':
      return String(producto.CodigoPropio || '').toLowerCase();
    case 'precio':
      return Number(producto.Precio) || 0;
    case 'stock':
      return Number(producto.Stock) || 0;
    default:
      return 0;
  }
}

// Acomoda la lista de productos según el encabezado que Claudia haya
// elegido. Si no eligió ninguno (orden === null), la deja tal cual —ahí es
// cuando se ven los más nuevos primero, como siempre.
function ordenarProductosStock(lista, orden) {
  if (!orden) return lista;
  const copia = lista.slice();
  copia.sort((a, b) => {
    const valorA = valorOrdenableStock(a, orden.campo);
    const valorB = valorOrdenableStock(b, orden.campo);
    if (valorA < valorB) return -1 * orden.direccion;
    if (valorA > valorB) return 1 * orden.direccion;
    return 0;
  });
  return copia;
}

// Lo que se muestra junto al nombre de la columna, para que Claudia vea de
// un vistazo si esa columna está ordenando la tabla y en qué dirección.
//
// Arreglo (2026-09-29, pedido por Claudia): antes, la columna que NO
// estaba ordenando la tabla mostraba una doble flecha "↕" — pidió
// cambiarla por un punto verde (el mismo verde de la marca), del mismo
// tamaño, porque es más fácil de reconocer de un vistazo "no le hemos
// movido el orden a esto" que una flecha que apunta para los dos lados.
// Las flechas ▲/▼ de la columna que SÍ está ordenando activamente se
// quedan exactamente igual que antes — Claudia solo pidió cambiar la de
// "sin ordenar", no esas.
function indicadorOrdenStock(orden, campo) {
  if (!orden || orden.campo !== campo) {
    return <span className="orden-header-punto" aria-hidden="true" />;
  }
  return orden.direccion === 1 ? '▲' : '▼';
}

// Bajado de 9 a un límite razonable (2026-09-23, pedido por Claudia): con 9
// dígitos se podía escribir Stock=111111111 o Precio=$111,111,111 y con eso
// se rompía el catálogo — 6 y 7 dígitos ya cubren de sobra un inventario y
// precios reales de una PyME, y el backend (Code.gs, PRECIO_MAXIMO_ /
// STOCK_MAXIMO_) aplica el mismo tope como respaldo aunque no se use este
// formulario.
const MAX_DIGITOS_STOCK = 6; // hasta 999,999 piezas
const MAX_DIGITOS_PRECIO = 7; // hasta $9,999,999 (con hasta 2 decimales)
const MAX_DIGITOS_CANTIDAD = 4; // hasta 9,999 piezas por pedido

// Límites estándar de caracteres para los campos de texto de "Agregar/editar
// producto" (2026-09-24, pedido por Claudia: varios de estos campos —
// Categoría, Marca, Talla, Color — no tenían NINGÚN límite, dejando pasar
// textos absurdamente largos que rompían el catálogo y la tabla de Stock).
// El mismo tope se aplica también en el servidor (Code.gs, recortarTexto_)
// como respaldo, igual que ya pasa con Stock/Precio.
const MAX_CARACTERES_NOMBRE = 80;
const MAX_CARACTERES_CODIGO = 30;
const MAX_CARACTERES_CATEGORIA = 40;
const MAX_CARACTERES_MARCA = 40;
const MAX_CARACTERES_TALLA = 20;
const MAX_CARACTERES_COLOR = 30;
const MAX_CARACTERES_DESCRIPCION = 250;

// Cada cuánto revisa el Dashboard, en segundo plano, si hay algo nuevo
// (milisegundos).
//
// Rediseño (2026-10-06, reportado por Claudia: cambiar el estado de un pedido
// tardó casi un minuto y el panel "ya no actúa rápido"). Antes, cada 6
// segundos se pedían TODAS las hojas completas, hubiera cambios o no, y sin
// esperar a que contestara la petición anterior: con varias pantallas
// abiertas las peticiones se encimaban y el servidor se atoraba. Ahora:
//   - cada 6 s solo se pregunta "¿hay algo nuevo?" (la "marca de cambios":
//     el servidor la contesta casi al instante, sin abrir la hoja de cálculo);
//   - los datos completos se piden solo cuando la marca cambió, o cada
//     minuto por si alguien escribió directo en la hoja de Google;
//   - nunca se manda una petición mientras la anterior no ha contestado, ni
//     mientras se está guardando algo;
//   - con la pestaña del navegador en segundo plano se revisa mucho menos.
const INTERVALO_REFRESCO_MS = 6000;
const REFRESCO_COMPLETO_MS = 60000;
const REFRESCO_PESTANA_OCULTA_MS = 30000;
// Tope de espera de la pregunta "¿hay algo nuevo?".
const LIMITE_MARCA_MS = 15000;
// Una petición que lleva más de esto sin contestar se da por perdida (para
// que una sola petición colgada no deje al panel sin refrescarse nunca más).
const PETICION_PERDIDA_MS = 90000;
// …pero si todavía no hay nada en pantalla, o la pantalla quedó atrasada
// después de guardar, no se espera tanto para volver a intentar.
const PETICION_PERDIDA_SIN_DATOS_MS = 15000;
const PETICION_PERDIDA_TRAS_GUARDAR_MS = 30000;
// Después de guardar algo, el botón espera a lo mucho esto a que llegue la
// recarga de los datos; pasado ese tiempo suelta el botón y la recarga sigue
// llegando por su cuenta.
const ESPERA_MAXIMA_RECARGA_TRAS_GUARDAR_MS = 15000;
const AVISO_PONIENDOSE_AL_DIA =
  '⏳ La pantalla se está poniendo al día: el servidor está tardando en mandar los datos. Si acabas de guardar algo, eso ya quedó guardado — no lo repitas. Este aviso se quita solo.';

// Bug real (2026-09-24, reportado por Claudia: "actualicé un estatus de un
// pedido y el círculo de carga se quedó cargando más de 1 minuto, hasta en
// otras pestañas donde no había hecho cambios, aunque el cambio ya se había
// aplicado"). Google Apps Script a veces tarda mucho, y muy rara vez una
// petición se puede quedar "colgada" sin nunca contestar (ni éxito ni
// error) — si eso pasa, una promesa que nunca se resuelve hace que el
// círculo de carga se quede prendido PARA SIEMPRE, porque nada vuelve a
// apagarlo (y como el círculo es el mismo para toda la app, se ve
// "cargando" en cualquier pestaña, no solo en la que se usó).
// `conLimiteDeTiempo` pone un tope de tiempo a cualquier llamada al
// servidor: si no contesta en ese tiempo, la damos por fallida para que el
// círculo se apague, en vez de quedarse esperando para siempre sin saber
// qué pasó.
//
// Ajuste (2026-09-25, reportado por Claudia: el aviso de "tardó demasiado"
// la asustó porque sonaba a que algo se rompió, y además le tocó justo al
// ABRIR el panel — que de por sí siempre tarda más, porque pide 8 hojas de
// Google Sheets al mismo tiempo y, si Google Apps Script llevaba rato sin
// usarse, tarda extra en "despertar"). Por eso ahora hay DOS topes
// distintos, no uno solo:
//   - `TIEMPO_MAXIMO_ESPERA_MS`: para una acción puntual (guardar un
//     pedido, actualizar stock, etc.) — son peticiones chicas, así que 25s
//     ya es generoso.
//   - `TIEMPO_MAXIMO_CARGA_INICIAL_MS`: para cargar TODO el panel — se le
//     da mucho más margen (45s) precisamente porque es más pesada y porque
//     es la que se dispara justo al abrir, cuando Apps Script puede estar
//     "frío". Además su mensaje ya NO dice "revisa antes de repetirlo" (eso
//     solo tiene sentido cuando SE GUARDÓ algo) ni empieza con la palabra
//     "Error" — es solo un aviso tranquilo de que sigue intentando, y el
//     refresco automático de cada 6s lo va a resolver solo en cuanto la
//     conexión conteste (ver el `.then()` de `cargarTodo`, que limpia este
//     aviso apenas un refresco de fondo sí funciona).
const TIEMPO_MAXIMO_ESPERA_MS = 25000;
const TIEMPO_MAXIMO_CARGA_INICIAL_MS = 45000;
// El aviso amarillo de la "red de seguridad" del círculo de carga.
const AVISO_ESPERA_CANCELADA =
  'Una acción está tardando más de lo normal. Es posible que sí se haya guardado del lado del servidor — revisa antes de repetirla. En cuanto termine, este aviso se quita solo.';

// Ajuste (2026-09-29, reportado por Claudia): la primera vez que movió el
// Estado de un pedido a "En proceso" tardó mucho y salió el aviso de "tardó
// demasiado" — aunque el panel ya había cargado bien antes de eso. La razón
// es que Google Apps Script arranca las peticiones de LECTURA (`doGet`,
// usada para cargar el panel) y las de ESCRITURA (`doPost`, usada para
// guardar cualquier cambio) como dos "entradas" separadas: que `doGet` ya
// esté "caliente" no significa que `doPost` también lo esté, así que la
// PRIMERA escritura de toda la sesión puede tardar tanto como la carga
// inicial, aunque sea una acción chica. Antes esa primera escritura usaba
// el mismo tope corto de 25s que las demás (pensado ya para un servidor
// "caliente") y por eso saltaba el aviso de más antes de tiempo. Ahora, SOLO
// la primera escritura de la sesión usa el mismo margen generoso que la
// carga inicial (45s); de ahí en adelante, ya con `doPost` "caliente", se
// usa el tope normal de 25s.
let primeraEscrituraDeLaSesionYaHecha_ = false;
// (2026-10-06) Cuando se deja de esperar un guardado, la petición sigue su
// camino. Si el servidor por fin contesta, el Dashboard se entera por aquí y
// le dice a la persona, sin lugar a dudas, si se guardó o no (antes se
// quedaba el "es posible que sí se haya guardado" y había que adivinar).
let alTerminarTarde_ = null;
// Cambia cada vez que se inicia o se cierra sesión: un guardado que contesta
// tarde, cuando ya hay otra persona en esta misma pestaña, no le avisa nada
// a esa otra persona.
let numeroDeSesion_ = 0;
function conLimiteDeTiempo(promesa, etiqueta, opciones = {}) {
  const esLectura = !!opciones.esLectura;
  let ms = opciones.ms || TIEMPO_MAXIMO_ESPERA_MS;
  if (!esLectura && !primeraEscrituraDeLaSesionYaHecha_) {
    ms = Math.max(ms, TIEMPO_MAXIMO_CARGA_INICIAL_MS);
    primeraEscrituraDeLaSesionYaHecha_ = true;
  }
  let seDejoDeEsperar = false;
  if (!esLectura) {
    const sesionAlPedir = numeroDeSesion_;
    Promise.resolve(promesa).then(
      (respuesta) => {
        if (seDejoDeEsperar && alTerminarTarde_ && sesionAlPedir === numeroDeSesion_) alTerminarTarde_(etiqueta, true, respuesta);
      },
      (error) => {
        if (seDejoDeEsperar && alTerminarTarde_ && sesionAlPedir === numeroDeSesion_) alTerminarTarde_(etiqueta, false, error);
      }
    );
  }
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(() => {
        seDejoDeEsperar = true;
        const segundos = Math.round(ms / 1000);
        const error = new Error(
          esLectura
            ? `Sigue cargando… la conexión está tardando más de lo normal (más de ${segundos}s). Se va a seguir intentando solo — si tarda mucho más, dale clic a "Actualizar".`
            : `${etiqueta}: el servidor está tardando más de lo normal (más de ${segundos}s). Es posible que el cambio sí se haya guardado del lado del servidor — revisa antes de repetirlo. En cuanto el servidor conteste, aquí mismo te aviso si se guardó o no.`
        );
        error.esLimiteDeTiempo = true;
        reject(error);
      }, ms)
    ),
  ]);
}

// El estado con el que nace un pedido se llama "Pendiente" (2026-10-01,
// Claudia: "en lugar de que diga Sin solicitud que diga Pendiente... también
// en la hoja cámbialo"). Antes se llamaba "Sin solicitud". "Code.gs" ya
// guarda "Pendiente" en los pedidos nuevos y renombra los viejos en la hoja
// la primera vez que se abre el panel. Mientras eso pasa (o si alguna fila
// vieja se quedara con el nombre anterior), aquí los dos nombres se tratan
// como el MISMO estado: se cuentan juntos, se filtran juntos y siempre se
// muestran como "Pendiente".
// Valor especial del filtro por dueño de Stock (no puede chocar con un ID).
const FILTRO_SIN_DUENO = '\u0000sin-dueno';
const ESTADO_PENDIENTE = 'Pendiente';
const ESTADO_PENDIENTE_VIEJO = 'Sin solicitud';
const ESTADOS_PEDIDO = [ESTADO_PENDIENTE, 'En proceso', 'Pagado', 'Reembolsado', 'Cancelado'];

function estadoCanonicoPedido(estado) {
  return String(estado ?? '').trim() === ESTADO_PENDIENTE_VIEJO ? ESTADO_PENDIENTE : estado;
}
// Nombre que SE VE en pantalla de un Estado.
function etiquetaEstadoPedido(estado) {
  return estadoCanonicoPedido(estado);
}
// Para textos que llegan ya escritos desde el servidor (el detalle de la
// Bitácora de fechas anteriores al cambio de nombre, un mensaje de error):
// donde digan "Sin solicitud" se muestra "Pendiente".
function conEtiquetasDeEstado(texto) {
  return String(texto ?? '').replace(/Sin solicitud/g, ESTADO_PENDIENTE);
}

// Flujo de Estados de Pedido (2026-09-29, diseño explícito de Claudia):
// desde cada Estado solo se puede avanzar a los que se listan aquí — nunca
// saltarse pasos ni regresar a mano. Mismo mapa que ya se validaba en
// "Code.gs" (acción "actualizarPedido"); aquí se usa solo para que el menú
// desplegable de Estado de cada pedido NO OFREZCA siquiera las opciones
// que el servidor de todos modos rechazaría — así Claudia no se topa con
// el error después de elegir, ve directamente las opciones válidas.
//   - "Pendiente" → únicamente "En proceso".
//   - "En proceso" → "Pagado" o "Cancelado" (todavía no hay dinero de por
//     medio que revertir).
//   - "Pagado" → únicamente "Reembolsado" (para que el Cargo que revierte
//     el Abono SIEMPRE quede registrado en Estado de cuenta).
//   - "Cancelado" → puede regresar a "En proceso" (por si se le dio clic
//     por accidente) — seguro porque "En proceso" nunca registra dinero.
//   - "Reembolsado" sigue siendo final: a diferencia de "Cancelado", sí
//     registró un Cargo real, y reabrirlo necesitaría además deshacer ese
//     Cargo (no se pidió, y se presta a confusión contable).
const SIGUIENTE_ESTADO_VALIDO_PEDIDO = {
  [ESTADO_PENDIENTE]: [ESTADO_PENDIENTE, 'En proceso'],
  'En proceso': ['En proceso', 'Pagado', 'Cancelado'],
  Pagado: ['Pagado', 'Reembolsado'],
  Cancelado: ['Cancelado', 'En proceso'],
  Reembolsado: ['Reembolsado'],
};

// ---- Pedidos de hoy, pedidos nuevos y pedidos de varios productos (2026-10-06) ----
// ¿La fecha es de HOY (día del calendario de quien mira el panel)?
function esFechaDeHoy(valor) {
  if (!valor) return false;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return false;
  const hoy = new Date();
  return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth() && fecha.getDate() === hoy.getDate();
}

// Cuándo se hizo un pedido, en milisegundos (0 si no tiene fecha legible).
function momentoDelPedido(pedido) {
  const ms = pedido && pedido.Fecha ? new Date(pedido.Fecha).getTime() : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

// Cuando una clienta pide varios productos en el mismo pedido (el carrito
// del catálogo), cada producto queda en su propio renglón, todos con la
// misma fecha y hora. Aquí se juntan: mismos datos de clienta (teléfono; si
// no tiene, nombre), mismo catálogo (Global o la misma sucursal) y hechos
// con menos de SEGUNDOS_MISMO_PEDIDO de diferencia uno del siguiente.
// Regresa { porPedidoId: { id: compra }, compras: { clave: compra } }, donde
// compra = { clave, ids: [...], cliente }. Solo salen las de 2 o más renglones.
const SEGUNDOS_MISMO_PEDIDO = 90;
function juntarPedidosDeVariosProductos(pedidos) {
  const porClienta = {};
  pedidos.forEach((ped) => {
    const momento = momentoDelPedido(ped);
    if (!momento) return;
    const telefono = String(ped.Telefono === null || ped.Telefono === undefined ? '' : ped.Telefono).replace(/\D/g, '');
    const nombre = String(ped.Cliente || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const quien = telefono.length >= 7 ? `t:${telefono.slice(-10)}` : (nombre ? `n:${nombre}` : '');
    if (!quien) return;
    const llave = `${quien}|${String(ped.Sucursal || '').trim()}`;
    if (!porClienta[llave]) porClienta[llave] = [];
    porClienta[llave].push({ ped, momento });
  });
  const porPedidoId = {};
  const compras = {};
  Object.keys(porClienta).forEach((llave) => {
    const lista = porClienta[llave].sort((a, b) => a.momento - b.momento);
    let grupo = [];
    const cerrar = () => {
      if (grupo.length >= 2) {
        const compra = {
          clave: `${llave}|${grupo[0].momento}`,
          ids: grupo.map((x) => String(x.ped.ID)),
          cliente: String(grupo[0].ped.Cliente || '').trim() || 'Cliente sin nombre',
        };
        compras[compra.clave] = compra;
        compra.ids.forEach((id) => { porPedidoId[id] = compra; });
      }
      grupo = [];
    };
    lista.forEach((x) => {
      if (grupo.length > 0 && x.momento - grupo[grupo.length - 1].momento > SEGUNDOS_MISMO_PEDIDO * 1000) cerrar();
      grupo.push(x);
    });
    cerrar();
  });
  return { porPedidoId, compras };
}

// Hasta qué pedido ya vio esta persona la pestaña Pedidos (se guarda en el
// navegador, por cuenta): lo más nuevo que había la última vez que entró.
const LLAVE_PEDIDOS_VISTOS = 'pyme_pedidos_vistos_';
// Las alertas que esta persona ya vio (por cuenta, en este navegador).
const LLAVE_ALERTAS_VISTAS = 'pyme_alertas_vistas_';
// Cuánto dura el destello amarillo de un pedido nuevo (2 pasadas).
const DURACION_DESTELLO_PEDIDO_MS = 3800;

// Si el Estado guardado no es ninguno de los 5 conocidos (dato viejo o
// atípico), se muestran los 5 sin restringir — mismo respaldo que ya usa
// "Code.gs" para no atorar un dato raro.
function opcionesEstadoPedido(estadoActual) {
  const canonico = estadoCanonicoPedido(estadoActual);
  const lista = SIGUIENTE_ESTADO_VALIDO_PEDIDO[canonico];
  if (!lista) return ESTADOS_PEDIDO;
  // La opción "quedarse como está" conserva el valor EXACTO que tiene
  // guardado el pedido (si aún dijera "Sin solicitud", se manda tal cual y
  // el servidor lo entiende); en pantalla se ve como "Pendiente".
  return lista.map((opcion) => (opcion === canonico ? estadoActual : opcion));
}

// Ya no existe una sola "clave de administrador" compartida: cada persona
// inicia sesión con su propio usuario y contraseña (hoja "Usuarios"), y el
// servidor regresa un "token" de sesión que se guarda aquí, junto con el
// Rol y el Nombre de esa persona.
//
// Se guarda en localStorage (no sessionStorage) — cambio hecho el
// 2026-09-09 para arreglar un bug real en celular: algunos navegadores de
// Android, al abrir la cámara o la galería desde "Fotos del producto",
// pueden reciclar en segundo plano la pestaña del navegador (por memoria),
// y sessionStorage se perdía en ese momento aunque la sesión en el
// servidor seguía siendo válida — el resultado era el error confuso
// "Falta iniciar sesión" al subir la foto, estando ya con la sesión
// iniciada. localStorage no tiene ese problema porque no depende de que la
// pestaña siga "viva": sigue disponible aunque el navegador recicle la
// pestaña o se cierre por completo. La sesión sigue siendo segura porque
// de todas formas expira sola a las 12 horas (`DURACION_SESION_MS` en
// `Code.gs`) y se invalida al instante si un Administrador inhabilita esa
// cuenta — cerrar sesión con el botón del panel también la borra de
// inmediato. Lo único que cambia es que, en un celular/compu compartido,
// alguien tendría que cerrar sesión a propósito (o esperar a que expire)
// en vez de que se borre sola al cerrar la pestaña.
const TOKEN_KEY = 'pyme_sesion_token';
const ROL_KEY = 'pyme_sesion_rol';
const NOMBRE_KEY = 'pyme_sesion_nombre';
// Funcionalidad 1 (Admin Central, 2026-09): igual que ROL_KEY/NOMBRE_KEY,
// pero para saber si ESTA cuenta es el Admin Central (ver Code.gs) — se usa
// para mostrar el sello "👑 Admin Central" y para bloquear en la pantalla
// las acciones que el backend igual rechazaría (inhabilitar/cambiar el rol
// de otro Administrador), para que Claudia no le dé clic a algo que de
// todos modos le va a salir con error.
const ADMIN_CENTRAL_KEY = 'pyme_sesion_admin_central';

// Funcionalidad 2 (Stock personal, 2026-09): el ID de la propia cuenta.
const USUARIO_ID_KEY = 'pyme_sesion_usuario_id';

// Funcionalidad 1, Paso 2 (Permisos de pestañas, 2026-09): igual que las
// llaves de arriba, pero para guardar qué pestañas puede ver esta cuenta
// (calculado por el backend a partir de su Rol + cualquier excepción
// individual). Se guarda como texto JSON, ej. '{"stock":true,"usuarios":false,...}'.
const PERMISOS_KEY = 'pyme_sesion_permisos';
// Qué recuadros de avisos de arriba están minimizados (como puntito de
// color) en este navegador — ver "avisosMinimizados" en Dashboard.
const AVISOS_MINIMIZADOS_KEY = 'pyme_avisos_minimizados';
// Orden de las pestañas elegido por cada persona (2026-10-01, pendiente P13):
// se guarda en este navegador, una lista por cuenta (se le agrega el ID).
const ORDEN_PESTANAS_KEY = 'pyme_orden_pestanas_';

// Etapa 4, rediseño del candado de Pedidos (2026-09-28): llave del permiso
// especial "¿puede saltarse el candado de un pedido ajeno?" dentro de ese
// mismo objeto de permisos — MISMA llave que usa el backend
// (CLAVE_CANDADO_PEDIDOS en Code.gs). A propósito NO se agrega a
// PESTANAS_TODAS_PERMITIDAS (el respaldo de "algo salió mal, muestra todo"
// de abajo): si por lo que sea no se pudieron cargar los permisos reales,
// el candado se queda APAGADO por default (más seguro que fallar abierto).
const CLAVE_CANDADO_PEDIDOS = 'candadoPedidos';

// Candado nuevo, aparte del de arriba (2026-09-30, pedido por Claudia):
// llave del permiso especial "¿puede marcar un pedido como Reembolsado?" —
// MISMA llave que usa el backend (CLAVE_CANDADO_REEMBOLSOS en Code.gs).
// Igual que el de arriba, APAGADO por default si algo falla al cargar los
// permisos reales.
const CLAVE_CANDADO_REEMBOLSOS = 'candadoReembolsos';
// (2026-10-08) Permiso especial "Acomodar el catálogo general" (misma llave
// que CLAVE_ORDEN_GENERAL en Code.gs).
const CLAVE_ORDEN_GENERAL = 'ordenGeneral';

// Respaldo seguro: si por lo que sea no hay permisos guardados (una sesión
// vieja de antes de que existiera esta función, o un error al leerlos), se
// muestran TODAS las pestañas en vez de ninguna — así nadie se queda con el
// panel vacío por un problema de este tipo; el backend de todos modos sigue
// revisando el permiso real en cada acción.
const PESTANAS_TODAS_PERMITIDAS = {
  stock: true,
  pedidos: true,
  alertas: true,
  cuenta: true,
  bitacora: true,
  usuarios: true,
  analitica: true,
  orden: true,
  nuevo: true,
};

// Al iniciar sesión, se abre la primera pestaña de esta lista que la
// cuenta SÍ pueda ver (en vez de siempre "stock" a fuerza, por si algún día
// el Admin Central le quita esa pestaña a un Rol). Si por algo raro no
// puede ver ninguna, de todos modos cae en "stock" (el panel se lo va a
// negar y mostrará el aviso correspondiente, ver más abajo).
const ORDEN_PESTANAS_INICIALES = [
  'stock', 'pedidos', 'alertas', 'orden', 'nuevo', 'cuenta', 'bitacora', 'usuarios', 'analitica', 'inventario', 'tickets',
];

function primeraPestanaVisible(permisosCalculados) {
  return ORDEN_PESTANAS_INICIALES.find((p) => permisosCalculados[p]) || 'stock';
}

function leerPermisosGuardados() {
  try {
    const texto = localStorage.getItem(PERMISOS_KEY);
    if (!texto) return PESTANAS_TODAS_PERMITIDAS;
    const parsed = JSON.parse(texto);
    return parsed && typeof parsed === 'object' ? parsed : PESTANAS_TODAS_PERMITIDAS;
  } catch (e) {
    return PESTANAS_TODAS_PERMITIDAS;
  }
}

// Normaliza valores de "sí/no" que pueden venir como booleano real
// (true/false) o como texto ("TRUE", "SI"), igual que hace el backend.
// Indicador minimalista de "algo está cargando" (2026-09-24, pedido por
// Claudia; rediseñado el mismo día porque la primera versión giraba en un
// bucle infinito y ella no podía saber si de verdad iba avanzando o cuándo
// terminaría). Ahora `progreso` es un número real de 0 a 100 que Dashboard
// calcula según el tiempo transcurrido — el círculo se va cerrando
// despacio, y solo se cierra POR COMPLETO y desaparece cuando la carga de
// verdad terminó (`activo` pasa a false). ver `cargasEnCurso`/
// `progresoCarga` en el componente Dashboard para quién lo calcula.
function IndicadorCarga({ activo, progreso }) {
  if (!activo) return null;
  const porcentaje = Math.min(100, Math.max(0, progreso || 0));
  return (
    <div className="indicador-carga" role="status" aria-live="polite" title="Cargando…">
      <span
        className="indicador-carga-circulo"
        style={{ '--indicador-carga-angulo': `${porcentaje}%` }}
      />
    </div>
  );
}

// Flechitas ▲▼ para subir/bajar un campo numérico (2026-09-24, pedido por
// Claudia): al cambiar Precio/Stock de <input type="number"> a
// type="text" (ver la nota junto a limitarDigitos, arriba) se perdieron
// las flechitas nativas del navegador. Claudia pidió que NO desaparezcan
// — que se queden, más grandes y fáciles de dar clic (sin exagerar), y
// que además dejarlas presionadas suba/baje rápido en vez de solo
// clic-por-clic como las nativas. Por eso son botones propios: un clic
// normal sube/baja de 1 en 1, y mantenerlos presionados (mouse o dedo)
// arranca una repetición rápida a los 400ms de tenerlos abajo.
function BotonesPasoNumero({ onSubir, onBajar, disabled }) {
  const intervaloRef = useRef(null);
  const esperaRef = useRef(null);

  function detener() {
    if (esperaRef.current) clearTimeout(esperaRef.current);
    if (intervaloRef.current) clearInterval(intervaloRef.current);
    esperaRef.current = null;
    intervaloRef.current = null;
  }

  function iniciar(accion) {
    if (disabled) return;
    accion();
    esperaRef.current = setTimeout(() => {
      intervaloRef.current = setInterval(accion, 80);
    }, 400);
  }

  useEffect(() => detener, []);

  return (
    <div className="paso-numero-botones">
      <button
        type="button"
        className="paso-numero-btn"
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={() => iniciar(onSubir)}
        onMouseUp={detener}
        onMouseLeave={detener}
        onTouchStart={(e) => { e.preventDefault(); iniciar(onSubir); }}
        onTouchEnd={detener}
        aria-label="Subir"
      >
        ▲
      </button>
      <button
        type="button"
        className="paso-numero-btn"
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={() => iniciar(onBajar)}
        onMouseUp={detener}
        onMouseLeave={detener}
        onTouchStart={(e) => { e.preventDefault(); iniciar(onBajar); }}
        onTouchEnd={detener}
        aria-label="Bajar"
      >
        ▼
      </button>
    </div>
  );
}

function esActivo(valor) {
  return valor === true || String(valor).toUpperCase() === 'TRUE' || String(valor).toUpperCase() === 'SI';
}

// (2026-10-09, Claudia: "el QR sigue mandando al panel del admin… jamás
// direccionar al panel") Con "?ticket=" en la dirección del panel (solo los
// QR de los tickets de ANTES la traen; los de ahora llevan al ticket digital,
// en la página del catálogo) NUNCA se enseña el panel ni su inicio de sesión,
// haya o no sesión abierta: solo este aviso.
export default function Dashboard() {
  const [ticketDeQRViejo] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('ticket') || '';
    } catch {
      return '';
    }
  });
  if (ticketDeQRViejo) {
    return (
      <div className="login-box ticket-qr-viejo" data-ticket-qr-viejo>
        <h2>🎫 Ticket {ticketDeQRViejo}</h2>
        <p>Este código es de una versión anterior del ticket y ya no se puede abrir en línea.</p>
        <p className="muted">Pídele a la tienda que te comparta tu ticket otra vez.</p>
      </div>
    );
  }
  return <PanelDeAdministracion />;
}

function PanelDeAdministracion() {
  const [sesionToken, setSesionToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const sesionIdRef = useRef(0);
  const [rol, setRol] = useState(() => localStorage.getItem(ROL_KEY) || '');
   const [nombreSesion, setNombreSesion] = useState(() => localStorage.getItem(NOMBRE_KEY) || '');
  // Arreglo (2026-09-23, pedido por Claudia): lo que se lleva escrito en
  // "+ Agregar producto" ya NO se borra si cambias de pestaña sin querer —
  // este estado vive aquí (en Dashboard, que nunca se desmonta) en vez de
  // adentro de ProductoForm (que sí se desmonta al cambiar de pestaña).
  const [formNuevoProducto, setFormNuevoProducto] = useState(() => ({ ...FORM_INICIAL }));
  const [fotosNuevoProducto, setFotosNuevoProducto] = useState([]);
     const [esAdminCentral, setEsAdminCentral] = useState(() => localStorage.getItem(ADMIN_CENTRAL_KEY) === 'true');
  const [usuarioId, setUsuarioId] = useState(() => localStorage.getItem(USUARIO_ID_KEY) || '');
  const [permisos, setPermisos] = useState(() => leerPermisosGuardados());
  const [autenticado, setAutenticado] = useState(!!localStorage.getItem(TOKEN_KEY));
  // Mientras esto sea true, NO mostramos el panel: estamos comprobando (o
  // volviendo a comprobar) que la sesión guardada todavía sea válida contra
  // el servidor, para no dejar ver la estructura del Dashboard a alguien
  // que en realidad no tiene una sesión correcta.
   const [verificandoSesion, setVerificandoSesion] = useState(() => !!localStorage.getItem(TOKEN_KEY));
  const [inputUsuario, setInputUsuario] = useState('');
  const [inputContrasena, setInputContrasena] = useState('');
  const [verificandoLogin, setVerificandoLogin] = useState(false);
  const [errorLogin, setErrorLogin] = useState('');
  const [tab, setTab] = useState('stock'); // stock | pedidos | alertas | cuenta | bitacora | usuarios | analitica | orden | nuevo
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  // (2026-10-08) Pagos y reembolsos recientes ({ f, m, u, p }) para el
  // resumen "Vendido hoy / semana / mes". Ver "ResumenDeVentas".
  const [ventasRecientes, setVentasRecientes] = useState([]);
  const [bitacora, setBitacora] = useState([]);
  // Papelera (P1, 2026-10-02): qué renglones de la Bitácora se pueden
  // restaurar todavía (o ya se restauraron). Solo le llega al Admin Central;
  // a los demás les llega vacía. "papeleraDias" = cuántos días se guardan.
  const [papelera, setPapelera] = useState([]);
  const [papeleraDias, setPapeleraDias] = useState(30);
  // ---- Tickets (2026-10-06) ----
  // Llegan con cada carga del panel: los tickets que esta persona puede ver,
  // los pedidos pagados que todavía no tienen ticket, y los datos de la
  // tienda + el interruptor de "automático".
  const [tickets, setTickets] = useState([]);
  const [pedidosParaTicket, setPedidosParaTicket] = useState([]);
  const [configuracionTickets, setConfiguracionTickets] = useState(null);
  const [ticketsPuedeConfigurar, setTicketsPuedeConfigurar] = useState(false);
  // Ticket abierto en su ventana (se guarda el ID: el ticket se toma siempre
  // de la lista más reciente, para que lo que se ve nunca esté viejo).
  const [ticketAbiertoId, setTicketAbiertoId] = useState(null);
  // Pedido pagado al que se le dio 🎫 en Pedidos (abre "Generar ticket").
  const [pedidoParaGenerarTicket, setPedidoParaGenerarTicket] = useState(null);
  // Folio que hay que buscar al abrir la pestaña Tickets. Arranca con el que
  // venga en la dirección (?ticket=T-00012): así llega quien lee el QR.
  const [folioBuscadoDeTicket, setFolioBuscadoDeTicket] = useState('');
  // Alguien del equipo leyó un QR de antes (apunta al panel) y quiere entrar.
  // "Ver sus pedidos" desde un ticket: Pedidos enseña solo esos.
  const [filtroPedidosDeTicket, setFiltroPedidosDeTicket] = useState(null); // { folio, ids: Set }
  // true cuando ya llegó al menos una carga completa del panel (para no
  // decir "no encontré ese ticket" antes de tener la lista).
  const [panelYaCargo, setPanelYaCargo] = useState(false);
  const numeroDeCargaRef = useRef(0);
  const ultimaCargaAplicadaRef = useRef(0);
  // ---- Refresco de fondo (2026-10-06, ver "INTERVALO_REFRESCO_MS") ----
  // Cargas completas que siguen sin contestar: [{ desde }].
  const cargasEnVueloRef = useRef([]);
  // Cuándo empezó el último intento de carga, cuánto tardó la última, y
  // cuándo se aplicó la última que sí llegó.
  const ultimoIntentoDeCargaRef = useRef(0);
  const duracionUltimaCargaRef = useRef(0);
  const ultimaCargaCompletaRef = useRef(0);
  // La "marca de cambios" que traían los datos que están en pantalla.
  const marcaVistaRef = useRef('');
  // true si el servidor todavía no sabe contestar la marca (versión de antes).
  const servidorSinMarcaRef = useRef(false);
  // Cuándo se mandó la última pregunta "¿hay algo nuevo?" (0 = ninguna en camino).
  const revisandoMarcaDesdeRef = useRef(0);
  const ultimaRevisionDeMarcaRef = useRef(0);
  // Número de la carga que la pantalla NECESITA (la de después de guardar).
  // 0 = la pantalla está al día.
  const cargaNecesariaRef = useRef(0);
  const latidoRef = useRef(null);
  // Lo que se va escribiendo en "Datos de la tienda" (vive aquí arriba para
  // que no se pierda al cambiar de pestaña antes de guardar). null = sin tocar.
  const [tiendaEnEdicion, setTiendaEnEdicion] = useState(null);
  // Catálogos por sucursal (2026-10-02): la(s) sucursal(es) que esta cuenta
  // puede ver en "🏪 Mi sucursal" — la suya si tiene "Catálogo propio"
  // prendido; el Admin Central recibe todas. Ver SucursalTab.
  const [sucursales, setSucursales] = useState([]);
    const [usuarios, setUsuarios] = useState([]);
  // Funcionalidad 2 (Stock personal + transferencias, 2026-09): lista
  // completa de solicitudes (para el historial de Admin/Admin Central), y
  // las que llegan ya calculadas dentro de "alertas": las pendientes
  // dirigidas a mí (para el panel de arriba de Stock) y las mías ya
  // resueltas que todavía no he visto (para el aviso en Alertas).
  const [transferencias, setTransferencias] = useState([]);
  const [transferenciasPendientes, setTransferenciasPendientes] = useState([]);
  const [transferenciasResueltas, setTransferenciasResueltas] = useState([]);
  // Solicitudes que YO mandé y siguen sin respuesta (para avisarte en
  // Alertas que sí se enviaron, y para no dejarte mandar la misma dos
  // veces desde el botón "Solicitar").
   const [transferenciasEnProceso, setTransferenciasEnProceso] = useState([]);
  // Avisos de "Aplicada" (Admin movió stock de una persona a otra sin
  // pedir Aceptar/Rechazar): le llegan a ambas personas, solo para
  // dárselos por entendido.
  const [transferenciasAplicadas, setTransferenciasAplicadas] = useState([]);
  // Regresión reportada por Claudia (2026-09): Aceptar/Rechazar/Entendido no
  // daban ninguna señal visual al tocarlos, parecía que el click no había
  // funcionado y a veces se tocaban dos veces. Este Set guarda los IDs de
  // transferencia "en camino" (ya se mandó la petición, todavía no responde
  // el servidor) para poner sus botones en gris mientras tanto.
  const [transferenciasEnAccion, setTransferenciasEnAccion] = useState(new Set());
  // Feature pedido por Claudia (2026-09): al tocar el aviso de una solicitud
  // pendiente en Stock, salta a la fila de ese producto y la resalta unos
  // segundos en amarillo.
  const [productoResaltadoId, setProductoResaltadoId] = useState(null);
  // P14 (2026-10-01): cuántos renglones se ven en Stock y en Pedidos (50,
  // 100 o todos). "productoFijadoId" / "pedidoFijadoId": el renglón al que
  // se saltó desde un aviso se queda a la vista aunque caiga fuera del
  // corte (si no, desaparecería a los 4 segundos, cuando se le quita el
  // resaltado amarillo).
  const [limiteFilasStock, setLimiteFilasStock] = useLimiteFilas('stock');
  const [limiteFilasPedidos, setLimiteFilasPedidos] = useLimiteFilas('pedidos');
  const [productoFijadoId, setProductoFijadoId] = useState(null);
  const [pedidoFijadoId, setPedidoFijadoId] = useState(null);
  // Solicitudes de reembolso (2026-09-30, pedido por Claudia): mismo
  // patrón que las Transferencias de arriba. "Pendientes" solo le llega a
  // quien puede responderlas (permiso candadoReembolsos/Admin Central);
  // "Resueltas" (sin ver) le llega a quien la pidió, para saber si se
  // aprobó o se rechazó.
  const [solicitudesReembolsoPendientes, setSolicitudesReembolsoPendientes] = useState([]);
  const [solicitudesReembolsoResueltas, setSolicitudesReembolsoResueltas] = useState([]);
  const [solicitudesReembolsoEnAccion, setSolicitudesReembolsoEnAccion] = useState(new Set());

  // ---- Avisos de arriba minimizables (2026-10-01, pedido por Claudia) ----
  // Los recuadros de avisos de arriba (bajo inventario, solicitudes de
  // stock, solicitudes de reembolso) se pueden minimizar: se quedan como un
  // puntito de color (🔴 bajo inventario, 🟡 solicitudes de stock, 🔵
  // reembolsos) con cuántos hay, y al darle clic al punto se vuelven a
  // abrir. Se guarda, por tipo, CUÁNTOS había al minimizarlo — si después
  // llegan más, el punto parpadea para avisar que hay algo nuevo. Se
  // recuerda en este navegador (localStorage), para que no se vuelvan a
  // abrir solos cada vez que se recarga la página.
  const [avisosMinimizados, setAvisosMinimizados] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(AVISOS_MINIMIZADOS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  });
  function guardarAvisosMinimizados(siguiente) {
    try {
      localStorage.setItem(AVISOS_MINIMIZADOS_KEY, JSON.stringify(siguiente));
    } catch {
      // Sin almacenamiento disponible: solo se pierde el "recordar"; minimizar sigue funcionando.
    }
    return siguiente;
  }
  function minimizarAviso(tipo, conteo) {
    setAvisosMinimizados((prev) => guardarAvisosMinimizados({ ...prev, [tipo]: conteo }));
  }
  function abrirAviso(tipo) {
    setAvisosMinimizados((prev) => {
      const siguiente = { ...prev };
      delete siguiente[tipo];
      return guardarAvisosMinimizados(siguiente);
    });
  }

  // ---- Nombres de dueños en Stock (2026-10-01, pedido por Claudia) ----
  // Los nombres largos se recortan con "…" para que todas las filas de la
  // columna Dueño queden alineadas (nombre | cantidad | botón). Con el
  // botón ↔ del encabezado (o dándole clic a un nombre) se ven completos, y
  // se regresan solos a su tamaño después de 5 minutos (o antes, a mano).
  const [duenosExpandidos, setDuenosExpandidos] = useState(false);
  useEffect(() => {
    if (!duenosExpandidos) return undefined;
    const temporizador = setTimeout(() => setDuenosExpandidos(false), 5 * 60 * 1000);
    return () => clearTimeout(temporizador);
  }, [duenosExpandidos]);
  // Lupa del encabezado "Dueño" (2026-10-01): su explicación sale como
  // comentario flotante. null = cerrado; 'hover' = abierto por pasarle el
  // mouse (se cierra al quitarlo); 'clic' = abierto por un clic (se cierra
  // solo a los pocos segundos, con la ✕ o tocando en otro lado).
  const lupaDuenosRef = useRef(null);
  const [avisoLupaDuenos, setAvisoLupaDuenos] = useState(null);
  // ¿Hay algún nombre de dueño recortado con "…" AHORITA en la tabla? Se
  // mide directo en pantalla (antes se adivinaba contando letras), porque
  // el ancho de los nombres ahora crece en pantallas anchas y un mismo
  // nombre puede caber completo en una pantalla y recortarse en otra.
  const tablaStockRef = useRef(null);
  const [hayNombresDuenoRecortados, setHayNombresDuenoRecortados] = useState(false);
  // Ancho REAL (en pixeles) del nombre de dueño más largo y de la cantidad
  // más larga que se están viendo en la tabla (2026-10-01, Claudia con
  // captura: "hay mucho espacio en la columna de Dueño entre el nombre y
  // los números"). Antes las dos columnitas tenían un ancho fijo generoso
  // y sobraba aire; ahora miden justo lo que ocupa el texto más largo, así
  // el número queda pegado al nombre y el botón pegado al número, sin
  // perder la alineación entre renglones. Se mide el texto con un lienzo
  // invisible (no cambia nada en pantalla). 0 = todavía no se ha medido.
  const [anchosDuenos, setAnchosDuenos] = useState({ nombre: 0, cantidad: 0 });
  const lienzoMedirRef = useRef(null);
  useEffect(() => {
    function anchoMasLargo(elementos) {
      if (elementos.length === 0) return 0;
      try {
        if (!lienzoMedirRef.current) lienzoMedirRef.current = document.createElement('canvas').getContext('2d');
        const lienzo = lienzoMedirRef.current;
        if (!lienzo) return 0;
        const estilo = window.getComputedStyle(elementos[0]);
        lienzo.font = `${estilo.fontStyle} ${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`;
        const vistos = new Set();
        let maximo = 0;
        for (let i = 0; i < elementos.length; i += 1) {
          const texto = elementos[i].textContent || '';
          if (vistos.has(texto)) continue;
          vistos.add(texto);
          maximo = Math.max(maximo, lienzo.measureText(texto).width);
        }
        return Math.ceil(maximo) + 2;
      } catch {
        return 0;
      }
    }
    function medir() {
      const tabla = tablaStockRef.current;
      if (!tabla) return;
      let recortado = false;
      const nombres = tabla.querySelectorAll('.stock-dueno-nombre');
      for (let i = 0; i < nombres.length; i += 1) {
        if (nombres[i].scrollWidth > nombres[i].clientWidth + 1) {
          recortado = true;
          break;
        }
      }
      setHayNombresDuenoRecortados((antes) => (antes === recortado ? antes : recortado));
      const nombre = anchoMasLargo(nombres);
      const cantidad = anchoMasLargo(tabla.querySelectorAll('.stock-dueno-cantidad'));
      setAnchosDuenos((antes) => (antes.nombre === nombre && antes.cantidad === cantidad ? antes : { nombre, cantidad }));
    }
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  });

  // ---- Orden de las pestañas a gusto de cada quien (2026-10-01, pendiente
  // P13 de Claudia: "poder alterar el orden de las pestañas del panel de
  // manera sencilla por si hay unas que ocupan más las tengan más cerca, y
  // que tenga un botón de regresar a orden default, y que no genere
  // registro en la Bitácora") ----
  // Se guarda solo en ESTE navegador (localStorage), por cuenta — nunca
  // llega al servidor, así que tampoco a la Bitácora. Se arrastra cada
  // pestaña a su lugar, o se usan las flechitas ◀ ▶ (en celular).
  const [ordenPestanas, setOrdenPestanas] = useState([]);
  const [ordenandoPestanas, setOrdenandoPestanas] = useState(false);
  const [pestanaArrastrada, setPestanaArrastrada] = useState(null);
  useEffect(() => {
    if (!usuarioId) {
      setOrdenPestanas([]);
      return;
    }
    try {
      const guardado = JSON.parse(localStorage.getItem(ORDEN_PESTANAS_KEY + usuarioId) || '[]');
      setOrdenPestanas(Array.isArray(guardado) ? guardado : []);
    } catch {
      setOrdenPestanas([]);
    }
  }, [usuarioId]);
  function guardarOrdenPestanas(nuevoOrden) {
    setOrdenPestanas(nuevoOrden);
    try {
      if (nuevoOrden.length === 0) localStorage.removeItem(ORDEN_PESTANAS_KEY + usuarioId);
      else localStorage.setItem(ORDEN_PESTANAS_KEY + usuarioId, JSON.stringify(nuevoOrden));
    } catch {
      // Sin almacenamiento: el orden dura hasta recargar, no pasa nada más.
    }
  }

  // ---- Sesión cambiada en OTRA pestaña (2026-10-01, pendiente P6 de
  // Claudia: "al darle reiniciar en el panel de admin me pasó directamente
  // al panel de un vendedor") ----
  // Causa real: la sesión se guarda en localStorage, que COMPARTEN todas las
  // pestañas del mismo navegador. Si en otra pestaña se entra con otra
  // cuenta (o se cierra la sesión), esta pestaña seguía viéndose como la
  // cuenta anterior, pero al recargarla tomaba la sesión nueva — y algunas
  // partes (como subir fotos, que lee el token directo de localStorage)
  // podían mandar cosas a nombre de la OTRA cuenta sin que se notara. Podía
  // pasar en los dos sentidos (de admin a vendedor y de vendedor a admin).
  // Ahora, en cuanto otra pestaña cambia la sesión, esta lo detecta (evento
  // "storage" del navegador) y se bloquea con un aviso claro, pidiendo
  // recargar — nunca se mezclan dos cuentas en silencio.
  const [sesionCambiadaFuera, setSesionCambiadaFuera] = useState(null); // null | 'otraCuenta' | 'cerrada'
  const sesionTokenRef = useRef(sesionToken);
  sesionTokenRef.current = sesionToken;
  useEffect(() => {
    function alCambiarAlmacenamiento(e) {
      if (e.key !== TOKEN_KEY && e.key !== null) return; // null = se borró todo el almacenamiento
      const tokenDeEstaPestana = sesionTokenRef.current;
      if (!tokenDeEstaPestana) return; // esta pestaña no tiene sesión abierta, no hay nada que mezclar
      const tokenNuevo = e.key === null ? null : e.newValue;
      if (tokenNuevo === tokenDeEstaPestana) return;
      setSesionCambiadaFuera(tokenNuevo ? 'otraCuenta' : 'cerrada');
    }
    window.addEventListener('storage', alCambiarAlmacenamiento);
    return () => window.removeEventListener('storage', alCambiarAlmacenamiento);
  }, []);
  // Igual que "productoResaltadoId" de arriba, pero para saltar a la
  // pestaña Pedidos y resaltar la fila de un pedido en concreto (se usa
  // desde el aviso de una solicitud de reembolso en Alertas).
  const [pedidoResaltadoId, setPedidoResaltadoId] = useState(null);

  // ---- Pedidos (2026-10-06, pedido por Claudia) ----
  // Pedidos que en este momento hacen el "destello" amarillo: los nuevos que
  // todavía no se habían visto, y los de un ticket al dar "Mostrar en pedidos".
  const [pedidosConDestello, setPedidosConDestello] = useState(() => new Set());
  // El pedido de varios productos que se está atendiendo (se tocó uno de sus
  // renglones): su clave, o null. Ver "juntarPedidosDeVariosProductos".
  const [compraActivaClave, setCompraActivaClave] = useState(null);
  // (2026-10-08) La barrita amarilla ya no ocupa su lugar de antemano: al
  // salir empuja la tabla. Aquí se anota dónde estaba el renglón tocado para,
  // ya dibujada la barrita, mover el scroll lo mismo y que el renglón se
  // quede justo debajo del dedo.
  const filaTocadaParaCompraRef = useRef(null);
  // Cuándo se apretó el mouse/dedo en la tabla de Pedidos: si el foco llega
  // por ese mismo toque, la barrita espera al "click" (cuando ya se soltó),
  // para que la tabla no se mueva a medio clic.
  const momentoPunteroEnPedidosRef = useRef(0);
  useLayoutEffect(() => {
    const anotada = filaTocadaParaCompraRef.current;
    filaTocadaParaCompraRef.current = null;
    if (!anotada || !anotada.fila || !anotada.fila.isConnected) return;
    const diferencia = anotada.fila.getBoundingClientRect().top - anotada.top;
    if (Math.abs(diferencia) >= 1) {
      try {
        window.scrollBy(0, diferencia);
      } catch {
        // Sin scroll que mover: no pasa nada.
      }
    }
  }, [compraActivaClave]);
  // "Estatus para todos": cada vez que se elige uno, cambia la ficha y los
  // renglones de ese pedido ponen ese estatus en su propio menú (los que
  // pueden). estado null = regresar cada renglón a como está guardado.
  const [ordenGeneralDeCompra, setOrdenGeneralDeCompra] = useState({ ficha: 0, clave: null, estado: null, motivo: '' });
  const [guardandoCompra, setGuardandoCompra] = useState(false);
  // Pedidos que se están guardando EN ESTE MOMENTO (por su propio "Guardar"
  // o de un jalón): para no mandar el mismo dos veces.
  const [pedidosGuardandose, setPedidosGuardandose] = useState(() => new Set());
  const pedidosGuardandoseRef = useRef(new Set());
  function marcarGuardandose(ids, guardando) {
    const siguiente = new Set(pedidosGuardandoseRef.current);
    ids.forEach((id) => { if (guardando) siguiente.add(String(id)); else siguiente.delete(String(id)); });
    pedidosGuardandoseRef.current = siguiente;
    setPedidosGuardandose(siguiente);
  }
  // Deja sin efecto el "Estatus para todos" que se hubiera elegido (se llama
  // cada vez que ese pedido deja de estarse atendiendo: se cierra su
  // barrita, se toca otro pedido, se cancelan los cambios, se cambia de
  // pestaña o de cuenta). Así una orden vieja nunca se aplica después.
  function soltarEstatusParaTodos() {
    setOrdenGeneralDeCompra((antes) => (antes.clave === null ? antes : { ficha: antes.ficha, clave: null, estado: null, motivo: '' }));
  }
  // true mientras la pestaña del navegador está a la vista (un pedido o una
  // alerta no cuentan como "vistos" si llegaron con el panel en segundo plano).
  const [paginaALaVista, setPaginaALaVista] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    function alCambiar() {
      setPaginaALaVista(!document.hidden);
    }
    document.addEventListener('visibilitychange', alCambiar);
    return () => document.removeEventListener('visibilitychange', alCambiar);
  }, []);
  // Lo ya visto, por si el navegador no deja guardar nada (modo privado,
  // almacenamiento lleno): se recuerda mientras la pestaña siga abierta.
  const vistosEnMemoriaRef = useRef({});
  // Sucursales que ya no pueden atender sus propios pedidos (lo manda el
  // servidor). null = servidor de antes, que todavía no aplica el candado
  // de sucursal.
  const [sucursalesQueNoAtienden, setSucursalesQueNoAtienden] = useState(null);
  // Para no volver a juntar los pedidos de varios productos en cada dibujo.
  const comprasMemoRef = useRef({ pedidos: null, valor: null });
  // Puntito rojo de las pestañas (2026-10-06, Claudia): cuántos pedidos
  // nuevos hay sin ver, y si hay alertas sin ver. "Ver" = abrir su pestaña.
  const [pedidosSinVer, setPedidosSinVer] = useState(0);
  const [hayAlertasSinVer, setHayAlertasSinVer] = useState(false);
  // Cada renglón de Pedidos deja aquí cómo leer lo que tiene escrito (para
  // poder guardar varios con un solo botón): { idDelPedido: () => datos }.
  const pendientesDePedidosRef = useRef({});
  function registrarPendienteDePedido(pedidoId, leer) {
    if (leer) pendientesDePedidosRef.current[String(pedidoId)] = leer;
    else delete pendientesDePedidosRef.current[String(pedidoId)];
  }
  const destellosRef = useRef([]);
  function destellarPedidos(ids) {
    const lista = (ids || []).map(String);
    if (lista.length === 0) return;
    setPedidosConDestello((antes) => new Set([...antes, ...lista]));
    const reloj = setTimeout(() => {
      setPedidosConDestello((antes) => {
        const siguiente = new Set(antes);
        lista.forEach((id) => siguiente.delete(id));
        return siguiente;
      });
      destellosRef.current = destellosRef.current.filter((otro) => otro !== reloj);
    }, DURACION_DESTELLO_PEDIDO_MS);
    destellosRef.current.push(reloj);
  }
  useEffect(() => () => { destellosRef.current.forEach((reloj) => clearTimeout(reloj)); }, []);

  // 'todo' muestra el stock completo (con el dueño de cada quien); 'mio'
  // filtra solo los productos donde yo tengo algo asignado.
  const [filtroStockPersonal, setFiltroStockPersonal] = useState('todo');
  // Filtro por dueño en Stock (2026-10-05, pedido varias veces por
  // Claudia: "ver rápido qué productos tiene cada persona"). '' = todos;
  // el ID de una persona = solo donde ESA persona tiene piezas a su
  // nombre; FILTRO_SIN_DUENO = productos que nadie tiene asignados.
  // "Mi stock personal" (arriba) sigue siendo el atajo para verme a mí.
  const [filtroDuenoStock, setFiltroDuenoStock] = useState('');
   const esAdministrador = rol === 'Administrador';
  // Funcionalidad 1, Paso 2 (Permisos de pestañas, 2026-09): reemplaza los
  // "esAdministrador &&" que antes decidían a mano qué pestañas se ven. El
  // Admin Central siempre tiene todo en `true` (el backend ya se lo manda
  // así calculado); para los demás, `permisos` refleja el default de su Rol
  // más cualquier excepción individual que le haya puesto el Admin Central.
  function puedeVer(pestana) {
    return !!permisos[pestana];
  }
  // Tickets (2026-10-06): si se llegó con un folio en la dirección (por el
  // QR de un ticket), en cuanto hay sesión se abre la pestaña Tickets; ella
  // busca el folio y abre ese ticket.
  // Para los tickets hacen falta DOS permisos: "tickets" y "pedidos" (así lo
  // revisa también el servidor).
  const puedeVerTickets = !!permisos.tickets && !!permisos.pedidos;
  useEffect(() => {
    if (!folioBuscadoDeTicket || !autenticado) return;
    if (puedeVerTickets) {
      setTab('tickets');
    } else if (panelYaCargo) {
      // Ya cargó el panel y esta cuenta no tiene Tickets: se dice, y el
      // folio se olvida (para que no brinque de pestaña más tarde).
      setMensaje(`Llegaste con el enlace del ticket ${folioBuscadoDeTicket}, pero esta cuenta no tiene permiso para ver tickets.`);
      atenderFolioDeTicket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folioBuscadoDeTicket, autenticado, puedeVerTickets, panelYaCargo]);
  // Opciones predeterminadas para los campos de "+ Agregar producto"
  // (Nombre, Código propio, Categoría, Marca, Talla, Color). Se guarda como
  // { categoria: ['Bolsas', 'Zapatos'], color: ['Rojo'], ... }. A propósito
  // NO se llena sola con el historial de productos: solo tiene lo que se
  // agregó a mano desde "Administrar opciones predeterminadas".
  const [opciones, setOpciones] = useState({});
  const [cargando, setCargando] = useState(false);
  // Indicador de carga minimalista tipo "reloj que se cierra" (2026-09-24,
  // pedido por Claudia: no saber si la app se congeló o solo está
  // tardando le generaba ansiedad — sobre todo al Guardar en Stock o al
  // guardar un producto). Es un CONTADOR, no un booleano, porque puede
  // haber más de una cosa cargando al mismo tiempo (por ejemplo, guardar
  // un producto Y el refresco de fondo) — el círculo solo desaparece
  // cuando de verdad ya no queda NADA pendiente. `iniciarCarga`/
  // `terminarCarga` se pasan hacia abajo a los componentes que lo
  // necesiten (ver `onCargando`/`onCargaLista` en ProductoForm).
  const [cargasEnCurso, setCargasEnCurso] = useState(0);
  // Cuántas acciones siguen DE VERDAD sin terminar (2026-10-06). El contador
  // de arriba es el del círculo, y la "red de seguridad" de más abajo lo
  // regresa a 0 cuando algo tarda demasiado; este no se toca ahí, así se
  // sabe cuándo esa acción lenta por fin terminó.
  const cargasRealesRef = useRef(0);
  // true mientras está en pantalla el aviso amarillo de "tardó demasiado".
  const avisoDeEsperaRef = useRef(false);
  // Cuándo empezó la última acción (para que el refresco de fondo no compita
  // con un guardado que está en camino).
  const ultimaAccionIniciadaRef = useRef(0);
  function iniciarCarga() {
    cargasRealesRef.current += 1;
    ultimaAccionIniciadaRef.current = Date.now();
    setCargasEnCurso((n) => n + 1);
  }
  function terminarCarga() {
    cargasRealesRef.current = Math.max(0, cargasRealesRef.current - 1);
    setCargasEnCurso((n) => Math.max(0, n - 1));
    // Reportado por Claudia (2026-10-06): el aviso amarillo de "una acción
    // tardó demasiado… revisa antes de repetirla" se quedaba pegado aunque
    // el cambio sí se había hecho. Ese aviso sale cuando se deja de esperar,
    // pero la acción sigue su camino; en cuanto termina (ya no queda
    // ninguna pendiente) el aviso deja de tener sentido y se quita solo. Si
    // la acción terminó mal, su propio mensaje de error es el que queda.
    if (cargasRealesRef.current === 0 && avisoDeEsperaRef.current) {
      avisoDeEsperaRef.current = false;
      setMensaje((previo) => (previo === AVISO_ESPERA_CANCELADA ? '' : previo));
    }
  }

  // Rediseño del círculo de carga (2026-09-24, pedido por Claudia: "prefiero
  // que se vaya cerrando lentamente conforme al tiempo y en cuanto ya acabe
  // la espera se cierra el circulo entero y se quita, así se ve realmente
  // cuánto va de progreso y no solo algo cíclico"). Antes el círculo se
  // llenaba con una animación CSS en bucle infinito (`@keyframes ...
  // infinite`) que no significaba nada — solo giraba y giraba sin parar.
  // Ahora `progresoCarga` es un número real (0 a 100) que avanza con el
  // tiempo transcurrido de verdad, cada vez más despacio (nunca podemos
  // saber CUÁNTO va a tardar el servidor, así que no prometemos un tiempo
  // exacto — pero sí transmitimos "sigue avanzando, no está congelado"), y
  // se topa en 92% mientras seguimos esperando. Solo cuando `cargasEnCurso`
  // de verdad vuelve a 0 (la espera real terminó) el círculo salta a 100%
  // —se cierra por completo— y un instante después desaparece, para que esa
  // desaparición sea la señal clara de "ya acabó de verdad".
  const [progresoCarga, setProgresoCarga] = useState(0);
  const [mostrarIndicadorCarga, setMostrarIndicadorCarga] = useState(false);
  // Ojo: la dependencia es `cargasEnCurso > 0` (un booleano), NO
  // `cargasEnCurso` directo. Como puede haber más de una cosa cargando al
  // mismo tiempo, el contador puede subir y bajar (1 → 2 → 1) sin llegar a
  // 0 — si este efecto se reiniciara con cada uno de esos cambios, el
  // progreso "regresaría" a 0% de golpe cada vez que empezara una segunda
  // acción, dando una sensación de retroceso. Así, solo se reinicia cuando
  // de verdad se pasa de "nada cargando" a "algo cargando" o viceversa.
  useEffect(() => {
    if (cargasEnCurso > 0) {
      setMostrarIndicadorCarga(true);
      const inicio = Date.now();
      // Arreglo (2026-09-25, reportado por Claudia: "el pacman debe ser un
      // indicador del tiempo real que lleva esperar... a veces no es exacto,
      // el relleno brinca al final en vez de avanzar parejo"). La curva
      // anterior (exponencial) avanzaba rápido al principio y se iba
      // "aplanando" cada vez más despacio cerca del 92% — en una acción
      // rápida (la mayoría duran 1-2 segundos) eso se veía como que el
      // círculo se quedaba estancado en un punto bajo, y luego SALTABA de
      // golpe hasta 100% al terminar, en vez de sentirse como un cronómetro
      // real avanzando parejo. Ahora el avance es LINEAL — misma velocidad
      // todo el tiempo, como un cronómetro de verdad — contra una duración
      // típica de referencia, topándose en un techo alto (97%) mientras
      // seguimos esperando (nunca se completa solo, eso sigue pasando SOLO
      // cuando `cargasEnCurso` de verdad vuelve a 0). El salto final que
      // queda (de donde se haya quedado hasta 100%) sigue siendo inevitable
      // — nadie puede saber de antemano el instante exacto en que el
      // servidor va a responder — pero ahora ese cierre es una transición
      // suave y rápida (ver ".indicador-carga-circulo" en global.css) en
      // vez de un salto instantáneo, así se siente como que "alcanza" el
      // 100% justo cuando el cambio se realiza.
      const DURACION_TIPICA_MS = 3500;
      const TOPE_MIENTRAS_CARGA = 97;
      const avance = setInterval(() => {
        const transcurrido = Date.now() - inicio;
        const porcentajeParejo = (transcurrido / DURACION_TIPICA_MS) * TOPE_MIENTRAS_CARGA;
        setProgresoCarga(Math.min(TOPE_MIENTRAS_CARGA, porcentajeParejo));
      }, 60);
      return () => clearInterval(avance);
    }
    // Ya no queda nada cargando de verdad: cerramos el círculo por completo
    // y, poquito después (para que se alcance a VER cerrarse, no que
    // desaparezca de golpe), lo quitamos de la pantalla.
    setProgresoCarga(100);
    const espera = setTimeout(() => setMostrarIndicadorCarga(false), 350);
    return () => clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargasEnCurso > 0]);

  // Red de seguridad (2026-09-24, reportado por Claudia: una vez el círculo
  // se quedó cargando más de 1 minuto, aunque el cambio ya se había
  // aplicado — una petición se quedó "colgada" sin nunca contestar).
  // `conLimiteDeTiempo` ya le pone un tope a cada llamada al servidor, pero
  // esto es un respaldo adicional: si por cualquier motivo no previsto el
  // círculo siguiera encendido más tiempo del razonable, lo apagamos
  // nosotros mismos y avisamos, en vez de dejarlo dando vueltas para
  // siempre sin que Claudia sepa qué pasó.
  useEffect(() => {
    if (cargasEnCurso === 0) return;
    // Ojo: el margen tiene que ser MÁS LARGO que el tope más largo que
    // exista (`TIEMPO_MAXIMO_CARGA_INICIAL_MS`, el de abrir el panel
    // completo) — si aquí pusiéramos un margen corto, esta red de
    // seguridad apagaría el círculo ANTES de que la carga inicial (que
    // legítimamente puede tardar hasta 45s) tuviera oportunidad de
    // terminar bien.
    const vigilante = setTimeout(() => {
      setCargasEnCurso(0);
      setCargando(false);
      // Si la acción todavía sigue viva, el aviso se quita solo cuando
      // termine (ver "terminarCarga").
      avisoDeEsperaRef.current = cargasRealesRef.current > 0;
      setMensaje(AVISO_ESPERA_CANCELADA);
    }, Math.max(TIEMPO_MAXIMO_ESPERA_MS, TIEMPO_MAXIMO_CARGA_INICIAL_MS) + 5000);
    return () => clearTimeout(vigilante);
  }, [cargasEnCurso]);

  const [mensaje, setMensaje] = useState('');
  const [productoEditando, setProductoEditando] = useState(null);
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [busquedaStock, setBusquedaStock] = useState('');
  const [filtroCategoriaStock, setFiltroCategoriaStock] = useState('');
  const [ordenStock, setOrdenStock] = useState(null); // { campo, direccion } o null
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroPedidoDesde, setFiltroPedidoDesde] = useState('');
  const [filtroPedidoHasta, setFiltroPedidoHasta] = useState('');
  // Etapa 4 (Pedidos por dueño, 2026-09-26): '' significa "todos los
  // pedidos"; cualquier otro valor es un usuarioId — para un Vendedor solo
  // puede ser el suyo propio ("Mis pedidos"), para un Admin/Admin Central
  // puede ser el de cualquier persona (selector "Ver pedidos de…").
  // (2026-10-08, Claudia: "el de ver pedidos que esté predeterminado el de
  // mis pedidos personales"). 'yo' = los míos (se resuelve con mi usuarioId
  // al momento de usarlo, porque al abrir el panel todavía puede no
  // saberse); '' = de todos; cualquier otro valor = el id de otra persona.
  const [filtroPedidoDueno, setFiltroPedidoDueno] = useState('yo');
  // Filtro verde "De hoy": se suma a los demás (por ejemplo "Pendientes de hoy").
  const [soloDeHoy, setSoloDeHoy] = useState(false);
  // Pedidos que YO guardé en esta visita: siguen saliendo en "Mis pedidos"
  // aunque, por ejemplo, al cobrarlo se me hayan acabado las piezas (y por
  // eso ya no aparezca como dueña del producto).
  const [pedidosQueAtendi, setPedidosQueAtendi] = useState(() => new Set());
  function anotarPedidosQueAtendi(ids) {
    setPedidosQueAtendi((antes) => {
      const siguiente = new Set(antes);
      ids.forEach((id) => siguiente.add(String(id)));
      return siguiente;
    });
  }
  const [fotoAmpliada, setFotoAmpliada] = useState('');
  // Nota de un pedido abierta "en grande" (ver/editar completa). Null cuando
  // no hay ninguna abierta. Guarda también `onChange`, que es el `setNotas`
  // de esa fila de Pedidos en particular, para que editar aquí actualice
  // exactamente esa misma fila.
  const [notaEnZoom, setNotaEnZoom] = useState(null);

  // Mapa de llaves (con prefijo "stock:" o "pedido:") -> descripción del
  // cambio pendiente de guardar. Mientras este mapa no esté vacío, avisamos
  // antes de cambiar de pestaña o cerrar la página, para no perder el
  // cambio por un descuido. La descripción es lo que se le muestra a
  // Claudia para que sepa EXACTAMENTE qué dato movió.
  const [sinGuardar, setSinGuardar] = useState(() => new Map());

  // Se incrementa cada vez que Claudia cancela los cambios sin guardar (con
  // el botón o con Escape). Lo usamos como parte del "key" de cada fila de
  // Stock/Pedidos: al cambiar el key, React destruye y vuelve a crear esa
  // fila desde cero, así que sus casillas regresan a mostrar el valor
  // original (el que tiene el servidor), no el que Claudia había escrito.
  const [resetToken, setResetToken] = useState(0);

  function marcarSucio(llave, sucio, descripcion) {
    setSinGuardar((prev) => {
      const next = new Map(prev);
      if (sucio) next.set(llave, descripcion || 'Un campo cambió');
      else next.delete(llave);
      return next;
    });
  }

  function cancelarCambios() {
    soltarEstatusParaTodos();
    setResetToken((t) => t + 1);
    setSinGuardar(new Map());
  }

  function cambiarTab(nuevaTab) {
    if (sinGuardar.size > 0) {
      const salir = window.confirm(
        'Tienes cambios sin guardar. Si continúas se van a perder. ¿Quieres salir de todas formas?'
      );
      if (!salir) return;
      cancelarCambios();
    }
    setTab(nuevaTab);
  }

  // Si intentan cerrar o recargar la pestaña con cambios sin guardar, el
  // navegador les muestra su propia advertencia (no podemos personalizar el
  // texto, pero sí evitar que se vayan sin darse cuenta).
  useEffect(() => {
    function avisarAntesDeSalir(e) {
      if (sinGuardar.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', avisarAntesDeSalir);
    return () => window.removeEventListener('beforeunload', avisarAntesDeSalir);
  }, [sinGuardar]);

  // La tecla Escape cancela los cambios sin guardar, igual que el botón del
  // aviso amarillo — pero NO si hay una foto ampliada o una nota ampliada
  // abierta en ese momento (ahí Escape, o simplemente cerrar esa ventana,
  // no debe perder un cambio sin querer).
  useEffect(() => {
    function onKeyDown(e) {
      // (2026-10-06) Tampoco con una ventana de ticket abierta.
      if (e.key === 'Escape' && !fotoAmpliada && !notaEnZoom && !ticketAbiertoId && !pedidoParaGenerarTicket && sinGuardar.size > 0) {
        cancelarCambios();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinGuardar, fotoAmpliada, notaEnZoom, ticketAbiertoId, pedidoParaGenerarTicket]);

  // `silencioso: true` no muestra "Actualizando…" ni mensajes de error (para
  // no ser molesto). Hay dos clases de carga silenciosa:
  //   - `deFondo: true`: el refresco automático (ver "latido" más abajo);
  //   - sin `deFondo`: la recarga que se pide justo DESPUÉS de guardar algo.
  //     Esa es obligatoria: si falla o tarda, se reintenta sola hasta que
  //     llegue (aunque haya renglones con cambios sin guardar), para que la
  //     pantalla nunca se quede enseñando datos de antes del guardado.
  function cargarTodo(token, opciones = {}) {
    const silencioso = !!opciones.silencioso;
    const deFondo = !!opciones.deFondo;
    // Un guardado de la sesión ANTERIOR que termina cuando ya entró otra
    // persona en esta pestaña no debe traer aquí los datos de la anterior.
    if (token !== sesionTokenRef.current) return Promise.resolve(null);
    // Fix "switcheo" de sesión (2026-09): "número de turno" de quien pidió estos datos.
    const miSesionId = sesionIdRef.current;
    // (2026-10-06) Número de esta carga: si su respuesta llega DESPUÉS de la
    // de una carga más nueva (un refresco de fondo que iba atrasado), ya no
    // se aplica — traería datos viejos y, por ejemplo, haría desaparecer un
    // momento el ticket que se acaba de generar.
    numeroDeCargaRef.current += 1;
    const miNumeroDeCarga = numeroDeCargaRef.current;
    if (!deFondo) cargaNecesariaRef.current = miNumeroDeCarga;
    if (!silencioso) {
      setCargando(true);
      iniciarCarga();
    }
    const empezo = Date.now();
    ultimoIntentoDeCargaRef.current = empezo;
    const enVuelo = { desde: empezo };
    cargasEnVueloRef.current = cargasEnVueloRef.current.concat([enVuelo]);
    let seDejoDeEsperar = false;

      // Arreglo de rendimiento (2026-09-25, reportado por Claudia: al abrir
    // el panel — o incluso al darle "Actualizar" — se quedaba "cargando"
    // sin nunca terminar). Antes aquí se hacían 8 peticiones SEPARADAS al
    // mismo tiempo (una por cada pestaña de datos: productos, pedidos,
    // alertas, opciones, movimientos, bitácora, usuarios, transferencias).
    // Cada una es su PROPIA ejecución de Apps Script desde cero — vuelve a
    // abrir la hoja de cálculo, vuelve a leer "Usuarios" completa para
    // validar la sesión, y vuelve a leer "Permisos" completa para revisar
    // qué puede ver esa cuenta — así que 8 a la vez era 8 veces ese trabajo
    // repetido al mismo tiempo, y eso era lo que hacía que a veces nunca
    // terminara de contestar. Ahora se pide todo junto en una sola llamada
    // (`cargarPanelCompleto`, en Code.gs) que hace ese trabajo una sola vez
    // y ya decide del lado del servidor qué partes puede ver esta cuenta
    // (igual que antes, solo que en un solo viaje de ida y vuelta en vez de
    // ocho).
    const peticion = cargarPanelCompleto(token);
    // (2026-10-06) La respuesta se aplica CUANDO LLEGUE, aunque ya se haya
    // dejado de esperarla (antes, una respuesta que llegaba tarde se tiraba a
    // la basura y había que pedir todo otra vez).
    const aplicada = peticion.then((r) => {
      // Fix "switcheo" de sesión (2026-09): si ya cambiamos de sesión, ignoramos esta respuesta vieja.
      if (miSesionId !== sesionIdRef.current) return r;
      if (miNumeroDeCarga < ultimaCargaAplicadaRef.current) return r;
      ultimaCargaAplicadaRef.current = miNumeroDeCarga;
      // La "marca de cambios" con la que el servidor armó estos datos: el
      // refresco de fondo solo vuelve a pedir todo cuando la marca cambie.
      // Un servidor de antes no la manda: se sigue refrescando como antes.
      marcaVistaRef.current = r && typeof r.marca === 'string' ? r.marca : '';
      servidorSinMarcaRef.current = !marcaVistaRef.current;
      ultimaCargaCompletaRef.current = Date.now();
      if (miNumeroDeCarga >= cargaNecesariaRef.current) cargaNecesariaRef.current = 0;
        setProductos(r.productos || []);
        setPedidos(r.pedidos || []);
        setAlertas(r.alertas || []);
        setTransferenciasPendientes(r.transferenciasPendientes || []);
        setTransferenciasResueltas(r.transferenciasResueltas || []);
        setTransferenciasEnProceso(r.transferenciasEnProceso || []);         setTransferenciasAplicadas(r.transferenciasAplicadas || []);
        setSolicitudesReembolsoPendientes(r.solicitudesReembolsoPendientes || []);
        setSolicitudesReembolsoResueltas(r.solicitudesReembolsoResueltas || []);
        setOpciones(r.opciones || {});
        setMovimientos(r.movimientos || []);
        setVentasRecientes(Array.isArray(r.ventasRecientes) ? r.ventasRecientes : []);
        setBitacora(r.bitacora || []);
        setPapelera(r.papelera || []);
        if (r.papeleraDias) setPapeleraDias(r.papeleraDias);
        setSucursales(r.sucursales || []);
        setSucursalesQueNoAtienden(Array.isArray(r.sucursalesQueNoAtienden) ? r.sucursalesQueNoAtienden.map(String) : null);
        // Si la parte de tickets falló en el servidor ("errorTickets"), se
        // conserva lo que ya se tenía en vez de vaciar la pestaña.
        if (!r.errorTickets) {
          setTickets(r.tickets || []);
          setPedidosParaTicket(r.pedidosParaTicket || []);
          setConfiguracionTickets(r.configuracionTickets || null);
          setTicketsPuedeConfigurar(!!r.ticketsPuedeConfigurar);
        }
        setPanelYaCargo(true);
        setUsuarios(r.usuarios || []);
        setTransferencias(r.transferencias || []);
        // Permisos al día (2026-10-05): antes solo llegaban al iniciar
        // sesión, así que una pestaña nueva (como "Entradas y salidas") o un
        // cambio hecho en 🔐 Permisos no se veía hasta cerrar sesión y volver
        // a entrar. Ahora el servidor los manda en cada carga del panel. Un
        // servidor de antes no los manda: se quedan los que ya había.
        if (r.permisos && typeof r.permisos === 'object') {
          const textoPermisos = JSON.stringify(r.permisos);
          setPermisos((antes) => (JSON.stringify(antes) === textoPermisos ? antes : r.permisos));
          try {
            localStorage.setItem(PERMISOS_KEY, textoPermisos);
          } catch {
            // Sin almacenamiento: los permisos valen mientras la pestaña esté abierta.
          }
        }
      // Arreglo (2026-09-25, reportado por Claudia: el aviso de "sigue
      // cargando" se quedó pegado en pantalla para siempre, ni el refresco
      // automático lo quitaba). Si lo que había en pantalla era justo un
      // aviso o error de ESTA misma función (cargar datos), se quita solo en
      // cuanto cualquier carga (silenciosa o no) sí funciona — así el aviso
      // desaparece apenas la conexión se recupera, sin tener que darle clic
      // a "Actualizar" a mano.
      setMensaje((prev) => {
        if (!silencioso && !seDejoDeEsperar) return '';
        return prev && (prev === AVISO_PONIENDOSE_AL_DIA || prev.startsWith('Sigue cargando') || prev.startsWith('Error al cargar datos'))
          ? ''
          : prev;
      });
      return r;
    });
    // Pase lo que pase con la petición de verdad (bien, mal, tarde): deja de
    // contar como "en camino", y se anota cuánto tardó.
    aplicada.then(
      () => null,
      (err) => err
    ).then((err) => {
      cargasEnVueloRef.current = cargasEnVueloRef.current.filter((x) => x !== enVuelo);
      if (miSesionId === sesionIdRef.current) duracionUltimaCargaRef.current = Date.now() - empezo;
      // Si ya se había dejado de esperar y el servidor por fin contestó que
      // la sesión ya no vale, se cierra la sesión igual.
      if (err && err.sesionInvalida && seDejoDeEsperar && miSesionId === sesionIdRef.current) {
        handleLogout();
        setErrorLogin(err.message || 'Tu sesión ya no es válida. Vuelve a iniciar sesión.');
      }
    });

    const conTope = conLimiteDeTiempo(aplicada, 'Cargar datos', { ms: TIEMPO_MAXIMO_CARGA_INICIAL_MS, esLectura: true })
      .then((r) => r || null)
      .catch((err) => {
        if (err && err.esLimiteDeTiempo) seDejoDeEsperar = true;
        // Fix "switcheo" de sesión (2026-09): mismo control que arriba, para no reaccionar a una respuesta vieja.
        if (miSesionId !== sesionIdRef.current) return null;
        // Si el servidor dice que la sesión ya no es válida (expiró, la
        // cuenta se inhabilitó, o quedó guardado un token viejo de otra
        // sesión), cerramos sesión automáticamente en vez de dejar el
        // panel abierto sin poder cargar ni guardar nada.
        if (err.sesionInvalida) {
          handleLogout();
          setErrorLogin(err.message || 'Tu sesión ya no es válida. Vuelve a iniciar sesión.');
          return null;
        }
        // Arreglo (2026-09-25, pedido por Claudia: el mensaje de "tardó
        // demasiado" al abrir el panel se veía como un error grave y
        // asustaba, cuando en realidad Apps Script solo estaba tardando en
        // "despertar"). Si fue justo por el límite de tiempo (no un error
        // real del servidor), usamos el aviso tranquilo que ya trae
        // `conLimiteDeTiempo` tal cual — no lo marcamos como "Error". Un
        // fallo de verdad (por ejemplo el servidor contestó pero con un
        // problema) sí se muestra como error.
        // (Si mientras tanto ya llegó OTRA carga más nueva, la pantalla ya
        // tiene datos al día: no hay nada que avisar.)
        if (!silencioso && ultimaCargaAplicadaRef.current <= miNumeroDeCarga) {
          setMensaje(err.esLimiteDeTiempo ? err.message : `Error al cargar datos: ${err.message}`);
        }
        return null;
      })
      .finally(() => {
        // Bug real (2026-09-24): antes este `return` por "ya no es la
        // sesión activa" estaba ANTES de apagar el círculo de carga — si
        // alguna vez pasaba (o si una petición tardaba tanto que la sesión
        // cambiaba mientras tanto), `terminarCarga()` nunca se llamaba y el
        // círculo se quedaba encendido para siempre. Apagar el círculo NO
        // depende de que sigamos en la misma sesión (nada se corrompe por
        // apagarlo), así que ahora eso pasa siempre. Lo único que sí debe
        // depender de la sesión es `verificandoSesion`.
        if (!silencioso) {
          setCargando(false);
          terminarCarga();
        }
        // Fix "switcheo" de sesión (2026-09): ignoramos si ya no es la sesión activa.
        if (miSesionId !== sesionIdRef.current) return;
        setVerificandoSesion(false);
      });

    // La carga inicial, el botón "Actualizar" y el refresco de fondo esperan
    // lo que haga falta (tienen su propio tope de tiempo).
    if (!silencioso || deFondo) return conTope;

    // La recarga de DESPUÉS de guardar (2026-10-06, reportado por Claudia: el
    // botón se quedó en "Guardando…" casi un minuto y el pedido seguía como
    // "sin guardar", aunque el servidor ya lo había guardado: lo que no
    // llegaba era ESTA recarga). Quien guardó espera aquí a lo mucho unos
    // segundos; si para entonces no ha llegado, se suelta el botón, se avisa
    // que la pantalla se está poniendo al día, y la recarga sigue llegando
    // por su cuenta (y si falla, el refresco de fondo la repite).
    let yaTermino = false;
    conTope.then(() => { yaTermino = true; });
    return Promise.race([
      conTope,
      new Promise((resolver) => {
        setTimeout(() => {
          if (!yaTermino && !opciones.sinAviso && miSesionId === sesionIdRef.current && cargaNecesariaRef.current > 0) {
            setMensaje((prev) => (prev ? prev : AVISO_PONIENDOSE_AL_DIA));
          }
          resolver(null);
        }, ESPERA_MAXIMA_RECARGA_TRAS_GUARDAR_MS);
      }),
    ]);
  }

  useEffect(() => {
    if (autenticado) cargarTodo(sesionToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado]);

  // ---- Lo que ya se vio (pedidos y alertas), por cuenta, en este navegador ----
  function leerVistos(llave) {
    // Si la última vez no se pudo guardar en el navegador, vale lo que se
    // recuerda en esta pestaña (lo guardado estaría atrasado).
    if (vistosEnMemoriaRef.current[`${llave}:sinGuardar`]) return vistosEnMemoriaRef.current[llave] || null;
    try {
      const guardado = JSON.parse(window.localStorage.getItem(llave) || 'null');
      if (guardado !== null && typeof guardado === 'object') return guardado;
    } catch {
      // Sin almacenamiento: vale lo que se recuerde mientras la pestaña siga abierta.
    }
    return vistosEnMemoriaRef.current[llave] || null;
  }
  function guardarVistos(llave, valor) {
    vistosEnMemoriaRef.current[llave] = valor;
    try {
      window.localStorage.setItem(llave, JSON.stringify(valor));
      vistosEnMemoriaRef.current[`${llave}:sinGuardar`] = false;
    } catch {
      // Ya quedó en memoria (ver "leerVistos").
      vistosEnMemoriaRef.current[`${llave}:sinGuardar`] = true;
    }
  }

  // Pedidos NUEVOS sin ver (2026-10-06, pedido por Claudia). Un pedido se
  // "ve" cuando su renglón sale en la tabla de Pedidos con la pestaña del
  // navegador a la vista. Mientras no se haya visto, la pestaña Pedidos lleva
  // un puntito rojo; en cuanto se ve, hace su destello amarillo (dos
  // pasadas, de izquierda a derecha) y ya cuenta como visto: ni el puntito
  // ni el destello vuelven a salir por él. Si un filtro lo tiene escondido,
  // sigue contando como "sin ver" hasta que de verdad aparezca.
  // Se guarda: hasta qué fecha se conocen los pedidos ("hasta"), cuáles son
  // de esa misma fecha ("enLaMarca": un carrito anota todos sus renglones
  // con la misma fecha y hora) y cuáles siguen sin verse ("sinVer"). La
  // primera vez, todo lo que ya había cuenta como visto.
  useEffect(() => {
    if (!autenticado || !panelYaCargo || !usuarioId || !permisos.pedidos) {
      setPedidosSinVer(0);
      return;
    }
    const llave = LLAVE_PEDIDOS_VISTOS + usuarioId;
    const guardado = leerVistos(llave);
    const masNuevo = pedidos.reduce((mayor, ped) => Math.max(mayor, momentoDelPedido(ped)), 0);
    const idsDeEseMomento = (ms) => pedidos.filter((ped) => momentoDelPedido(ped) === ms).map((ped) => String(ped.ID));
    if (!guardado || typeof guardado.hasta !== 'number') {
      guardarVistos(llave, { hasta: masNuevo, enLaMarca: idsDeEseMomento(masNuevo), sinVer: [] });
      setPedidosSinVer(0);
      return;
    }
    const queExisten = new Set(pedidos.map((ped) => String(ped.ID)));
    const enLaMarca = new Set((Array.isArray(guardado.enLaMarca) ? guardado.enLaMarca : []).map(String));
    const sinVer = (Array.isArray(guardado.sinVer) ? guardado.sinVer : []).map(String).filter((id) => queExisten.has(id));
    pedidos.forEach((ped) => {
      const momento = momentoDelPedido(ped);
      const id = String(ped.ID);
      if (!momento) return;
      if ((momento > guardado.hasta || (momento === guardado.hasta && !enLaMarca.has(id))) && !sinVer.includes(id)) sinVer.push(id);
    });
    let quedan = sinVer;
    if (tab === 'pedidos' && paginaALaVista && sinVer.length > 0) {
      // Los que de verdad están dibujados en la tabla en este momento.
      const vistosAhora = sinVer.filter((id) => !!document.getElementById(`pedido-fila-${id}`));
      if (vistosAhora.length > 0) {
        destellarPedidos(vistosAhora);
        quedan = sinVer.filter((id) => !vistosAhora.includes(id));
      }
    }
    const hasta = Math.max(guardado.hasta, masNuevo);
    const siguiente = { hasta, enLaMarca: idsDeEseMomento(hasta), sinVer: quedan };
    if (JSON.stringify(siguiente) !== JSON.stringify(guardado)) guardarVistos(llave, siguiente);
    // (2026-10-08) Con "Mis pedidos (Yo)" el puntito solo cuenta los míos;
    // los de los demás se quedan "sin ver" y destellan cuando se elija
    // "Todos los pedidos".
    if (filtroPedidoDueno === 'yo') {
      const porId = new Map(pedidos.map((ped) => [String(ped.ID), ped]));
      setPedidosSinVer(quedan.filter((id) => porId.has(id) && pedidoEsMio(porId.get(id))).length);
    } else {
      setPedidosSinVer(quedan.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autenticado, panelYaCargo, usuarioId, tab, pedidos, paginaALaVista, permisos.pedidos,
    filtroEstado, filtroPedidoDesde, filtroPedidoHasta, filtroPedidoDueno, soloDeHoy, filtroPedidosDeTicket, limiteFilasPedidos, pedidosQueAtendi,
  ]);

  // Alertas sin ver (2026-10-06, Claudia: "lo mismo en Alertas, solo si
  // están sin ver; si ya los viste ya no deben salir"). Cada alerta tiene su
  // clave; al abrir la pestaña Alertas (con el navegador a la vista) todas
  // las que hay quedan vistas. Una alerta que desaparece y vuelve a salir
  // cuenta otra vez como nueva. Las solicitudes que uno mismo mandó ("en
  // proceso") no cuentan: ya las conoce.
  const clavesDeAlertas = []
    .concat(alertas.map((x) => `bajo:${x.ID}`))
    .concat(transferenciasPendientes.map((x) => `tp:${x.ID}`))
    .concat(transferenciasResueltas.map((x) => `tr:${x.ID}`))
    .concat(transferenciasAplicadas.map((x) => `ta:${x.ID}`))
    .concat(solicitudesReembolsoPendientes.filter((x) => String(x.SolicitanteID) !== String(usuarioId)).map((x) => `rp:${x.ID}`))
    .concat(solicitudesReembolsoResueltas.map((x) => `rr:${x.ID}`));
  const textoDeClavesDeAlertas = clavesDeAlertas.join('|');
  useEffect(() => {
    if (!autenticado || !panelYaCargo || !usuarioId || !permisos.alertas) {
      setHayAlertasSinVer(false);
      return;
    }
    const llave = LLAVE_ALERTAS_VISTAS + usuarioId;
    const guardado = leerVistos(llave);
    const vistas = guardado && Array.isArray(guardado.claves) ? guardado.claves.map(String) : null;
    const actuales = textoDeClavesDeAlertas ? textoDeClavesDeAlertas.split('|') : [];
    // La primera vez, y cada vez que se está VIENDO la pestaña Alertas: todo
    // lo que hay queda visto. Si no: se olvidan las que ya no existen.
    const viendolas = tab === 'alertas' && paginaALaVista;
    const quedan = vistas === null || viendolas ? actuales : vistas.filter((clave) => actuales.includes(clave));
    if (vistas === null || quedan.join('|') !== vistas.join('|')) guardarVistos(llave, { claves: quedan });
    setHayAlertasSinVer(!viendolas && actuales.some((clave) => !quedan.includes(clave)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado, panelYaCargo, usuarioId, tab, textoDeClavesDeAlertas, paginaALaVista, permisos.alertas]);

  // Al salir de Pedidos se suelta el pedido de varios productos que se
  // estaba atendiendo.
  useEffect(() => {
    if (tab !== 'pedidos') {
      setCompraActivaClave(null);
      soltarEstatusParaTodos();
    }
  }, [tab]);

  // Refresco automático en segundo plano: así los pedidos nuevos y los
  // cambios de stock se ven casi al instante, sin tener que darle
  // "Actualizar" a mano. Se pausa si hay cambios sin guardar o si está
  // abierto el formulario de agregar/editar producto, para no interrumpir.
  //
  // "latido" corre cada INTERVALO_REFRESCO_MS y decide qué toca (ver la
  // explicación completa junto a esa constante, arriba del archivo).
  function latido() {
    if (!autenticado) return;
    const ahora = Date.now();
    // Cuánto se le espera a una carga antes de darla por perdida: poco si
    // todavía no hay nada en pantalla; algo más si la pantalla quedó
    // atrasada después de guardar; y bastante en el refresco normal.
    const esperaPorPerdida = ultimaCargaCompletaRef.current === 0
      ? PETICION_PERDIDA_SIN_DATOS_MS
      : (cargaNecesariaRef.current > 0 ? PETICION_PERDIDA_TRAS_GUARDAR_MS : PETICION_PERDIDA_MS);
    const hayCargaEnVuelo = cargasEnVueloRef.current.some((x) => ahora - x.desde < esperaPorPerdida);
    // Mientras se está guardando algo, el refresco no compite con ese
    // guardado (salvo que la acción lleve colgada más de la cuenta).
    // (Si todavía no hay datos en pantalla no puede haber un guardado en
    // camino: lo único "en curso" es la carga inicial misma.)
    const hayAccionEnCurso = ultimaCargaCompletaRef.current !== 0 && cargasRealesRef.current > 0 && ahora - ultimaAccionIniciadaRef.current < PETICION_PERDIDA_MS;
    // Si la última carga tardó mucho, la siguiente espera más: al servidor
    // no se le piden cosas más rápido de lo que alcanza a contestarlas.
    const respiro = Math.min(60000, 2 * duracionUltimaCargaRef.current);
    const tocaRespirar = ahora - ultimoIntentoDeCargaRef.current < respiro;

    // 1) La pantalla quedó atrasada después de guardar algo (su recarga
    //    falló o no ha llegado): ponerla al día es lo primero, aunque haya
    //    renglones con cambios sin guardar (esos no se pierden: cada renglón
    //    conserva lo que se le escribió).
    if (cargaNecesariaRef.current > 0) {
      if (!hayCargaEnVuelo && !hayAccionEnCurso && !tocaRespirar) {
        cargarTodo(sesionToken, { silencioso: true, deFondo: true });
      }
      return;
    }
    if (sinGuardar.size > 0 || productoEditando || tab === 'nuevo') return;
    if (hayCargaEnVuelo || hayAccionEnCurso || tocaRespirar) return;

    const oculta = typeof document !== 'undefined' && !!document.hidden;
    const desdeUltimaCompleta = ahora - ultimaCargaCompletaRef.current;

    // 2) Servidor de antes (no sabe contestar la marca): se piden los datos
    //    completos como antes, pero nunca encimados.
    if (servidorSinMarcaRef.current) {
      if (oculta && desdeUltimaCompleta < REFRESCO_PESTANA_OCULTA_MS) return;
      cargarTodo(sesionToken, { silencioso: true, deFondo: true });
      return;
    }
    // 3) Cada minuto, completo de todos modos (por si alguien escribió
    //    directo en la hoja de Google). Con la pestaña en segundo plano no.
    if (!oculta && desdeUltimaCompleta >= REFRESCO_COMPLETO_MS) {
      cargarTodo(sesionToken, { silencioso: true, deFondo: true });
      return;
    }
    // 4) Lo normal: preguntar solo "¿hay algo nuevo?".
    if (revisandoMarcaDesdeRef.current > 0 && ahora - revisandoMarcaDesdeRef.current < LIMITE_MARCA_MS + 5000) return;
    if (oculta && ahora - ultimaRevisionDeMarcaRef.current < REFRESCO_PESTANA_OCULTA_MS) return;
    revisandoMarcaDesdeRef.current = ahora;
    ultimaRevisionDeMarcaRef.current = ahora;
    const miSesionId = sesionIdRef.current;
    conLimiteDeTiempo(consultarMarcaDeCambios(), 'Revisar cambios', { ms: LIMITE_MARCA_MS, esLectura: true })
      .then((r) => {
        if (miSesionId !== sesionIdRef.current) return;
        const marca = r && typeof r.marca === 'string' ? r.marca : '';
        if (!marca) {
          servidorSinMarcaRef.current = true;
          return;
        }
        const yaHayCargaEnVuelo = cargasEnVueloRef.current.some((x) => Date.now() - x.desde < PETICION_PERDIDA_MS);
        const accionEnCurso = cargasRealesRef.current > 0 && Date.now() - ultimaAccionIniciadaRef.current < PETICION_PERDIDA_MS;
        if (marca !== marcaVistaRef.current && !yaHayCargaEnVuelo && !accionEnCurso) {
          cargarTodo(sesionToken, { silencioso: true, deFondo: true });
        }
      })
      .catch((err) => {
        // Un servidor de antes contesta "Acción no reconocida".
        if (err && err.datos && err.datos.error === 'Acción no reconocida') servidorSinMarcaRef.current = true;
        // Cualquier otra falla (se fue el internet un momento): se vuelve a
        // preguntar en el siguiente latido.
      })
      .finally(() => {
        if (revisandoMarcaDesdeRef.current === ahora) revisandoMarcaDesdeRef.current = 0;
      });
  }
  latidoRef.current = latido;

  useEffect(() => {
    if (!autenticado) return undefined;
    const intervalo = setInterval(() => {
      if (latidoRef.current) latidoRef.current();
    }, INTERVALO_REFRESCO_MS);
    // Al volver a la pestaña (o al desbloquear el celular) se revisa de una
    // vez, sin esperar al siguiente latido.
    function alVolver() {
      if (typeof document !== 'undefined' && !document.hidden && latidoRef.current) latidoRef.current();
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(intervalo);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alVolver);
    };
  }, [autenticado]);

  // Un guardado que se dejó de esperar y que el servidor por fin contestó
  // (ver "alTerminarTarde_" junto a "conLimiteDeTiempo"): se dice claro si
  // quedó guardado o no, y la pantalla se pone al día.
  useEffect(() => {
    alTerminarTarde_ = (etiqueta, salioBien, dato) => {
      if (!autenticado) return;
      if (salioBien && dato && Array.isArray(dato.resultados)) {
        // El guardado de varios pedidos de un jalón.
        pintarGuardadoJunto(dato.resultados);
        soltarEstatusParaTodos();
        setMensaje(`El servidor tardó en contestar, pero ya contestó. ${resumenDeGuardadoJunto(dato.resultados, 'esa clienta')}`);
      } else if (salioBien) {
        setMensaje(dato && dato.solicitudReembolsoCreada
          ? '✓ Tu solicitud de reembolso sí se envió al Administrador: el servidor tardó en contestar, pero ya quedó. No hace falta repetirla.'
          : `✓ "${etiqueta}" sí se guardó: el servidor tardó en contestar, pero el cambio ya quedó. No hace falta repetirlo.`);
        if (dato && dato.pedido && !dato.solicitudReembolsoCreada) pintarPedidoGuardado(dato.pedido);
      } else if (dato && dato.datos) {
        // El servidor contestó, y contestó que no.
        setMensaje(`Error: "${etiqueta}" NO se guardó: ${conEtiquetasDeEstado(dato.message || 'el servidor lo rechazó')}`);
      } else {
        // Se perdió la conexión antes de saber: no hay forma de asegurarlo.
        setMensaje(`No se pudo confirmar si "${etiqueta}" se guardó (se perdió la conexión con el servidor). Revisa cómo quedó antes de repetirlo.`);
      }
      cargarTodo(sesionToken, { silencioso: true });
      // El aviso sale hasta arriba del panel: si se está más abajo (por
      // ejemplo en el formulario de un producto), se lleva la vista ahí.
      setTimeout(() => {
        try {
          const aviso = document.querySelector('.info-msg');
          if (aviso && aviso.scrollIntoView) aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch {
          // Solo es para que se vea.
        }
      }, 60);
    };
    return () => {
      alTerminarTarde_ = null;
    };
  });

   // Hace scroll hasta la fila resaltada (ver irAStockYResaltar) para que se
  // vea aunque esté más abajo en la tabla, sin tener que buscarla a mano.
  useEffect(() => {
    if (!productoResaltadoId || tab !== 'stock') return;
    const fila = document.getElementById(`stock-fila-${productoResaltadoId}`);
    if (fila) fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [productoResaltadoId, tab]);

  // Mismo mecanismo que el de arriba, pero para saltar a un pedido en
  // concreto en la pestaña Pedidos (ver "irAPedidoYResaltar", pedido por
  // Claudia para poder identificar rápido, desde Alertas, el pedido al que
  // corresponde una solicitud de reembolso).
  useEffect(() => {
    if (!pedidoResaltadoId || tab !== 'pedidos') return;
    const fila = document.getElementById(`pedido-fila-${pedidoResaltadoId}`);
    if (fila) fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pedidoResaltadoId, tab]);

  // Entra al Dashboard con usuario y contraseña (hoja "Usuarios"). Si están
  // mal, NUNCA se activa `autenticado` — así nadie que escriba mal sus
  // datos llega a ver la estructura del Dashboard, aunque sea sin datos.
  function handleLogin(e) {
    e.preventDefault();
    const usuarioTexto = inputUsuario.trim();
    const contrasena = inputContrasena;
    if (!usuarioTexto || !contrasena) return;
    setVerificandoLogin(true);
    setErrorLogin('');
        login({ usuario: usuarioTexto, contrasena })
         .then((res) => {
        // Fix "switcheo" de sesión (2026-09): "nueva sesión", para que las respuestas de la sesión anterior ya no cuenten.
        sesionIdRef.current += 1;
        numeroDeSesion_ += 1;
        const permisosCalculados = res.permisos || PESTANAS_TODAS_PERMITIDAS;
        localStorage.setItem(TOKEN_KEY, res.token);
        localStorage.setItem(ROL_KEY, res.rol);
        localStorage.setItem(NOMBRE_KEY, res.nombre);
        localStorage.setItem(ADMIN_CENTRAL_KEY, res.esAdminCentral ? 'true' : 'false');
        localStorage.setItem(USUARIO_ID_KEY, res.id || '');
        localStorage.setItem(PERMISOS_KEY, JSON.stringify(permisosCalculados));
        setSesionToken(res.token);
        setRol(res.rol);
        setNombreSesion(res.nombre);
        setEsAdminCentral(!!res.esAdminCentral);
        setUsuarioId(res.id || '');
        setPermisos(permisosCalculados);
        setInputContrasena('');
        setTab(primeraPestanaVisible(permisosCalculados));
        setAutenticado(true);
        setVerificandoSesion(false);
      })
      .catch((err) => setErrorLogin(err.message || 'No se pudo iniciar sesión'))
      .finally(() => setVerificandoLogin(false));
  }

    function handleLogout() {
           sesionIdRef.current += 1;
    numeroDeSesion_ += 1;
    soltarEstatusParaTodos();
    setCompraActivaClave(null);
    setSucursalesQueNoAtienden(null);
    marcarGuardandose(Array.from(pedidosGuardandoseRef.current), false);
    cargaNecesariaRef.current = 0;
    marcaVistaRef.current = '';
    servidorSinMarcaRef.current = false;
    ultimaCargaCompletaRef.current = 0;
    duracionUltimaCargaRef.current = 0;
    revisandoMarcaDesdeRef.current = 0;
    cargasEnVueloRef.current = [];
           localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROL_KEY);
    localStorage.removeItem(NOMBRE_KEY);
      localStorage.removeItem(ADMIN_CENTRAL_KEY);
    localStorage.removeItem(USUARIO_ID_KEY);
    localStorage.removeItem(PERMISOS_KEY);
    setAutenticado(false);
    setSesionToken('');
    setRol('');
    setNombreSesion('');
    setEsAdminCentral(false);
    setUsuarioId('');
    setPermisos(PESTANAS_TODAS_PERMITIDAS);
    setInputUsuario('');
    setInputContrasena('');
    setTab('stock');
    // Bug reportado por Claudia (2026-09): al cambiar de cuenta se veía un
    // "flash" con las notificaciones/datos de la cuenta anterior mientras
    // cargaban los de la nueva. Faltaba limpiar estos datos aquí — ahora se
    // vacían de inmediato al cerrar sesión, así la pantalla de login nunca
    // se queda con datos de otra persona.
    setProductos([]);
    setPedidos([]);
    setAlertas([]);
    setMovimientos([]);
    setVentasRecientes([]);
    setBitacora([]);
    setPapelera([]);
    setSucursales([]);
    setTickets([]);
    setPanelYaCargo(false);
    setPedidosParaTicket([]);
    setConfiguracionTickets(null);
    setTicketsPuedeConfigurar(false);
    setTicketAbiertoId(null);
    setPedidoParaGenerarTicket(null);
    setFiltroPedidosDeTicket(null);
    setTiendaEnEdicion(null);
    setUsuarios([]);
    setTransferencias([]);
    setTransferenciasPendientes([]);
    setTransferenciasResueltas([]);
    setTransferenciasEnProceso([]);
    setTransferenciasAplicadas([]);
    setSolicitudesReembolsoPendientes([]);
    setSolicitudesReembolsoResueltas([]);
    setPedidoResaltadoId(null);
    setOpciones({});
    // Bug reportado por Claudia (2026-09): un filtro que dejaba puesto una
    // persona (búsqueda, categoría, fechas, estado, orden de columnas...) se
    // le quedaba "pegado" a la siguiente que entrara en esa misma pantalla,
    // porque el arreglo anterior solo limpiaba los DATOS, no las casillas
    // de filtro. Ahora también se resetean al cerrar sesión.
    setFiltroStockPersonal('todo');
    setFiltroDesde('');
    setFiltroHasta('');
    setBusquedaStock('');
    setFiltroCategoriaStock('');
    setOrdenStock(null);
    setFiltroEstado('');
    setFiltroPedidoDesde('');
    setFiltroPedidoHasta('');
    setFiltroPedidoDueno('yo');
    setSoloDeHoy(false);
    setPedidosQueAtendi(new Set());
    setMensaje('');
  }

  // Arreglo (2026-09-23, pedido por Claudia): antes esta función no
  // regresaba su promesa, así que el cuadrito de "Actualizar stock" no
  // tenía forma de saber cuándo terminaba el guardado — el botón se
  // quedaba en "Guardar" todo el tiempo, sin avisar que estaba
  // procesando, y si fallaba, el mensaje de error se quedaba pegado en
  // pantalla aunque el siguiente intento sí funcionara. Ahora se limpia
  // el mensaje viejo al empezar y SÍ se regresa la promesa, para que
  // StockRow pueda mostrar "Guardando…" mientras espera la respuesta.
  // A partir de aquí (2026-09-24, pedido por Claudia: "recuerda que el
  // pacman es indispensable en cada carga que haya, para reducir la
  // incertidumbre al hacer un cambio") TODAS estas acciones envuelven su
  // llamada al servidor con `iniciarCarga()`/`terminarCarga()` desde el
  // primer clic (antes varias solo prendían el círculo DESPUÉS de que la
  // acción ya había contestado, durante el refresco posterior — mientras la
  // acción de verdad tardaba, no había ningún aviso). También se les puso
  // `conLimiteDeTiempo` para que, si el servidor se cuelga, la espera se dé
  // por terminada sola en vez de dejar el círculo cargando para siempre
  // (ver el comentario junto a `conLimiteDeTiempo`, arriba).
  function handleActualizarStock(productoId, nuevoStock) {
    setMensaje('');
    iniciarCarga();
    return conLimiteDeTiempo(actualizarStock({ sesionToken, productoId, nuevoStock }), 'Actualizar stock')
      // Arreglo (2026-09-25, reportado por Claudia: "el pacman se detiene 1
      // segundo antes de que se aplique el cambio, debe ser al mismo
      // tiempo"). Aquí faltaba un "return": con "{ cargarTodo(...); }" (con
      // llaves y sin "return") la función de la flecha en realidad NO
      // regresa la promesa de cargarTodo, así que la cadena ".then()" la
      // daba por "terminada" de inmediato, sin esperar a que la
      // actualización de datos (cargarTodo) de verdad completara. Eso hacía
      // que ".finally(terminarCarga)" cerrara el círculo ANTES de que los
      // datos nuevos (el stock actualizado) llegaran a la pantalla — de ahí
      // el desfase que reportó. Con "return" sí se espera a que cargarTodo
      // termine antes de cerrar el círculo.
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => {
        setMensaje(`Error al actualizar stock: ${err.message}`);
        throw err;
      })
      .finally(terminarCarga);
  }

  // (2026-10-06) Pinta en la lista lo que el servidor dice que quedó escrito
  // en un pedido, sin esperar a la recarga completa. Cualquier carga que
  // venga atrasada (pedida ANTES de este guardado) ya no se aplica: traería
  // el pedido como estaba antes.
  function pintarPedidoGuardado(pedidoGuardado) {
    if (!pedidoGuardado || pedidoGuardado.ID === undefined || pedidoGuardado.ID === null) return;
    ultimaCargaAplicadaRef.current = Math.max(ultimaCargaAplicadaRef.current, numeroDeCargaRef.current + 1);
    setPedidos((lista) => lista.map((p) => (String(p.ID) === String(pedidoGuardado.ID) ? { ...p, ...pedidoGuardado, ID: p.ID } : p)));
  }

  function handleGuardarPedido(pedidoId, { cantidad, telefono, notas, estado, montoReembolso, motivoReembolso }) {
    marcarGuardandose([pedidoId], true);
    iniciarCarga();
    return conLimiteDeTiempo(
      actualizarPedido({ sesionToken, pedidoId, cantidad, telefono, notas, estado, montoReembolso, motivoReembolso }),
      'Actualizar pedido'
    )
      .then((res) => {
        anotarPedidosQueAtendi([pedidoId]);
        // Reportado por Claudia (2026-10-06): el botón se quedó en
        // "Guardando…" casi un minuto y el pedido seguía marcado "sin
        // guardar". El servidor ya había guardado; lo que no llegaba era la
        // recarga completa de todas las hojas que se esperaba aquí. Ahora el
        // servidor contesta cómo quedó el pedido y se pinta de inmediato; la
        // recarga completa (stock, bitácora, tickets…) llega después, de
        // fondo, sin detener el botón. (Con una solicitud de reembolso sí se
        // espera: el renglón depende de que llegue la solicitud. Igual con
        // un "Reembolsado": el renglón enseña cuánto se reembolsó, y ese
        // dato llega con la recarga. Y un servidor de antes no manda el
        // pedido: se espera como antes.)
        if (res && res.pedido && !res.solicitudReembolsoCreada && res.pedido.Estado !== 'Reembolsado') {
          pintarPedidoGuardado(res.pedido);
          // "sinAviso": el renglón ya está al día; no hace falta avisar que
          // el resto de la pantalla viene en camino.
          cargarTodo(sesionToken, { silencioso: true, sinAviso: true });
          return res;
        }
        return cargarTodo(sesionToken, { silencioso: true }).then(() => res);
      })
      .then((res) => {
        // Candado de Reembolsos (2026-09-30, pedido por Claudia): si el
        // pedido no cambió de Estado de verdad porque hacía falta permiso,
        // el servidor creó una solicitud en vez de rechazar — avisamos aquí
        // para que no parezca que el guardado no hizo nada.
        if (res && res.solicitudReembolsoCreada) {
          setMensaje('Tu solicitud de reembolso se envió al Administrador — en cuanto la confirme o la cancele, este pedido pasará a "Reembolsado" (o se quedará como está).');
        }
        // Tickets automáticos (2026-10-06): el servidor avisa si al quedar
        // pagado salió el ticket solo, o si sigue esperando a los demás
        // pedidos de esa clienta.
        if (res && Array.isArray(res.ticketsCreados) && res.ticketsCreados.length > 0) {
          setMensaje(`🎫 Se generó solo el ticket ${res.ticketsCreados.join(', ')} (modo automático). Lo encuentras en la pestaña Tickets o con el 🎫 del pedido.`);
        } else if (res && res.ticketEnEspera > 0) {
          setMensaje(`⏳ El ticket de esta clienta saldrá solo cuando se resuelva${res.ticketEnEspera === 1 ? '' : 'n'} su${res.ticketEnEspera === 1 ? '' : 's'} otro${res.ticketEnEspera === 1 ? '' : 's'} ${res.ticketEnEspera} pedido${res.ticketEnEspera === 1 ? '' : 's'} de esta compra (Pendiente o En proceso).`);
        }
      })
      .catch((err) => setMensaje(`Error al actualizar pedido: ${conEtiquetasDeEstado(err.message)}`))
      .finally(() => {
        marcarGuardandose([pedidoId], false);
        terminarCarga();
      });
  }

  // ---- Tickets (2026-10-06) ----
  // Qué ticket vigente tiene cada pedido, y qué pedidos pagados todavía no
  // tienen (de los que esta persona sí puede usar): para el 🎫 de Pedidos.
  const ticketVigentePorPedidoId = {};
  tickets.forEach((t) => {
    if (t.Estado === ESTADO_TICKET_CANCELADO) return;
    (t.PedidoIDs || []).forEach((id) => { ticketVigentePorPedidoId[String(id)] = t; });
  });
  // El servidor manda de cada pedido pagado sin ticket solo su ID, su clave
  // de clienta y cuántos pedidos de esa compra faltan por resolver: lo demás
  // sale de la lista de pedidos que el panel ya tiene.
  const pedidoPorIdParaTicket = {};
  pedidos.forEach((ped) => { pedidoPorIdParaTicket[String(ped.ID)] = ped; });
  const codigoPorProductoParaTicket = {};
  productos.forEach((prod) => { codigoPorProductoParaTicket[String(prod.ID)] = prod.CodigoPropio || ''; });
  const pedidosSinTicket = pedidosParaTicket
    .map((x) => {
      const ped = pedidoPorIdParaTicket[String(x.ID)];
      if (!ped) return null;
      return {
        ID: String(ped.ID),
        Fecha: ped.Fecha,
        Cliente: String(ped.Cliente || ''),
        Telefono: textoSeguro(ped.Telefono),
        Producto: String(ped.Producto || ''),
        ProductoID: String(ped.ProductoID ?? ''),
        Codigo: String(codigoPorProductoParaTicket[String(ped.ProductoID)] || ''),
        Cantidad: Math.max(1, Math.floor(Number(ped.Cantidad) || 1)),
        Precio: Number(ped.Precio) || 0,
        SucursalNombre: String(ped.Sucursal || '').trim() ? String(ped.SucursalNombre || 'Sucursal') : '',
        ClaveCliente: x.ClaveCliente,
        SinResolver: Number(x.SinResolver) || 0,
      };
    })
    .filter(Boolean);
  const idsDePedidosParaTicket = new Set(pedidosSinTicket.map((p) => String(p.ID)));
  const ticketAbierto = ticketAbiertoId ? tickets.find((t) => t.ID === ticketAbiertoId) || null : null;
  // Si el pedido al que se le iba a generar ticket deja de estar en la lista
  // (alguien más ya se lo generó, o dejó de estar pagado), la ventana se
  // cierra de una vez: que no vuelva a aparecer sola más tarde.
  useEffect(() => {
    if (pedidoParaGenerarTicket && panelYaCargo && !pedidosParaTicket.some((x) => String(x.ID) === pedidoParaGenerarTicket)) {
      setPedidoParaGenerarTicket(null);
    }
  }, [pedidoParaGenerarTicket, panelYaCargo, pedidosParaTicket]);

  // Cada acción regresa su promesa (y deja pasar el error): la ventana que
  // la pidió enseña el resultado ahí mismo, donde se está viendo.
  function accionDeTicket(promesa, etiqueta) {
    iniciarCarga();
    return conLimiteDeTiempo(promesa, etiqueta)
      .then((res) => cargarTodo(sesionToken, { silencioso: true }).then(() => res))
      .finally(terminarCarga);
  }
  function handleCrearTickets(pedidoIds, porLote) {
    return accionDeTicket(crearTickets({ sesionToken, pedidoIds, porLote: !!porLote }), 'Generar ticket');
  }
  function handleActualizarTicket(ticket, cambios) {
    return accionDeTicket(actualizarTicket({ sesionToken, ticketId: ticket.ID, ...cambios }), 'Guardar ticket');
  }
  function handleRehacerTicket(ticket) {
    return accionDeTicket(rehacerTicket({ sesionToken, ticketId: ticket.ID }), 'Volver a armar ticket');
  }
  function handleCancelarTicket(ticket, motivo) {
    return accionDeTicket(cancelarTicket({ sesionToken, ticketId: ticket.ID, motivo }), 'Cancelar ticket');
  }
  function handleGuardarConfiguracionTickets(cambios) {
    return accionDeTicket(guardarConfiguracionTickets({ sesionToken, ...cambios }), 'Guardar datos de tickets');
  }
  // El 🎫 de un pedido: si ya tiene ticket lo abre; si no, ofrece generarlo.
  function abrirTicketDesdePedido(pedido) {
    const ticket = ticketVigentePorPedidoId[String(pedido.ID)];
    if (ticket) setTicketAbiertoId(ticket.ID);
    else if (idsDePedidosParaTicket.has(String(pedido.ID))) setPedidoParaGenerarTicket(String(pedido.ID));
  }
  // "Ver sus pedidos" desde un ticket.
  function verPedidosDeTicket(ticket) {
    if (sinGuardar.size > 0) {
      const salir = window.confirm('Tienes cambios sin guardar. Si continúas se van a perder. ¿Quieres salir de todas formas?');
      if (!salir) return;
      cancelarCambios();
    }
    setTicketAbiertoId(null);
    setFiltroPedidosDeTicket({ folio: ticket.Folio, ids: new Set((ticket.PedidoIDs || []).map(String)) });
    // …y se iluminan (2026-10-06), para ubicarlos de un vistazo.
    destellarPedidos(ticket.PedidoIDs || []);
    setFiltroEstado('');
    setFiltroPedidoDesde('');
    setFiltroPedidoHasta('');
    setFiltroPedidoDueno('');
    setSoloDeHoy(false);
    setTab('pedidos');
  }
  // Ya se buscó el folio con el que se llegó: se quita de la dirección para
  // que no se vuelva a abrir solo al recargar.
  function atenderFolioDeTicket() {
    setFolioBuscadoDeTicket('');
    try {
      const direccion = new URL(window.location.href);
      if (direccion.searchParams.has('ticket')) {
        direccion.searchParams.delete('ticket');
        window.history.replaceState(window.history.state, '', `${direccion.pathname}${direccion.search}${direccion.hash}`);
      }
    } catch {
      // Si no se puede tocar la dirección, no pasa nada.
    }
  }

  function handleCambiarDisponibilidad(producto) {
    const nuevoValor = !esProductoVisible(producto);
    iniciarCarga();
    conLimiteDeTiempo(
      cambiarDisponibilidad({ sesionToken, productoId: producto.ID, disponible: nuevoValor }),
      'Cambiar disponibilidad'
    )
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => setMensaje(`Error al cambiar visibilidad: ${err.message}`))
      .finally(terminarCarga);
  }

   function handleEliminarProducto(producto) {
    const confirmar = window.confirm(
      `¿Seguro que quieres eliminar "${producto.Nombre}"? Si fue un error, el Admin Central puede regresarlo desde la Bitácora durante ${papeleraDias} días; después ya no.`
    );
    if (!confirmar) return;
    iniciarCarga();
    conLimiteDeTiempo(eliminarProducto({ sesionToken, productoId: producto.ID }), 'Eliminar producto')
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => setMensaje(`Error al eliminar producto: ${err.message}`))
      .finally(terminarCarga);
  }

  // ---- Funcionalidad 2 (Stock personal + transferencias, 2026-09) ----
  function handleSolicitarTransferencia(producto, dueno, cantidad) {
    iniciarCarga();
    return conLimiteDeTiempo(
      solicitarTransferencia({
        sesionToken,
        productoId: producto.ID,
        duenoId: dueno.usuarioId,
        duenoNombre: dueno.nombre,
        cantidad,
      }),
      'Solicitar stock'
    )
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => {
        setMensaje(`Error al solicitar stock: ${err.message}`);
        throw err;
      })
      .finally(terminarCarga);
  }

  function handleOfrecerTransferencia(producto, dueno, destinatarioId, destinatarioNombre, cantidad) {
    iniciarCarga();
    return conLimiteDeTiempo(
      ofrecerTransferencia({
        sesionToken,
        productoId: producto.ID,
        duenoId: dueno.usuarioId,
        duenoNombre: dueno.nombre,
        destinatarioId,
        destinatarioNombre,
        cantidad,
      }),
      'Transferir stock'
    )
      // Mismo arreglo que en handleActualizarStock: faltaba el "return" que
      // hace que se espere a cargarTodo antes de cerrar el círculo.
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => {
        setMensaje(`Error al transferir stock: ${err.message}`);
        throw err;
      })
      .finally(terminarCarga);
  }

  function handleResponderTransferencia(transferenciaId, aceptar) {
    setTransferenciasEnAccion((prev) => new Set(prev).add(transferenciaId));
    iniciarCarga();
    conLimiteDeTiempo(responderTransferencia({ sesionToken, transferenciaId, aceptar }), 'Responder solicitud')
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => setMensaje(`Error al responder la solicitud: ${err.message}`))
      .finally(() => {
        terminarCarga();
        setTransferenciasEnAccion((prev) => {
          const siguiente = new Set(prev);
          siguiente.delete(transferenciaId);
          return siguiente;
        });
      });
  }

  function handleMarcarTransferenciaVista(transferenciaId) {
    setTransferenciasEnAccion((prev) => new Set(prev).add(transferenciaId));
    iniciarCarga();
    conLimiteDeTiempo(marcarTransferenciaVista({ sesionToken, transferenciaId }), 'Marcar transferencia vista')
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => {
        terminarCarga();
        setTransferenciasEnAccion((prev) => {
          const siguiente = new Set(prev);
          siguiente.delete(transferenciaId);
          return siguiente;
        });
      });
  }

  // Solicitudes de reembolso (2026-09-30, pedido por Claudia): mismo
  // patrón que handleResponderTransferencia/handleMarcarTransferenciaVista
  // de arriba, pero para la nueva hoja "SolicitudesReembolso".
  function handleResponderSolicitudReembolso(solicitudId, aceptar) {
    setSolicitudesReembolsoEnAccion((prev) => new Set(prev).add(solicitudId));
    iniciarCarga();
    conLimiteDeTiempo(responderSolicitudReembolso({ sesionToken, solicitudId, aceptar }), 'Responder solicitud de reembolso')
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => setMensaje(`Error al responder la solicitud de reembolso: ${err.message}`))
      .finally(() => {
        terminarCarga();
        setSolicitudesReembolsoEnAccion((prev) => {
          const siguiente = new Set(prev);
          siguiente.delete(solicitudId);
          return siguiente;
        });
      });
  }

  function handleMarcarSolicitudReembolsoVista(solicitudId) {
    setSolicitudesReembolsoEnAccion((prev) => new Set(prev).add(solicitudId));
    iniciarCarga();
    conLimiteDeTiempo(marcarSolicitudReembolsoVista({ sesionToken, solicitudId }), 'Marcar solicitud vista')
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => {
        terminarCarga();
        setSolicitudesReembolsoEnAccion((prev) => {
          const siguiente = new Set(prev);
          siguiente.delete(solicitudId);
          return siguiente;
        });
      });
  }

  // Feature pedido por Claudia (2026-09-30): cambia a la pestaña Pedidos y
  // marca ese pedido para que su fila se resalte en amarillo un momento —
  // igual que "irAStockYResaltar", para poder identificar rápido, desde el
  // aviso de una solicitud de reembolso en Alertas, a qué pedido corresponde.
  function irAPedidoYResaltar(pedidoId) {
    setFiltroPedidosDeTicket(null);
    // Ese pedido puede ser de otra persona o de otro día: se quitan los
    // filtros que lo esconderían.
    setFiltroPedidoDueno('');
    setSoloDeHoy(false);
    setFiltroEstado('');
    setFiltroPedidoDesde('');
    setFiltroPedidoHasta('');
    setTab('pedidos');
    setPedidoFijadoId(pedidoId);
    setPedidoResaltadoId(pedidoId);
    setTimeout(() => setPedidoResaltadoId(null), 4000);
  }

  // Feature pedido por Claudia (2026-09): cambia a la pestaña Stock y marca
  // el producto para que su fila se resalte en amarillo un momento.
  function irAStockYResaltar(productoId) {
    setTab('stock');
    setProductoFijadoId(productoId);
    setProductoResaltadoId(productoId);
    setTimeout(() => setProductoResaltadoId(null), 4000);
  }

  // "Pedir más" desde "🏪 Mi sucursal" (2026-10-02): lleva al producto en
  // Stock, donde ya existe el botón para pedirle piezas a quien tenga. Se
  // quitan antes los filtros de Stock, porque con "Solo lo mío" puesto un
  // producto del que ya no tengo piezas no aparecería.
  function irAStockParaPedirMas(productoId) {
    limpiarFiltrosStock();
    irAStockYResaltar(productoId);
  }  

  // Solo un Administrador puede usar esto (el backend también lo revisa):
  // pone en EXACTAMENTE `cantidad` la porción de este producto que le
  // toca a esa persona.
  function handleAsignarStockDueno(producto, destinoUsuarioId, destinoUsuarioNombre, cantidad) {
    iniciarCarga();
    return conLimiteDeTiempo(
      asignarStockDueno({
        sesionToken,
        productoId: producto.ID,
        usuarioId: destinoUsuarioId,
        usuarioNombre: destinoUsuarioNombre,
        cantidad,
      }),
      'Asignar stock'
    )
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
      .catch((err) => {
        setMensaje(`Error al asignar stock: ${err.message}`);
        throw err;
      })
      .finally(terminarCarga);
  }

  // (2026-10-07) Un QR de los tickets de ANTES todavía apunta a esta
  // dirección (…/admin?ticket=T-00012). Si lo lee una clienta, ya no ve la
  // pantalla de usuario y contraseña del panel: ve un aviso sencillo.


  if (!autenticado) {
    return (
      <form className="login-box" onSubmit={handleLogin}>
        <h2>Acceso administrador</h2>
        <p className="muted">
          Ingresa tu usuario y contraseña para entrar al panel de control.
        </p>
        {errorLogin && <p className="info-msg error">{errorLogin}</p>}
        <input
          type="text"
          placeholder="Usuario"
          value={inputUsuario}
          onChange={(e) => setInputUsuario(e.target.value)}
          autoComplete="username"
          required
        />
        <CampoContrasena
          placeholder="Contraseña"
          value={inputContrasena}
          onChange={(e) => setInputContrasena(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={verificandoLogin}>
          {verificandoLogin ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    );
  }

  // Todavía no confirmamos con el servidor que la clave guardada sea
  // válida (esto pasa justo después de recargar la página) — mostramos un
  // mensaje neutro en vez del panel completo, por seguridad.
  if (verificandoSesion) {
    return <p className="info-msg">Verificando sesión…</p>;
  }

  // Más recientes primero: los productos y pedidos se guardan agregándolos
  // al final del Google Sheet, así que para mostrar los más nuevos arriba
  // simplemente invertimos el orden en el que llegaron.
  const productosOrdenados = productos.slice().reverse();

  // Filtro por fecha de alta: si Claudia elige "Desde" y/o "Hasta", solo se
  // muestran los productos cuya FechaCreacion cae dentro de ese rango. Los
  // productos que no tienen fecha guardada (los que existían antes de esta
  // función) se ocultan mientras el filtro esté activo, porque no hay forma
  // de saber si entran o no en el rango.
  function productoEnRangoDeFecha(producto) {
    if (!filtroDesde && !filtroHasta) return true;
    if (!producto.FechaCreacion) return false;
    const fecha = new Date(producto.FechaCreacion);
    if (Number.isNaN(fecha.getTime())) return false;
    if (filtroDesde && fecha < new Date(`${filtroDesde}T00:00:00`)) return false;
    if (filtroHasta && fecha > new Date(`${filtroHasta}T23:59:59`)) return false;
    return true;
  }

  // Lista de nombres de categoría que existen ahorita (incluye "Otros" si
  // hay algún producto sin categoría), para llenar el menú desplegable del
  // filtro. Ordenada alfabéticamente para que sea fácil de encontrar.
  const categoriasDisponibles = Array.from(
    new Set(productos.map((p) => categoriaDeProducto(p)))
  ).sort((a, b) => a.localeCompare(b, 'es'));

  // Para poder mostrar la Categoría y el Código de cada Pedido (los pedidos
  // no guardan eso, solo el ID del producto), armamos dos mapas ID ->
  // Categoría / ID -> Código usando la lista de productos que ya tenemos
  // cargada.
  const categoriaPorProductoId = {};
  const codigoPorProductoId = {};
  // Etapa 4 (Pedidos por dueño, 2026-09-26): quién(es) tienen asignado el
  // stock del producto de cada pedido AHORITA — se resuelve en vivo con los
  // mismos `Duenos` que ya trae cada producto (los mismos que usa la
  // pestaña Stock), sin guardar ningún "dueño" fijo en Pedidos. Así, si el
  // stock cambia de dueño después, el permiso del pedido se actualiza solo.
  const duenosPorProductoId = {};
  productos.forEach((p) => {
    categoriaPorProductoId[p.ID] = categoriaDeProducto(p);
    codigoPorProductoId[p.ID] = p.CodigoPropio || '';
    duenosPorProductoId[p.ID] = p.Duenos || [];
  });

  // Catálogos por sucursal (2026-10-02): un pedido que llegó por el catálogo
  // de una persona es SOLO de esa persona (aunque el producto tenga más
  // dueños, y aunque a ella ya se le hayan acabado las piezas) — misma regla
  // que aplica el servidor en "actualizarPedido". Para los pedidos del
  // catálogo Global sigue siendo como siempre: los dueños del producto.
  // ("cantidad" se manda como mínimo en 1 porque PedidoRow toma por dueño
  // a quien tenga cantidad > 0.)
  // "Mis pedidos (Yo)" (2026-10-08). Es mío un pedido si: soy dueña del
  // producto (o es de mi sucursal); el producto no tiene dueño (cualquiera
  // lo puede atender, así no se queda escondido); yo lo cobré (mi nombre en
  // su pago); o yo lo guardé en esta visita.
  function pedidoEsMio(pedido) {
    const yo = String(usuarioId || '');
    if (!yo) return true;
    const id = String(pedido.ID);
    if (pedidosQueAtendi.has(id)) return true;
    const duenos = duenosDelPedido(pedido);
    if (duenos.length === 0) return true;
    if (duenos.some((d) => String(d.usuarioId) === yo)) return true;
    return pedidosQueYoCobre.has(id);
  }
  // Los pedidos cuyo pago quedó a mi nombre (en Movimientos).
  const pedidosQueYoCobre = new Set(
    nombreSesion
      ? movimientos.filter((m) => m.Tipo === 'Abono' && String(m.Usuario || '') === nombreSesion).map((m) => String(m.PedidoID))
          .concat(ventasRecientes.filter((v) => v.m > 0 && v.u === nombreSesion).map((v) => String(v.p)))
      : []
  );

  function duenosDelPedido(pedido) {
    const delProducto = duenosPorProductoId[pedido.ProductoID] || [];
    const sucursalId = String(pedido.Sucursal || '').trim();
    if (!sucursalId) return delProducto;
    const suya = delProducto.find((d) => String(d.usuarioId) === sucursalId);
    return [{
      usuarioId: sucursalId,
      nombre: pedido.SucursalNombre || 'Sucursal',
      cantidad: Math.max(1, suya ? Number(suya.cantidad) || 0 : 0),
    }];
  }

  // Bug reportado por Claudia (2026-09-30): después de guardar un pedido
  // como "Reembolsado", el cuadro de texto de "Monto a reembolsar" se
  // quedaba visible y editable (aunque ya no tuviera ningún efecto,
  // Guardar seguía deshabilitado) — nomás estorbaba y ensanchaba la fila.
  // Para reemplazarlo por un texto fijo ("Reembolsado: $X") una vez
  // guardado, se necesita el monto que de verdad se reembolsó — y eso NO
  // se guarda en la propia fila del pedido, solo en el "Cargo" que
  // "actualizarPedido" ya registra en Movimientos (ver Code.gs). Aquí se
  // arma un mapa PedidoID -> monto para poder mostrarlo sin tener que
  // agregar una columna nueva a la hoja de Pedidos.
  const montoReembolsadoPorPedidoId = {};
  movimientos.forEach((m) => {
    if (m.Tipo === 'Cargo' && m.PedidoID && m.Concepto === 'Reembolso de pedido') {
      montoReembolsadoPorPedidoId[m.PedidoID] = Number(m.Monto) || 0;
    }
  });

  // Arreglo (2026-09-30, reportado por Claudia con capturas): cuando
  // alguien sin el permiso de reembolsos guarda un pedido como
  // "Reembolsado", el servidor crea una SOLICITUD y deja el pedido igual a
  // propósito — pero la fila (PedidoRow) no tenía ninguna manera de
  // enterarse de que ya se había mandado esa solicitud, así que se quedaba
  // marcada como "1 cambio sin guardar" para siempre, con el botón
  // "Guardar" habilitado y bloqueando hasta la salida de la página. Este
  // mapa le permite a cada fila, por su propio PedidoID, saber si YA existe
  // una solicitud de reembolso pendiente sobre ella (Code.gs ahora incluye
  // en "solicitudesReembolsoPendientes" tanto las que puede aprobar esta
  // cuenta como las que ella misma pidió).
  const solicitudReembolsoPendientePorPedidoId = {};
  solicitudesReembolsoPendientes.forEach((s) => {
    solicitudReembolsoPendientePorPedidoId[s.PedidoID] = s;
  });
  // Usado tanto para decidir qué le toca editar a cada PedidoRow como para
  // decidir, en Alertas, si esta cuenta ve botones de Confirmar/Cancelar en
  // cada solicitud pendiente o solo un aviso de "tu solicitud sigue en
  // camino" (ver más abajo — Code.gs ahora también incluye ahí las
  // solicitudes propias, no solo las que esta cuenta puede aprobar).
  const puedeResponderReembolso = esAdminCentral || !!permisos[CLAVE_CANDADO_REEMBOLSOS];

  const productosPorFecha = productosOrdenados.filter(productoEnRangoDeFecha);
  const productosPorCategoria = filtroCategoriaStock
    ? productosPorFecha.filter((p) => categoriaDeProducto(p) === filtroCategoriaStock)
    : productosPorFecha;
   const productosBuscados = productosPorCategoria.filter((p) => coincideBusquedaStock(p, busquedaStock));
  const productosOrdenadosPorColumna = ordenarProductosStock(productosBuscados, ordenStock);

  // Funcionalidad 2 (Stock personal, 2026-09): con "Mi stock personal"
  // activo, solo se muestran los productos donde YO tengo algo asignado
  // (mi propia porción, no la de nadie más).
  function esDuenoDelProducto(producto) {
    return (producto.Duenos || []).some((d) => String(d.usuarioId) === String(usuarioId) && d.cantidad > 0);
  }
  // Filtro por dueño (2026-10-05): quién tiene piezas a su nombre, en
  // cuántos productos y cuántas piezas — sale de la misma columna "Dueño"
  // que ya se ve en la tabla, así que funciona igual para cualquier cuenta.
  function piezasDe(producto, idPersona) {
    return (producto.Duenos || []).reduce(
      (suma, d) => suma + (String(d.usuarioId) === String(idPersona) && d.cantidad > 0 ? Number(d.cantidad) || 0 : 0),
      0
    );
  }
  function tieneAlgunDueno(producto) {
    return (producto.Duenos || []).some((d) => d.cantidad > 0);
  }
  const duenosDeStock = (() => {
    const mapa = new Map();
    productos.forEach((p) => {
      const vistos = new Set();
      (p.Duenos || []).forEach((d) => {
        if (!(d.cantidad > 0)) return;
        const id = String(d.usuarioId);
        const persona = mapa.get(id) || { id, nombre: String(d.nombre || 'Sin nombre'), productos: 0, piezas: 0 };
        if (!vistos.has(id)) persona.productos += 1;
        vistos.add(id);
        persona.piezas += Number(d.cantidad) || 0;
        mapa.set(id, persona);
      });
    });
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  })();
  // (2026-10-09) Un producto agotado (0 piezas) no es "sin dueño". Las piezas
  // que de verdad no son de nadie el servidor ya se las pasa solo al Admin
  // Central, así que esta opción normalmente ni sale.
  const productosSinDueno = productos.filter((p) => !tieneAlgunDueno(p) && (Number(p.Stock) || 0) > 0).length;
  // Si la persona elegida ya no tiene nada (se le acabó o se reasignó),
  // se sigue viendo en la lista mientras esté elegida, con 0.
  const duenoElegido =
    filtroDuenoStock && filtroDuenoStock !== FILTRO_SIN_DUENO
      ? duenosDeStock.find((d) => d.id === String(filtroDuenoStock)) || {
          id: String(filtroDuenoStock),
          nombre: (usuarios.find((u) => String(u.ID) === String(filtroDuenoStock)) || {}).Nombre || 'Esa persona',
          productos: 0,
          piezas: 0,
        }
      : null;
  const valorSelectorDueno = filtroStockPersonal === 'mio' ? String(usuarioId) : filtroDuenoStock;
  function elegirDuenoDeStock(valor) {
    if (valor && valor === String(usuarioId)) {
      // Elegirme a mí es lo mismo que "Mi stock personal".
      setFiltroStockPersonal('mio');
      setFiltroDuenoStock('');
      return;
    }
    setFiltroStockPersonal('todo');
    setFiltroDuenoStock(valor);
  }

  const productosFiltrados =
    filtroStockPersonal === 'mio'
      ? productosOrdenadosPorColumna.filter(esDuenoDelProducto)
      : filtroDuenoStock === FILTRO_SIN_DUENO
        ? productosOrdenadosPorColumna.filter((p) => !tieneAlgunDueno(p))
        : filtroDuenoStock
          ? productosOrdenadosPorColumna.filter((p) => piezasDe(p, filtroDuenoStock) > 0)
          : productosOrdenadosPorColumna;

  // ---- Descargar el inventario en Excel o PDF (2026-10-05) ----
  // Pedido por Claudia: "una opción de descargar en formato PDF y Excel el
  // inventario". Baja lo MISMO que se está viendo en la tabla: con los
  // filtros y el orden que estén puestos, pero TODOS los renglones (no solo
  // los primeros 50). En el archivo, "Yo" sale con el nombre de la persona.
  function nombreDeDuenoParaArchivo(d) {
    return String(d.usuarioId) === String(usuarioId) ? nombreSesion || d.nombre || 'Yo' : d.nombre || 'Sin nombre';
  }
  function descargarInventario(formato) {
    const lista = productosFiltrados;
    const duenosCon = (p) => (p.Duenos || []).filter((d) => d.cantidad > 0);
    const precioOferta = (p) => {
      const normal = Number(p.Precio) || 0;
      const oferta = Number(p.PrecioOferta) || 0;
      return oferta > 0 && oferta < normal ? oferta : '';
    };
    const textoDuenos = (p) => duenosCon(p).map((d) => `${nombreDeDuenoParaArchivo(d)}: ${d.cantidad}`).join(' · ') || 'Sin dueño';
    const totalPiezas = lista.reduce((suma, p) => suma + (Number(p.Stock) || 0), 0);
    const conPocas = lista.filter((p) => (Number(p.Stock) || 0) <= (Number(p.StockMinimo) || 0)).length;

    // Qué filtros estaban puestos, para que el archivo lo diga.
    const filtros = [];
    if (filtroStockPersonal === 'mio') filtros.push(`Stock de ${nombreSesion || 'mi cuenta'}`);
    else if (filtroDuenoStock === FILTRO_SIN_DUENO) filtros.push('Productos sin dueño');
    else if (duenoElegido) filtros.push(`Stock de ${duenoElegido.nombre}`);
    if (filtroCategoriaStock) filtros.push(`Categoría ${filtroCategoriaStock}`);
    if (busquedaStock.trim()) filtros.push(`Buscar "${busquedaStock.trim()}"`);
    if (filtroDesde || filtroHasta) filtros.push(`Agregados: ${textoRangoFechas(filtroDesde, filtroHasta).toLowerCase()}`);
    const ahora = new Date();
    const descargado = `Descargado el ${formatearFechaHora(ahora)}${nombreSesion ? ` por ${nombreSesion}` : ''}`;
    const cuantos = `${lista.length} producto${lista.length === 1 ? '' : 's'} · ${totalPiezas.toLocaleString('es-MX')} pieza${totalPiezas === 1 ? '' : 's'}`;
    const lineaFiltros = filtros.length > 0 ? `Filtros: ${filtros.join(' · ')}` : 'Sin filtros: todo el inventario';
    const nombreArchivo = `inventario-${fechaParaArchivo(ahora)}`;

    // Si algo falla al armar el archivo, el error lo enseña el propio botón
    // (ver "BotonesDescarga").
    {
      if (formato === 'excel') {
        const filasPorDueno = [];
        lista.forEach((p) => {
          const duenos = duenosCon(p);
          if (duenos.length === 0) {
            filasPorDueno.push([p.Nombre || '', p.CodigoPropio || '', categoriaDeProducto(p), 'Sin dueño', Number(p.Stock) || 0]);
            return;
          }
          duenos.forEach((d) => {
            filasPorDueno.push([p.Nombre || '', p.CodigoPropio || '', categoriaDeProducto(p), nombreDeDuenoParaArchivo(d), Number(d.cantidad) || 0]);
          });
        });
        descargarExcel(nombreArchivo, [
          {
            nombre: 'Inventario',
            titulo: 'Inventario (Stock)',
            subtitulo: `${descargado} · ${cuantos} · ${lineaFiltros}`,
            columnas: [
              { titulo: 'Fecha agregado', tipo: 'fechaHora', ancho: 17 },
              { titulo: 'Producto', ancho: 38 },
              { titulo: 'Categoría', ancho: 16 },
              { titulo: 'Código', ancho: 18 },
              { titulo: 'Marca', ancho: 14 },
              { titulo: 'Talla', ancho: 10 },
              { titulo: 'Color', ancho: 14 },
              { titulo: 'Precio', tipo: 'dinero', ancho: 12 },
              { titulo: 'Precio de oferta', tipo: 'dinero', ancho: 12 },
              { titulo: 'Stock', tipo: 'entero', ancho: 9 },
              { titulo: 'Mínimo', tipo: 'entero', ancho: 9 },
              { titulo: 'Dueños', ancho: 42 },
              { titulo: 'En el catálogo', ancho: 13 },
            ],
            filas: lista.map((p) => [
              p.FechaCreacion || '',
              p.Nombre || '',
              categoriaDeProducto(p),
              p.CodigoPropio || '',
              p.Marca || '',
              p.Talla || '',
              p.Color || '',
              Number(p.Precio) || 0,
              precioOferta(p),
              Number(p.Stock) || 0,
              Number(p.StockMinimo) || 0,
              textoDuenos(p),
              esProductoVisible(p) ? 'Visible' : 'Oculto',
            ]),
          },
          {
            nombre: 'Por dueño',
            titulo: 'Inventario por dueño',
            subtitulo: `${descargado} · un renglón por cada persona que tiene piezas de cada producto`,
            columnas: [
              { titulo: 'Producto', ancho: 38 },
              { titulo: 'Código', ancho: 18 },
              { titulo: 'Categoría', ancho: 16 },
              { titulo: 'Dueño', ancho: 26 },
              { titulo: 'Piezas', tipo: 'entero', ancho: 10 },
            ],
            filas: filasPorDueno,
          },
        ]);
      } else {
        descargarPDF(nombreArchivo, {
          titulo: 'Inventario (Stock)',
          subtitulo: [descargado, lineaFiltros],
          autor: nombreSesion,
          resumen: [
            { etiqueta: 'Productos', valor: lista.length.toLocaleString('es-MX') },
            { etiqueta: 'Piezas en total', valor: totalPiezas.toLocaleString('es-MX') },
            { etiqueta: 'En su mínimo o menos', valor: conPocas.toLocaleString('es-MX') },
          ],
          notaPie: 'Inventario (Stock)',
          columnas: [
            { titulo: 'Fecha agregado', tipo: 'fechaHora', peso: 1.35 },
            { titulo: 'Producto', peso: 3.1 },
            { titulo: 'Categoría', peso: 1.3 },
            { titulo: 'Código', peso: 1.4 },
            { titulo: 'Precio', tipo: 'dinero', peso: 0.95 },
            { titulo: 'Precio de oferta', tipo: 'dinero', peso: 0.95 },
            { titulo: 'Stock', tipo: 'entero', peso: 0.65 },
            { titulo: 'Mínimo', tipo: 'entero', peso: 0.7 },
            { titulo: 'Dueños', peso: 2.7 },
            { titulo: 'En el catálogo', peso: 0.9 },
          ],
          filas: lista.map((p) => [
            p.FechaCreacion || '',
            p.Nombre || '',
            categoriaDeProducto(p),
            p.CodigoPropio || '',
            Number(p.Precio) || 0,
            precioOferta(p),
            Number(p.Stock) || 0,
            Number(p.StockMinimo) || 0,
            textoDuenos(p),
            esProductoVisible(p) ? 'Visible' : 'Oculto',
          ]),
        });
      }
    }
  }

  // P14: de todos los productos que pasan los filtros, cuáles se dibujan
  // (los primeros 50 / 100 / todos). El buscador y los filtros siguen
  // buscando en TODOS, no solo en los que se ven.
  const productosVisibles = recortarFilas(
    productosFiltrados,
    limiteFilasStock,
    (p) => sinGuardar.has(`stock:${p.ID}`) || String(p.ID) === String(productoFijadoId)
  );

  const filtroFechaActivo = !!(filtroDesde || filtroHasta);
  const hayFiltrosStockActivos =
    filtroFechaActivo || !!filtroCategoriaStock || !!busquedaStock.trim() || filtroStockPersonal === 'mio' || !!filtroDuenoStock;

  // Al darle clic a un encabezado de columna ordenable: 1er clic ordena de
  // menor a mayor, 2do clic de mayor a menor, 3er clic quita ese orden y
  // regresa a como estaba (más nuevos primero).
  function cambiarOrdenStock(campo) {
    setOrdenStock((prev) => {
      if (!prev || prev.campo !== campo) return { campo, direccion: 1 };
      if (prev.direccion === 1) return { campo, direccion: -1 };
      return null;
    });
  }

    function limpiarFiltrosStock() {
    setFiltroDesde('');
    setFiltroHasta('');
    setBusquedaStock('');
    setFiltroCategoriaStock('');
    setFiltroStockPersonal('todo');
    setFiltroDuenoStock('');
  }
  // Pedidos: igual que los productos, más recientes primero. Además se
  // pueden filtrar por fecha (Desde/Hasta) y por Estado con la tablita de
  // conteos de la derecha.
  // Con "Ver sus pedidos" de un ticket, la tabla enseña solo esos (los demás
  // filtros de abajo se siguen aplicando encima).
  const pedidosOrdenados = pedidos
    .slice()
    .reverse()
    .filter((ped) => !filtroPedidosDeTicket || filtroPedidosDeTicket.ids.has(String(ped.ID)));

  function pedidoEnRangoDeFecha(pedido) {
    if (!filtroPedidoDesde && !filtroPedidoHasta) return true;
    if (!pedido.Fecha) return false;
    const fecha = new Date(pedido.Fecha);
    if (Number.isNaN(fecha.getTime())) return false;
    if (filtroPedidoDesde && fecha < new Date(`${filtroPedidoDesde}T00:00:00`)) return false;
    if (filtroPedidoHasta && fecha > new Date(`${filtroPedidoHasta}T23:59:59`)) return false;
    return true;
  }

  const pedidosPorFecha = pedidosOrdenados.filter(pedidoEnRangoDeFecha);

  // Etapa 4 (Pedidos por dueño): "Todos" (filtroPedidoDueno === '') no
  // filtra nada — ver todos los pedidos siempre se puede, sin importar de
  // quién es el producto (la restricción real es de EDICIÓN, no de
  // visibilidad, ver PedidoRow). Con una persona elegida, solo se quedan
  // los pedidos cuyo producto tiene a esa persona como dueño (con algo de
  // cantidad asignada de verdad).
  const duenoPedidosElegido = filtroPedidoDueno === 'yo' ? String(usuarioId || '') : filtroPedidoDueno;
  function pedidoEsDelDueno(pedido) {
    if (!duenoPedidosElegido) return true;
    if (duenoPedidosElegido === String(usuarioId)) return pedidoEsMio(pedido);
    return duenosDelPedido(pedido).some(
      (d) => String(d.usuarioId) === String(duenoPedidosElegido) && d.cantidad > 0
    );
  }
  const pedidosPorDueno = pedidosPorFecha.filter(pedidoEsDelDueno);
  // Filtro verde "De hoy" (2026-10-08): cuántos de lo que se ve son de hoy,
  // y, si está prendido, solo esos.
  const cantidadDeHoy = pedidosPorDueno.filter((p) => esFechaDeHoy(p.Fecha)).length;
  const pedidosParaEstado = soloDeHoy ? pedidosPorDueno.filter((p) => esFechaDeHoy(p.Fecha)) : pedidosPorDueno;

  // "estadoCanonicoPedido": un pedido que todavía diga "Sin solicitud"
  // (nombre viejo) cuenta y se filtra como "Pendiente".
  const conteoPorEstado = pedidosParaEstado.reduce((acc, p) => {
    const estadoPedido = estadoCanonicoPedido(p.Estado);
    acc[estadoPedido] = (acc[estadoPedido] || 0) + 1;
    return acc;
  }, {});
  const pedidosFiltrados = filtroEstado
    ? pedidosParaEstado.filter((p) => estadoCanonicoPedido(p.Estado) === filtroEstado)
    : pedidosParaEstado;

  // P14: los pedidos que se dibujan (los más recientes primero).
  const pedidosVisibles = recortarFilas(
    pedidosFiltrados,
    limiteFilasPedidos,
    (ped) => sinGuardar.has(`pedido:${ped.ID}`) || String(ped.ID) === String(pedidoFijadoId)
  );

  // ---- Pedido de varios productos (2026-10-06) ----
  // Al tocar un renglón que es parte de un pedido de varios productos, los
  // demás renglones de ese pedido se iluminan y sale una barrita para
  // cambiarles el estatus a todos y guardarlos con un solo botón. Cada
  // renglón conserva su propio menú y su propio "Guardar".
  if (comprasMemoRef.current.pedidos !== pedidos) {
    comprasMemoRef.current = { pedidos, valor: juntarPedidosDeVariosProductos(pedidos) };
  }
  const comprasDePedidos = comprasMemoRef.current.valor;
  // ¿Hay algún pedido de varios productos a la vista? (Para dejarle su
  // lugar a la barrita aunque todavía no se haya tocado ninguno.)
  const hayComprasALaVista = pedidosVisibles.some((ped) => !!comprasDePedidos.porPedidoId[String(ped.ID)]);
  const compraActiva = compraActivaClave ? comprasDePedidos.compras[compraActivaClave] || null : null;
  const idsDeCompraActiva = compraActiva ? new Set(compraActiva.ids) : null;
  const filasDeCompraActiva = compraActiva ? pedidosVisibles.filter((ped) => idsDeCompraActiva.has(String(ped.ID))) : [];
  const fueraDeVistaDeCompra = compraActiva ? compraActiva.ids.length - filasDeCompraActiva.length : 0;
  const totalDeCompraActiva = filasDeCompraActiva.reduce((suma, ped) => suma + (Number(ped.Precio) || 0) * (Number(ped.Cantidad) || 0), 0);
  const conCambiosEnCompra = filasDeCompraActiva.filter((ped) => sinGuardar.has(`pedido:${ped.ID}`));
  // Los estatus que se le pueden poner "a todos": cualquiera que sea el paso
  // siguiente de al menos un renglón (cada renglón solo lo toma si le toca).
  // (2026-10-08, Claudia: "cuando intento reembolsar no me da la opción de
  // todos, solo uno por uno") "Reembolsado" también: cada renglón se llena
  // con SU total (se puede cambiar en su renglón) y el motivo se escribe una
  // vez en la barrita para todos.
  const estatusParaTodos = ESTADOS_PEDIDO.filter((opcion) => filasDeCompraActiva.some((ped) => (
    estadoCanonicoPedido(ped.Estado) !== opcion && opcionesEstadoPedido(ped.Estado).includes(opcion)
  )));
  const estatusGeneralElegido = compraActiva && ordenGeneralDeCompra.clave === compraActiva.clave && ordenGeneralDeCompra.estado
    ? ordenGeneralDeCompra.estado
    : '';

  // Candado de SUCURSAL (2026-10-07, regla de Claudia): un pedido que llegó
  // por el catálogo de una persona solo lo puede atender ESA persona — ni el
  // Admin Central ni quien tenga el permiso de saltarse el candado. (El
  // servidor es quien manda; aquí solo se deja de ofrecer "Desbloquear".)
  // Única salida: si esa persona ya no existe, está inhabilitada o ya no
  // tiene la pestaña Pedidos (el servidor avisa cuáles, en
  // "sucursalesQueNoAtienden"), vuelve a valer el candado normal, para que
  // el pedido no se quede atorado.
  function pedidoEsSoloDeOtraSucursal(ped) {
    // Un servidor de antes (no manda la lista) todavía no aplica esta regla.
    if (sucursalesQueNoAtienden === null) return false;
    const idSucursal = String(ped.Sucursal || '').trim();
    if (!idSucursal || idSucursal === String(usuarioId)) return false;
    return !sucursalesQueNoAtienden.includes(idSucursal);
  }

  function alTocarFilaDePedido(e) {
    marcarFilaActiva(e);
    if (e.type === 'focus' && Date.now() - momentoPunteroEnPedidosRef.current < 1500) return;
    const fila = e.target && e.target.closest ? e.target.closest('tr') : null;
    if (!fila || fila.parentElement !== e.currentTarget) return;
    const compra = comprasDePedidos.porPedidoId[String(fila.getAttribute('data-pedido-id') || '')];
    const clave = compra ? compra.clave : null;
    if (clave !== compraActivaClave) {
      filaTocadaParaCompraRef.current = { fila, top: fila.getBoundingClientRect().top };
      // Se cambió de pedido: lo que se hubiera elegido en "Estatus para
      // todos" para el anterior ya no vale.
      soltarEstatusParaTodos();
      setCompraActivaClave(clave);
    }
  }
  function cerrarCompraActiva() {
    soltarEstatusParaTodos();
    setCompraActivaClave(null);
  }

  function elegirEstatusParaTodos(estadoElegido) {
    if (!compraActiva) return;
    setOrdenGeneralDeCompra((antes) => ({ ficha: antes.ficha + 1, clave: compraActiva.clave, estado: estadoElegido || null, motivo: estadoElegido === 'Reembolsado' ? antes.motivo || '' : '' }));
  }
  // El motivo del reembolso "para todos": se copia a cada renglón que se
  // está reembolsando (sin tocar el monto que cada uno tenga escrito).
  function escribirMotivoParaTodos(texto) {
    setOrdenGeneralDeCompra((antes) => ({ ...antes, motivo: String(texto || '').slice(0, 500) }));
  }

  // En palabras, cómo salió el guardado de varios pedidos.
  function resumenDeGuardadoJunto(resultados, cliente) {
    const bien = resultados.filter((r) => r.ok);
    const mal = resultados.filter((r) => !r.ok);
    const nombreDe = (id) => {
      const ped = pedidos.find((x) => String(x.ID) === String(id));
      return ped ? String(ped.Producto || 'un producto') : 'un producto';
    };
    const partes = [];
    if (mal.length === 0) {
      partes.push(bien.length === 1
        ? `✓ Se guardó el producto del pedido de ${cliente}.`
        : `✓ Se guardaron los ${bien.length} productos del pedido de ${cliente}.`);
    } else if (bien.length === 0) {
      partes.push(`Error: no se guardó ningún producto del pedido de ${cliente}.`);
    } else {
      partes.push(`Se guardaron ${bien.length} de ${resultados.length} productos del pedido de ${cliente}.`);
    }
    if (mal.length > 0) {
      partes.push(`No se guardó: ${mal.map((r) => `${nombreDe(r.pedidoId)} — ${conEtiquetasDeEstado(r.error || 'el servidor lo rechazó')}`).join(' · ')}`);
    }
    if (bien.some((r) => r.solicitudReembolsoCreada)) {
      partes.push('La solicitud de reembolso se envió al Administrador.');
    }
    const folios = [];
    bien.forEach((r) => (r.ticketsCreados || []).forEach((folio) => { if (!folios.includes(folio)) folios.push(folio); }));
    const enEspera = bien.reduce((mayor, r) => Math.max(mayor, Number(r.ticketEnEspera) || 0), 0);
    if (folios.length > 0) partes.push(`🎫 Se generó solo el ticket ${folios.join(', ')} (modo automático).`);
    else if (enEspera > 0) partes.push(`⏳ El ticket saldrá solo cuando se resuelva${enEspera === 1 ? '' : 'n'} ${enEspera === 1 ? 'el otro pedido' : `los otros ${enEspera} pedidos`} de esta compra.`);
    return partes.join(' ');
  }

  // Pinta lo que sí se guardó; regresa true si además hace falta esperar la
  // recarga (solicitud de reembolso o "Reembolsado": dependen de ella).
  function pintarGuardadoJunto(resultados) {
    let faltaRecarga = false;
    (resultados || []).forEach((r) => {
      if (!r || !r.ok) return;
      if (r.pedido && !r.solicitudReembolsoCreada && r.pedido.Estado !== 'Reembolsado') pintarPedidoGuardado(r.pedido);
      else faltaRecarga = true;
    });
    return faltaRecarga;
  }

  // "Guardar de un jalón": manda, en una sola petición, todos los renglones
  // de este pedido que tienen cambios, cada uno con lo que tiene escrito.
  function handleGuardarCompra() {
    if (!compraActiva || guardandoCompra) return undefined;
    const cambios = [];
    const sinMonto = [];
    conCambiosEnCompra.forEach((ped) => {
      // Uno que ya se está guardando con su propio botón no se manda otra vez.
      if (pedidosGuardandoseRef.current.has(String(ped.ID))) return;
      const leer = pendientesDePedidosRef.current[String(ped.ID)];
      const dato = leer ? leer() : null;
      if (!dato) return;
      if (!dato.listo) {
        sinMonto.push(String(ped.Producto || 'un producto'));
        return;
      }
      cambios.push({ pedidoId: ped.ID, ...dato.cambio });
    });
    if (cambios.length === 0) {
      setMensaje(sinMonto.length > 0
        ? `Falta el monto o el motivo del reembolso en: ${sinMonto.join(', ')}.`
        : 'Este pedido no tiene cambios que guardar.');
      return undefined;
    }
    const cliente = compraActiva.cliente;
    const idsDelLote = cambios.map((c) => String(c.pedidoId));
    setMensaje('');
    setGuardandoCompra(true);
    marcarGuardandose(idsDelLote, true);
    iniciarCarga();
    return conLimiteDeTiempo(actualizarPedidosJuntos({ sesionToken, cambios }), 'Guardar pedido completo', { ms: TIEMPO_MAXIMO_CARGA_INICIAL_MS })
      .then((res) => {
        anotarPedidosQueAtendi(idsDelLote);
        return res;
      })
      .catch((err) => {
        // Un servidor de antes no sabe guardar varios de un jalón: se
        // guardan uno por uno, como siempre.
        if (!(err && err.datos && err.datos.error === 'Acción no reconocida')) throw err;
        return cambios
          .reduce((cadena, cambio) => cadena.then((hechos) => (
            conLimiteDeTiempo(actualizarPedido({ sesionToken, ...cambio }), 'Actualizar pedido').then(
              (r) => hechos.concat([{
                pedidoId: String(cambio.pedidoId), ok: true, error: '', pedido: r.pedido || null,
                solicitudReembolsoCreada: !!r.solicitudReembolsoCreada, ticketsCreados: r.ticketsCreados || [], ticketEnEspera: r.ticketEnEspera || 0,
              }]),
              (errUno) => hechos.concat([{ pedidoId: String(cambio.pedidoId), ok: false, error: errUno.message || 'No se pudo guardar' }])
            )
          )), Promise.resolve([]))
          .then((resultados) => ({ ok: true, resultados, deUnoPorUno: true }));
      })
      .then((res) => {
        const resultados = Array.isArray(res.resultados) ? res.resultados : [];
        // Con un servidor de antes no llega cómo quedó cada pedido: se espera la recarga.
        const faltaRecarga = pintarGuardadoJunto(resultados) || !!res.deUnoPorUno;
        const recarga = cargarTodo(sesionToken, { silencioso: true, sinAviso: !faltaRecarga });
        return (faltaRecarga ? recarga : Promise.resolve()).then(() => resultados);
      })
      .then((resultados) => {
        setMensaje(resumenDeGuardadoJunto(resultados, cliente));
        if (sinMonto.length > 0) {
          setMensaje((previo) => `${previo} Falta el monto o el motivo del reembolso en: ${sinMonto.join(', ')}.`);
        }
        // Lo elegido en "Estatus para todos" ya se usó: el menú de la
        // barrita vuelve a "— elegir —" (los renglones que no se guardaron
        // conservan lo que tienen escrito).
        soltarEstatusParaTodos();
      })
      .catch((err) => setMensaje(`Error al guardar el pedido completo: ${conEtiquetasDeEstado(err.message)}`))
      .finally(() => {
        setGuardandoCompra(false);
        marcarGuardandose(idsDelLote, false);
        terminarCarga();
      });
  }

  const filtroPedidoFechaActivo = !!(filtroPedidoDesde || filtroPedidoHasta);

  function limpiarFiltroPedidoFecha() {
    setFiltroPedidoDesde('');
    setFiltroPedidoHasta('');
  }

  // Ancho de la columna de nombres de dueño cuando se "agrandan" (botón ↔
  // de Stock): lo justo para el nombre más largo de los productos que se
  // están viendo (con un tope), igual para todas las filas, para que sigan
  // quedando alineadas.
  const largoNombreDuenoMasLargo = productosFiltrados.reduce((max, p) => {
    const largos = (p.Duenos || []).map((d) => String(String(d.usuarioId) === String(usuarioId) ? 'Yo' : d.nombre || '').length);
    return Math.max(max, ...largos, 0);
  }, 0);
  const anchoNombresDuenosExpandidos = `${(Math.min(Math.max(largoNombreDuenoMasLargo, 6), 40) * 0.72).toFixed(2)}em`;

  // ---- Avisos (2026-10-01, pedido por Claudia con capturas) ----
  // Piezas reutilizables: la misma lista se muestra en Alertas Y arriba de
  // la pestaña donde se atiende (solicitudes de stock arriba de Stock,
  // reembolsos arriba de Pedidos), sin duplicar el código.
  const listaSolicitudesStock = (
    <ListaVerMas className="transferencias-pendientes-lista" limite={3}>
                             {transferenciasPendientes.map((t) => (
                  <li key={t.ID} className="transferencias-pendientes-item">
                    <span>
                      {t.Tipo === 'Oferta' ? (
                        <><strong>{t.DuenoNombre}</strong> te asignó <strong>{t.Cantidad}</strong> de{' '}
                        <button type="button" className="link-button" onClick={() => irAStockYResaltar(t.ProductoID)}>
                          "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''}
                        </button></>
                      ) : (
                        <><strong>{t.SolicitanteNombre}</strong> te solicita <strong>{t.Cantidad}</strong> de{' '}
                        <button type="button" className="link-button" onClick={() => irAStockYResaltar(t.ProductoID)}>
                          "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''}
                        </button></>
                      )}
                    </span>
                    <div className="transferencias-pendientes-botones">
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={transferenciasEnAccion.has(t.ID)}
                        onClick={() => handleResponderTransferencia(t.ID, true)}
                      >
                        Aceptar
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={transferenciasEnAccion.has(t.ID)}
                        onClick={() => handleResponderTransferencia(t.ID, false)}
                      >
                        Rechazar
                      </button>
                    </div>
                  </li>
                ))}
              </ListaVerMas>
  );
  const bloqueReembolsos = (
    <>
                  {/* Solicitudes de reembolso (2026-09-30, pedido por Claudia).
              Corrección del mismo día (reportado por Claudia con capturas):
              esta lista ahora también incluye las solicitudes que hizo la
              PROPIA cuenta (para que su pantalla sepa que ya se mandaron —
              ver "haySolicitudPendienteReembolso" en PedidoRow), así que ya
              no se puede asumir que todo el que aparece aquí se puede
              aprobar: se branchea por elemento con "puedeResponderReembolso"
              — quien puede aprobar ve Confirmar/Cancelar; el que solo hizo
              la solicitud ve nomás un aviso de que sigue en camino (mismo
              patrón que "transferenciasEnProceso" de arriba). */}
          {solicitudesReembolsoPendientes.length > 0 && (
            <ListaVerMas className="transferencias-en-proceso-lista solicitudes-reembolso-lista" limite={3}>
              {solicitudesReembolsoPendientes.map((s) => (
                <li key={s.ID} className="solicitud-reembolso-pendiente">
                  <span>
                    {puedeResponderReembolso ? (
                      <>
                        🔒 <strong>{s.SolicitanteNombre}</strong> pide permiso para reembolsar{' '}
                        <strong>{formatearMoneda(Number(s.MontoSolicitado) || 0)}</strong> de{' '}
                        <button type="button" className="link-button" onClick={() => irAPedidoYResaltar(s.PedidoID)}>
                          "{s.Producto}"{codigoPorProductoId[s.ProductoID] ? ` (${codigoPorProductoId[s.ProductoID]})` : ''}
                        </button>
                        {' '}— {s.Cliente || 'cliente sin nombre'}, cantidad {s.Cantidad}, el{' '}
                        {formatearFechaSolo(s.Fecha)} a las {formatearHoraSolo(s.Fecha)}{' '}
                        <MotivoMinimizable texto={s.Motivo} />
                      </>
                    ) : (
                      <>
                        ⏳ Tu solicitud para reembolsar{' '}
                        <strong>{formatearMoneda(Number(s.MontoSolicitado) || 0)}</strong> de{' '}
                        <button type="button" className="link-button" onClick={() => irAPedidoYResaltar(s.PedidoID)}>
                          "{s.Producto}"{codigoPorProductoId[s.ProductoID] ? ` (${codigoPorProductoId[s.ProductoID]})` : ''}
                        </button>
                        {' '}sigue en camino — el Administrador todavía no la confirma ni la cancela.{' '}
                        <MotivoMinimizable texto={s.Motivo} />
                      </>
                    )}
                  </span>
                  {puedeResponderReembolso && (
                    <span className="solicitud-reembolso-botones">
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={solicitudesReembolsoEnAccion.has(s.ID)}
                        onClick={() => handleResponderSolicitudReembolso(s.ID, true)}
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={solicitudesReembolsoEnAccion.has(s.ID)}
                        onClick={() => handleResponderSolicitudReembolso(s.ID, false)}
                      >
                        Cancelar
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ListaVerMas>
          )}
          {solicitudesReembolsoResueltas.length > 0 && (
            <ListaVerMas className="transferencias-resueltas-lista solicitudes-reembolso-lista" limite={3}>
              {solicitudesReembolsoResueltas.map((s) => (
                <li
                  key={s.ID}
                  className={s.Estado === 'Aprobada' ? 'transferencia-aceptada' : 'transferencia-rechazada'}
                >
                  <span>
                    {s.Estado === 'Aprobada' ? '✅' : '🚫'} Tu solicitud de reembolso de{' '}
                    <strong>{formatearMoneda(Number(s.MontoSolicitado) || 0)}</strong> de{' '}
                    <button type="button" className="link-button" onClick={() => irAPedidoYResaltar(s.PedidoID)}>
                      "{s.Producto}"{codigoPorProductoId[s.ProductoID] ? ` (${codigoPorProductoId[s.ProductoID]})` : ''}
                    </button>
                    {' '}fue {s.Estado === 'Aprobada' ? 'aprobada' : 'rechazada'}
                    {s.RespondidoPor ? <> por <strong>{s.RespondidoPor}</strong></> : null}{' '}
                    <MotivoMinimizable texto={s.Motivo} />
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={solicitudesReembolsoEnAccion.has(s.ID)}
                    onClick={() => handleMarcarSolicitudReembolsoVista(s.ID)}
                  >
                    Entendido
                  </button>
                </li>
              ))}
            </ListaVerMas>
          )}
    </>
  );
  const idsReembolsos = solicitudesReembolsoPendientes.map((r) => r.ID).concat(solicitudesReembolsoResueltas.map((r) => r.ID));

  // Arreglo (2026-10-01, reportado por Claudia): el número de la pestaña
  // Alertas solo contaba los productos con bajo inventario (por eso "siempre
  // decía 1"). Ahora cuenta TODO lo que se ve dentro de esa pestaña.
  const conteoAlertasPestana =
    alertas.length +
    transferenciasPendientes.length +
    transferenciasEnProceso.length +
    transferenciasResueltas.length +
    transferenciasAplicadas.length +
    idsReembolsos.length;

  // Recuadros de avisos de arriba (2026-10-01): bajo inventario (🔴),
  // solicitudes de stock (🟡) y reembolsos (🔵). Ajuste del mismo día
  // (Claudia: "las alertas de círculos desaparecen si cambias de pestaña,
  // eso no me gusta"): antes el amarillo solo salía en Stock y el azul solo
  // en Pedidos — ahora los TRES salen igual en TODAS las pestañas (abiertos
  // o como puntito, según como los dejaste), así nunca desaparecen. Cada uno se puede
  // minimizar a un puntito de color; si llega algo NUEVO mientras está
  // minimizado (un ID que no estaba cuando se minimizó), el punto parpadea.
  const avisosDeArriba = [
    {
      tipo: 'bajoStock',
      color: 'rojo',
      nombre: 'Bajo inventario',
      ids: alertas.map((a) => a.ID),
      visibleAqui: true,
      // P14: si son muchos productos, se ven los primeros 6 y "… y N más".
      titulo: <TituloBajoInventario alertas={alertas} onIr={irAStockYResaltar} />,
      contenido: null,
    },
    {
      tipo: 'solicitudesStock',
      color: 'amarillo',
      nombre: 'Solicitudes de stock',
      ids: transferenciasPendientes.map((t) => t.ID),
      visibleAqui: true,
      titulo: (
        <>
          📥 Tienes {transferenciasPendientes.length} solicitud{transferenciasPendientes.length === 1 ? '' : 'es'} de stock pendiente{transferenciasPendientes.length === 1 ? '' : 's'}:
        </>
      ),
      contenido: listaSolicitudesStock,
    },
    {
      tipo: 'reembolsos',
      color: 'azul',
      nombre: 'Solicitudes de reembolso',
      ids: idsReembolsos,
      visibleAqui: true,
      titulo: <>💸 Solicitudes de reembolso ({idsReembolsos.length}):</>,
      contenido: bloqueReembolsos,
    },
  ].filter((a) => a.ids.length > 0 && a.visibleAqui);
  const estaMinimizado = (tipo) => Object.prototype.hasOwnProperty.call(avisosMinimizados, tipo);
  const avisosEnPunto = avisosDeArriba.filter((a) => estaMinimizado(a.tipo));
  const avisosAbiertos = avisosDeArriba.filter((a) => !estaMinimizado(a.tipo));
  function hayNuevoEnAviso(a) {
    const vistos = Array.isArray(avisosMinimizados[a.tipo]) ? avisosMinimizados[a.tipo].map(String) : [];
    return a.ids.some((id) => !vistos.includes(String(id)));
  }
  const zonaAvisos = avisosDeArriba.length === 0 ? null : (
    <div className="zona-avisos">
      {avisosEnPunto.length > 0 && (
        <div className="avisos-puntos">
          {avisosEnPunto.map((a) => (
            <button
              key={a.tipo}
              type="button"
              className={`aviso-punto aviso-punto-${a.color}${hayNuevoEnAviso(a) ? ' aviso-punto-nuevo' : ''}`}
              onClick={() => abrirAviso(a.tipo)}
              title={`${a.nombre} (${a.ids.length}) — clic para abrir`}
              aria-label={`${a.nombre}: ${a.ids.length}. Clic para abrir`}
            >
              {a.ids.length}
            </button>
          ))}
        </div>
      )}
      {avisosAbiertos.map((a) => (
        <div key={a.tipo} className={`aviso-panel aviso-panel-${a.color}`}>
          {/* Ajuste (2026-10-01, Claudia: "el botón de minimizar está muy
              cerca del de Rechazar"): "Minimizar" pasa al lado IZQUIERDO,
              antes del título — lejos de los botones de Aceptar/Rechazar/
              Confirmar/Cancelar, que siempre van a la derecha. */}
          <div className="aviso-panel-encabezado">
            <button
              type="button"
              className="aviso-panel-minimizar"
              onClick={() => minimizarAviso(a.tipo, a.ids)}
              title="Minimizar — se queda como un puntito de color; dale clic al punto para volver a abrirlo"
              aria-label="Minimizar este aviso"
            >
              ▾ Minimizar
            </button>
            <div className="aviso-panel-titulo">{a.titulo}</div>
          </div>
          {a.contenido}
        </div>
      ))}
    </div>
  );

  return (
    <div className="dashboard">
      {sesionCambiadaFuera && (
        <div className="modal-overlay sesion-cambiada-overlay" role="alertdialog" aria-modal="true">
          <div className="modal-box">
            <h3>⚠️ La sesión cambió en otra pestaña</h3>
            <p>
              {sesionCambiadaFuera === 'otraCuenta'
                ? 'En otra pestaña de este mismo navegador se entró con OTRA cuenta. Para no mezclar cuentas (y que nada se guarde a nombre de quien no es), esta pestaña ya no se puede seguir usando así.'
                : 'En otra pestaña de este mismo navegador se cerró la sesión. Para no seguir trabajando con una sesión que ya se cerró, esta pestaña ya no se puede seguir usando así.'}
            </p>
            <p className="muted">
              Al recargar, esta pestaña va a quedar con la sesión que esté abierta ahora en este navegador
              {sesionCambiadaFuera === 'cerrada' ? ' (o sea, te va a pedir iniciar sesión)' : ''}. Si quieres usar dos
              cuentas a la vez, usa otro navegador o una ventana de incógnito para la segunda.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                Recargar esta pestaña
              </button>
            </div>
          </div>
        </div>
      )}
      <IndicadorCarga activo={mostrarIndicadorCarga} progreso={progresoCarga} />
      <div className="dashboard-header">
        <h2>Panel de administración</h2>
        <div className="dashboard-header-acciones">
                    <span className="muted texto-usuario-conectado">
            Sesión: <strong>{nombreSesion || 'Sin nombre'}</strong> · {rol || '—'}
          </span>
          {/* Arreglo (2026-09-24, pedido por Claudia: "el botón de actualizar
              no me da certeza de saber si cuando lo cliqueo si acciona o no,
              no parece que haga algo"). Antes el único aviso de que el clic
              sí hizo algo era el círculo chiquito de la esquina, fácil de no
              notar. Ahora el botón mismo cambia de texto y se deshabilita
              mientras carga, para que quede clarísimo que SÍ reaccionó — y
              de paso evita que un doble clic dispare dos cargas iguales. */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => cargarTodo(sesionToken)}
            disabled={cargando}
          >
            {cargando ? 'Actualizando…' : '🔄 Actualizar'}
          </button>
          <button className="btn btn-secondary" onClick={handleLogout}>Cerrar sesión</button>
        </div>
      </div>

      {zonaAvisos}

      {/* Arreglo (2026-09-25, pedido por Claudia: un aviso de "sigue
          cargando" (no un error de verdad) se veía en rojo fuerte y
          asustaba). Un mensaje que empieza con "Error" se muestra en rojo;
          cualquier otro (como el aviso tranquilo de "Sigue cargando…") se
          muestra en un tono más neutro. */}
      <MensajeDelPanel texto={mensaje} onQuitar={(quitado) => setMensaje((actual) => (actual === quitado ? '' : actual))} />
      {cargando && <p className="info-msg">Actualizando…</p>}

      {/* Aviso flotante: se queda pegado abajo de la pantalla aunque hagas
          scroll, y lista EXACTAMENTE qué dato(s) cambiaste sin guardar. */}
      {sinGuardar.size > 0 && (
        <div className="aviso-flotante">
          <p className="aviso-flotante-titulo">
            ⚠️ Tienes {sinGuardar.size} cambio(s) sin guardar:
          </p>
          {/* P14: si son muchos cambios, se ven los primeros 4 y "Ver N más". */}
          <ListaVerMas limite={4}>
            {Array.from(sinGuardar.values()).map((descripcion, i) => (
              <li key={i}>{descripcion}</li>
            ))}
          </ListaVerMas>
          <div className="aviso-flotante-acciones">
            <button type="button" className="btn btn-secondary btn-small" onClick={cancelarCambios}>
              Cancelar cambios (Esc)
            </button>
          </div>
          <p className="aviso-flotante-nota">
            Dale clic a "Guardar" en cada fila antes de salir de esta pestaña.
          </p>
        </div>
      )}

      {/* Pestañas (2026-10-01, pendiente P13): se arman desde una lista
          para poder acomodarlas en el orden que cada quien elija — ver
          "ordenPestanas" arriba. El orden ORIGINAL es el de esta lista. */}
      {(() => {
        const todas = [
          { clave: 'stock', texto: 'Stock', visible: puedeVer('stock') },
          {
            clave: 'pedidos', texto: `Pedidos (${pedidos.length})`, visible: puedeVer('pedidos'),
            punto: pedidosSinVer > 0
              ? `${pedidosSinVer} pedido${pedidosSinVer === 1 ? ' nuevo' : 's nuevos'} sin ver${tab === 'pedidos' ? ' (no se ve' + (pedidosSinVer === 1 ? '' : 'n') + ' en la tabla: revisa los filtros o cuántos renglones se muestran)' : ''}`
              : '',
          },
          // 2026-10-06: tickets de los pedidos pagados. Solo sale si el
          // servidor ya la conoce (manda su permiso).
          { clave: 'tickets', texto: '🎫 Tickets', visible: puedeVerTickets },
          { clave: 'alertas', texto: `Alertas (${conteoAlertasPestana})`, visible: puedeVer('alertas'), punto: hayAlertasSinVer ? 'Hay alertas nuevas sin ver' : '' },
          { clave: 'cuenta', texto: '📄 Estado de cuenta', visible: puedeVer('cuenta') },
          { clave: 'bitacora', texto: '🗒️ Bitácora', visible: puedeVer('bitacora') },
          // 2026-10-05: historial de entradas y salidas de piezas. Solo sale
          // si el servidor ya la conoce (manda su permiso); se prende o apaga
          // por Rol o por persona desde 🔐 Permisos.
          { clave: 'inventario', texto: '📥 Entradas y salidas', visible: puedeVer('inventario') },
          { clave: 'usuarios', texto: '👤 Usuarios', visible: puedeVer('usuarios') },
          { clave: 'analitica', texto: '📈 Analítica de ventas', visible: puedeVer('analitica') },
          { clave: 'orden', texto: '🔀 Orden del catálogo', visible: puedeVer('orden') },
          { clave: 'nuevo', texto: '+ Agregar producto', visible: puedeVer('nuevo') },
          { clave: 'permisos', texto: '🔐 Permisos', visible: esAdminCentral },
          // Catálogos por sucursal (2026-10-02): la ve quien tiene "Catálogo
          // propio" prendido; el Admin Central siempre (revisa todas).
          { clave: 'sucursal', texto: esAdminCentral ? '🏪 Sucursales' : '🏪 Mi sucursal', visible: esAdminCentral || sucursales.length > 0 },
        ].filter((p) => p.visible);
        const posicionGuardada = (clave) => {
          const i = ordenPestanas.indexOf(clave);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const pestanas = todas
          .map((p, indiceOriginal) => ({ ...p, indiceOriginal }))
          .sort((x, y) => posicionGuardada(x.clave) - posicionGuardada(y.clave) || x.indiceOriginal - y.indiceOriginal);
        const claves = pestanas.map((p) => p.clave);
        const esOrdenOriginal = claves.every((c, i) => c === todas[i].clave);

        function mover(clave, destino) {
          const lista = claves.filter((c) => c !== clave);
          const limite = Math.max(0, Math.min(destino, lista.length));
          lista.splice(limite, 0, clave);
          guardarOrdenPestanas(lista);
        }

        return (
          <div className={`tabs${ordenandoPestanas ? ' tabs-ordenando' : ''}`}>
            {pestanas.map((p, i) =>
              ordenandoPestanas ? (
                <span
                  key={p.clave}
                  className={`tab-ordenable${pestanaArrastrada === p.clave ? ' arrastrando' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setPestanaArrastrada(p.clave);
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', p.clave); } catch { /* algunos navegadores */ }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (pestanaArrastrada && pestanaArrastrada !== p.clave) mover(pestanaArrastrada, i);
                    setPestanaArrastrada(null);
                  }}
                  onDragEnd={() => setPestanaArrastrada(null)}
                  title="Arrástrala a su lugar, o usa las flechitas"
                >
                  <button type="button" className="tab-mover" onClick={() => mover(p.clave, i - 1)} disabled={i === 0} aria-label={`Mover ${p.texto} a la izquierda`}>
                    ◀
                  </button>
                  <span className="tab-ordenable-texto">⠿ {p.texto}</span>
                  <button type="button" className="tab-mover" onClick={() => mover(p.clave, i + 1)} disabled={i === pestanas.length - 1} aria-label={`Mover ${p.texto} a la derecha`}>
                    ▶
                  </button>
                </span>
              ) : (
                <button key={p.clave} className={tab === p.clave ? 'active' : ''} onClick={() => cambiarTab(p.clave)}>
                  {p.texto}
                  {/* (2026-10-06) Puntito rojo: hay algo nuevo sin ver ahí.
                      Se quita al abrir la pestaña. */}
                  {p.punto ? <span className="tab-punto" title={p.punto} aria-label={p.punto} data-tab-punto={p.clave} /> : null}
                </button>
              )
            )}
            {ordenandoPestanas ? (
              <span className="tabs-ordenar-acciones">
                <button type="button" className="tabs-ordenar-btn" onClick={() => guardarOrdenPestanas([])} disabled={esOrdenOriginal}>
                  ↺ Orden original
                </button>
                <button type="button" className="tabs-ordenar-btn tabs-ordenar-listo" onClick={() => setOrdenandoPestanas(false)}>
                  ✓ Listo
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="tabs-ordenar-btn tabs-ordenar-abrir"
                onClick={() => setOrdenandoPestanas(true)}
                title="Acomodar las pestañas en el orden que tú quieras (solo cambia en este navegador)"
                aria-label="Acomodar pestañas"
              >
                ⇄ Acomodar
              </button>
            )}
          </div>
        );
      })()}
      {ordenandoPestanas && (
        <p className="muted tabs-ordenar-ayuda">
          Arrastra cada pestaña a donde la quieras (o usa ◀ ▶). Se guarda solita en este navegador, solo para tu cuenta, y
          no se anota en la Bitácora. Dale "✓ Listo" al terminar.
        </p>
      )}

      {!puedeVer(tab) && tab !== 'permisos' && tab !== 'sucursal' && (
        <p className="info-msg">
          Ya no tienes acceso a esta pestaña. Elige otra de arriba, o pídele al Admin Central que revise tus permisos.
        </p>
      )}

           {tab === 'stock' && puedeVer('stock') && (
        <>

          <div className="stock-personal-toggle">
            <button
              type="button"
              className={`resumen-btn ${filtroStockPersonal === 'todo' && !filtroDuenoStock ? 'activo' : ''}`}
              onClick={() => elegirDuenoDeStock('')}
            >
              Todo el stock
            </button>
            <button
              type="button"
              className={`resumen-btn ${filtroStockPersonal === 'mio' ? 'activo' : ''}`}
              onClick={() => elegirDuenoDeStock(String(usuarioId))}
            >
              Mi stock personal
            </button>
            {/* Filtro por dueño (2026-10-05): ver qué productos tiene cada
                persona. Entre paréntesis, en cuántos productos tiene piezas. */}
            <label className="pedidos-filtro-dueno-admin stock-filtro-dueno">
              Ver stock de:
              <select value={valorSelectorDueno} onChange={(e) => elegirDuenoDeStock(e.target.value)} aria-label="Ver el stock de una persona">
                <option value="">Todos</option>
                {!duenosDeStock.some((d) => d.id === String(usuarioId)) && <option value={String(usuarioId)}>Yo (0)</option>}
                {duenoElegido && duenoElegido.productos === 0 && <option value={duenoElegido.id}>{duenoElegido.nombre} (0)</option>}
                {duenosDeStock.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id === String(usuarioId) ? `Yo — ${d.nombre}` : d.nombre} ({d.productos})
                  </option>
                ))}
                {(productosSinDueno > 0 || valorSelectorDueno === FILTRO_SIN_DUENO) && (
                  <option value={FILTRO_SIN_DUENO}>Sin dueño ({productosSinDueno})</option>
                )}
              </select>
            </label>
            {duenoElegido && (
              <span className="stock-dueno-resumen">
                🧑 <strong>{duenoElegido.nombre}</strong> tiene <strong>{duenoElegido.piezas}</strong> pieza
                {duenoElegido.piezas === 1 ? '' : 's'} a su nombre en <strong>{duenoElegido.productos}</strong> producto
                {duenoElegido.productos === 1 ? '' : 's'}.
              </span>
            )}
            {filtroDuenoStock === FILTRO_SIN_DUENO && (
              <span className="stock-dueno-resumen">
                📦 <strong>{productosSinDueno}</strong> producto{productosSinDueno === 1 ? '' : 's'} que nadie tiene asignado
                {productosSinDueno === 1 ? '' : 's'}.
              </span>
            )}
          </div>

          <div className="filtro-fechas">
            <label>
              Buscar
              <input
                type="text"
                value={busquedaStock}
                onChange={(e) => setBusquedaStock(e.target.value)}
                placeholder="Nombre, categoría, código, stock, o $precio…"
              />
            </label>
            <label>
              Categoría
              <select
                value={filtroCategoriaStock}
                onChange={(e) => setFiltroCategoriaStock(e.target.value)}
              >
                <option value="">Todas</option>
                {categoriasDisponibles.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Agregados desde
              <input
                type="date"
                value={filtroDesde}
                onChange={(e) => setFiltroDesde(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={filtroHasta}
                onChange={(e) => setFiltroHasta(e.target.value)}
              />
            </label>
            <span className="stock-conteo-total">
              📦 <strong>{productos.length}</strong> producto{productos.length === 1 ? '' : 's'} en total
            </span>
            <BotonesDescarga
              que="el inventario"
              onExcel={() => descargarInventario('excel')}
              onPDF={() => descargarInventario('pdf')}
              cuantos={productosFiltrados.length}
            />
            {hayFiltrosStockActivos && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={limpiarFiltrosStock}
              >
                Quitar filtros
              </button>
            )}
            {hayFiltrosStockActivos && (
              <span className="filtro-fechas-conteo">
                Mostrando {productosFiltrados.length} de {productosOrdenados.length} productos
              </span>
            )}
          </div>

          {/* Pedido de Claudia (2026-09-28): que el encabezado de Stock y de
              Pedidos se quede fijo/visible arriba al hacer scroll hacia
              abajo, para no perder de vista qué es cada columna en tablas
              largas. "table-scroll-fijo" (ver global.css) desactiva el
              recorte vertical que traía "table-scroll" por default — ese
              recorte, aunque nunca se notaba a simple vista, le impedía a
              "position: sticky" funcionar (bug clásico de CSS: un
              antepasado con "overflow" puesto en algo distinto de
              "visible" rompe el pegado, aunque ese antepasado nunca llegue
              a necesitar su propio scroll). Solo se activa aquí y en
              Pedidos — el resto de las tablas de la app se quedan igual. */}
          <div className="table-scroll table-scroll-fijo">
            <table
              ref={tablaStockRef}
              className={`data-table stock-table${duenosExpandidos ? ' duenos-expandidos' : ''}`}
              style={{
                // Anchos medidos (ver "anchosDuenos"). Si aún no se miden, el
                // CSS usa sus anchos de respaldo.
                ...(anchosDuenos.nombre > 0 ? { '--ancho-nombre-natural': `${anchosDuenos.nombre}px` } : {}),
                ...(anchosDuenos.cantidad > 0 ? { '--ancho-cantidad-dueno': `${anchosDuenos.cantidad}px` } : {}),
                // Nombres agrandados (lupa): el ancho del nombre más largo,
                // completo, sin el tope normal.
                ...(duenosExpandidos
                  ? {
                      '--ancho-nombre-dueno':
                        anchosDuenos.nombre > 0 ? `${Math.min(anchosDuenos.nombre, 460)}px` : anchoNombresDuenosExpandidos,
                    }
                  : {}),
              }}
            >
              <thead>
                <tr>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('fecha')}>
                      Fecha agregado <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'fecha')}</span>
                    </button>
                  </th>
                  <th>
                    {/* 2026-10-01 (Claudia): "la columna de Hora igual debe
                        dejarnos alterar el orden, con su punto verde y sus
                        flechas como las demás". Ordena por la hora del día. */}
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('hora')}>
                      Hora agregado <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'hora')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('nombre')}>
                      Producto <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'nombre')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('categoria')}>
                      Categoría <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'categoria')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('codigo')}>
                      Código <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'codigo')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('precio')}>
                      Precio <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'precio')}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('stock')}>
                      Stock <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'stock')}</span>
                    </button>
                  </th>
                  <th>
                    {/* Rediseñado (2026-10-01, Claudia con captura): el botón
                        "🔍 Ver nombres completos" iba DEBAJO de la palabra
                        Dueño y dejaba este encabezado más arriba que los
                        demás. Ahora es solo una lupita en la misma línea, a
                        la derecha de "Dueño"; su explicación sale como
                        comentario flotante (tipo Word) al pasarle el mouse
                        o darle clic, sin mover ni ensanchar la columna. El
                        clic además agranda/recorta los nombres. Solo
                        aparece cuando de verdad hay algún nombre recortado
                        con "…" (o cuando están agrandados, para regresar). */}
                    <span className="stock-th-dueno">
                      Dueño
                      {(hayNombresDuenoRecortados || duenosExpandidos) && (
                        <>
                          <button
                            type="button"
                            ref={lupaDuenosRef}
                            className={`btn-lupa-duenos${duenosExpandidos ? ' activa' : ''}`}
                            aria-label={duenosExpandidos ? 'Volver a recortar los nombres largos' : 'Ver los nombres completos'}
                            onMouseEnter={() => setAvisoLupaDuenos((v) => v || 'hover')}
                            onMouseLeave={() => setAvisoLupaDuenos((v) => (v === 'hover' ? null : v))}
                            onClick={() => {
                              setDuenosExpandidos((v) => !v);
                              setAvisoLupaDuenos('clic');
                            }}
                          >
                            🔍
                          </button>
                          <AvisoFlotante
                            anclaRef={lupaDuenosRef}
                            abierto={avisoLupaDuenos !== null}
                            onCerrar={() => setAvisoLupaDuenos(null)}
                            autoCerrarMs={avisoLupaDuenos === 'clic' ? 6000 : 0}
                          >
                            {duenosExpandidos ? (
                              <>
                                <strong>Nombres completos.</strong> Se vuelven a recortar solos en 5 minutos, o dale
                                clic otra vez a la lupa para recortarlos ahora.
                              </>
                            ) : (
                              <>
                                <strong>Ver nombres completos.</strong> Algunos nombres están recortados con "…" —
                                dale clic a la lupa para verlos completos.
                              </>
                            )}
                          </AvisoFlotante>
                        </>
                      )}
                    </span>
                  </th>
                  <th>Mínimo</th>
                  <th>Actualizar stock</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody onClickCapture={marcarFilaActiva} onFocusCapture={marcarFilaActiva}>
                {productosVisibles.map((p) => (
                                                                    <StockRow
                    key={`${p.ID}-${resetToken}`}
                    producto={p}
                    categoria={categoriaDeProducto(p)}
                    usuarioId={usuarioId}
                    controlTotal={esAdministrador}
                    usuarios={usuarios}
                    misSolicitudesEnProceso={transferenciasEnProceso}
                    resaltado={p.ID === productoResaltadoId}
                    onActualizar={handleActualizarStock}
                    onDirtyChange={marcarSucio}
                    onEditar={setProductoEditando}
                    onCambiarDisponibilidad={handleCambiarDisponibilidad}
                    onEliminar={handleEliminarProducto}
                    onVerFoto={setFotoAmpliada}
                                      onSolicitar={handleSolicitarTransferencia}
                    onOfrecer={handleOfrecerTransferencia}
                    onAsignarDueno={handleAsignarStockDueno}
                    onAlternarNombresDuenos={() => setDuenosExpandidos((v) => !v)}
                  />
                ))}
              </tbody>
            </table>
            {productosFiltrados.length === 0 && (
              <p className="info-msg">Ningún producto coincide con la búsqueda o los filtros de arriba.</p>
            )}
          </div>
          <BarraFilas
            total={productosFiltrados.length}
            visibles={productosVisibles.length}
            limite={limiteFilasStock}
            onCambiar={(valor) => {
              setProductoFijadoId(null);
              setLimiteFilasStock(valor);
            }}
            nombre="productos"
          />
        </>
      )}

           {tab === 'pedidos' && puedeVer('pedidos') && (
        <>
          {filtroPedidosDeTicket && (
            <p className="ticket-filtro-pedidos" role="status">
              🎫 Viendo solo los pedidos del ticket <strong>{filtroPedidosDeTicket.folio}</strong>{' '}
              ({pedidosOrdenados.length} de {filtroPedidosDeTicket.ids.size}
              {pedidosFiltrados.length !== pedidosOrdenados.length ? `; con los filtros de abajo se ven ${pedidosFiltrados.length}` : ''}).
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setFiltroPedidosDeTicket(null)}>
                Ver todos los pedidos
              </button>
            </p>
          )}
          <div className="filtro-fechas">
            <label>
              Pedidos desde
              <input
                type="date"
                value={filtroPedidoDesde}
                onChange={(e) => setFiltroPedidoDesde(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={filtroPedidoHasta}
                onChange={(e) => setFiltroPedidoHasta(e.target.value)}
              />
            </label>
            {filtroPedidoFechaActivo && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={limpiarFiltroPedidoFecha}
              >
                Quitar filtro de fechas
              </button>
            )}
          </div>

          {/* Etapa 4 (Pedidos por dueño, 2026-09-26): igual que "Mi stock
              personal" en Stock — un Vendedor solo puede alternar entre
              "Todos" y "Mis pedidos" (los suyos); un Admin/Admin Central
              puede además elegir a CUALQUIER persona para ver nada más los
              pedidos de lo que ella tiene asignado. Esto solo filtra qué se
              VE en la tabla — no restringe nada de edición, eso lo hace
              cada fila por separado (ver PedidoRow) sin importar este
              filtro. */}
          <div className="stock-personal-toggle">
            <button
              type="button"
              className={`resumen-btn ${duenoPedidosElegido === '' ? 'activo' : ''}`}
              onClick={() => setFiltroPedidoDueno('')}
              data-pedidos-todos
            >
              Todos los pedidos
            </button>
            <button
              type="button"
              className={`resumen-btn ${duenoPedidosElegido !== '' && duenoPedidosElegido === String(usuarioId) ? 'activo' : ''}`}
              onClick={() => setFiltroPedidoDueno('yo')}
              data-pedidos-mios
            >
              Mis pedidos (Yo)
            </button>
            <ResumenDeVentas
              ventas={ventasRecientes}
              nombre={
                esAdministrador
                  ? (duenoPedidosElegido === ''
                    ? null
                    : duenoPedidosElegido === String(usuarioId)
                      ? nombreSesion
                      : ((usuarios.find((u) => String(u.ID) === duenoPedidosElegido) || {}).Nombre || ''))
                  : nombreSesion
              }
              esMio={!esAdministrador || duenoPedidosElegido === String(usuarioId)}
            />
            {esAdministrador && (
              <label className="pedidos-filtro-dueno-admin">
                Ver pedidos de:
                <select
                  value={duenoPedidosElegido}
                  onChange={(e) => setFiltroPedidoDueno(e.target.value === String(usuarioId) ? 'yo' : e.target.value)}
                  data-pedidos-dueno
                >
                  <option value="">Todos</option>
                  {usuarios.filter((u) => esActivo(u.Activo)).map((u) => (
                    <option key={u.ID} value={u.ID}>
                      {String(u.ID) === String(usuarioId) ? `${u.Nombre} (Yo)` : u.Nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Tablita de conteo por estado, ARRIBA de la tabla (no al lado),
              para no quitarle ancho a la tabla y así evitar que tenga que
              hacer scroll hacia los lados. Los números ya respetan el
              filtro de fechas Y el de dueño de arriba, si están activos. */}
          <div className="pedidos-resumen-fila">
            <span className="pedidos-resumen-titulo">Pedidos por estado:</span>
            <button
              type="button"
              className={`resumen-btn ${filtroEstado === '' && !soloDeHoy ? 'activo' : ''}`}
              onClick={() => { setFiltroEstado(''); setSoloDeHoy(false); }}
            >
              <span>Todos</span>
              <strong>{pedidosPorDueno.length}</strong>
            </button>
            <button
              type="button"
              className={`resumen-btn resumen-btn-hoy ${soloDeHoy ? 'activo' : ''}`}
              onClick={() => setSoloDeHoy((antes) => !antes)}
              aria-pressed={soloDeHoy}
              title="Solo los pedidos de hoy (se puede combinar con un estado)"
              data-pedidos-de-hoy
            >
              <span>De hoy</span>
              <strong>{cantidadDeHoy}</strong>
            </button>
            {ESTADOS_PEDIDO.map((estadoOpcion) => (
              <button
                key={estadoOpcion}
                type="button"
                className={`resumen-btn ${filtroEstado === estadoOpcion ? 'activo' : ''}`}
                onClick={() => setFiltroEstado(estadoOpcion)}
              >
                <span>{etiquetaEstadoPedido(estadoOpcion)}</span>
                <strong>{conteoPorEstado[estadoOpcion] || 0}</strong>
              </button>
            ))}
            {hayComprasALaVista && !compraActiva && <AvisoDeCompra />}
          </div>

          {/* Pedido de varios productos (2026-10-06; rehecho el 2026-10-08 a
              pedido de Claudia: "que solo aparezca cuando presionamos un
              pedido de múltiples productos, si no que no aparezca, para que
              no sature la vista; que esté minimizado").
              - sin tocar un pedido de varios productos: NO hay franja; solo
                un 💡 chiquito al final de "Pedidos por estado" (minimizado);
              - al tocarlo: la barrita amarilla, pegada arriba aunque se baje
                la página, para cambiarles el estatus a todos y guardarlos
                juntos. Al aparecer empuja la tabla hacia abajo, así que se
                compensa el scroll para que el renglón tocado no se mueva. */}
          {(() => {
            const activa = !!compraActiva && filasDeCompraActiva.length >= 2;
            if (!activa) return null;
            const sinCambiar = filasDeCompraActiva.length - conCambiosEnCompra.length;
            const notas = [];
            if (estatusParaTodos.length === 0) notas.push('Estos productos ya no tienen un estatus que se les pueda poner a todos de una vez.');
            if (estatusGeneralElegido && sinCambiar > 0) {
              notas.push(`${sinCambiar} no cambi${sinCambiar === 1 ? 'ó' : 'aron'}: ya estaba${sinCambiar === 1 ? '' : 'n'} así, ese estatus no le${sinCambiar === 1 ? '' : 's'} toca o tiene${sinCambiar === 1 ? '' : 'n'} candado 🔒.`);
            }
            if (fueraDeVistaDeCompra > 0) {
              notas.push(`${fueraDeVistaDeCompra} producto${fueraDeVistaDeCompra === 1 ? '' : 's'} más de este pedido no se ve${fueraDeVistaDeCompra === 1 ? '' : 'n'} ahorita en la tabla (por los filtros o por cuántos renglones se muestran).`);
            }
            const textoDeNotas = notas.join(' ');
            const titulo = `Pedido de ${compraActiva.cliente} · ${filasDeCompraActiva.length} productos · ${formatearMoneda(totalDeCompraActiva)}`;
            return (
              <div className="compra-franja compra-franja-activa" data-compra-franja="activa">
                <div className="compra-barra" role="group" aria-label={`Pedido de ${compraActiva.cliente}, ${filasDeCompraActiva.length} productos`} data-compra-barra>
                  <span className="compra-barra-titulo" title={titulo}>
                    Pedido de <strong>{compraActiva.cliente}</strong> · {filasDeCompraActiva.length} productos · {formatearMoneda(totalDeCompraActiva)}
                  </span>
                  <span className="compra-barra-nota" title={textoDeNotas || undefined} data-compra-nota>{textoDeNotas}</span>
                  <span className="compra-barra-controles">
                    {estatusGeneralElegido === 'Reembolsado' && (
                      <input
                        type="text"
                        className="compra-barra-motivo"
                        value={ordenGeneralDeCompra.motivo || ''}
                        onChange={(e) => escribirMotivoParaTodos(e.target.value)}
                        placeholder="¿Por qué se reembolsa? (para todos)"
                        aria-label="Motivo del reembolso para todos los productos de este pedido"
                        disabled={guardandoCompra}
                        maxLength={500}
                        data-compra-motivo
                      />
                    )}
                    {estatusParaTodos.length > 0 && (
                      <label className="compra-barra-estado">
                        <span className="compra-barra-etiqueta">Estatus para todos</span>
                        <span className="compra-barra-etiqueta-corta">Para todos:</span>
                        <select
                          value={estatusGeneralElegido}
                          onChange={(e) => elegirEstatusParaTodos(e.target.value)}
                          disabled={guardandoCompra}
                          aria-label="Estatus para todos los productos de este pedido"
                          data-compra-estatus
                        >
                          <option value="">— elegir —</option>
                          {estatusParaTodos.map((opcion) => (
                            <option key={opcion} value={opcion}>{etiquetaEstadoPedido(opcion)}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={handleGuardarCompra}
                      disabled={guardandoCompra || conCambiosEnCompra.length === 0}
                      title={conCambiosEnCompra.length === 0 ? 'Cambia algo en los productos de este pedido (o elige un "Estatus para todos") y aquí los guardas juntos. Cada producto conserva su propio menú y su propio "Guardar".' : 'Guarda en un solo paso todos los productos de este pedido que tienen cambios'}
                      data-compra-guardar
                    >
                      {guardandoCompra
                        ? 'Guardando…'
                        : conCambiosEnCompra.length === 0
                          ? '💾 Guardar todos'
                          : conCambiosEnCompra.length === 1 ? '💾 Guardar el que cambió' : `💾 Guardar los ${conCambiosEnCompra.length} de un jalón`}
                    </button>
                    <button type="button" className="compra-barra-cerrar" onClick={cerrarCompraActiva} title="Dejar de ver este pedido junto" aria-label="Cerrar">
                      ✕
                    </button>
                  </span>
                </div>
              </div>
            );
          })()}

          <div className="table-scroll table-scroll-fijo">
            <table className="data-table pedidos-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Categoría</th><th>Código</th>
                  <th>Cant.</th><th>Precio</th><th>Total</th><th>Notas</th><th>Estado</th><th>Dueño(s)</th><th>Guardar</th>
                </tr>
              </thead>
              <tbody
                onPointerDownCapture={() => { momentoPunteroEnPedidosRef.current = Date.now(); }}
                onClickCapture={alTocarFilaDePedido}
                onFocusCapture={alTocarFilaDePedido}
              >
                {pedidosVisibles.map((ped) => (
                  <PedidoRow
                    key={`${ped.ID}-${resetToken}`}
                    pedido={ped}
                    destello={pedidosConDestello.has(String(ped.ID))}
                    enCompraActiva={!!idsDeCompraActiva && idsDeCompraActiva.has(String(ped.ID))}
                    ordenGeneral={idsDeCompraActiva && idsDeCompraActiva.has(String(ped.ID)) && ordenGeneralDeCompra.clave === compraActivaClave ? ordenGeneralDeCompra : null}
                    guardandoJunto={guardandoCompra && pedidosGuardandose.has(String(ped.ID))}
                    onRegistrarPendiente={registrarPendienteDePedido}
                    categoria={categoriaPorProductoId[ped.ProductoID] || '—'}
                    codigo={codigoPorProductoId[ped.ProductoID] || '—'}
                    duenos={duenosDelPedido(ped)}
                    sucursalNombre={String(ped.Sucursal || '').trim() ? (ped.SucursalNombre || 'Sucursal') : ''}
                    usuarioId={usuarioId}
                    puedeSaltarCandado={(esAdminCentral || !!permisos[CLAVE_CANDADO_PEDIDOS]) && !pedidoEsSoloDeOtraSucursal(ped)}
                    soloDeSuSucursal={pedidoEsSoloDeOtraSucursal(ped)}
                    puedeReembolsar={puedeResponderReembolso}
                    montoReembolsado={montoReembolsadoPorPedidoId[ped.ID]}
                    solicitudReembolsoPendiente={solicitudReembolsoPendientePorPedidoId[ped.ID]}
                    resaltado={ped.ID === pedidoResaltadoId}
                    ticket={puedeVerTickets ? ticketVigentePorPedidoId[String(ped.ID)] : undefined}
                    puedeGenerarTicket={puedeVerTickets && idsDePedidosParaTicket.has(String(ped.ID))}
                    onTicket={abrirTicketDesdePedido}
                    onGuardar={handleGuardarPedido}
                    onDirtyChange={marcarSucio}
                    onAbrirNota={(cliente, valor, onChange) => setNotaEnZoom({ cliente, valor, onChange })}
                  />
                ))}
              </tbody>
            </table>
            {pedidosFiltrados.length === 0 && (
              <p className="info-msg">Ningún pedido coincide con el estado, el rango de fechas o el filtro de "Ver pedidos de…" de arriba.</p>
            )}
          </div>
          <BarraFilas
            total={pedidosFiltrados.length}
            visibles={pedidosVisibles.length}
            limite={limiteFilasPedidos}
            onCambiar={(valor) => {
              setPedidoFijadoId(null);
              setLimiteFilasPedidos(valor);
            }}
            nombre="pedidos"
          />
        </>
      )}

                      {tab === 'alertas' && puedeVer('alertas') && (
        <>
          {/* 2026-10-01: las solicitudes de stock que te hicieron también se
              ven aquí (antes solo arriba de Stock), para que Alertas
              muestre TODO lo que cuenta su número. */}
          {transferenciasPendientes.length > 0 && (
            <div className="transferencias-pendientes-panel">
              <p className="transferencias-pendientes-titulo">
                📥 Tienes {transferenciasPendientes.length} solicitud{transferenciasPendientes.length === 1 ? '' : 'es'} de stock pendiente{transferenciasPendientes.length === 1 ? '' : 's'}:
              </p>
              {listaSolicitudesStock}
            </div>
          )}
                   {transferenciasEnProceso.length > 0 && (
            <ListaVerMas className="transferencias-en-proceso-lista" limite={6}>
              {transferenciasEnProceso.map((t) => (
                <li key={t.ID}>
                                  {t.Tipo === 'Oferta' ? (
                    <>⏳ Le asignaste <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''} a <strong>{t.SolicitanteNombre}</strong>, esperando que acepte</>
                  ) : (
                    <>⏳ Esperando respuesta de <strong>{t.DuenoNombre}</strong> por <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''}</>
                  )}
                </li>
              ))}
            </ListaVerMas>
          )}
                  {transferenciasResueltas.length > 0 && (
            <ListaVerMas className="transferencias-resueltas-lista" limite={6}>
              {transferenciasResueltas.map((t) => (
                <li
                  key={t.ID}
                  className={t.Estado === 'Aceptada' ? 'transferencia-aceptada' : 'transferencia-rechazada'}
                >
                                   <span>
                                       {t.Tipo === 'Oferta' ? (
                      <><strong>{t.SolicitanteNombre}</strong> {t.Estado === 'Aceptada' ? 'aceptó' : 'rechazó'} lo que le asignaste de{' '}
                      <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''}</>
                    ) : (
                      <><strong>{t.DuenoNombre}</strong> {t.Estado === 'Aceptada' ? 'aceptó' : 'rechazó'} tu solicitud de{' '}
                      <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''}</>
                    )}
                  </span>
                                   <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={transferenciasEnAccion.has(t.ID)}
                    onClick={() => handleMarcarTransferenciaVista(t.ID)}
                  >
                    Entendido
                  </button>
                </li>
              ))}
            </ListaVerMas>
          )}
          {transferenciasAplicadas.length > 0 && (
            <ListaVerMas className="transferencias-resueltas-lista" limite={6}>
              {transferenciasAplicadas.map((t) => (
                <li key={t.ID} className="transferencia-aplicada">
                  <span>
                                                                          {String(t.SolicitanteID) === String(usuarioId) ? (
                      <>✅ Recibiste <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''} (venía de <strong>{t.DuenoNombre}</strong>){t.RealizadoPor ? <> — lo asignó <strong>{t.RealizadoPor}</strong> el {formatearFechaSolo(t.FechaRespuesta)} a las {formatearHoraSolo(t.FechaRespuesta)}</> : null}</>
                    ) : (
                      <>↪️ Se movieron <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''} que tenías, a <strong>{t.SolicitanteNombre}</strong>{t.RealizadoPor ? <> — lo hizo <strong>{t.RealizadoPor}</strong> el {formatearFechaSolo(t.FechaRespuesta)} a las {formatearHoraSolo(t.FechaRespuesta)}</> : null}</>
                    )}
                  </span>
                                 <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={transferenciasEnAccion.has(t.ID)}
                    onClick={() => handleMarcarTransferenciaVista(t.ID)}
                  >
                    Entendido
                  </button>
                </li>
              ))}
            </ListaVerMas>
          )}
          {bloqueReembolsos}
                   <ListaVerMas className="alert-list" limite={10}>
            {alertas.length === 0 && <li>Sin alertas de bajo inventario 🎉</li>}
            {alertas.map((a) => (
              <li key={a.ID}>
                <button type="button" className="link-button" onClick={() => irAStockYResaltar(a.ID)}>
                  <strong>{a.Nombre}</strong>{a.CodigoPropio ? ` (${a.CodigoPropio})` : ''} — quedan {a.Stock} (mínimo {a.StockMinimo})
                </button>
              </li>
            ))}
          </ListaVerMas>
        </>
      )}

      {tab === 'cuenta' && puedeVer('cuenta') && (
        <EstadoCuentaTab movimientos={movimientos} pedidos={pedidos} productos={productos} />
      )}

      {tab === 'bitacora' && puedeVer('bitacora') && (
        <BitacoraTab
          bitacora={bitacora}
          papelera={papelera}
          papeleraDias={papeleraDias}
          esAdminCentral={esAdminCentral}
          sesionToken={sesionToken}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
          iniciarCarga={iniciarCarga}
          terminarCarga={terminarCarga}
        />
      )}

      {tab === 'tickets' && puedeVerTickets && (
        <TicketsTab
          tickets={tickets}
          pedidosParaTicket={pedidosSinTicket}
          configuracion={configuracionTickets}
          tienda={tiendaEnEdicion}
          setTienda={setTiendaEnEdicion}
          puedeConfigurar={ticketsPuedeConfigurar}
          folioBuscado={panelYaCargo ? folioBuscadoDeTicket : ''}
          onFolioAtendido={atenderFolioDeTicket}
          onCrear={handleCrearTickets}
          onAbrirTicket={(t) => setTicketAbiertoId(t.ID)}
          onVerPedidos={puedeVer('pedidos') ? verPedidosDeTicket : null}
          onGuardarConfiguracion={handleGuardarConfiguracionTickets}
        />
      )}

      {tab === 'inventario' && puedeVer('inventario') && (
        <InventarioTab
          sesionToken={sesionToken}
          productos={productos}
          nombreSesion={nombreSesion}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true, deFondo: true })}
          onVerFoto={setFotoAmpliada}
        />
      )}

      {tab === 'usuarios' && puedeVer('usuarios') && (
        <UsuariosTab
          usuarios={usuarios}
          sesionToken={sesionToken}
          soyAdminCentral={esAdminCentral}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
          iniciarCarga={iniciarCarga}
          terminarCarga={terminarCarga}
        />
      )}

      {tab === 'analitica' && puedeVer('analitica') && <AnaliticaTab sesionToken={sesionToken} />}

      {tab === 'sucursal' && (
        esAdminCentral || sucursales.length > 0 ? (
          <SucursalTab
            sucursales={sucursales}
            ventasRecientes={ventasRecientes}
            usuarioId={usuarioId}
            esAdminCentral={esAdminCentral}
            sesionToken={sesionToken}
            onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
            iniciarCarga={iniciarCarga}
            terminarCarga={terminarCarga}
            onPedirMas={puedeVer('stock') ? irAStockParaPedirMas : null}
            onVerFoto={setFotoAmpliada}
          />
        ) : (
          <p className="info-msg">Tu cuenta ya no tiene catálogo propio. Elige otra pestaña de arriba.</p>
        )
      )}

      {tab === 'orden' && puedeVer('orden') && (
        <OrdenDelCatalogo
          key={`orden-${resetToken}`}
          sucursales={sucursales}
          usuarioId={usuarioId}
          puedeOrdenarGeneral={esAdminCentral || !!permisos[CLAVE_ORDEN_GENERAL]}
          puedeAyudarSucursales={esAdministrador || esAdminCentral}
          hayCambiosSinGuardar={sinGuardar.has('orden-catalogo')}
          onDirtyChange={marcarSucio}
          productos={productos}
          opciones={opciones}
          sesionToken={sesionToken}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
          iniciarCarga={iniciarCarga}
          terminarCarga={terminarCarga}
        />
      )}

          {tab === 'nuevo' && puedeVer('nuevo') && (
             <ProductoForm
          sesionToken={sesionToken}
          opciones={opciones}
          setOpciones={setOpciones}
          usuarios={usuarios}
          productos={productos}
          esAdministrador={esAdministrador}
          usuarioId={usuarioId}
          nombreSesion={nombreSesion}
          formExterno={formNuevoProducto}
          setFormExterno={setFormNuevoProducto}
          fotosExterno={fotosNuevoProducto}
          setFotosExterno={setFotosNuevoProducto}
          onOpcionesActualizadas={() => cargarTodo(sesionToken, { silencioso: true })}
          iniciarCarga={iniciarCarga}
          terminarCarga={terminarCarga}
          onGuardado={() => {
            // Arreglo (2026-09-25): antes esta función no regresaba la
            // promesa de cargarTodo, así que ProductoForm cerraba su
            // círculo de carga sin esperar a que los datos nuevos de
            // verdad llegaran — mismo bug que en handleActualizarStock.
            //
            // Arreglo (2026-09-29, reportado por Claudia): al guardar un
            // producto, esto la mandaba automáticamente a la pestaña
            // Stock. Primero se intentó arreglar solo el caso en que ella
            // ya se había ido a otra pestaña mientras esperaba (con
            // `tabRef`, ver historial), pero luego pidió explícitamente
            // que YA NO SE HAGA ESE SALTO EN ABSOLUTO, ni siquiera si se
            // queda esperando en "Agregar producto": "no quiero que me
            // redireccione a la pestaña de Stock". Se quitó por completo
            // — después de guardar, se queda donde esté, y el listado se
            // actualiza solo de fondo (silencioso) para que el producto ya
            // aparezca en Stock la próxima vez que Claudia entre ahí.
            return cargarTodo(sesionToken, { silencioso: true });
          }}
        />
      )}

      {tab === 'permisos' && esAdminCentral && (
        <PermisosTab
          sesionToken={sesionToken}
          usuarios={usuarios}
          iniciarCarga={iniciarCarga}
          terminarCarga={terminarCarga}
        />
      )}

      {productoEditando && (
        <div className="modal-overlay" onClick={() => setProductoEditando(null)}>
          <div className="modal-box modal-box-ancho" onClick={(e) => e.stopPropagation()}>
            <h3>Editar producto</h3>
            <ProductoForm
              sesionToken={sesionToken}
              opciones={opciones}
              setOpciones={setOpciones}
              usuarioId={usuarioId}
              productos={productos}
              onOpcionesActualizadas={() => cargarTodo(sesionToken, { silencioso: true })}
              productoExistente={productoEditando}
              iniciarCarga={iniciarCarga}
              terminarCarga={terminarCarga}
              onGuardado={() => {
                // Mismo arreglo: hay que regresar la promesa de cargarTodo
                // para que ProductoForm espere a que termine antes de
                // cerrar su círculo de carga.
                setProductoEditando(null);
                return cargarTodo(sesionToken, { silencioso: true });
              }}
              onCancelar={() => setProductoEditando(null)}
            />
          </div>
        </div>
      )}

      {fotoAmpliada && (
        <ImageLightbox src={fotoAmpliada} onClose={() => setFotoAmpliada('')} />
      )}

      {/* ---- Tickets (2026-10-06): ventanas ---- */}
      {ticketAbierto && puedeVerTickets && (
        <ModalTicket
          key={ticketAbierto.ID}
          ticket={ticketAbierto}
          configuracion={configuracionTickets}
          puedeVerPedidos={puedeVer('pedidos')}
          onCerrar={() => setTicketAbiertoId(null)}
          onGuardar={handleActualizarTicket}
          onRehacer={handleRehacerTicket}
          onCancelar={handleCancelarTicket}
          onVerPedidos={verPedidosDeTicket}
        />
      )}
      {pedidoParaGenerarTicket && puedeVerTickets && (() => {
        const delPedido = pedidosSinTicket.find((p) => String(p.ID) === pedidoParaGenerarTicket);
        if (!delPedido) return null;
        return (
          <ModalGenerarTicket
            key={pedidoParaGenerarTicket}
            pedidos={pedidosSinTicket.filter((p) => p.ClaveCliente === delPedido.ClaveCliente)}
            inicialId={pedidoParaGenerarTicket}
            onCerrar={() => setPedidoParaGenerarTicket(null)}
            onGenerar={(ids) =>
              handleCrearTickets(ids).then((res) => {
                setPedidoParaGenerarTicket(null);
                // Se abre el ticket recién hecho, listo para descargar (y se
                // dice aparte, por si la lista tarda en traerlo).
                if (res && res.creados && res.creados[0]) {
                  setTicketAbiertoId(res.creados[0].ID);
                  setMensaje(`🎫 Se generó el ticket ${res.creados[0].Folio}.`);
                }
              })
            }
          />
        );
      })()}

      {notaEnZoom && (
        <div className="modal-overlay" onClick={() => setNotaEnZoom(null)}>
          <div className="modal-box modal-box-ancho" onClick={(e) => e.stopPropagation()}>
            <h3>Nota de {notaEnZoom.cliente}</h3>
            <textarea
              className="nota-modal-textarea"
              value={notaEnZoom.valor}
              onChange={(e) => {
                notaEnZoom.onChange(e.target.value);
                setNotaEnZoom((prev) => (prev ? { ...prev, valor: e.target.value } : prev));
              }}
              placeholder="Sin notas"
              autoFocus
            />
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => setNotaEnZoom(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FORM_INICIAL = {
  nombre: '',
  categoria: '',
  marca: '',
  talla: '',
  color: '',
  precio: '',
  precioCompra: '',
  stock: '',
    stockMinimo: '',
  descripcion: '',
  codigoPropio: '',
  precioOferta: '',
  enOferta: false,
  duenoId: '',
};

function formDesdeProducto(producto) {
  return {
    nombre: producto.Nombre || '',
    categoria: producto.Categoria || '',
    marca: producto.Marca || '',
    talla: producto.Talla || '',
    color: producto.Color || '',
    precio: producto.Precio ?? '',
    precioCompra: producto.PrecioCompra ?? '',
    stock: producto.Stock ?? '',
    stockMinimo: producto.StockMinimo ?? '',
       descripcion: producto.Descripcion || '',
    codigoPropio: textoSeguro(producto.CodigoPropio),
    precioOferta: producto.PrecioOferta ?? '',
    enOferta: !!producto.EnOferta,
  };
}
function fotosDesdeProducto(producto) {
  return String(producto?.FotoURL || '')
    .split('|')
    .map((u) => u.trim())
    .filter(Boolean);
}

// Los 6 campos del formulario que tienen "opciones predeterminadas"
// administrables (Claudia las agrega/edita/quita a mano desde el botón ⚙️
// de cada uno). La llave (`campo`) es la que se usa para guardarlas en la
// hoja "Opciones" del Sheet.
const CAMPOS_CON_OPCIONES = [
  { campo: 'nombre', etiqueta: 'Nombre' },
  { campo: 'codigoPropio', etiqueta: 'Código propio' },
  { campo: 'categoria', etiqueta: 'Categoría' },
  { campo: 'marca', etiqueta: 'Marca' },
  { campo: 'talla', etiqueta: 'Talla / Medida' },
  { campo: 'color', etiqueta: 'Color' },
];

// Arreglo (2026-09-30, pedido por Claudia): reemplaza al <input list="…">
// + <datalist> nativo que usaban Nombre, Código propio, Categoría, Marca,
// Talla y Color. El datalist del navegador tiene un problema sin solución
// limpia: en cuanto el campo ya tiene un texto que coincide con una
// opción, la próxima vez que abres la lista solo aparece ESA opción, no
// las demás. El arreglo anterior (2026-09-29) vaciaba el campo al
// enfocarlo para forzar que el navegador mostrara la lista completa, pero
// Claudia reportó que no le gusta que el campo se vea vacío al dar
// clic/tocarlo — "debe de seguirse pudiendo ver, y ya solo si selecciono
// otra categoría que se limpie". Por eso este combobox es propio (no usa
// <datalist> en absoluto): el campo de texto SIEMPRE muestra el valor
// actual (nunca se vacía solo), y al enfocarlo/tocarlo se abre una lista
// propia (un <ul> normal) con TODAS las opciones predeterminadas, sin
// filtrar por lo que ya esté escrito. Si eliges una opción de la lista, el
// valor del campo cambia a esa opción y la lista se cierra; si no eliges
// nada, el valor que ya tenía se queda igual. También se puede seguir
// escribiendo libremente como antes (no es obligatorio elegir de la
// lista).
//
// Arreglo (2026-10-02, reportado por Claudia: "sigue fallando... cuando le
// damos clic a un campo y ya tiene una categoría dentro debería seguir
// viendo cuáles otras hay... si le doy clic no veo qué más hay a menos que
// la borre"). La causa: la lista solo se abría cuando el campo RECIBÍA el
// foco. Después de elegir una opción el campo se queda con el foco, así que
// volver a darle clic ya no hacía nada (no hay un "nuevo" foco) y parecía
// que no había más opciones. Ahora la lista se abre:
//   - al dar clic o tocar el campo, SIEMPRE (tenga o no el foco, tenga o no
//     algo escrito), mostrando TODAS las opciones;
//   - con la flechita ▾ de la derecha (abre y cierra);
//   - al escribir (ahí sí se acorta a las opciones que contienen lo
//     escrito, para encontrarlas rápido; si ninguna coincide, se ven todas);
//   - con las flechas ↓ ↑ del teclado (Enter elige, Esc cierra).
// La opción que ya está puesta se marca con ✓. El campo nunca se vacía
// solo: solo cambia si eliges otra opción o escribes otra cosa.
function CampoConOpciones({ id, valor, onChange, opciones = [], placeholder, maxLength, required }) {
  const [abierta, setAbierta] = useState(false);
  // "filtrando" = la lista se abrió (o siguió abierta) porque se está
  // escribiendo. Si se abrió con clic / flechita / foco, se ven todas.
  const [filtrando, setFiltrando] = useState(false);
  const [resaltada, setResaltada] = useState(-1); // opción marcada con el teclado
  const wrapperRef = useRef(null);
  const listaRef = useRef(null);

  const texto = String(valor ?? '').trim().toLowerCase();
  const coincidencias = filtrando && texto ? opciones.filter((o) => String(o).toLowerCase().includes(texto)) : opciones;
  // Si lo escrito no se parece a ninguna opción, se enseñan todas (mejor
  // que una lista vacía: así se ve qué hay para elegir).
  const visibles = coincidencias.length > 0 ? coincidencias : opciones;
  const mostrarLista = abierta && visibles.length > 0;

  function abrir(conFiltro) {
    setFiltrando(!!conFiltro);
    setResaltada(-1);
    setAbierta(true);
  }
  function cerrar() {
    setAbierta(false);
    setFiltrando(false);
    setResaltada(-1);
  }

  // Cierra la lista si se hace clic / se toca fuera de este campo (en vez
  // de usar onBlur del <input>, que se dispararía ANTES del clic en una
  // opción y la cerraría antes de que ese clic pudiera registrarse).
  useEffect(() => {
    if (!abierta) return undefined;
    function alTocarFuera(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) cerrar();
    }
    document.addEventListener('mousedown', alTocarFuera);
    document.addEventListener('touchstart', alTocarFuera);
    return () => {
      document.removeEventListener('mousedown', alTocarFuera);
      document.removeEventListener('touchstart', alTocarFuera);
    };
  }, [abierta]);

  // Con el teclado: que la opción marcada siempre quede a la vista.
  useEffect(() => {
    if (!mostrarLista || resaltada < 0 || !listaRef.current) return;
    const el = listaRef.current.children[resaltada];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [resaltada, mostrarLista]);

  function elegirOpcion(v) {
    onChange(v);
    cerrar();
  }

  function alTeclear(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (opciones.length === 0) return;
      e.preventDefault();
      if (!mostrarLista) {
        abrir(false);
        return;
      }
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      setResaltada((actual) => (actual + paso + visibles.length) % visibles.length);
    } else if (e.key === 'Enter') {
      // Enter solo elige si hay una opción marcada con las flechas; si no,
      // hace lo de siempre (mandar el formulario).
      if (mostrarLista && resaltada >= 0 && resaltada < visibles.length) {
        e.preventDefault();
        elegirOpcion(visibles[resaltada]);
      }
    } else if (e.key === 'Escape') {
      if (mostrarLista) {
        e.stopPropagation();
        cerrar();
      }
    } else if (e.key === 'Tab') {
      cerrar();
    }
  }

  return (
    <div className={`campo-opciones${opciones.length > 0 ? ' campo-opciones-con-flecha' : ''}`} ref={wrapperRef}>
      <input
        id={id}
        value={valor}
        onChange={(e) => {
          onChange(e.target.value);
          abrir(true);
        }}
        onFocus={() => abrir(false)}
        // "onClick" además de "onFocus": si el campo YA tiene el foco (por
        // ejemplo, justo después de elegir una opción), un clic no dispara
        // un foco nuevo — sin esto la lista no volvía a abrirse.
        onClick={() => abrir(false)}
        onKeyDown={alTeclear}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        autoComplete="off"
        role={opciones.length > 0 ? 'combobox' : undefined}
        aria-expanded={opciones.length > 0 ? mostrarLista : undefined}
        aria-autocomplete={opciones.length > 0 ? 'list' : undefined}
      />
      {opciones.length > 0 && (
        <button
          type="button"
          className="campo-opciones-flecha"
          tabIndex={-1}
          aria-label={mostrarLista ? 'Cerrar la lista de opciones' : 'Ver todas las opciones'}
          title={mostrarLista ? 'Cerrar la lista' : 'Ver todas las opciones'}
          // onMouseDown + preventDefault: no le quita el foco al campo.
          onMouseDown={(e) => {
            e.preventDefault();
            if (mostrarLista) cerrar();
            else abrir(false);
          }}
        >
          {mostrarLista ? '▴' : '▾'}
        </button>
      )}
      {mostrarLista && (
        <ul className="campo-opciones-lista" ref={listaRef} role="listbox">
          {visibles.map((v, i) => {
            const esActual = String(v) === String(valor ?? '');
            return (
              <li key={v} role="option" aria-selected={esActual}>
                {/* onMouseDown con preventDefault (en vez de onClick solo) para
                    que el clic elija la opción ANTES de que el <input> pierda
                    el foco — así no hay parpadeo ni carrera con el cierre por
                    clic-fuera de arriba. */}
                <button
                  type="button"
                  tabIndex={-1}
                  className={`${esActual ? 'opcion-actual' : ''}${i === resaltada ? ' opcion-resaltada' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); elegirOpcion(v); }}
                >
                  <span className="opcion-palomita" aria-hidden="true">{esActual ? '✓' : ''}</span>
                  {v}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Sirve tanto para dar de alta un producto nuevo como para editar uno que
// ya existe: si le pasas `productoExistente`, precarga sus datos y guarda
// con "actualizarProducto" en vez de "crearProducto".
const LLAVE_LADO_FORMULARIO = 'pyme_formulario_lado';
const LADOS_FORMULARIO = [
  { clave: 'izquierda', texto: '⬅ Izquierda' },
  { clave: 'centro', texto: '↔ Centro' },
  { clave: 'derecha', texto: 'Derecha ➡' },
];

function ProductoForm({ sesionToken, opciones = {}, setOpciones, usuarios = [], productos = [], esAdministrador = false, usuarioId = '', nombreSesion = '', productoExistente, onGuardado, onOpcionesActualizadas, onCancelar, formExterno, setFormExterno, fotosExterno, setFotosExterno, iniciarCarga, terminarCarga }) {
  const esEdicion = !!productoExistente;
  // Arreglo (2026-09-23, pedido por Claudia): en la pestaña "+ Agregar
  // producto" (nunca en el modal de "Editar"), el Dashboard manda su PROPIO
  // estado (formExterno/fotosExterno) para que lo escrito NO se borre si
  // cambias de pestaña sin querer — ProductoForm igual se sigue montando y
  // desmontando, pero el estado ya no vive adentro de él. Si no llega ese
  // estado externo (como en "Editar producto"), se usa el de siempre.
  const usaEstadoExterno = !esEdicion && formExterno !== undefined && !!setFormExterno;
  const [formInterno, setFormInterno] = useState(() => (esEdicion ? formDesdeProducto(productoExistente) : { ...FORM_INICIAL, duenoId: usuarioId || '' }));
  const [fotosInterno, setFotosInterno] = useState(() => (esEdicion ? fotosDesdeProducto(productoExistente) : []));
  // Arreglo (2026-09-28, pedido por Claudia): guardamos una "foto" de cómo
  // estaba el formulario justo al ABRIRSE el modal de "Editar producto".
  // Como este componente NO se vuelve a montar mientras el modal sigue
  // abierto (solo cambian sus props si los datos se refrescan en segundo
  // plano), esta referencia se queda fija con los valores originales — nos
  // sirve para, al guardar, mandar solo lo que el usuario de verdad cambió
  // (ver handleSubmit) en vez de reenviar TODO el formulario.
  const valorOriginalRef = useRef(esEdicion ? formDesdeProducto(productoExistente) : null);
  const fotosOriginalRef = useRef(esEdicion ? fotosDesdeProducto(productoExistente) : null);
  const form = usaEstadoExterno ? formExterno : formInterno;
  const setForm = usaEstadoExterno ? setFormExterno : setFormInterno;
  const fotos = usaEstadoExterno ? fotosExterno : fotosInterno;
  const setFotos = usaEstadoExterno ? setFotosExterno : setFotosInterno;
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  // (2026-10-07, pedido por Claudia) En "+ Agregar producto" cada quien
  // decide dónde ver el formulario: a la izquierda (como siempre), al centro
  // o a la derecha. Se recuerda en este navegador.
  const [ladoFormulario, setLadoFormulario] = useState(() => {
    try {
      const guardado = localStorage.getItem(LLAVE_LADO_FORMULARIO);
      return LADOS_FORMULARIO.some((l) => l.clave === guardado) ? guardado : 'izquierda';
    } catch {
      return 'izquierda';
    }
  });
  function elegirLadoFormulario(clave) {
    setLadoFormulario(clave);
    try {
      localStorage.setItem(LLAVE_LADO_FORMULARIO, clave);
    } catch {
      // Sin almacenamiento: vale solo mientras la pestaña siga abierta.
    }
  }
  // Bug reportado por Claudia (2026-09-30): subir una foto puede tardar, y
  // si en ese ratito le da clic a "Agregar producto" por accidente, el
  // producto se guardaba sin esperar a que la foto terminara de subir.
  // "ImageUploader" ahora avisa aquí cada vez que hay (o deja de haber)
  // una foto subiéndose (ver "onSubiendoCambio" en ese componente); con
  // eso, "handleSubmit" puede preguntar antes de guardar.
  const [fotosSubiendo, setFotosSubiendo] = useState(false);

  const duenosEdicion = esEdicion ? (productoExistente.Duenos || []) : [];
  const miPropioEdicion = duenosEdicion.find((d) => String(d.usuarioId) === String(usuarioId));
  const miCantidadPropiaEdicion = miPropioEdicion ? miPropioEdicion.cantidad : 0;
  const stockOriginalEdicion = esEdicion ? Number(productoExistente.Stock) || 0 : 0;
  const minimoPermitidoEdicion =
    duenosEdicion.length > 0 ? Math.max(0, stockOriginalEdicion - miCantidadPropiaEdicion) : 0;
  const excedeMiPropioEdicion =
    esEdicion && duenosEdicion.length > 0 && form.stock !== '' && Number(form.stock) < minimoPermitidoEdicion;

  // Actualiza YA (sin esperar el refresco completo de datos) la lista de
  // opciones predeterminadas visible en este formulario, para que agregar o
  // quitar una opción se vea al instante y no tarde varios segundos —
  // "onOpcionesActualizadas" se sigue llamando después, como respaldo, pero
  // ya no es lo único que actualiza lo que se ve en pantalla.
  function actualizarOpcionesLocal(campo, quitar, agregar) {
    setOpciones?.((prev) => {
      const lista = prev[campo] || [];
      let nueva = quitar ? lista.filter((v) => v !== quitar) : lista;
      if (agregar && !nueva.includes(agregar)) nueva = [...nueva, agregar];
      return { ...prev, [campo]: nueva };
    });
  }

  // ---- Ventana de "Administrar opciones predeterminadas" ----
  // Es UNA sola ventana compartida por los 6 campos: el botón ⚙️ de cada
  // campo la abre ya elegido en ese campo (`campoGestion`). Las opciones
  // NUNCA se llenan solas: solo tienen lo que se agrega aquí a propósito.
  const [gestorAbierto, setGestorAbierto] = useState(false);
  const [campoGestion, setCampoGestion] = useState('categoria');
  const [valorOpcion, setValorOpcion] = useState('');
  const [editandoValorOriginal, setEditandoValorOriginal] = useState(null);
  const [guardandoOpcion, setGuardandoOpcion] = useState(false);

  function abrirGestor(campo) {
    setCampoGestion(campo);
    setValorOpcion('');
    setEditandoValorOriginal(null);
    setGestorAbierto(true);
  }

  function cerrarGestor() {
    setGestorAbierto(false);
    setValorOpcion('');
    setEditandoValorOriginal(null);
  }

  function handleEmpezarEditarOpcion(valor) {
    setEditandoValorOriginal(valor);
    setValorOpcion(valor);
  }

  // Agrega la opción nueva o, si se estaba editando una ya existente,
  // primero quita la vieja y luego agrega la nueva (así "renombramos" un
  // valor sin necesitar un botón especial de "editar" en el backend).
  function handleGuardarOpcion() {
    const valor = valorOpcion.trim();
    if (!valor) return;
    setGuardandoOpcion(true);
    const promesa =
      editandoValorOriginal && editandoValorOriginal !== valor
        ? eliminarOpcion({ sesionToken, campo: campoGestion, valor: editandoValorOriginal }).then(() =>
            agregarOpcion({ sesionToken, campo: campoGestion, valor })
          )
        : agregarOpcion({ sesionToken, campo: campoGestion, valor });

    promesa
      .then(() => {
        actualizarOpcionesLocal(
          campoGestion,
          editandoValorOriginal && editandoValorOriginal !== valor ? editandoValorOriginal : null,
          valor
        );
        setValorOpcion('');
        setEditandoValorOriginal(null);
        onOpcionesActualizadas?.();
      })
      .catch((err) => setMensaje(`Error al guardar la opción: ${err.message}`))
      .finally(() => setGuardandoOpcion(false));
  }

  function handleEliminarOpcion(valor) {
    const confirmar = window.confirm(`¿Quitar "${valor}" de las opciones predeterminadas?`);
    if (!confirmar) return;
    eliminarOpcion({ sesionToken, campo: campoGestion, valor })
      .then(() => {
        actualizarOpcionesLocal(campoGestion, valor, null);
        onOpcionesActualizadas?.();
      })
      .catch((err) => setMensaje(`Error al quitar la opción: ${err.message}`));
  }

  function handleChange(campo) {
    return (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  }

  // Para campos numéricos (precio, stock, etc.): igual que handleChange,
  // pero corta el texto a una cantidad máxima de dígitos para que no se
  // puedan escribir números absurdamente grandes. Estos campos usan
  // <input type="text" inputMode="numeric|decimal"> (no type="number") a
  // propósito — ver la nota junto a limitarDigitos() más abajo sobre por
  // qué se cambió.
  function handleChangeNumero(campo, maxDigitos) {
    return (e) => setForm((f) => ({ ...f, [campo]: limitarDigitos(e.target.value, maxDigitos) }));
  }

  // Para las flechitas ▲▼ de subir/bajar (ver BotonesPasoNumero, arriba en
  // el archivo). Usa la forma funcional de setForm para que, aunque el
  // botón se quede presionado y este mismo cierre se llame muchas veces
  // seguidas por el temporizador, cada paso siempre sume/reste sobre el
  // valor MÁS RECIENTE, nunca sobre uno viejo.
  function handlePasoNumero(campo, delta, maxDigitos) {
    setForm((f) => {
      const actual = Number(f[campo]) || 0;
      const nuevo = Math.max(0, actual + delta);
      return { ...f, [campo]: limitarDigitos(String(nuevo), maxDigitos) };
    });
  }

  // Para campos de texto con límite de caracteres (Nombre, Categoría, Marca,
  // Talla, Color, Código, Descripción, 2026-09-24). A diferencia de dejar
  // solo el atributo nativo `maxLength` del <input>, este recorte se hace
  // en JS sobre el valor real que ya trae el navegador en cada tecleo — así
  // el límite se respeta siempre, incluso en el caso raro que reportó
  // Claudia de mantener una tecla presionada y presionar otra(s) al mismo
  // tiempo (el navegador a veces entrega de golpe más caracteres de los que
  // "debería" en un solo evento; recortar por JS en cada evento, sobre el
  // valor completo que sea, es lo único que garantiza el tope pase lo que
  // pase). El `maxLength` del <input> se deja puesto también, como respaldo
  // extra, pero quien de verdad manda es este recorte.
  function handleChangeTexto(campo, maxCaracteres) {
    return (e) => setForm((f) => ({ ...f, [campo]: String(e.target.value).slice(0, maxCaracteres) }));
  }

  // Igual que handleChangeTexto, pero para usarse con "CampoConOpciones"
  // (el combobox propio de Nombre, Código propio, Categoría, Marca, Talla
  // y Color, ver esa función arriba) — ese componente entrega el valor de
  // texto directamente en vez de un evento de <input>.
  function handleChangeTextoValor(campo, maxCaracteres) {
    return (valor) => setForm((f) => ({ ...f, [campo]: String(valor).slice(0, maxCaracteres) }));
  }

  // Para casillas (checkboxes) como "En oferta": a diferencia de los demás
  // campos, lo que importa es si está marcada o no (e.target.checked), no
  // el texto que se escribió.
  function handleChangeCheckbox(campo) {
    return (e) => setForm((f) => ({ ...f, [campo]: e.target.checked }));
  }
   function handleSubmit(e) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.precio) {
      setMensaje('Error: el nombre y el precio de venta son obligatorios.');
      return;
    }
    // Bug reportado por Claudia (2026-09-30): subir fotos puede tardar, y
    // es fácil confundirse y darle a "Guardar"/"Agregar producto" antes de
    // que termine. Si eso pasa, se pregunta explícitamente en vez de
    // guardar de una vez sin avisar — así ella decide si de verdad quiere
    // seguir sin esa foto, o prefiere cancelar y esperar.
    if (fotosSubiendo) {
      const seguirSinEsperar = window.confirm(
        'Todavía se están cargando cambios (una o más fotos siguen subiendo). ¿Estás segura de que quieres seguir de todos modos?'
      );
      if (!seguirSinEsperar) return;
    }
    setEnviando(true);
    setMensaje('');
    // Para que el círculo de carga de la esquina también aparezca aquí
    // (2026-09-24, pedido por Claudia: "el pacman es indispensable en cada
    // carga que haya") — el botón "Guardar" ya se deshabilita con
    // `enviando`, pero el círculo global da la misma certeza en cualquier
    // parte de la pantalla en la que esté mirando.
    iniciarCarga?.();

    // Funcionalidad 2 (Stock personal, 2026-09): si un Administrador eligió
    // a alguien en "Asignar a" al crear el producto, mandamos también su
    // nombre (el backend lo necesita para guardarlo en "StockPersonal"). Si
    // no se eligió a nadie, el backend asigna todo al Admin Central solo.
    // Blindaje extra (2026-09-22): no confiamos SOLO en el valor con el que
    // se inicializó el formulario al montarse — si por cualquier motivo
    // llegó vacío (por ejemplo si el componente se montó antes de que la
    // sesión terminara de cargar), aquí mismo, justo antes de mandarlo, se
    // vuelve a poner por default a quien está creando el producto.
    const duenoIdFinal = !esEdicion && !form.duenoId ? usuarioId : form.duenoId;
    const duenoSeleccionado = usuarios.find((u) => u.ID === duenoIdFinal);

    let datos;
    if (esEdicion) {
      // Arreglo (2026-09-28, pedido por Claudia): antes se reenviaban TODOS
      // los campos del formulario tal cual estaban en pantalla, aunque
      // nadie los hubiera tocado — eso hacía que la Bitácora reportara
      // "cambios" en varios datos cuando en realidad solo se editó uno.
      // Ahora comparamos contra el valor ORIGINAL con el que se abrió el
      // formulario (valorOriginalRef/fotosOriginalRef) y solo mandamos al
      // backend los campos que de verdad son distintos.
      datos = { sesionToken };
      const original = valorOriginalRef.current || {};
      Object.keys(form).forEach((campo) => {
        if (String(original[campo] ?? '') !== String(form[campo] ?? '')) {
          datos[campo] = form[campo];
        }
      });
      const fotoUrlOriginal = (fotosOriginalRef.current || []).join('|');
      const fotoUrlActual = fotos.join('|');
      if (fotoUrlOriginal !== fotoUrlActual) {
        datos.fotoUrl = fotoUrlActual;
      }
    } else {
      datos = {
        sesionToken,
        ...form,
        duenoId: duenoIdFinal,
        duenoNombre: duenoSeleccionado ? duenoSeleccionado.Nombre : (duenoIdFinal === usuarioId ? nombreSesion : ''),
        fotoUrl: fotos.join('|'),
      };
    }
    const promesa = conLimiteDeTiempo(
      esEdicion
        ? actualizarProducto({ ...datos, productoId: productoExistente.ID })
        : crearProducto(datos),
      esEdicion ? 'Guardar cambios' : 'Agregar producto'
    );

    promesa
      .then(() => {
        if (!esEdicion) {
          setForm(FORM_INICIAL);
          setFotos([]);
        }
        setMensaje(esEdicion ? 'Cambios guardados ✅' : 'Producto agregado correctamente ✅');
        // Arreglo (2026-09-25): faltaba "return" — sin él, ".finally()" de
        // abajo (que apaga el círculo de carga) no esperaba a que
        // onGuardado() (que dispara la actualización silenciosa de datos)
        // de verdad terminara.
        return onGuardado();
      })
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => {
        setEnviando(false);
        terminarCarga?.();
      });
  }

  return (
    <form className={`new-product-form ${esEdicion ? '' : `formulario-lado-${ladoFormulario}`}`} onSubmit={handleSubmit} data-formulario-lado={esEdicion ? undefined : ladoFormulario}>
      {!esEdicion && (
        <div className="formulario-lado-selector" role="group" aria-label="Dónde se ve este formulario">
          <span className="formulario-lado-etiqueta">Ver este formulario:</span>
          {LADOS_FORMULARIO.map((l) => (
            <button
              key={l.clave}
              type="button"
              className={`formulario-lado-btn ${ladoFormulario === l.clave ? 'activo' : ''}`}
              aria-pressed={ladoFormulario === l.clave}
              onClick={() => elegirLadoFormulario(l.clave)}
              data-lado={l.clave}
            >
              {l.texto}
            </button>
          ))}
        </div>
      )}
      {/* En cada uno de estos campos puedes escribir libremente lo que
          quieras, O darle clic a la flechita del cuadro para elegir una de
          tus opciones predeterminadas. Dale clic al ⚙️ de cada campo para
          agregar, editar o quitar esas opciones — la lista NUNCA se llena
          sola, solo tiene lo que agregues ahí a propósito. */}
      <div className="form-grid">
        <label>
          <span className="form-label-fila">
            Nombre*
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('nombre')} title="Administrar opciones predeterminadas de Nombre">
              ⚙️
            </button>
          </span>
          <CampoConOpciones
            valor={form.nombre}
            onChange={handleChangeTextoValor('nombre', MAX_CARACTERES_NOMBRE)}
            opciones={opciones.nombre || []}
            required
            maxLength={MAX_CARACTERES_NOMBRE}
          />
        </label>
        <label>
          <span className="form-label-fila">
            Código propio
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('codigoPropio')} title="Administrar opciones predeterminadas de Código propio">
              ⚙️
            </button>
          </span>
          <CampoConOpciones
            valor={form.codigoPropio}
            onChange={handleChangeTextoValor('codigoPropio', MAX_CARACTERES_CODIGO)}
            opciones={opciones.codigoPropio || []}
            placeholder="Ej. PLY-001"
            maxLength={MAX_CARACTERES_CODIGO}
          />
          {/* Aviso de código repetido (2026-10-05, catálogo de claves): solo
              informa, no impide guardar — en esta tienda un mismo código a
              veces se usa en varios productos a propósito. */}
          {(() => {
            const codigo = normalizarParaFiltro(form.codigoPropio);
            if (!codigo) return null;
            const otros = productos.filter(
              (p) => normalizarParaFiltro(p.CodigoPropio) === codigo && (!productoExistente || String(p.ID) !== String(productoExistente.ID))
            );
            if (otros.length === 0) return null;
            return (
              <span className="form-nota-codigo" role="status">
                ℹ️ Este código ya lo tiene{otros.length === 1 ? '' : 'n'}: {otros.slice(0, 3).map((p) => p.Nombre).join(', ')}
                {otros.length > 3 ? ` y ${otros.length - 3} más` : ''}. Puedes repetirlo si así lo usas.
              </span>
            );
          })()}
        </label>
        <label>
          <span className="form-label-fila">
            Categoría
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('categoria')} title="Administrar opciones predeterminadas de Categoría">
              ⚙️
            </button>
          </span>
          <CampoConOpciones
            valor={form.categoria}
            onChange={handleChangeTextoValor('categoria', MAX_CARACTERES_CATEGORIA)}
            opciones={opciones.categoria || []}
            maxLength={MAX_CARACTERES_CATEGORIA}
          />
        </label>
        <label>
          <span className="form-label-fila">
            Marca
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('marca')} title="Administrar opciones predeterminadas de Marca">
              ⚙️
            </button>
          </span>
          <CampoConOpciones
            valor={form.marca}
            onChange={handleChangeTextoValor('marca', MAX_CARACTERES_MARCA)}
            opciones={opciones.marca || []}
            maxLength={MAX_CARACTERES_MARCA}
          />
        </label>
        <label>
          <span className="form-label-fila">
            Talla / Medida
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('talla')} title="Administrar opciones predeterminadas de Talla / Medida">
              ⚙️
            </button>
          </span>
          <CampoConOpciones
            valor={form.talla}
            onChange={handleChangeTextoValor('talla', MAX_CARACTERES_TALLA)}
            opciones={opciones.talla || []}
            maxLength={MAX_CARACTERES_TALLA}
          />
        </label>
              <label>
          <span className="form-label-fila">
            Color
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('color')} title="Administrar opciones predeterminadas de Color">
              ⚙️
            </button>
          </span>
          <CampoConOpciones
            valor={form.color}
            onChange={handleChangeTextoValor('color', MAX_CARACTERES_COLOR)}
            opciones={opciones.color || []}
            maxLength={MAX_CARACTERES_COLOR}
          />
        </label>
        {esAdministrador && !esEdicion && (
          <label>
            Asignar a
            {/* (2026-10-09, Claudia: "Admin Central (default)" y "MARY CRUZ"
                eran la misma persona, salía repetida.) Una opción por
                persona; quien está creando el producto va primero y es la
                de entrada (así ya funcionaba al guardar). */}
            <select value={form.duenoId || String(usuarioId || '')} onChange={handleChange('duenoId')}>
              {usuarios
                .filter((u) => esActivo(u.Activo))
                .slice()
                .sort((a, b) => (String(a.ID) === String(usuarioId) ? -1 : String(b.ID) === String(usuarioId) ? 1 : 0))
                .map((u) => (
                  <option key={u.ID} value={u.ID}>
                    {u.Nombre}
                    {String(u.ID) === String(usuarioId) ? ' (yo)' : ''}
                    {esActivo(u.EsAdminCentral) ? ' — 👑 Admin Central' : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Precio de venta*
          <div className="campo-numero-wrapper">
            <input
              type="text"
              inputMode="decimal"
              value={form.precio}
              onChange={handleChangeNumero('precio', MAX_DIGITOS_PRECIO)}
              required
            />
            <BotonesPasoNumero
              onSubir={() => handlePasoNumero('precio', 1, MAX_DIGITOS_PRECIO)}
              onBajar={() => handlePasoNumero('precio', -1, MAX_DIGITOS_PRECIO)}
            />
          </div>
        </label>
        <label>
          Precio de compra
          <div className="campo-numero-wrapper">
            <input
              type="text"
              inputMode="decimal"
              value={form.precioCompra}
              onChange={handleChangeNumero('precioCompra', MAX_DIGITOS_PRECIO)}
            />
            <BotonesPasoNumero
              onSubir={() => handlePasoNumero('precioCompra', 1, MAX_DIGITOS_PRECIO)}
              onBajar={() => handlePasoNumero('precioCompra', -1, MAX_DIGITOS_PRECIO)}
            />
          </div>
        </label>
        <label>
          Precio de oferta
          <div className="campo-numero-wrapper">
            <input
              type="text"
              inputMode="decimal"
              value={form.precioOferta}
              onChange={handleChangeNumero('precioOferta', MAX_DIGITOS_PRECIO)}
              placeholder="Déjalo vacío si no aplica"
            />
            <BotonesPasoNumero
              onSubir={() => handlePasoNumero('precioOferta', 1, MAX_DIGITOS_PRECIO)}
              onBajar={() => handlePasoNumero('precioOferta', -1, MAX_DIGITOS_PRECIO)}
            />
          </div>
        </label>
        <label className="form-checkbox-fila">
          <input
            type="checkbox"
            checked={form.enOferta}
            onChange={handleChangeCheckbox('enOferta')}
          />
          En oferta (aparece en la zona de Ofertas del catálogo)
        </label>
        <label>
          Stock {esEdicion ? '' : 'inicial'}
          <div className="campo-numero-wrapper">
            <input
              type="text"
              inputMode="numeric"
              className={excedeMiPropioEdicion ? 'campo-modificado' : ''}
              value={form.stock}
              onChange={handleChangeNumero('stock', MAX_DIGITOS_STOCK)}
            />
            <BotonesPasoNumero
              onSubir={() => handlePasoNumero('stock', 1, MAX_DIGITOS_STOCK)}
              onBajar={() => handlePasoNumero('stock', -1, MAX_DIGITOS_STOCK)}
            />
          </div>
          {excedeMiPropioEdicion && (
            <span className="muted campo-nota aviso-stock-propio">
              Solo puedes bajar hasta {minimoPermitidoEdicion} — de este producto tienes {miCantidadPropiaEdicion}{' '}
              asignado a ti, y bajar más afectaría el stock de alguien más.
            </span>
          )}
        </label>
        <label>
          Stock mínimo
          <div className="campo-numero-wrapper">
            <input
              type="text"
              inputMode="numeric"
              value={form.stockMinimo}
              onChange={handleChangeNumero('stockMinimo', MAX_DIGITOS_STOCK)}
            />
            <BotonesPasoNumero
              onSubir={() => handlePasoNumero('stockMinimo', 1, MAX_DIGITOS_STOCK)}
              onBajar={() => handlePasoNumero('stockMinimo', -1, MAX_DIGITOS_STOCK)}
            />
          </div>
        </label>
        <label className="form-grid-wide">
          Descripción
          <input value={form.descripcion} onChange={handleChangeTexto('descripcion', MAX_CARACTERES_DESCRIPCION)} maxLength={MAX_CARACTERES_DESCRIPCION} />
        </label>
      </div>

      <div className="form-field-fotos">
        <label>Fotos del producto</label>
        <ImageUploader sesionToken={sesionToken} value={fotos} onChange={setFotos} onSubiendoCambio={setFotosSubiendo} />
      </div>

      {mensaje && (
        <p className={`info-msg ${mensaje.startsWith('Error') ? 'error' : ''}`}>{mensaje}</p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={enviando || excedeMiPropioEdicion}>
          {enviando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Agregar producto'}
        </button>
        {esEdicion && (
          <button type="button" className="btn btn-secondary" onClick={onCancelar}>
            Cancelar
          </button>
        )}
        {/* Arreglo (2026-09-23, pedido por Claudia): botón para borrar TODO
            lo escrito en "+ Agregar producto" a propósito — con aviso antes,
            para no perder nada por un clic accidental. Va del lado opuesto
            al de "Agregar producto" (ver .btn-cancelar-nuevo en el CSS). */}
        {!esEdicion && (
          <button
            type="button"
            className="btn btn-secondary btn-cancelar-nuevo"
            onClick={() => {
              const confirmar = window.confirm(
                '¿Seguro que quieres cancelar? Se borrará todo lo que llevas escrito en este formulario.'
              );
              if (!confirmar) return;
              setForm({ ...FORM_INICIAL, duenoId: usuarioId || '' });
              setFotos([]);
              setMensaje('');
            }}
          >
            Cancelar
          </button>
        )}
      </div>

      {gestorAbierto && (
        <div className="modal-overlay" onClick={cerrarGestor}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Opciones predeterminadas</h3>
            <p className="muted">
              Estas son TUS opciones para este campo — no se llenan solas, solo
              aparecen aquí las que tú agregas. Puedes cambiar de campo con el
              siguiente menú.
            </p>

            <label className="modal-field">
              Campo
              <select
                value={campoGestion}
                onChange={(e) => {
                  setCampoGestion(e.target.value);
                  setValorOpcion('');
                  setEditandoValorOriginal(null);
                }}
              >
                {CAMPOS_CON_OPCIONES.map((c) => (
                  <option key={c.campo} value={c.campo}>
                    {c.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <div className="opciones-lista">
              {(opciones[campoGestion] || []).length === 0 && (
                <p className="muted">Todavía no hay opciones guardadas para este campo.</p>
              )}
              {(opciones[campoGestion] || []).map((valor) => (
                <div key={valor} className="opciones-item">
                  <span>{valor}</span>
                  <div className="opciones-item-botones">
                    <button
                      type="button"
                      className="opciones-item-btn"
                      onClick={() => handleEmpezarEditarOpcion(valor)}
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="opciones-item-btn"
                      onClick={() => handleEliminarOpcion(valor)}
                      title="Quitar"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <label className="modal-field">
              {editandoValorOriginal ? `Editando "${editandoValorOriginal}"` : 'Agregar una opción nueva'}
              <input
                value={valorOpcion}
                onChange={(e) => setValorOpcion(e.target.value)}
                placeholder="Escribe el valor"
              />
            </label>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={guardandoOpcion || !valorOpcion.trim()}
                onClick={handleGuardarOpcion}
              >
                {editandoValorOriginal ? 'Guardar cambio' : 'Agregar'}
              </button>
              {editandoValorOriginal && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setEditandoValorOriginal(null);
                    setValorOpcion('');
                  }}
                >
                  Cancelar edición
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={cerrarGestor}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

// Agrupa productos por categoría para la pestaña de "Orden del catálogo",
// mostrando primero los más nuevos (igual que hace el catálogo público).
// Los productos sin categoría se juntan bajo "Otros", igual que en el
// catálogo. También arma una cajita VACÍA por cada categoría que Claudia
// haya agregado a propósito (o que ya existiera como opción predeterminada)
// pero que todavía no tenga ningún producto, para poder renombrarla,
// ocultarla o borrarla igual que las demás.
function agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito) {
  const masNuevosPrimero = productos.slice().reverse();
  const grupos = [];
  const indicePorCategoria = {};

  function asegurarGrupo(nombreCategoria) {
    if (!nombreCategoria) return null;
    if (!(nombreCategoria in indicePorCategoria)) {
      indicePorCategoria[nombreCategoria] = grupos.length;
      grupos.push({
        nombre: nombreCategoria,
        productos: [],
        oculta: (categoriasOcultas || []).indexOf(nombreCategoria) !== -1,
      });
    }
    return grupos[indicePorCategoria[nombreCategoria]];
  }

  masNuevosPrimero.forEach((p) => {
    const nombreCategoria = String(p.Categoria || '').trim() || 'Otros';
    asegurarGrupo(nombreCategoria).productos.push(p);
  });

  (categoriasPredeterminadas || []).forEach((nombreCategoria) => {
    asegurarGrupo(String(nombreCategoria || '').trim());
  });

   grupos.forEach((g) => {
    g.productos.sort((a, b) => (Number(a.Orden) || 0) - (Number(b.Orden) || 0));
  });

  // Bug reportado por Claudia (2026-09): el orden de categorías en esta
  // pestaña no coincidía con el del catálogo público — a esta pestaña le
  // faltaba aplicar el MISMO criterio de respaldo que ya usa el backend
  // (`ordenarProductos_` en Code.gs) para las categorías que todavía no
  // tienen un orden explícito guardado: acomodarlas según el menor
  // número de "Orden" de sus productos. Sin esto, aquí las categorías se
  // quedaban en el orden en que aparecía su primer producto al recorrer
  // la lista del más nuevo al más viejo — que no es necesariamente lo
  // mismo que "la categoría cuyo producto tiene el Orden más chico".
  // Las categorías con orden explícito (las que Claudia ya acomodó a
  // propósito con las flechitas ▲/▼ grandes) van primero, en ese orden;
  // las demás se acomodan con el criterio de respaldo; y las cajitas de
  // categorías vacías (sin ningún producto todavía) se quedan al final,
  // igual que antes.
  const explicito = categoriaOrdenExplicito || [];
  const conExplicito = grupos.filter((g) => explicito.indexOf(g.nombre) !== -1);
  const sinExplicitoConProductos = grupos.filter(
    (g) => explicito.indexOf(g.nombre) === -1 && g.productos.length > 0
  );
  const categoriasVacias = grupos.filter(
    (g) => explicito.indexOf(g.nombre) === -1 && g.productos.length === 0
  );

  conExplicito.sort((a, b) => explicito.indexOf(a.nombre) - explicito.indexOf(b.nombre));

  sinExplicitoConProductos.sort((a, b) => {
    const minA = Math.min.apply(null, a.productos.map((p) => Number(p.Orden) || 0));
    const minB = Math.min.apply(null, b.productos.map((p) => Number(p.Orden) || 0));
    return minA - minB;
  });

  return conExplicito.concat(sinExplicitoConProductos, categoriasVacias);
}

// ---- Ayudas de "Orden del catálogo" (rediseño 2026-10-01) ----
// Misma regla que la tarjeta del catálogo (ProductCard.jsx,
// "obtenerInfoOferta") para saber si un producto sale en la zona 🔥 Ofertas.
function productoEnOferta(p) {
  const precio = Number(p.Precio) || 0;
  const oferta = Number(p.PrecioOferta) || 0;
  const marcado = p.EnOferta === true || ['TRUE', 'SI'].includes(String(p.EnOferta).toUpperCase());
  return (oferta > 0 && oferta < precio) || marcado;
}

// Orden del carrusel de Ofertas — la MISMA regla que usa Catalog.jsx: lo
// que ya se acomodó a mano va en ese orden; las ofertas nuevas que todavía
// no se han acomodado van al principio, la más nueva primero.
function ordenarOfertas(productos, ofertasOrden) {
  const orden = (ofertasOrden || []).map(String);
  const posicion = (p) => orden.indexOf(String(p.ID));
  return productos
    .filter(productoEnOferta)
    .slice()
    .sort((a, b) => {
      const pa = posicion(a);
      const pb = posicion(b);
      if (pa === -1 && pb === -1) return new Date(b.FechaCreacion) - new Date(a.FechaCreacion);
      if (pa === -1) return -1;
      if (pb === -1) return 1;
      return pa - pb;
    });
}

function moverEnLista(lista, desde, hasta) {
  const copia = lista.slice();
  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido);
  return copia;
}

// ---- Orden rápido (2026-10-05) ----
// Pedido por Claudia: en "Orden del catálogo", un botón general (todas las
// categorías) y uno en cada categoría para acomodar los productos "por
// tiempo de agregado, del más nuevo al más viejo; si se presiona de nuevo,
// del más viejo al más nuevo", y otro por orden alfabético; "antes de
// accionar el cambio, que pregunte".
// criterio: 'fecha' | 'nombre'.  sentido: 'desc' | 'asc'.
//   fecha/desc = Nuevo–Viejo (lo primero que ofrece el botón), fecha/asc = Viejo–Nuevo
//   nombre/asc = A–Z (lo primero que ofrece el botón),         nombre/desc = Z–A
const ORDEN_RAPIDO = {
  fecha: {
    primero: 'desc',
    etiqueta: { desc: 'Nuevo–Viejo', asc: 'Viejo–Nuevo' },
    frase: { desc: 'del más nuevo al más viejo', asc: 'del más viejo al más nuevo' },
    nota: 'Se toma la fecha en que se agregó cada producto.',
  },
  nombre: {
    primero: 'asc',
    etiqueta: { asc: 'A–Z', desc: 'Z–A' },
    frase: { asc: 'por nombre, de la A a la Z', desc: 'por nombre, de la Z a la A' },
    nota: 'Se toma el nombre del producto, sin distinguir mayúsculas ni acentos.',
  },
};

// Acomoda una lista de productos. "lugarEnHoja" (ID → renglón de la hoja)
// desempata: entre dos productos con la misma fecha o el mismo nombre va
// primero el que se agregó antes, para que el resultado sea siempre igual.
function ordenarProductosPor(lista, criterio, sentido, lugarEnHoja) {
  const lugar = (p) => (lugarEnHoja && lugarEnHoja[String(p.ID)]) || 0;
  const fecha = (p) => {
    const t = new Date(p.FechaCreacion).getTime();
    return Number.isNaN(t) ? 0 : t; // sin fecha = lo más viejo
  };
  const copia = lista.slice();
  if (criterio === 'nombre') {
    copia.sort(
      (a, b) =>
        String(a.Nombre || '').trim().localeCompare(String(b.Nombre || '').trim(), 'es', { numeric: true, sensitivity: 'base' }) ||
        lugar(a) - lugar(b)
    );
  } else {
    copia.sort((a, b) => fecha(a) - fecha(b) || lugar(a) - lugar(b));
  }
  if (sentido === 'desc') copia.reverse();
  return copia;
}

function mismoOrdenDeProductos(a, b) {
  return a.length === b.length && a.every((p, i) => String(p.ID) === String(b[i].ID));
}

// Qué sentido ofrece el botón: el primero de ese criterio, salvo que TODAS
// las listas ya estén así — entonces ofrece el contrario (es el "si se
// presiona de nuevo" que pidió Claudia). Se decide mirando cómo están
// acomodadas, así que sigue funcionando después de recargar la página.
function siguienteSentidoDeOrden(listas, criterio, lugarEnHoja) {
  const primero = ORDEN_RAPIDO[criterio].primero;
  const conVarios = listas.filter((l) => l.length > 1);
  if (conVarios.length === 0) return primero;
  const yaEstan = conVarios.every((l) => mismoOrdenDeProductos(l, ordenarProductosPor(l, criterio, primero, lugarEnHoja)));
  return yaEstan ? (primero === 'desc' ? 'asc' : 'desc') : primero;
}

// Cajita con el número de lugar (1, 2, 3…): se escribe el lugar a donde se
// quiere mandar y se da Enter — así algo pasa del lugar 10 al 2 de un jalón,
// sin darle 8 veces a la flechita.
function CampoPosicion({ posicion, total, onMover, etiqueta }) {
  const [texto, setTexto] = useState(String(posicion));
  useEffect(() => {
    setTexto(String(posicion));
  }, [posicion]);
  function aplicar() {
    const n = Math.round(Number(texto));
    if (!texto || Number.isNaN(n)) {
      setTexto(String(posicion));
      return;
    }
    const destino = Math.max(1, Math.min(total, n));
    if (destino === posicion) setTexto(String(posicion));
    else onMover(destino - 1);
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      className="orden-posicion"
      value={texto}
      onChange={(e) => setTexto(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
      onFocus={(e) => e.target.select()}
      onBlur={aplicar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      }}
      title={`Lugar ${posicion} de ${total} — escribe otro número y da Enter para mandarlo directo a ese lugar`}
      aria-label={`${etiqueta}: lugar ${posicion} de ${total}. Escribe otro número y da Enter para moverlo`}
    />
  );
}

// Pestaña "Orden del catálogo" — REDISEÑADA el 2026-10-01 (pendientes P8 y
// P11 de Claudia). Antes cada clic en una flechita guardaba de inmediato
// (un guardado + un renglón de Bitácora POR CADA lugar que se movía algo), y
// como la pantalla se volvía a acomodar con datos del servidor mientras
// tanto, a veces el producto "subía, bajaba y volvía a subir". Ahora:
//   1. Se acomoda TODO lo que se quiera primero (nada se guarda todavía) y
//      al final se da UN solo "💾 Guardar orden" — un solo guardado y un
//      solo renglón de Bitácora que dice qué pasó de qué lugar a cuál.
//   2. Para mover: escribir el número de lugar y dar Enter (del 10 al 2 de
//      un jalón), las flechitas ▲ ▼ de uno en uno, o arrastrar (en compu).
//   3. Lo que se movió se queda resaltado en su lugar nuevo.
//   4. Mientras haya cambios sin guardar, la pantalla NO se vuelve a
//      acomodar sola con datos del servidor (se acabó el sube-baja).
//   5. Al guardar sale un aviso grande de "Guardando el orden…" al centro,
//      visible sin importar en qué parte de la página se esté.
//   6. Zona "🔥 Ofertas": aparece aquí arriba para ocultarla/mostrarla y
//      para acomodar el orden de su carrusel.
//   7. Buscador para encontrar rápido un producto o categoría, y botones
//      para contraer/expandir las categorías.
// Renombrar, ocultar, agregar y eliminar categoría siguen igual que antes
// (se guardan al momento), pero se bloquean mientras haya cambios de orden
// sin guardar, para no mezclar las dos cosas.
// Textos de ayuda que se pueden minimizar. Minimizados queda solo un
// botoncito "ℹ️ <título>" para volver a abrirlos. Se recuerda en este
// aparato cómo se dejaron ("clave" distingue una ayuda de otra).
const AYUDA_MINIMIZADA_KEY = 'pyme_ayuda_minimizada_';
function AyudaMinimizable({ clave, titulo, children }) {
  const [minimizada, setMinimizada] = useState(() => {
    try {
      return window.localStorage.getItem(AYUDA_MINIMIZADA_KEY + clave) === '1';
    } catch {
      return false;
    }
  });
  function alternar() {
    setMinimizada((antes) => {
      const ahora = !antes;
      try {
        if (ahora) window.localStorage.setItem(AYUDA_MINIMIZADA_KEY + clave, '1');
        else window.localStorage.removeItem(AYUDA_MINIMIZADA_KEY + clave);
      } catch {
        // Sin almacenamiento: vale mientras la pestaña esté abierta.
      }
      return ahora;
    });
  }
  if (minimizada) {
    return (
      <button type="button" className="ayuda-minimizable-abrir" onClick={alternar} aria-expanded="false" title="Ver la explicación">
        ℹ️ {titulo} ▾
      </button>
    );
  }
  return (
    <div className="ayuda-minimizable">
      {children}
      <button type="button" className="ayuda-minimizable-cerrar" onClick={alternar} aria-expanded="true" title="Minimizar esta explicación">
        ▴ Minimizar
      </button>
    </div>
  );
}

// Las categorías en el orden en que aparecen en una lista de productos.
function categoriasEnOrdenDeAparicion(productos) {
  const vistas = [];
  (productos || []).forEach((p) => {
    const nombre = String(p.Categoria || '').trim() || 'Otros';
    if (!vistas.includes(nombre)) vistas.push(nombre);
  });
  return vistas;
}

// ============================================================================
// ORDEN DEL CATÁLOGO: general o de una sucursal (2026-10-08)
// ============================================================================
// Claudia: "en Orden del catálogo solo puedo ordenar el general; todos los
// demás deben de tener por default el orden de su catálogo de su sucursal, y
// solo los admin tienen un carrusel para ordenar el catálogo general".
//  - Quien NO es Administrador acomoda SOLO el catálogo de su sucursal (el de
//    su link). Sin catálogo propio, no hay nada que acomodar.
//  - Un Administrador / el Admin Central tiene arriba un carrusel para
//    elegir: el catálogo general, el suyo (si tiene) o el de otra sucursal
//    (para ayudarle).
// El servidor manda los productos de cada sucursal ya en el orden en que
// salen en su catálogo (ver "sucursales" en cargarPanelCompleto).
function OrdenDelCatalogo({ productos, opciones, sucursales = [], usuarioId, puedeOrdenarGeneral, puedeAyudarSucursales, hayCambiosSinGuardar, ...resto }) {
  const propia = sucursales.find((s) => String(s.id) === String(usuarioId)) || null;
  // (2026-10-08, Claudia: "por default todos tienen el orden de su catálogo
  // personal") Primero va SIEMPRE el de mi sucursal (si tengo); después, en
  // el carrusel, el general (con permiso) y las demás sucursales (Admin).
  const vistas = [];
  if (propia) vistas.push({ clave: `s:${propia.id}`, texto: `🏪 Mi sucursal (Yo)`, sucursal: propia });
  if (puedeOrdenarGeneral) vistas.push({ clave: 'general', texto: '🌐 Catálogo general' });
  if (puedeAyudarSucursales) {
    sucursales
      .filter((s) => !propia || String(s.id) !== String(propia.id))
      .forEach((s) => vistas.push({ clave: `s:${s.id}`, texto: `🏪 ${s.nombre}`, sucursal: s }));
  }
  const [elegida, setElegida] = useState(() => (vistas[0] ? vistas[0].clave : ''));
  const vista = vistas.find((v) => v.clave === elegida) || vistas[0] || null;
  const sucursalElegida = vista && vista.sucursal ? vista.sucursal : null;

  // Los productos de esa sucursal, completos y en SU orden (el número de
  // "Orden" se vuelve su lugar, para que la pestaña los acomode igual).
  const productosDeLaVista = useMemo(() => {
    if (!sucursalElegida) return productos;
    const porId = new Map(productos.map((p) => [String(p.ID), p]));
    const lista = [];
    (sucursalElegida.productos || []).forEach((x) => {
      const p = porId.get(String(x.productoId));
      // Las piezas que se ven son las de ESA sucursal, no las de toda la tienda.
      const piezas = x.disponible !== undefined ? x.disponible : x.cantidad;
      // (2026-10-08) Con la oferta de ESA sucursal (no la del general).
      if (p) {
        lista.push({
          ...p,
          Orden: lista.length + 1,
          Stock: piezas !== undefined ? piezas : p.Stock,
          PrecioOferta: Number(x.precioOferta) > 0 ? Number(x.precioOferta) : '',
          EnOferta: false,
        });
      }
    });
    return lista;
  }, [productos, sucursalElegida]);

  if (!vista) {
    return (
      <p className="info-msg">
        Tu cuenta no tiene catálogo propio, así que aquí no hay nada que acomodar. Para acomodar el catálogo general hace falta el permiso "Acomodar el catálogo general" (se da en 🔐 Permisos).
      </p>
    );
  }
  return (
    <div className="orden-del-catalogo" data-orden-vista={vista.clave}>
      {vistas.length > 1 ? (
        <div className="orden-vistas" role="group" aria-label="Qué catálogo quieres acomodar">
          <span className="orden-vistas-titulo">Acomodar:</span>
          <div className="orden-vistas-carrusel">
            {vistas.map((v) => (
              <button
                key={v.clave}
                type="button"
                className={`resumen-btn ${v.clave === vista.clave ? 'activo' : ''}`}
                onClick={() => setElegida(v.clave)}
                disabled={hayCambiosSinGuardar && v.clave !== vista.clave}
                title={hayCambiosSinGuardar && v.clave !== vista.clave ? 'Primero guarda o descarta los cambios de orden' : undefined}
                aria-pressed={v.clave === vista.clave}
                data-orden-vista-btn={v.clave}
              >
                {v.texto}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {sucursalElegida && (
        <p className="orden-vista-nota" data-orden-vista-nota>
          Estás acomodando el catálogo de <strong>{String(sucursalElegida.id) === String(usuarioId) ? 'tu sucursal' : sucursalElegida.nombre}</strong>
          {' '}(el que abre su link). El catálogo general no cambia.
          {sucursalElegida.productos && sucursalElegida.productos.length === 0 && ' Todavía no tiene productos.'}
        </p>
      )}
      <OrdenTab
        key={vista.clave}
        {...resto}
        productos={productosDeLaVista}
        productosDeHoja={productos}
        opciones={opciones}
        sucursal={sucursalElegida ? { id: sucursalElegida.id, nombre: sucursalElegida.nombre } : null}
        ofertasOrdenSucursal={sucursalElegida && Array.isArray(sucursalElegida.ofertasOrden) ? sucursalElegida.ofertasOrden : []}
      />
    </div>
  );
}

// "sucursal" (2026-10-08): si viene ({ id, nombre }), esta pestaña acomoda el
// catálogo de ESA sucursal y no el general: "productos" ya llegan en el orden
// de esa sucursal, no hay zona de Ofertas ni botones de renombrar / ocultar /
// eliminar categorías (eso es del catálogo general, solo para Admin), y todo
// se guarda de un jalón con "guardarOrdenSucursal".
function OrdenTab({ productos, opciones, sesionToken, onCambio, iniciarCarga, terminarCarga, onDirtyChange, sucursal = null, productosDeHoja = null, ofertasOrdenSucursal = [] }) {
  const modoSucursal = !!sucursal;
  const categoriasPredeterminadas = modoSucursal ? [] : (opciones.categoria || []);
  const categoriasOcultas = opciones.categoriaOculta || [];
  const categoriaOrdenExplicito = modoSucursal ? categoriasEnOrdenDeAparicion(productos) : (opciones.categoriaOrden || []);
  // (2026-10-08) En una sucursal, la zona de Ofertas es la SUYA: sus
  // ofertas propias, en el orden que ella acomodó.
  const ofertasOrdenGuardado = modoSucursal ? ofertasOrdenSucursal.map(String) : (opciones.ofertasOrden || []);
  const zonaOfertasOculta = !modoSucursal && (opciones.ofertasOculta || []).length > 0;
  const tituloOfertas = (opciones.ofertasTitulo || [])[0] || 'Ofertas';
  const ofertasDe = (lista) => ordenarOfertas(lista, ofertasOrdenGuardado);

  const [gruposLocal, setGruposLocal] = useState(() =>
    agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito)
  );
  const [ofertasLocal, setOfertasLocal] = useState(() => ofertasDe(productos));
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  // Qué se ha movido y todavía no se guarda.
  const [categoriasTocadas, setCategoriasTocadas] = useState(() => new Set());
  const [ordenCategoriasTocado, setOrdenCategoriasTocado] = useState(false);
  const [ofertasTocadas, setOfertasTocadas] = useState(false);
  // De dónde salió cada cosa que se movió (para el resumen de la Bitácora):
  // clave "p:<id>" | "c:<nombre>" | "o:<id>" -> { nombre, categoria, desde }
  const [movidos, setMovidos] = useState(() => new Map());
  const hayCambios = categoriasTocadas.size > 0 || ordenCategoriasTocado || ofertasTocadas;
  const hayCambiosRef = useRef(false);
  hayCambiosRef.current = hayCambios || guardando;

  const [resaltado, setResaltado] = useState('');
  const [arrastre, setArrastre] = useState(null); // { lista, indice }
  const [sobre, setSobre] = useState(null); // { lista, indice }
  const [busquedaOrden, setBusquedaOrden] = useState('');
  const [contraidas, setContraidas] = useState(() => new Set());
  const [cambiandoZonaOfertas, setCambiandoZonaOfertas] = useState(false);
  // Renombrar / Eliminar la zona de Ofertas (2026-10-01, Claudia: "a la de
  // Ofertas le faltan los botones de Eliminar y Renombrar").
  const [renombrandoOfertas, setRenombrandoOfertas] = useState(false);
  const [tituloOfertasNuevo, setTituloOfertasNuevo] = useState('');
  const [guardandoTituloOfertas, setGuardandoTituloOfertas] = useState(false);
  const [eliminandoOfertas, setEliminandoOfertas] = useState(false);
  const [confirmoQuitarOfertas, setConfirmoQuitarOfertas] = useState(false);
  const [quitandoOfertas, setQuitandoOfertas] = useState(false);

  const [renombrando, setRenombrando] = useState(null); // nombre de categoría actual, o null
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [guardandoNombre, setGuardandoNombre] = useState(false);

  const [agregandoCategoria, setAgregandoCategoria] = useState(false);
  const [nombreCategoriaNueva, setNombreCategoriaNueva] = useState('');
  const [guardandoCategoriaNueva, setGuardandoCategoriaNueva] = useState(false);

  // Nombre de la categoría que se está ocultando/mostrando en este momento
  // (mientras se guarda), para poder deshabilitar solo ESE botón y no
  // todos, si Claudia le da clic a varias categorías seguidas.
  const [ocultandoCategoria, setOcultandoCategoria] = useState('');

  const [eliminando, setEliminando] = useState(null); // { nombre, cantidad } o null
  const [borrarProductosTambien, setBorrarProductosTambien] = useState(false);
  const [confirmoBorrarProductos, setConfirmoBorrarProductos] = useState(false);
  const [guardandoEliminar, setGuardandoEliminar] = useState(false);

  // Orden rápido (2026-10-05): lo que se está por confirmar
  // ({ alcance: 'todas' | 'categoria' | 'ofertas', nombre, criterio, sentido })
  // y el aviso verde de "listo" de cuando terminó.
  const [ordenRapido, setOrdenRapido] = useState(null);
  const [avisoListo, setAvisoListo] = useState('');
  // Sube de número cuando hay que volver a acomodar la pantalla con lo que
  // quedó en el servidor (ver el efecto de abajo).
  const [resincronizar, setResincronizar] = useState(0);

  function acomodarDesdeServidor() {
    setGruposLocal(agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito));
    setOfertasLocal(ofertasDe(productos));
  }

  // Si los productos o las opciones cambian desde fuera, se vuelve a
  // acomodar la lista con los datos más recientes — PERO solo si no hay
  // cambios de orden sin guardar (ni un guardado en curso): si no, los datos
  // del servidor (todavía con el orden viejo) deshacían en pantalla lo que
  // se acababa de mover.
  useEffect(() => {
    if (hayCambiosRef.current) return;
    acomodarDesdeServidor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, opciones]);

  // Después de un "orden rápido": la pantalla se vuelve a acomodar con lo
  // que de verdad quedó guardado (el efecto de arriba no corre mientras se
  // está guardando, así que hace falta pedirlo aparte al terminar).
  useEffect(() => {
    if (resincronizar === 0 || hayCambiosRef.current) return;
    acomodarDesdeServidor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resincronizar]);

  useEffect(() => {
    if (!avisoListo) return undefined;
    const t = setTimeout(() => setAvisoListo(''), 8000);
    return () => clearTimeout(t);
  }, [avisoListo]);

  // Avisa al Dashboard que hay cambios sin guardar (para el aviso de "no te
  // salgas sin guardar" y para pausar la actualización automática).
  useEffect(() => {
    onDirtyChange?.(
      'orden-catalogo',
      hayCambios,
      hayCambios ? `Orden del catálogo: ${movidos.size} movimiento(s) sin guardar — dale "💾 Guardar orden"` : ''
    );
    return () => onDirtyChange?.('orden-catalogo', false, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayCambios, movidos.size]);

  // Lleva la pantalla a donde quedó lo que se acaba de mover.
  useEffect(() => {
    if (!resaltado) return undefined;
    const el = document.getElementById(`orden-${resaltado}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const t = setTimeout(() => setResaltado(''), 2500);
    return () => clearTimeout(t);
  }, [resaltado]);

  // Foto de cómo estaba TODO antes del primer movimiento sin guardar, para
  // que el resumen de la Bitácora diga el lugar ORIGINAL de cada cosa (y no
  // el lugar a donde la habían empujado otros movimientos de la misma tanda).
  const antesDeMoverRef = useRef(null);
  function lugarOriginal(tipo, id, categoria, respaldo) {
    const foto = antesDeMoverRef.current;
    if (!foto) return respaldo;
    let i = -1;
    if (tipo === 'p') {
      const g = foto.grupos.find((x) => x.nombre === categoria);
      i = g ? g.productos.findIndex((p) => String(p.ID) === String(id)) : -1;
    } else if (tipo === 'c') {
      i = foto.grupos.findIndex((g) => g.nombre === id);
    } else {
      i = foto.ofertas.findIndex((p) => String(p.ID) === String(id));
    }
    return i === -1 ? respaldo : i + 1;
  }
  function anotarMovido(clave, info) {
    if (!hayCambios) antesDeMoverRef.current = { grupos: gruposLocal, ofertas: ofertasLocal };
    const tipo = clave.slice(0, 1);
    const desde = lugarOriginal(tipo, clave.slice(2), info.categoria, info.desde);
    setMovidos((prev) => (prev.has(clave) ? prev : new Map(prev).set(clave, { ...info, desde })));
  }

  // Mueve un producto DENTRO de su categoría, del lugar "desde" al "hasta"
  // (los dos contando desde 0). Nada se guarda todavía.
  function moverProductoA(nombreCategoria, desde, hasta) {
    const grupo = gruposLocal.find((g) => g.nombre === nombreCategoria);
    if (!grupo) return;
    const destino = Math.max(0, Math.min(grupo.productos.length - 1, hasta));
    if (destino === desde) return;
    const p = grupo.productos[desde];
    anotarMovido(`p:${p.ID}`, { nombre: p.Nombre || 'Producto', categoria: nombreCategoria, desde: desde + 1 });
    setGruposLocal((prev) =>
      prev.map((g) => (g.nombre === nombreCategoria ? { ...g, productos: moverEnLista(g.productos, desde, destino) } : g))
    );
    setCategoriasTocadas((prev) => new Set(prev).add(nombreCategoria));
    setResaltado(`p:${p.ID}`);
  }

  // Mueve una CATEGORÍA completa entre las demás.
  function moverCategoriaA(desde, hasta) {
    const destino = Math.max(0, Math.min(gruposLocal.length - 1, hasta));
    if (destino === desde) return;
    const g = gruposLocal[desde];
    anotarMovido(`c:${g.nombre}`, { nombre: g.nombre, desde: desde + 1 });
    setGruposLocal((prev) => moverEnLista(prev, desde, destino));
    setOrdenCategoriasTocado(true);
    setResaltado(`c:${g.nombre}`);
  }

  // Mueve un producto dentro del carrusel de la zona 🔥 Ofertas.
  function moverOfertaA(desde, hasta) {
    const destino = Math.max(0, Math.min(ofertasLocal.length - 1, hasta));
    if (destino === desde) return;
    const p = ofertasLocal[desde];
    anotarMovido(`o:${p.ID}`, { nombre: p.Nombre || 'Producto', desde: desde + 1 });
    setOfertasLocal((prev) => moverEnLista(prev, desde, destino));
    setOfertasTocadas(true);
    setResaltado(`o:${p.ID}`);
  }

  // Texto para la Bitácora: qué pasó de qué lugar a cuál (solo lo que de
  // verdad terminó en un lugar distinto al que tenía).
  function resumenDe(tipo) {
    const partes = [];
    movidos.forEach((info, clave) => {
      if (!clave.startsWith(`${tipo}:`)) return;
      const id = clave.slice(2);
      let hasta = -1;
      if (tipo === 'p') {
        const grupo = gruposLocal.find((g) => g.nombre === info.categoria);
        hasta = grupo ? grupo.productos.findIndex((p) => String(p.ID) === id) + 1 : -1;
      } else if (tipo === 'c') {
        hasta = gruposLocal.findIndex((g) => g.nombre === id) + 1;
      } else {
        hasta = ofertasLocal.findIndex((p) => String(p.ID) === id) + 1;
      }
      if (hasta <= 0 || hasta === info.desde) return;
      partes.push(
        tipo === 'p'
          ? `"${info.nombre}": lugar ${info.desde} → ${hasta} (${info.categoria})`
          : `"${info.nombre}": lugar ${info.desde} → ${hasta}`
      );
    });
    if (partes.length === 0) return '';
    const visibles = partes.slice(0, 8).join('; ');
    const prefijo = tipo === 'p' ? 'Productos' : tipo === 'c' ? 'Categorías' : 'Zona de Ofertas';
    return `${prefijo} — ${visibles}${partes.length > 8 ? `; y ${partes.length - 8} más` : ''}`;
  }

  function limpiarCambios() {
    setCategoriasTocadas(new Set());
    setOrdenCategoriasTocado(false);
    setOfertasTocadas(false);
    setMovidos(new Map());
  }

  function descartarCambios() {
    limpiarCambios();
    acomodarDesdeServidor();
  }

  // UN solo guardado para todo lo que se movió (máximo una llamada por tipo:
  // productos, categorías, ofertas — cada una deja UN renglón de Bitácora).
  async function guardarTodo() {
    if (!hayCambios || guardando) return;
    setGuardando(true);
    setMensaje('');
    iniciarCarga?.();
    try {
      if (modoSucursal) {
        // El catálogo de una sucursal se guarda COMPLETO en una sola llamada.
        await guardarOrdenSucursal({
          sesionToken,
          sucursalId: sucursal.id,
          productos: gruposLocal.flatMap((g) => g.productos.map((p) => String(p.ID))),
          categorias: gruposLocal.map((g) => g.nombre),
          ofertas: ofertasLocal.map((p) => String(p.ID)),
          resumen: [resumenDe('p'), resumenDe('c'), resumenDe('o')].filter(Boolean).join(' | ') || undefined,
        });
        limpiarCambios();
        await onCambio();
        return;
      }
      if (categoriasTocadas.size > 0) {
        const cambios = [];
        gruposLocal
          .filter((g) => categoriasTocadas.has(g.nombre))
          .forEach((g) => g.productos.forEach((p, i) => cambios.push({ productoId: p.ID, orden: i + 1 })));
        await actualizarOrdenMultiple({ sesionToken, cambios, resumen: resumenDe('p') || undefined });
      }
      if (ordenCategoriasTocado) {
        await actualizarOrdenCategorias({
          sesionToken,
          categorias: gruposLocal.map((g) => g.nombre),
          resumen: resumenDe('c') || undefined,
        });
      }
      if (ofertasTocadas) {
        await actualizarOrdenOfertas({
          sesionToken,
          productoIds: ofertasLocal.map((p) => p.ID),
          resumen: resumenDe('o') || undefined,
        });
      }
      limpiarCambios();
      await onCambio();
    } catch (err) {
      setMensaje(`Error al guardar el orden: ${err.message} — tus cambios siguen aquí, vuelve a darle "Guardar orden".`);
    } finally {
      setGuardando(false);
      terminarCarga?.();
    }
  }

  // ---- Orden rápido (2026-10-05): por fecha o por nombre, con pregunta ----
  // Renglón de la hoja de cada producto (los de más abajo son los más
  // nuevos): sirve para desempatar fechas o nombres iguales.
  const lugarEnHoja = {};
  (productosDeHoja || productos).forEach((p, i) => { lugarEnHoja[String(p.ID)] = i + 1; });

  // Las listas a las que les toca cada alcance.
  function listasDeOrdenRapido(alcance, nombre) {
    if (alcance === 'ofertas') return [ofertasLocal];
    if (alcance === 'categoria') {
      const g = gruposLocal.find((x) => x.nombre === nombre);
      return g ? [g.productos] : [];
    }
    return gruposLocal.map((g) => g.productos).concat(ofertasLocal.length > 0 ? [ofertasLocal] : []);
  }

  // Lo que dibuja cada par de botones: [{ criterio, sentido, texto, apagado }].
  function botonesDeOrdenRapido(alcance, nombre) {
    const listas = listasDeOrdenRapido(alcance, nombre);
    const hayQueAcomodar = listas.some((l) => l.length > 1);
    return ['fecha', 'nombre'].map((criterio) => {
      const sentido = siguienteSentidoDeOrden(listas, criterio, lugarEnHoja);
      return { criterio, sentido, texto: ORDEN_RAPIDO[criterio].etiqueta[sentido], apagado: !hayQueAcomodar };
    });
  }

  function pedirOrdenRapido(alcance, nombre, criterio, sentido) {
    if (bloqueoPorCambios) return;
    setAvisoListo('');
    setOrdenRapido({ alcance, nombre: nombre || '', criterio, sentido });
  }

  // Ya confirmado: se manda al servidor de un jalón (UNA llamada para todos
  // los productos, más una para la zona de Ofertas si le toca; cada una
  // deja UN renglón de Bitácora, que se puede deshacer desde la papelera).
  // La pantalla no se mueve "por adelantado": se acomoda al terminar, con
  // lo que de verdad quedó guardado.
  async function aplicarOrdenRapido() {
    const pedido = ordenRapido;
    if (!pedido || guardando || hayCambios) return;
    const { alcance, nombre, criterio, sentido } = pedido;
    const frase = ORDEN_RAPIDO[criterio].frase[sentido];
    setOrdenRapido(null);
    setGuardando(true);
    setMensaje('');
    iniciarCarga?.();
    try {
      const cambios = [];
      const categoriasCambiadas = [];
      if (alcance !== 'ofertas') {
        gruposLocal.forEach((g) => {
          if (alcance === 'categoria' && g.nombre !== nombre) return;
          const acomodados = ordenarProductosPor(g.productos, criterio, sentido, lugarEnHoja);
          if (mismoOrdenDeProductos(acomodados, g.productos)) return;
          categoriasCambiadas.push(g.nombre);
          acomodados.forEach((p, i) => cambios.push({ productoId: p.ID, orden: i + 1 }));
        });
      }
      let ofertasAcomodadas = null;
      if (alcance !== 'categoria' && ofertasLocal.length > 1) {
        const acomodadas = ordenarProductosPor(ofertasLocal, criterio, sentido, lugarEnHoja);
        if (!mismoOrdenDeProductos(acomodadas, ofertasLocal)) ofertasAcomodadas = acomodadas;
      }
      if (cambios.length === 0 && !ofertasAcomodadas) {
        setAvisoListo('Ya estaban acomodados así: no hubo nada que cambiar.');
        return;
      }
      if (modoSucursal) {
        const acomodadosPorCategoria = {};
        gruposLocal.forEach((g) => {
          if (categoriasCambiadas.includes(g.nombre)) acomodadosPorCategoria[g.nombre] = ordenarProductosPor(g.productos, criterio, sentido, lugarEnHoja);
        });
        await guardarOrdenSucursal({
          sesionToken,
          sucursalId: sucursal.id,
          productos: gruposLocal.flatMap((g) => (acomodadosPorCategoria[g.nombre] || g.productos).map((p) => String(p.ID))),
          categorias: gruposLocal.map((g) => g.nombre),
          ofertas: (ofertasAcomodadas || ofertasLocal).map((p) => String(p.ID)),
          resumen: alcance === 'ofertas'
            ? `Zona de Ofertas — acomodada ${frase}`
            : `Productos — ${categoriasCambiadas.length === 1 ? `"${categoriasCambiadas[0]}"` : `${categoriasCambiadas.length} categorías`}: acomodados ${frase}`,
        });
      } else if (cambios.length > 0) {
        const cuales =
          categoriasCambiadas.length === 1
            ? `"${categoriasCambiadas[0]}"`
            : `${categoriasCambiadas.length} categorías (${categoriasCambiadas.slice(0, 6).join(', ')}${categoriasCambiadas.length > 6 ? '…' : ''})`;
        await actualizarOrdenMultiple({
          sesionToken,
          cambios,
          resumen: `Productos — ${cuales}: acomodados ${frase} (${cambios.length} producto${cambios.length === 1 ? '' : 's'})`,
        });
      }
      if (ofertasAcomodadas && !modoSucursal) {
        await actualizarOrdenOfertas({
          sesionToken,
          productoIds: ofertasAcomodadas.map((p) => p.ID),
          resumen: `Zona de Ofertas — acomodada ${frase} (${ofertasAcomodadas.length} productos)`,
        });
      }
      await onCambio();
      const donde =
        alcance === 'todas' ? 'Todas las categorías quedaron' : alcance === 'ofertas' ? `La zona de "${tituloOfertas}" quedó` : `"${nombre}" quedó`;
      setAvisoListo(`${donde} ${alcance === 'todas' ? 'acomodadas' : 'acomodada'} ${frase}. Así se ve ya en el catálogo.`);
      if (alcance === 'categoria') setResaltado(`c:${nombre}`);
    } catch (err) {
      setMensaje(`Error al acomodar: ${err.message} — revisa cómo quedó y vuelve a intentarlo.`);
      try {
        await onCambio();
      } catch {
        // Si tampoco se pudo actualizar, la actualización automática lo hará.
      }
    } finally {
      setGuardando(false);
      terminarCarga?.();
      setResincronizar((n) => n + 1);
    }
  }

  // Lo que lleva un botón "compacto" (solo ícono) de los encabezados
  // (2026-10-06, Claudia: "que los botones se minimicen, que solo se vean
  // sus íconos… el nombre completo solo al pasar el mouse o presionar").
  // El nombre va en "data-pista": global.css lo enseña en una etiqueta
  // flotante al pasar el mouse, al presionar o al llegar con el teclado
  // (sale al instante y no mueve nada de lugar). "motivoApagado" explica
  // por qué no se puede usar, cuando está apagado.
  function propsBotonCompacto(nombreBoton, motivoApagado) {
    const pista = motivoApagado ? `${nombreBoton} — ${motivoApagado}` : nombreBoton;
    return { 'data-pista': pista, 'aria-label': pista };
  }

  // Los dos botones (Nuevo–Viejo / A–Z) de un encabezado. Con "compacto"
  // (los de cada categoría y los de Ofertas) solo se ve el ícono con una
  // flechita que dice hacia dónde acomoda.
  function botonesOrdenRapidoJSX(alcance, nombre, clase, compacto) {
    return botonesDeOrdenRapido(alcance, nombre).map((b) => {
      const nombreBoton = `Orden ${b.criterio === 'fecha' ? 'por ' : ''}${b.texto}`;
      const comun = {
        type: 'button',
        'data-orden-rapido': `${b.criterio}:${b.sentido}`,
        onClick: () => pedirOrdenRapido(alcance, nombre, b.criterio, b.sentido),
        disabled: bloqueoPorCambios || b.apagado,
      };
      if (compacto) {
        return (
          <button
            key={b.criterio}
            {...comun}
            className={`${clase} btn-icono`}
            {...propsBotonCompacto(nombreBoton, motivoBloqueo || (b.apagado ? 'aquí no hay productos que acomodar' : ''))}
          >
            <span aria-hidden="true">{b.criterio === 'fecha' ? '🕒' : '🔤'}</span>
            <span className="btn-icono-sentido" aria-hidden="true">{b.sentido === 'asc' ? '↑' : '↓'}</span>
          </button>
        );
      }
      return (
        <button
          key={b.criterio}
          {...comun}
          className={clase}
          title={
            tituloBloqueo ||
            (b.apagado
              ? 'Aquí no hay productos que acomodar'
              : `Acomoda ${alcance === 'todas' ? 'los productos de TODAS las categorías' : 'los productos de aquí'} ${ORDEN_RAPIDO[b.criterio].frase[b.sentido]}. Antes de hacerlo te pregunta. Al presionarlo otra vez, los acomoda al revés.`)
          }
        >
          {b.criterio === 'fecha' ? '🕒' : '🔤'} <span className="orden-rapido-prefijo">Orden {b.criterio === 'fecha' ? 'por ' : ''}</span>{b.texto}
        </button>
      );
    });
  }

  // Ocultar/mostrar la zona 🔥 Ofertas completa del catálogo (los productos
  // siguen en su categoría normal y siguen con su precio de oferta; solo se
  // quita/pone el carrusel de "Ofertas" de arriba).
  function toggleZonaOfertas() {
    setCambiandoZonaOfertas(true);
    setMensaje('');
    iniciarCarga?.();
    const promesa = zonaOfertasOculta
      ? eliminarOpcion({ sesionToken, campo: 'ofertasOculta', valor: 'SI' })
      : agregarOpcion({ sesionToken, campo: 'ofertasOculta', valor: 'SI' });
    promesa
      .then(() => onCambio())
      .catch((err) => setMensaje(`Error al ${zonaOfertasOculta ? 'mostrar' : 'ocultar'} la zona de Ofertas: ${err.message}`))
      .finally(() => {
        setCambiandoZonaOfertas(false);
        terminarCarga?.();
      });
  }

  function confirmarRenombrarOfertas() {
    setGuardandoTituloOfertas(true);
    setMensaje('');
    iniciarCarga?.();
    renombrarZonaOfertas({ sesionToken, titulo: tituloOfertasNuevo.trim() })
      .then(() => {
        setRenombrandoOfertas(false);
        return onCambio();
      })
      .catch((err) => setMensaje(`Error al renombrar la zona de Ofertas: ${err.message}`))
      .finally(() => {
        setGuardandoTituloOfertas(false);
        terminarCarga?.();
      });
  }

  // "Eliminar" la zona de Ofertas = quitarle la oferta a TODOS los productos
  // (vuelven a su precio normal). No borra ningún producto.
  function confirmarQuitarOfertas() {
    if (!confirmoQuitarOfertas) return;
    setQuitandoOfertas(true);
    setMensaje('');
    iniciarCarga?.();
    quitarTodasLasOfertas({ sesionToken })
      .then(() => {
        setEliminandoOfertas(false);
        return onCambio();
      })
      .catch((err) => setMensaje(`Error al quitar las ofertas: ${err.message}`))
      .finally(() => {
        setQuitandoOfertas(false);
        terminarCarga?.();
      });
  }

  function alternarContraida(nombre) {
    setContraidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(nombre)) siguiente.delete(nombre);
      else siguiente.add(nombre);
      return siguiente;
    });
  }

  // ---- Arrastrar con el DEDO (celular / tablet) ----
  // Pedido de Claudia (2026-10-01): "en celular sí debería poder arrastrar,
  // ya que de hecho ahí es más fácil". El arrastre de computadora (el de
  // abajo) no funciona con el dedo en la mayoría de los celulares, así que
  // el ⠿ tiene su propio arrastre táctil:
  //   - Se pone el dedo en el ⠿ y se arrastra (empieza de inmediato, sin
  //     tener que dejarlo presionado). El ⠿ es lo único que "agarra": en
  //     el resto del renglón el dedo sigue desplazando la página normal.
  //   - Una etiqueta con el nombre sigue al dedo, el renglón original se
  //     atenúa y la raya verde marca dónde va a quedar (lo mismo que con
  //     el mouse: se reutilizan "arrastre" y "sobre").
  //   - Si el dedo se acerca al borde de arriba o de abajo de la pantalla,
  //     la página se desplaza sola para alcanzar lugares lejanos.
  //   - Al soltar se mueve; funciona igual para productos, Ofertas y
  //     categorías, y cada cosa solo se mueve dentro de su propia lista.
  const raizOrdenRef = useRef(null);
  const fantasmaRef = useRef(null);
  const tactilRef = useRef(null);

  // ---- Arrastrar una CATEGORÍA: que sea igual de fácil que un producto ----
  // Claudia (2026-10-01): "desplazar una categoría no es tan fácil como un
  // producto, no me guío y no funciona igual". El problema: una categoría
  // abierta es una caja altísima (con todos sus productos adentro), así que
  // había que arrastrarla muy lejos y no se veía dónde iba a quedar. Ahora,
  // MIENTRAS se arrastra una categoría:
  //   1. Todas las categorías se muestran contraídas (solo su renglón de
  //      título), así quedan como una lista corta — igual que los productos.
  //      Al soltar, cada una vuelve a como estaba (abierta o contraída).
  //   2. Se puede soltar en cualquier parte (encima de una categoría, en el
  //      hueco entre dos, arriba de la primera o abajo de la última): se
  //      toma la categoría más cercana a la altura del puntero o del dedo.
  //   3. En el hueco donde va a quedar sale una barra verde que lo dice con
  //      letras: "Aquí queda «NOMBRE» · lugar N".
  // "compactar" es solo visual y temporal; no cambia qué categorías tiene
  // Claudia contraídas.
  const [compactar, setCompactar] = useState(false);
  const compactarRef = useRef(false);
  const arrastreRef = useRef(null);
  arrastreRef.current = arrastre;
  // Para que la pantalla no "brinque" cuando las cajas se encogen o se
  // vuelven a abrir: se anota a qué altura estaba un encabezado antes del
  // cambio y, ya con el cambio hecho, se desplaza la página lo necesario
  // para que ese encabezado quede a esa misma altura.
  const anclaCompactarRef = useRef(null);
  // Hueco invisible arriba de la lista: solo se usa mientras se arrastra una
  // categoría, cuando la página no puede desplazarse lo suficiente para que
  // la categoría agarrada se quede bajo el puntero (pasa con las primeras).
  const espaciadorRef = useRef(null);
  useLayoutEffect(() => {
    const ancla = anclaCompactarRef.current;
    anclaCompactarRef.current = null;
    const raiz = raizOrdenRef.current;
    const espaciador = espaciadorRef.current;
    if (!compactar) {
      // Se acabó el arrastre: fuera el hueco y la altura reservada.
      if (espaciador) espaciador.style.height = '0px';
      if (raiz) raiz.style.minHeight = '';
    }
    if (ancla && ancla.el.isConnected) {
      const diferencia = ancla.el.getBoundingClientRect().top - ancla.top;
      if (Math.abs(diferencia) > 1) window.scrollBy(0, diferencia);
      if (compactar && espaciador) {
        const falta = ancla.top - ancla.el.getBoundingClientRect().top;
        if (falta > 1) espaciador.style.height = `${Math.round(falta)}px`;
      }
    }
    if (tactilRef.current) tactilRef.current.recalcular = true;
  }, [compactar]);

  function encabezadoDeCategoria(indice) {
    const raiz = raizOrdenRef.current;
    if (!raiz) return null;
    let encontrado = null;
    raiz.querySelectorAll('[data-orden-lista="categorias"]').forEach((el) => {
      if (Number(el.dataset.ordenIndice) === indice) encontrado = el.querySelector('.orden-categoria-header');
    });
    return encontrado;
  }
  function empezarACompactar(indice) {
    if (compactarRef.current) return;
    const el = encabezadoDeCategoria(indice);
    compactarRef.current = true;
    anclaCompactarRef.current = el ? { el, top: el.getBoundingClientRect().top } : null;
    // Se reserva la altura que tiene la pestaña ahorita, para que la página
    // no se "acorte" de golpe al contraer las categorías (si se acortara,
    // el navegador brincaría hacia arriba y la categoría agarrada se iría
    // de debajo del puntero).
    const raiz = raizOrdenRef.current;
    if (raiz) raiz.style.minHeight = `${raiz.offsetHeight}px`;
    setCompactar(true);
  }
  // Al terminar de arrastrar una categoría (se haya movido o no). Si se
  // movió ("hasta" distinto de "desde"), la pantalla se acomoda para que la
  // categoría quede justo donde se soltó.
  function terminarDeCompactar(desde, hasta) {
    if (!compactarRef.current) return;
    compactarRef.current = false;
    const elMovido = encabezadoDeCategoria(desde);
    const elReferencia = hasta !== null && hasta !== undefined && hasta !== desde ? encabezadoDeCategoria(hasta) : elMovido;
    anclaCompactarRef.current = elMovido && elReferencia ? { el: elMovido, top: elReferencia.getBoundingClientRect().top } : null;
    setCompactar(false);
  }
  // Siempre apunta a las funciones de mover de ESTE render (las del momento
  // de soltar), no a las del momento en que se puso el dedo.
  const moverPorListaRef = useRef(null);
  moverPorListaRef.current = (lista, desde, hasta) => {
    if (lista === 'categorias') moverCategoriaA(desde, hasta);
    else if (lista === 'ofertas') moverOfertaA(desde, hasta);
    else if (lista.startsWith('cat:')) moverProductoA(lista.slice(4), desde, hasta);
  };

  // ¿En qué lugar quedaría lo que se está arrastrando si se soltara a esta
  // altura de la pantalla? Sirve igual para el dedo y para el mouse, y para
  // productos, Ofertas y categorías. La regla es la de cualquier lista que
  // se acomoda arrastrando: cuenta el HUECO más cercano al puntero — entre
  // el renglón que queda arriba y el que queda abajo —, así que da lo mismo
  // soltar encima de un renglón que en el espacio entre dos.
  //   - Categorías: se puede soltar en cualquier parte de la pestaña.
  //   - Productos: solo cuenta cerca de su propia lista; si el puntero se
  //     va lejos (por ejemplo a otra categoría), no se mueve nada.
  // Regresa el lugar nuevo (contando desde 0) o "desde" si no hay cambio.
  function destinoPorAltura(lista, desde, y, limites) {
    const raiz = raizOrdenRef.current;
    if (!raiz) return desde;
    let arriba = null; // el renglón más bajo que queda ARRIBA del puntero
    let abajo = null; // el renglón más alto que queda ABAJO del puntero
    let tope = Infinity;
    let fondo = -Infinity;
    raiz.querySelectorAll('[data-orden-lista]').forEach((el) => {
      if (el.dataset.ordenLista !== lista) return;
      const r = el.getBoundingClientRect();
      tope = Math.min(tope, r.top);
      fondo = Math.max(fondo, r.bottom);
      const indice = Number(el.dataset.ordenIndice);
      if (indice === desde) return;
      if (r.top + r.height / 2 < y) {
        if (arriba === null || indice > arriba) arriba = indice;
      } else if (abajo === null || indice < abajo) abajo = indice;
    });
    // Dónde empieza y termina la lista en pantalla (lo usa el desplazamiento
    // automático del dedo para no seguir de largo cuando ya se ve el final).
    if (limites) {
      limites.tope = tope;
      limites.fondo = fondo;
    }
    if (lista !== 'categorias' && (y < tope - 48 || y > fondo + 48)) return desde;
    if (arriba !== null && arriba > desde) return arriba;
    if (abajo !== null && abajo < desde) return abajo;
    return desde;
  }

  function terminarTactil(soltar) {
    const t = tactilRef.current;
    if (!t) return;
    tactilRef.current = null;
    window.removeEventListener('pointermove', t.alMover);
    window.removeEventListener('pointerup', t.alSoltar);
    window.removeEventListener('pointercancel', t.alCancelar);
    if (t.raf) cancelAnimationFrame(t.raf);
    if (fantasmaRef.current) fantasmaRef.current.style.display = 'none';
    document.body.classList.remove('orden-arrastrando-tactil');
    setArrastre(null);
    setSobre(null);
    const seMueve = soltar && t.destino !== null && t.destino !== t.indice;
    if (t.lista === 'categorias') terminarDeCompactar(t.indice, seMueve ? t.destino : null);
    if (seMueve) moverPorListaRef.current(t.lista, t.indice, t.destino);
  }

  function iniciarTactil(e, lista, indice, texto) {
    // Con mouse se usa el arrastre normal de computadora (el de abajo).
    if (e.pointerType === 'mouse' || guardando || tactilRef.current) return;
    e.preventDefault();
    const t = {
      lista,
      indice,
      destino: indice,
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      raf: 0,
      limites: { tope: -Infinity, fondo: Infinity },
    };
    const BORDE = 80; // alto de la zona de arriba/abajo donde la página se desplaza sola
    const actualizar = () => {
      // Con el dedo pegado al borde de la pantalla (la zona donde la página
      // se desplaza sola) cuenta como "hasta el final / hasta el principio"
      // de la lista, aunque la lista ya haya quedado un poco más adentro.
      let y = t.y;
      if (t.y > window.innerHeight - BORDE) y = Math.min(y, t.limites.fondo - 1);
      else if (t.y < BORDE) y = Math.max(y, t.limites.tope + 1);
      const destino = destinoPorAltura(lista, indice, y, t.limites);
      const fantasma = fantasmaRef.current;
      if (destino !== t.destino) {
        t.destino = destino;
        setSobre(destino === indice ? null : { lista, indice: destino });
        // La etiqueta que sigue al dedo también dice a qué lugar va.
        if (fantasma) fantasma.textContent = destino === indice ? `⠿ ${texto}` : `⠿ ${texto} → lugar ${destino + 1}`;
      }
      if (fantasma) {
        const x = Math.min(t.x + 16, window.innerWidth - fantasma.offsetWidth - 8);
        fantasma.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, t.y - 46)}px)`;
      }
    };
    // Desplazamiento automático cerca de los bordes de la pantalla.
    const ciclo = () => {
      if (tactilRef.current !== t) return;
      let paso = 0;
      if (t.y < BORDE) paso = -Math.ceil((BORDE - t.y) / 5);
      else if (t.y > window.innerHeight - BORDE) paso = Math.ceil((t.y - (window.innerHeight - BORDE)) / 5);
      // Si ya se ve el final (o el principio) de la lista, no seguir de largo.
      if (paso > 0 && t.limites.fondo < window.innerHeight - 40) paso = 0;
      if (paso < 0 && t.limites.tope > 40) paso = 0;
      if (paso) window.scrollBy(0, paso);
      if (paso || t.recalcular) {
        t.recalcular = false;
        actualizar();
      }
      t.raf = requestAnimationFrame(ciclo);
    };
    t.alMover = (ev) => {
      if (ev.pointerId !== t.pointerId) return;
      t.x = ev.clientX;
      t.y = ev.clientY;
      actualizar();
    };
    t.alSoltar = (ev) => {
      if (ev.pointerId === t.pointerId) terminarTactil(true);
    };
    t.alCancelar = (ev) => {
      if (ev.pointerId === t.pointerId) terminarTactil(false);
    };
    tactilRef.current = t;
    window.addEventListener('pointermove', t.alMover);
    window.addEventListener('pointerup', t.alSoltar);
    window.addEventListener('pointercancel', t.alCancelar);
    document.body.classList.add('orden-arrastrando-tactil');
    setArrastre({ lista, indice });
    setSobre(null);
    if (fantasmaRef.current) {
      fantasmaRef.current.textContent = `⠿ ${texto}`;
      fantasmaRef.current.style.display = 'block';
    }
    actualizar();
    if (lista === 'categorias') empezarACompactar(indice);
    t.raf = requestAnimationFrame(ciclo);
    try { navigator.vibrate?.(12); } catch { /* no todos los celulares vibran */ }
  }

  // Lo que lleva cada ⠿ para poder arrastrarse con el dedo.
  function propsAgarradera(lista, indice, texto) {
    return {
      onPointerDown: (e) => iniciarTactil(e, lista, indice, texto),
      onContextMenu: (e) => e.preventDefault(),
    };
  }

  // Si se cambia de pestaña a medio arrastre, que no quede nada colgado.
  useEffect(
    () => () => {
      const t = tactilRef.current;
      if (!t) return;
      tactilRef.current = null;
      window.removeEventListener('pointermove', t.alMover);
      window.removeEventListener('pointerup', t.alSoltar);
      window.removeEventListener('pointercancel', t.alCancelar);
      if (t.raf) cancelAnimationFrame(t.raf);
      document.body.classList.remove('orden-arrastrando-tactil');
    },
    []
  );

  // ---- Arrastrar y soltar (en computadora) ----
  function propsArrastre(lista, indice) {
    return {
      draggable: !guardando,
      onDragStart: (e) => {
        // Si ya se está arrastrando con el dedo, que el celular no arranque
        // además su propio arrastre (algunos lo hacen al dejar presionado).
        if (tactilRef.current) {
          e.preventDefault();
          return;
        }
        setArrastre({ lista, indice });
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(indice)); } catch { /* algunos navegadores */ }
      },
      // Dónde se suelta ya no lo decide cada renglón: ver "propsSoltar".
      onDragEnd: () => {
        setArrastre(null);
        setSobre(null);
      },
    };
  }
  function clasesFila(lista, indice, clave) {
    return [
      'orden-fila',
      resaltado === clave && 'orden-fila-movida',
      arrastre && arrastre.lista === lista && arrastre.indice === indice && 'orden-fila-arrastrando',
      sobre && arrastre && sobre.lista === lista && sobre.indice === indice && arrastre.indice !== indice &&
        (arrastre.indice < indice ? 'orden-fila-destino-abajo' : 'orden-fila-destino-arriba'),
    ].filter(Boolean).join(' ');
  }

  // ---- Buscador ----
  const textoBuscadoOrden = normalizarParaFiltro(busquedaOrden);
  function coincideProducto(p) {
    return normalizarParaFiltro([p.Nombre, p.CodigoPropio, p.Marca, p.Color].join(' ')).includes(textoBuscadoOrden);
  }
  const bloqueoPorCambios = hayCambios || guardando;
  const tituloBloqueo = bloqueoPorCambios ? 'Primero guarda o descarta los cambios de orden' : undefined;
  // Lo mismo, para la etiqueta de los botones compactos (va después del nombre).
  const motivoBloqueo = bloqueoPorCambios ? 'primero guarda o descarta los cambios de orden' : '';

  // Un renglón de producto (se usa igual en una categoría y en Ofertas).
  function filaProducto({ p, i, total, lista, clave, onMover }) {
    return (
      <li
        key={p.ID}
        id={`orden-${clave}`}
        className={clasesFila(lista, i, clave)}
        data-orden-lista={lista}
        data-orden-indice={i}
        {...propsArrastre(lista, i)}
      >
        <span className="orden-agarradera" aria-hidden="true" title="Arrastra para mover" {...propsAgarradera(lista, i, p.Nombre || 'Producto')}>⠿</span>
        <CampoPosicion posicion={i + 1} total={total} onMover={(destino) => onMover(i, destino)} etiqueta={p.Nombre} />
        <div className="orden-botones-mover">
          <button type="button" className="orden-mover-btn" onClick={() => onMover(i, i - 1)} disabled={i === 0 || guardando} title="Subir un lugar" aria-label="Subir un lugar">
            ▲
          </button>
          <button type="button" className="orden-mover-btn" onClick={() => onMover(i, i + 1)} disabled={i === total - 1 || guardando} title="Bajar un lugar" aria-label="Bajar un lugar">
            ▼
          </button>
        </div>
        {primeraFoto(p.FotoURL) ? (
          <img src={primeraFoto(p.FotoURL)} alt={p.Nombre} className="orden-thumb" draggable={false} />
        ) : (
          <div className="orden-thumb orden-thumb-vacia">Sin foto</div>
        )}
        {/* (2026-10-06, Claudia) El nombre va en un renglón, recortado con
            "…" (clic para verlo completo, igual que en Stock); debajo, en
            chiquito, el código, las piezas disponibles y el precio, para
            saber qué producto se está acomodando. */}
        <span className="orden-nombre">
          <span className="orden-texto-copiable" {...propsTextoSeleccionable}><CeldaTruncada texto={p.Nombre} /></span>
          <span className="orden-datos orden-texto-copiable" data-orden-datos {...propsTextoSeleccionable}>
            {p.CodigoPropio !== undefined && p.CodigoPropio !== null && String(p.CodigoPropio).trim() !== '' && (
              <span className="orden-dato orden-dato-codigo" title="Código del producto">{String(p.CodigoPropio)}</span>
            )}
            <span className={`orden-dato ${Number(p.Stock) > 0 ? '' : 'orden-dato-agotado'}`} title="Piezas disponibles en Stock">
              {Number(p.Stock) > 0 ? `${Number(p.Stock).toLocaleString('es-MX')} pza${Number(p.Stock) === 1 ? '' : 's'}` : 'Agotado'}
            </span>
            <span className="orden-dato" title={productoEnOferta(p) && Number(p.PrecioOferta) > 0 && Number(p.PrecioOferta) < Number(p.Precio) ? `Precio de oferta (normal: ${formatearMoneda(Number(p.Precio) || 0)})` : 'Precio'}>
              {formatearMoneda(productoEnOferta(p) && Number(p.PrecioOferta) > 0 && Number(p.PrecioOferta) < Number(p.Precio) ? Number(p.PrecioOferta) : Number(p.Precio) || 0)}
              {productoEnOferta(p) && Number(p.PrecioOferta) > 0 && Number(p.PrecioOferta) < Number(p.Precio) ? ' 🔥' : ''}
            </span>
          </span>
        </span>
        {!esProductoVisible(p) && <span className="badge badge-oculto">Oculto</span>}
        <button type="button" className="orden-al-inicio" onClick={() => onMover(i, 0)} disabled={i === 0 || guardando} title="Mandarlo al primer lugar">
          ↑ Al inicio
        </button>
      </li>
    );
  }

  function abrirRenombrar(nombreActual) {
    setRenombrando(nombreActual);
    setNombreNuevo(nombreActual === 'Otros' ? '' : nombreActual);
  }

  function confirmarRenombrar() {
    const nuevo = nombreNuevo.trim();
    if (!nuevo || !renombrando) return;
    setGuardandoNombre(true);
    iniciarCarga?.();
    renombrarCategoria({ sesionToken, categoriaAnterior: renombrando, categoriaNueva: nuevo })
      .then(() => {
        setRenombrando(null);
        // Arreglo (2026-09-28): antes faltaba el "return" aquí — el pacman
        // (una vez conectado) se hubiera cerrado en cuanto el servidor
        // confirmara el renombrado, sin esperar a que los datos nuevos de
        // verdad llegaran a la pantalla. Mismo bug que ya se había
        // encontrado y corregido en el Dashboard principal.
        return onCambio();
      })
      .catch((err) => setMensaje(`Error al renombrar la categoría: ${err.message}`))
      .finally(() => {
        setGuardandoNombre(false);
        terminarCarga?.();
      });
  }

  function abrirAgregarCategoria() {
    setNombreCategoriaNueva('');
    setAgregandoCategoria(true);
  }

  function confirmarAgregarCategoria() {
    const nombre = nombreCategoriaNueva.trim();
    if (!nombre) return;
    setGuardandoCategoriaNueva(true);
    iniciarCarga?.();
    agregarOpcion({ sesionToken, campo: 'categoria', valor: nombre })
      .then(() => {
        setAgregandoCategoria(false);
        return onCambio();
      })
      .catch((err) => setMensaje(`Error al agregar la categoría: ${err.message}`))
      .finally(() => {
        setGuardandoCategoriaNueva(false);
        terminarCarga?.();
      });
  }

  // Ocultar/mostrar es reversible y NO toca los productos ni su categoría:
  // solo agrega o quita el nombre de la categoría de una listita aparte
  // ("categoriaOculta"), que el catálogo público revisa antes de mostrar
  // cada producto.
  function toggleOcultarCategoria(grupo) {
    setOcultandoCategoria(grupo.nombre);
    setMensaje('');
    iniciarCarga?.();
    const promesa = grupo.oculta
      ? eliminarOpcion({ sesionToken, campo: 'categoriaOculta', valor: grupo.nombre })
      : agregarOpcion({ sesionToken, campo: 'categoriaOculta', valor: grupo.nombre });
    promesa
      .then(() => onCambio())
      .catch((err) =>
        setMensaje(`Error al ${grupo.oculta ? 'volver a mostrar' : 'ocultar'} la categoría: ${err.message}`)
      )
      .finally(() => {
        setOcultandoCategoria('');
        terminarCarga?.();
      });
  }

  function abrirEliminar(grupo) {
    setEliminando({ nombre: grupo.nombre, cantidad: grupo.productos.length });
    setBorrarProductosTambien(false);
    setConfirmoBorrarProductos(false);
  }

  function confirmarEliminar() {
    if (!eliminando) return;
    if (borrarProductosTambien && !confirmoBorrarProductos) return;
    setGuardandoEliminar(true);
    // Arreglo (2026-09-28, pedido por Claudia): esta es justo la acción que
    // señaló como "se alenta y como el pacman no sale, genera problemas" —
    // borrar una categoría CON sus productos puede tardar más que las demás
    // acciones de esta pestaña (borra un producto a la vez del lado del
    // servidor), y antes su única señal de progreso era el texto
    // "Aplicando…" del botón dentro del modal, fácil de perder de vista.
    iniciarCarga?.();
    eliminarCategoria({ sesionToken, categoria: eliminando.nombre, borrarProductos: borrarProductosTambien })
      .then(() => {
        setEliminando(null);
        return onCambio();
      })
      .catch((err) => setMensaje(`Error al quitar/borrar la categoría: ${err.message}`))
      .finally(() => {
        setGuardandoEliminar(false);
        terminarCarga?.();
      });
  }

  const gruposVisibles = gruposLocal
    .map((grupo, indiceCategoria) => {
      const nombreCoincide = textoBuscadoOrden && normalizarParaFiltro(grupo.nombre).includes(textoBuscadoOrden);
      const filas = grupo.productos
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !textoBuscadoOrden || nombreCoincide || coincideProducto(p));
      return { grupo, indiceCategoria, filas, nombreCoincide };
    })
    .filter(({ filas, nombreCoincide }) => !textoBuscadoOrden || nombreCoincide || filas.length > 0);
  const ofertasVisibles = ofertasLocal
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !textoBuscadoOrden || coincideProducto(p) || 'ofertas'.includes(textoBuscadoOrden));
  // La zona de Ofertas también se contrae (arreglo 2026-10-01: "el botón de
  // contraer no contrae a la de Ofertas, las demás sí"). Se guarda en la
  // misma lista de contraídas con una clave especial que no puede chocar con
  // el nombre de ninguna categoría.
  const CLAVE_OFERTAS = '\u0000ofertas';
  const hayZonaOfertas = ofertasLocal.length > 0 || zonaOfertasOculta;
  const clavesContraibles = gruposLocal.map((g) => g.nombre).concat(hayZonaOfertas ? [CLAVE_OFERTAS] : []);
  const todasContraidas = clavesContraibles.length > 0 && clavesContraibles.every((k) => contraidas.has(k));
  const ofertasContraida = (!textoBuscadoOrden && contraidas.has(CLAVE_OFERTAS)) || compactar;

  // Arrastre con el MOUSE: dónde se puede soltar. Antes cada renglón
  // decidía por su cuenta; ahora lo decide la pestaña completa con la misma
  // regla que el dedo ("destinoPorAltura"), para que productos y categorías
  // se comporten exactamente igual.
  const categoriaArrastrada = arrastre && arrastre.lista === 'categorias' ? gruposLocal[arrastre.indice] : null;
  const propsSoltar = {
    onDragOver: (e) => {
      if (!arrastre || tactilRef.current) return;
      const destino = destinoPorAltura(arrastre.lista, arrastre.indice, e.clientY);
      if (destino === arrastre.indice) {
        // Sin cambio (está sobre su propio lugar, o lejos de su lista).
        if (arrastre.lista === 'categorias') e.preventDefault();
        if (sobre) setSobre(null);
        return;
      }
      e.preventDefault();
      if (!sobre || sobre.lista !== arrastre.lista || sobre.indice !== destino) {
        setSobre({ lista: arrastre.lista, indice: destino });
      }
    },
    onDrop: (e) => {
      if (!arrastre || tactilRef.current) return;
      e.preventDefault();
      const { lista, indice: desde } = arrastre;
      const destino = destinoPorAltura(lista, desde, e.clientY);
      const seMueve = destino !== desde;
      if (lista === 'categorias') terminarDeCompactar(desde, seMueve ? destino : null);
      if (seMueve) moverPorListaRef.current(lista, desde, destino);
      setArrastre(null);
      setSobre(null);
    },
  };

  return (
    <div className="orden-catalogo" ref={raizOrdenRef} {...propsSoltar}>
      {/* Etiqueta que sigue al dedo mientras se arrastra en celular. */}
      <div ref={fantasmaRef} className="orden-fantasma" aria-hidden="true" style={{ display: 'none' }} />
      <div ref={espaciadorRef} aria-hidden="true" style={{ height: 0 }} />
      {/* Los textos de ayuda se pueden minimizar (2026-10-06, pedido de
          Claudia); se recuerda cómo los dejó. */}
      <AyudaMinimizable clave="orden" titulo="Cómo acomodar el catálogo">
        <p className="muted">
          Acomoda todo lo que quieras y al final dale <strong>💾 Guardar orden</strong> (un solo guardado). Para mover
          algo: escribe el número de lugar en su cajita y da Enter (por ejemplo, del 10 al 2 de un jalón), usa ▲ ▼ para
          moverlo de uno en uno, o arrástralo desde ⠿ (con el mouse o con el dedo en el celular). Lo que muevas se queda resaltado en su lugar nuevo.
        </p>
        <p className="muted">
          Los botones <strong>🕒 Orden por Nuevo–Viejo</strong> y <strong>🔤 Orden A–Z</strong> acomodan de un jalón (por
          fecha en que se agregaron, o por nombre): los de arriba, los productos de todas las categorías; los de cada
          categoría (🕒 y 🔤, con su flechita), solo los suyos. Antes de cambiar nada te preguntan, y esos se guardan
          solos. Si presionas el mismo botón otra vez, acomoda al revés.
        </p>
        {modoSucursal ? (
          <p className="muted">
            Renombrar, ocultar o eliminar categorías, y la zona de Ofertas, se cambian en el catálogo general (solo los
            Administradores).
          </p>
        ) : (
          <p className="muted">
            En cada categoría: ✏️ renombrar, el ojo para ocultarla o volver a mostrarla en el catálogo (ojo tachado =
            está oculta) y 🗑️ eliminar. Pasa el mouse por un botón (o déjalo presionado) para ver su nombre.
          </p>
        )}
      </AyudaMinimizable>

      <div className="orden-barra-superior">
        <div className="orden-buscador">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={busquedaOrden}
            onChange={(e) => setBusquedaOrden(e.target.value)}
            placeholder="Buscar producto o categoría…"
            aria-label="Buscar producto o categoría para acomodar"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setContraidas(todasContraidas ? new Set() : new Set(clavesContraibles))}
          title="Con las categorías contraídas es más fácil acomodar el orden de las categorías entre sí"
        >
          {todasContraidas ? '▾ Expandir todas' : '▸ Contraer todas'}
        </button>
        {!modoSucursal && (
          <button type="button" className="btn btn-secondary" onClick={abrirAgregarCategoria} disabled={bloqueoPorCambios} title={tituloBloqueo}>
            + Agregar categoría
          </button>
        )}
        {/* Orden rápido de TODAS las categorías a la vez (2026-10-05). */}
        <span className="orden-rapido-general" role="group" aria-label="Acomodar los productos de todas las categorías">
          <span className="orden-rapido-general-titulo">Todas las categorías:</span>
          {botonesOrdenRapidoJSX('todas', '', 'btn btn-secondary')}
        </span>
      </div>

      {/* Barra pegada arriba mientras haya cambios sin guardar: se ve
          aunque se haga scroll hasta el fondo de la lista. */}
      {hayCambios && (
        <div className="orden-barra-guardar" role="status">
          <span>
            ✋ Tienes <strong>{movidos.size}</strong> movimiento{movidos.size === 1 ? '' : 's'} sin guardar.
          </span>
          <span className="orden-barra-guardar-botones">
            <button type="button" className="btn btn-secondary btn-small" onClick={descartarCambios} disabled={guardando}>
              Descartar
            </button>
            <button type="button" className="btn btn-primary btn-small" onClick={guardarTodo} disabled={guardando}>
              {guardando ? 'Guardando…' : '💾 Guardar orden'}
            </button>
          </span>
        </div>
      )}
      {guardando && (
        <div className="orden-guardando-toast" role="alert">
          <span className="orden-guardando-giro" aria-hidden="true" /> Guardando el orden…
        </div>
      )}
      {mensaje && <p className="info-msg error">{mensaje}</p>}
      {avisoListo && !guardando && (
        <p className="orden-aviso-listo" role="status">
          ✅ {avisoListo}
        </p>
      )}

      {/* ---- Zona 🔥 Ofertas (2026-10-01, pendiente P11) ---- */}
      {hayZonaOfertas && (!textoBuscadoOrden || ofertasVisibles.length > 0) && (
        <section className={`orden-categoria-box orden-ofertas-box ${zonaOfertasOculta ? 'categoria-oculta' : ''}`}>
          <div className="orden-categoria-header">
            <button
              type="button"
              className="orden-contraer-btn"
              onClick={() => alternarContraida(CLAVE_OFERTAS)}
              aria-expanded={!ofertasContraida}
              title={ofertasContraida ? 'Ver los productos en oferta' : 'Esconder los productos en oferta'}
            >
              {ofertasContraida ? '▸' : '▾'}
            </button>
            <h3>
              🔥 {tituloOfertas} <span className="orden-conteo">({ofertasLocal.length})</span>
              {zonaOfertasOculta && <span className="badge badge-oculto">Oculta del catálogo</span>}
            </h3>
            <div className="orden-categoria-botones">
              {botonesOrdenRapidoJSX('ofertas', '', 'btn btn-secondary btn-small btn-orden-rapido', true)}
              {!modoSucursal && (<>
              <button
                type="button"
                className="btn btn-secondary btn-small btn-icono"
                data-accion="renombrar"
                onClick={() => {
                  setTituloOfertasNuevo(tituloOfertas === 'Ofertas' ? '' : tituloOfertas);
                  setRenombrandoOfertas(true);
                }}
                disabled={bloqueoPorCambios}
                {...propsBotonCompacto('Renombrar', motivoBloqueo)}
              >
                <span aria-hidden="true">✏️</span>
              </button>
              <button
                type="button"
                className={`btn btn-secondary btn-small btn-icono btn-ojo ${zonaOfertasOculta ? 'btn-ojo-cerrado' : ''}`}
                data-accion="ocultar"
                aria-pressed={zonaOfertasOculta}
                onClick={toggleZonaOfertas}
                disabled={cambiandoZonaOfertas || bloqueoPorCambios}
                {...propsBotonCompacto(
                  zonaOfertasOculta ? 'Mostrar en el catálogo' : 'Ocultar del catálogo',
                  motivoBloqueo
                )}
              >
                <IconoOjo abierto={!zonaOfertasOculta} tamano={16} />
              </button>
              <button
                type="button"
                className="btn btn-eliminar btn-small btn-icono"
                data-accion="eliminar"
                onClick={() => {
                  setConfirmoQuitarOfertas(false);
                  setEliminandoOfertas(true);
                }}
                disabled={bloqueoPorCambios || ofertasLocal.length === 0}
                {...propsBotonCompacto('Eliminar', motivoBloqueo || (ofertasLocal.length === 0 ? 'no hay ningún producto en oferta' : ''))}
              >
                <span aria-hidden="true">🗑️</span>
              </button>
              </>)}
            </div>
          </div>
          {!ofertasContraida && (
            <>
              {modoSucursal ? (
                <p className="muted orden-ofertas-nota">
                  Son las ofertas PROPIAS de esta sucursal (las del catálogo general no salen aquí). Aquí decides en qué
                  orden van. Para poner o quitar una oferta, o cambiar su precio, ve a 🏪 Mi sucursal → 🔥 Oferta.
                </p>
              ) : (
              <p className="muted orden-ofertas-nota">
                Es el carrusel de "🔥 {tituloOfertas}" que sale hasta arriba del catálogo. Aquí decides en qué orden van.
                "Ocultar" NO quita los productos ni su precio de oferta: siguen saliendo en su categoría de siempre. Para
                sacar UN producto de Ofertas, edítalo en Stock (quítale el precio de oferta).
              </p>
              )}
              {ofertasLocal.length === 0 ? (
                <p className="muted">Ahorita no hay ningún producto en oferta.</p>
              ) : (
                <ul className="orden-lista">
                  {ofertasVisibles.map(({ p, i }) =>
                    filaProducto({ p, i, total: ofertasLocal.length, lista: 'ofertas', clave: `o:${p.ID}`, onMover: moverOfertaA })
                  )}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {gruposVisibles.length === 0 && textoBuscadoOrden && ofertasVisibles.length === 0 && (
        <p className="info-msg">No hay ningún producto ni categoría con "{busquedaOrden}".</p>
      )}

      {gruposVisibles.map(({ grupo, indiceCategoria, filas }) => {
        const contraida = (!textoBuscadoOrden && contraidas.has(grupo.nombre)) || compactar;
        // Arrastrar CATEGORÍAS (2026-10-01, pedido por Claudia: "el mismo
        // sistema de arrastre que tienen los productos debería poder hacer
        // lo mismo entre categorías"). Se agarra del ENCABEZADO de la
        // categoría (el ⠿ o cualquier parte libre del encabezado) y se
        // suelta encima de otra categoría — en cualquier parte de su caja,
        // esté abierta o contraída. Se usa la misma pieza que los productos
        // ("propsArrastre"), repartida en dos: el encabezado es lo que se
        // agarra, y la caja completa es donde se puede soltar. Como los
        // productos usan otra "lista" ("cat:NOMBRE"), arrastrar un producto
        // nunca mueve una categoría ni al revés.
        const arrastreCategoria = propsArrastre('categorias', indiceCategoria);
        const arrastrandoCategorias = !!arrastre && arrastre.lista === 'categorias';
        const esDestino =
          arrastrandoCategorias && !!sobre && sobre.lista === 'categorias' && sobre.indice === indiceCategoria &&
          arrastre.indice !== indiceCategoria;
        const clasesCategoria = [
          'orden-categoria-box',
          grupo.oculta && 'categoria-oculta',
          resaltado === `c:${grupo.nombre}` && 'orden-fila-movida',
          arrastrandoCategorias && arrastre.indice === indiceCategoria && 'orden-fila-arrastrando',
          arrastrandoCategorias && sobre && sobre.lista === 'categorias' && sobre.indice === indiceCategoria &&
            arrastre.indice !== indiceCategoria &&
            (arrastre.indice < indiceCategoria ? 'orden-categoria-destino-abajo' : 'orden-categoria-destino-arriba'),
        ].filter(Boolean).join(' ');
        return (
          <section
            key={grupo.nombre}
            id={`orden-c:${grupo.nombre}`}
            className={clasesCategoria}
            data-orden-lista="categorias"
            data-orden-indice={indiceCategoria}
            data-destino-texto={
              esDestino && categoriaArrastrada ? `Aquí queda «${categoriaArrastrada.nombre}» · lugar ${indiceCategoria + 1}` : undefined
            }
          >
            <div
              className="orden-categoria-header"
              draggable={arrastreCategoria.draggable}
              onDragStart={(e) => {
                arrastreCategoria.onDragStart(e);
                // Un instante DESPUÉS de agarrarla (no en el mismo momento:
                // si la página cambia justo al empezar, algunos navegadores
                // cancelan el arrastre) se contraen todas las categorías.
                setTimeout(() => {
                  const a = arrastreRef.current;
                  if (a && a.lista === 'categorias' && !tactilRef.current) empezarACompactar(a.indice);
                }, 30);
              }}
              onDragEnd={() => {
                arrastreCategoria.onDragEnd();
                // Si se soltó fuera de la pestaña o se canceló con Esc.
                terminarDeCompactar(indiceCategoria, null);
              }}
            >
              <span
                className="orden-agarradera"
                aria-hidden="true"
                title="Arrastra para mover la categoría"
                {...propsAgarradera('categorias', indiceCategoria, grupo.nombre)}
              >
                ⠿
              </span>
              <CampoPosicion
                posicion={indiceCategoria + 1}
                total={gruposLocal.length}
                onMover={(destino) => moverCategoriaA(indiceCategoria, destino)}
                etiqueta={`Categoría ${grupo.nombre}`}
              />
              <div className="orden-botones-mover">
                <button
                  type="button"
                  className="orden-mover-btn"
                  onClick={() => moverCategoriaA(indiceCategoria, indiceCategoria - 1)}
                  disabled={indiceCategoria === 0 || guardando}
                  title="Subir esta categoría un lugar"
                  aria-label="Subir esta categoría un lugar"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="orden-mover-btn"
                  onClick={() => moverCategoriaA(indiceCategoria, indiceCategoria + 1)}
                  disabled={indiceCategoria === gruposLocal.length - 1 || guardando}
                  title="Bajar esta categoría un lugar"
                  aria-label="Bajar esta categoría un lugar"
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                className="orden-contraer-btn"
                onClick={() => alternarContraida(grupo.nombre)}
                aria-expanded={!contraida}
                title={contraida ? 'Ver los productos de esta categoría' : 'Esconder los productos de esta categoría'}
              >
                {contraida ? '▸' : '▾'}
              </button>
              <h3>
                <span className="orden-texto-copiable" {...propsTextoSeleccionable}>{grupo.nombre}</span> <span className="orden-conteo">({grupo.productos.length})</span>
                {grupo.oculta && <span className="badge badge-oculto">Oculta del catálogo</span>}
              </h3>
              <div className="orden-categoria-botones">
                {botonesOrdenRapidoJSX('categoria', grupo.nombre, 'btn btn-secondary btn-small btn-orden-rapido', true)}
                {!modoSucursal && (<>
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-icono"
                  data-accion="renombrar"
                  onClick={() => abrirRenombrar(grupo.nombre)}
                  disabled={bloqueoPorCambios}
                  {...propsBotonCompacto('Renombrar', motivoBloqueo)}
                >
                  <span aria-hidden="true">✏️</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary btn-small btn-icono btn-ojo ${grupo.oculta ? 'btn-ojo-cerrado' : ''}`}
                  data-accion="ocultar"
                  aria-pressed={!!grupo.oculta}
                  onClick={() => toggleOcultarCategoria(grupo)}
                  disabled={ocultandoCategoria === grupo.nombre || bloqueoPorCambios}
                  {...propsBotonCompacto(
                    grupo.oculta ? 'Mostrar en el catálogo' : 'Ocultar del catálogo',
                    motivoBloqueo
                  )}
                >
                  <IconoOjo abierto={!grupo.oculta} tamano={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-eliminar btn-small btn-icono"
                  data-accion="eliminar"
                  onClick={() => abrirEliminar(grupo)}
                  disabled={bloqueoPorCambios}
                  {...propsBotonCompacto('Eliminar', motivoBloqueo)}
                >
                  <span aria-hidden="true">🗑️</span>
                </button>
                </>)}
              </div>
            </div>

            {!contraida &&
              (grupo.productos.length === 0 ? (
                <p className="muted">Todavía no hay productos en esta categoría.</p>
              ) : (
                <ul className="orden-lista">
                  {filas.map(({ p, i }) =>
                    filaProducto({
                      p,
                      i,
                      total: grupo.productos.length,
                      lista: `cat:${grupo.nombre}`,
                      clave: `p:${p.ID}`,
                      onMover: (desde, hasta) => moverProductoA(grupo.nombre, desde, hasta),
                    })
                  )}
                </ul>
              ))}
          </section>
        );
      })}

      {/* ---- Orden rápido: pregunta antes de cambiar nada (2026-10-05) ---- */}
      {ordenRapido && (() => {
        const info = ORDEN_RAPIDO[ordenRapido.criterio];
        const listas = listasDeOrdenRapido(ordenRapido.alcance, ordenRapido.nombre).filter((l) => l.length > 1);
        const cuantosProductos =
          ordenRapido.alcance === 'todas'
            ? gruposLocal.reduce((suma, g) => suma + g.productos.length, 0)
            : listas.reduce((suma, l) => suma + l.length, 0);
        const cuantasCategorias = gruposLocal.filter((g) => g.productos.length > 1).length;
        return (
          <div className="modal-overlay" onClick={() => setOrdenRapido(null)}>
            <div className="modal-box orden-rapido-pregunta" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>¿Cambiar el orden?</h3>
              <p>
                {ordenRapido.alcance === 'todas' && (
                  <>
                    Los productos de <strong>TODAS las categorías</strong> ({cuantasCategorias} categoría
                    {cuantasCategorias === 1 ? '' : 's'}, {cuantosProductos} productos
                    {ofertasLocal.length > 1 ? `, y también la zona de 🔥 ${tituloOfertas}` : ''})
                  </>
                )}
                {ordenRapido.alcance === 'categoria' && (
                  <>
                    Los <strong>{cuantosProductos} productos de {ordenRapido.nombre}</strong>
                  </>
                )}
                {ordenRapido.alcance === 'ofertas' && (
                  <>
                    Los <strong>{cuantosProductos} productos de la zona de 🔥 {tituloOfertas}</strong>
                  </>
                )}{' '}
                van a quedar acomodados <strong>{info.frase[ordenRapido.sentido]}</strong>.
              </p>
              <p className="muted">
                {info.nota} Se pierde el acomodo que tenías hecho a mano ahí, y así se verá también en el catálogo de tus
                clientas.{ordenRapido.alcance === 'todas' ? ' Las categorías NO cambian de lugar entre sí: solo los productos dentro de cada una.' : ''}
              </p>
              <p className="muted">
                Si te arrepientes, el Admin Central lo puede deshacer desde la papelera de la Bitácora.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setOrdenRapido(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" onClick={aplicarOrdenRapido} autoFocus>
                  Sí, acomodar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {renombrandoOfertas && (
        <div className="modal-overlay" onClick={() => setRenombrandoOfertas(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Renombrar la zona de Ofertas</h3>
            <p className="muted">
              Cambia el título con el que sale esta zona hasta arriba del catálogo (hoy dice "🔥 {tituloOfertas}"). El 🔥
              se queda siempre. No cambia ningún producto ni ningún precio. Si lo dejas vacío, vuelve a decir "Ofertas".
            </p>
            <label className="modal-field">
              Nuevo título
              <input
                value={tituloOfertasNuevo}
                onChange={(e) => setTituloOfertasNuevo(e.target.value.slice(0, 40))}
                placeholder="Ofertas"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setRenombrandoOfertas(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={guardandoTituloOfertas} onClick={confirmarRenombrarOfertas}>
                {guardandoTituloOfertas ? 'Guardando…' : 'Guardar título'}
              </button>
            </div>
          </div>
        </div>
      )}

      {eliminandoOfertas && (
        <div className="modal-overlay" onClick={() => setEliminandoOfertas(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Eliminar la zona de "{tituloOfertas}"</h3>
            <p className="muted">
              Esto le quita la oferta a los {ofertasLocal.length} producto{ofertasLocal.length === 1 ? '' : 's'} que la
              tienen: vuelven a su precio normal y, como ya no queda ninguno en oferta, la zona desaparece del catálogo.
            </p>
            <p className="muted">
              <strong>No se borra ningún producto.</strong> Si solo quieres que la zona no se vea (sin tocar los precios),
              mejor usa "Ocultar".
            </p>
            <div className="aviso-peligro">
              ⚠️ Si fue un error, el Admin Central puede regresar todas las ofertas de un jalón desde la Bitácora durante
              30 días. Después de eso habría que escribirle otra vez su precio de oferta a cada producto.
              <label className="modal-opcion-checkbox">
                <input
                  type="checkbox"
                  checked={confirmoQuitarOfertas}
                  onChange={(e) => setConfirmoQuitarOfertas(e.target.checked)}
                />
                Sí, entiendo, quiero quitar todas las ofertas.
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEliminandoOfertas(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-eliminar"
                disabled={quitandoOfertas || !confirmoQuitarOfertas}
                onClick={confirmarQuitarOfertas}
              >
                {quitandoOfertas ? 'Aplicando…' : 'Quitar todas las ofertas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renombrando && (
        <div className="modal-overlay" onClick={() => setRenombrando(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Renombrar categoría</h3>
            <p className="muted">
              Esto cambia el nombre de la categoría en TODOS los productos que la tengan
              (actualmente "{renombrando}"), de un jalón.
            </p>
            <label className="modal-field">
              Nuevo nombre
              <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} autoFocus />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setRenombrando(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={guardandoNombre || !nombreNuevo.trim()}
                onClick={confirmarRenombrar}
              >
                {guardandoNombre ? 'Guardando…' : 'Guardar nuevo nombre'}
              </button>
            </div>
          </div>
        </div>
      )}

      {agregandoCategoria && (
        <div className="modal-overlay" onClick={() => setAgregandoCategoria(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Agregar categoría nueva</h3>
            <p className="muted">
              Se crea una cajita vacía con este nombre. Para meterle productos, agrégalos o
              edítalos y escribe este mismo nombre en el campo "Categoría".
            </p>
            <label className="modal-field">
              Nombre de la categoría
              <input
                value={nombreCategoriaNueva}
                onChange={(e) => setNombreCategoriaNueva(e.target.value)}
                placeholder="Ej. Zapatos"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAgregandoCategoria(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={guardandoCategoriaNueva || !nombreCategoriaNueva.trim()}
                onClick={confirmarAgregarCategoria}
              >
                {guardandoCategoriaNueva ? 'Agregando…' : 'Agregar categoría'}
              </button>
            </div>
          </div>
        </div>
      )}

      {eliminando && (
        <div className="modal-overlay" onClick={() => setEliminando(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Eliminar categoría "{eliminando.nombre}"</h3>
            <p className="muted">
              Esta categoría tiene {eliminando.cantidad} producto{eliminando.cantidad === 1 ? '' : 's'}.
              Elige qué quieres hacer:
            </p>

            <label className="modal-opcion-radio">
              <input
                type="radio"
                name="modoEliminarCategoria"
                checked={!borrarProductosTambien}
                onChange={() => {
                  setBorrarProductosTambien(false);
                  setConfirmoBorrarProductos(false);
                }}
              />
              Solo quitar la categoría — sus {eliminando.cantidad} producto
              {eliminando.cantidad === 1 ? '' : 's'} se conservan, se van a "Otros".
            </label>

            <label className="modal-opcion-radio">
              <input
                type="radio"
                name="modoEliminarCategoria"
                checked={borrarProductosTambien}
                onChange={() => setBorrarProductosTambien(true)}
              />
              Borrar la categoría Y sus {eliminando.cantidad} producto{eliminando.cantidad === 1 ? '' : 's'}.
            </label>

            {borrarProductosTambien && (
              <div className="aviso-peligro">
                ⚠️ Se van a borrar {eliminando.cantidad} producto{eliminando.cantidad === 1 ? '' : 's'} de tu
                inventario. Si fue un error, el Admin Central puede regresarlos desde la Bitácora durante 30 días;
                después de eso ya no se pueden recuperar desde la app.
                <label className="modal-opcion-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmoBorrarProductos}
                    onChange={(e) => setConfirmoBorrarProductos(e.target.checked)}
                  />
                  Sí, entiendo, quiero borrar también los productos.
                </label>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEliminando(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-eliminar"
                disabled={guardandoEliminar || (borrarProductosTambien && !confirmoBorrarProductos)}
                onClick={confirmarEliminar}
              >
                {guardandoEliminar
                  ? 'Aplicando…'
                  : borrarProductosTambien
                    ? 'Borrar categoría y productos'
                    : 'Quitar categoría'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// P14 de la lista de Claudia (2026-10-01): "si tienen mucha info se agrandan
// a niveles poco visuales... a cierto tamaño debe de haber un ... y opción de
// ver más y poderlo abrir y cerrar... o la tabla de pedidos si es muy larga,
// el típico recuadro de mostrar todos o 100".
// Dos piezas que se reutilizan en todo el panel:
//   1. Tablas largas: "Mostrar 50 / 100 / Todos" (Stock, Pedidos, Bitácora,
//      Estado de cuenta).
//   2. Listas de avisos largas: se ven las primeras y un "Ver N más".
// ============================================================================

// ---- 1. Tablas largas ----
// 0 = "Todos". Lo que cada quien elige se recuerda en ESTE navegador, por
// tabla (igual que el orden de las pestañas): no se guarda en la hoja ni
// genera nada en la Bitácora.
const OPCIONES_FILAS = [50, 100, 0];
const LLAVE_FILAS_POR_TABLA = 'pyme_filas_por_tabla';

function leerLimiteFilas(tabla) {
  try {
    const guardado = JSON.parse(window.localStorage.getItem(LLAVE_FILAS_POR_TABLA) || '{}');
    const valor = Number(guardado[tabla]);
    return OPCIONES_FILAS.includes(valor) ? valor : OPCIONES_FILAS[0];
  } catch {
    return OPCIONES_FILAS[0];
  }
}

function useLimiteFilas(tabla) {
  const [limite, setLimite] = useState(() => leerLimiteFilas(tabla));
  function cambiar(valor) {
    setLimite(valor);
    try {
      const guardado = JSON.parse(window.localStorage.getItem(LLAVE_FILAS_POR_TABLA) || '{}');
      guardado[tabla] = valor;
      window.localStorage.setItem(LLAVE_FILAS_POR_TABLA, JSON.stringify(guardado));
    } catch {
      /* navegador sin almacenamiento: la elección dura mientras la pestaña esté abierta */
    }
  }
  return [limite, cambiar];
}

// Regresa los primeros "limite" renglones. "siempreVisible" permite dejar
// a la vista renglones que quedarían fuera del corte pero NO deben
// desaparecer: los que tienen un cambio sin guardar (si se escondieran, el
// cambio se perdería sin avisar) y el renglón al que se saltó desde un aviso.
function recortarFilas(lista, limite, siempreVisible) {
  if (!limite || lista.length <= limite) return lista;
  return lista.filter((elemento, i) => i < limite || (siempreVisible ? siempreVisible(elemento) : false));
}

// La barrita "Mostrando 50 de 119 pedidos · Mostrar: 50 | 100 | Todos".
// No aparece si la tabla tiene 50 renglones o menos (no hay nada que cortar).
function BarraFilas({ total, visibles, limite, onCambiar, nombre }) {
  if (total <= OPCIONES_FILAS[0]) return null;
  // Si el límite elegido ya alcanza para todos, en la práctica es "Todos".
  const efectivo = limite && total > limite ? limite : 0;
  const opciones = OPCIONES_FILAS.filter((opcion) => opcion === 0 || total > opcion);
  return (
    <div className="barra-filas" role="group" aria-label={`Cuántos ${nombre} mostrar`}>
      <span>
        Mostrando <strong>{visibles}</strong> de <strong>{total}</strong> {nombre}
      </span>
      <span className="barra-filas-opciones">
        Mostrar:
        {opciones.map((opcion) => (
          <button
            key={opcion}
            type="button"
            className={`barra-filas-btn${efectivo === opcion ? ' activo' : ''}`}
            aria-pressed={efectivo === opcion}
            onClick={() => onCambiar(opcion)}
          >
            {opcion === 0 ? 'Todos' : opcion}
          </button>
        ))}
      </span>
    </div>
  );
}

// ---- Botones "Descargar: Excel / PDF" (2026-10-05) ----
// Los usan Stock y "Entradas y salidas". "onExcel" / "onPDF" arman y bajan
// el archivo (ver src/exportar.js); si algo truena, el aviso sale aquí
// mismo, junto a los botones.
function BotonesDescarga({ que, onExcel, onPDF, cuantos }) {
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }
  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(null), aviso.tipo === 'ok' ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [aviso]);
  function bajar(armar, formato) {
    try {
      armar();
      setAviso({ tipo: 'ok', texto: `✓ Se descargó ${que} en ${formato}. Búscalo en tus Descargas.` });
    } catch (err) {
      setAviso({ tipo: 'error', texto: `No se pudo armar la descarga: ${err.message}` });
    }
  }
  const detalle = `${cuantos} renglón${cuantos === 1 ? '' : 'es'}, tal como se ve ahora (con los filtros que tengas puestos)`;
  return (
    <span className="descargas" role="group" aria-label={`Descargar ${que}`}>
      <span className="descargas-titulo">Descargar:</span>
      <button
        type="button"
        className="btn btn-secondary btn-small btn-descarga"
        data-descarga="excel"
        onClick={() => bajar(onExcel, 'Excel')}
        title={`Baja ${que} como archivo de Excel (.xlsx): ${detalle}`}
      >
        📊 Excel
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-small btn-descarga"
        data-descarga="pdf"
        onClick={() => bajar(onPDF, 'PDF')}
        title={`Baja ${que} como PDF: ${detalle}`}
      >
        📄 PDF
      </button>
      {aviso && (
        <span className={`descargas-aviso descargas-aviso-${aviso.tipo}`} role="status">
          {aviso.texto}
        </span>
      )}
    </span>
  );
}

// ---- Pestaña "📥 Entradas y salidas" (2026-10-05) ----
// Pedido de Claudia: un registro "por si un día ocupo ver o buscar un
// producto que vendí en un mes pasado… aunque tal vez ya no lo tenga", y
// poder descargarlo en PDF y Excel.
// Los datos viven en la hoja "EntradasSalidas" (ver Code.gs, sección
// "ENTRADAS Y SALIDAS"): el servidor anota solo cada entrada y cada salida
// de piezas, y aquí nada más se consulta. Nunca se borra ni se edita.
// Es UNA lista (Movimientos), con buscador, fechas y filtros.
// (2026-10-07: aquí había además una segunda vista, "Catálogo de claves" —
// cada código con su producto—. Claudia la quitó: "ya está en entradas y
// salidas, el stock y su código guardado". El código de cada producto sigue
// saliendo en la columna "Código" de esta lista y en Stock.)
const MOTIVO_INVENTARIO_INICIAL = 'Inventario inicial';

// "Quedaron" de un movimiento (2026-10-06): las piezas que quedaron EN LA
// TIENDA después de él — las disponibles más las apartadas en pedidos "En
// proceso" ("EnTienda", lo manda el servidor). Con un servidor de antes se
// usa lo que había: solo las disponibles. Regresa '' si no se sabe.
function quedaronDeMovimiento(m) {
  const valor = m.EnTienda !== undefined ? m.EnTienda : m.Existencia;
  return valor === '' || valor === undefined || valor === null || Number.isNaN(Number(valor)) ? '' : Number(valor);
}

function InventarioTab({ sesionToken, productos, nombreSesion, onCambio, onVerFoto }) {
  // (2026-10-06) Foto de cada producto, para la miniatura de "Movimientos"
  // (igual que en Stock). Un producto que ya se eliminó no tiene foto.
  const fotoPorProductoId = {};
  (productos || []).forEach((prod) => { fotoPorProductoId[String(prod.ID)] = primeraFoto(prod.FotoURL); });
  const [movimientos, setMovimientos] = useState(null); // null = todavía cargando
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroMotivo, setFiltroMotivo] = useState('');
  const [filtroPersona, setFiltroPersona] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [limiteFilas, setLimiteFilas] = useLimiteFilas('inventario');

  function cargar() {
    setCargando(true);
    setError('');
    // De paso se refresca la lista de productos del panel (de ahí salen las
    // fotos de esta lista): si alguien más eliminó o agregó un producto
    // desde otro aparato, aquí se vería viejo.
    if (onCambio) {
      try {
        Promise.resolve(onCambio()).catch(() => {});
      } catch (err) {
        // Si falla, la pestaña sigue funcionando con lo que ya tenía.
      }
    }
    listarEntradasSalidas(sesionToken)
      .then((res) => setMovimientos(Array.isArray(res.movimientos) ? res.movimientos : []))
      .catch((err) => {
        setError(err.message);
        setMovimientos((antes) => antes || []);
      })
      .finally(() => setCargando(false));
  }
  // Se consulta cada vez que se abre la pestaña.
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lista = movimientos || [];
  const tiempoDe = (m) => {
    const t = new Date(m.Fecha).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  // Lo más reciente arriba (a igual fecha, lo que se anotó después va primero).
  const ordenados = lista
    .map((m, i) => ({ m, i }))
    .sort((a, b) => tiempoDe(b.m) - tiempoDe(a.m) || b.i - a.i)
    .map((x) => x.m);

  const unicos = (campo) =>
    Array.from(new Set(lista.map((m) => String(m[campo] || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const opcionesMotivo = unicos('Motivo');
  const opcionesPersona = unicos('Usuario');

  const textoBuscado = normalizarParaFiltro(buscar);
  const inicio = desde ? new Date(`${desde}T00:00:00`).getTime() : null;
  const fin = hasta ? new Date(`${hasta}T23:59:59`).getTime() : null;
  const filtrados = ordenados.filter((m) => {
    if (filtroTipo && m.Tipo !== filtroTipo) return false;
    if (filtroMotivo && String(m.Motivo || '').trim() !== filtroMotivo) return false;
    if (filtroPersona && String(m.Usuario || '').trim() !== filtroPersona) return false;
    const t = tiempoDe(m);
    if (inicio !== null && t < inicio) return false;
    if (fin !== null && t > fin) return false;
    if (textoBuscado) {
      const donde = normalizarParaFiltro([m.Producto, m.Codigo, m.Categoria, m.Cliente, m.Motivo, m.Detalle].join(' '));
      if (!donde.includes(textoBuscado)) return false;
    }
    return true;
  });
  const visibles = recortarFilas(filtrados, limiteFilas);
  const hayFiltros = !!(buscar.trim() || filtroTipo || filtroMotivo || filtroPersona || desde || hasta);
  function quitarFiltros() {
    setBuscar('');
    setFiltroTipo('');
    setFiltroMotivo('');
    setFiltroPersona('');
    setDesde('');
    setHasta('');
  }

  const piezas = (m) => Number(m.Cantidad) || 0;
  const totalEntradas = filtrados.filter((m) => m.Tipo === 'Entrada').reduce((suma, m) => suma + piezas(m), 0);
  const totalSalidas = filtrados.filter((m) => m.Tipo === 'Salida').reduce((suma, m) => suma + piezas(m), 0);

  // ---- Descargas ----
  const ahoraTexto = () => `Descargado el ${formatearFechaHora(new Date())}${nombreSesion ? ` por ${nombreSesion}` : ''}`;
  function textoDeFiltros() {
    const partes = [];
    if (desde || hasta) partes.push(textoRangoFechas(desde, hasta));
    if (filtroTipo) partes.push(filtroTipo === 'Entrada' ? 'Solo entradas' : 'Solo salidas');
    if (filtroMotivo) partes.push(`Motivo: ${filtroMotivo}`);
    if (filtroPersona) partes.push(`Quién: ${filtroPersona}`);
    if (buscar.trim()) partes.push(`Buscar "${buscar.trim()}"`);
    return partes.length > 0 ? `Filtros: ${partes.join(' · ')}` : 'Sin filtros: todos los movimientos';
  }
  function descargarMovimientos(formato) {
    const nombreArchivo = `entradas-y-salidas-${fechaParaArchivo()}`;
    const resumenTexto = `${filtrados.length} movimiento${filtrados.length === 1 ? '' : 's'} · entraron ${totalEntradas.toLocaleString('es-MX')} piezas · salieron ${totalSalidas.toLocaleString('es-MX')} piezas`;
    if (formato === 'excel') {
      descargarExcel(nombreArchivo, [
        {
          nombre: 'Entradas y salidas',
          titulo: 'Entradas y salidas',
          subtitulo: `${ahoraTexto()} · ${resumenTexto} · ${textoDeFiltros()}`,
          columnas: [
            { titulo: 'Fecha y hora', tipo: 'fechaHora', ancho: 17 },
            { titulo: 'Tipo', ancho: 10 },
            { titulo: 'Motivo', ancho: 34 },
            { titulo: 'Producto', ancho: 36 },
            { titulo: 'Código', ancho: 18 },
            { titulo: 'Categoría', ancho: 16 },
            { titulo: 'Piezas', tipo: 'entero', ancho: 9 },
            { titulo: 'Quedaron', tipo: 'entero', ancho: 10 },
            { titulo: 'Precio', tipo: 'dinero', ancho: 12 },
            { titulo: 'Quién', ancho: 20 },
            { titulo: 'Clienta', ancho: 22 },
            { titulo: 'Detalle', ancho: 44 },
          ],
          filas: filtrados.map((m) => [
            m.Fecha || '', m.Tipo || '', m.Motivo || '', m.Producto || '', m.Codigo === undefined ? '' : String(m.Codigo),
            m.Categoria || '', piezas(m), quedaronDeMovimiento(m),
            m.Precio === '' || m.Precio === undefined ? '' : Number(m.Precio), m.Usuario || '', m.Cliente || '', m.Detalle || '',
          ]),
        },
      ]);
      return;
    }
    descargarPDF(nombreArchivo, {
      titulo: 'Entradas y salidas',
      subtitulo: [ahoraTexto(), textoDeFiltros()],
      autor: nombreSesion,
      resumen: [
        { etiqueta: 'Movimientos', valor: filtrados.length.toLocaleString('es-MX') },
        { etiqueta: 'Piezas que entraron', valor: totalEntradas.toLocaleString('es-MX') },
        { etiqueta: 'Piezas que salieron', valor: totalSalidas.toLocaleString('es-MX') },
      ],
      notaPie: 'Entradas y salidas',
      columnas: [
        { titulo: 'Fecha y hora', tipo: 'fechaHora', peso: 1.55 },
        { titulo: 'Tipo', peso: 0.8 },
        { titulo: 'Motivo', peso: 1.85 },
        { titulo: 'Producto', peso: 2.45 },
        { titulo: 'Código', peso: 1.15 },
        { titulo: 'Piezas', tipo: 'entero', peso: 0.7 },
        { titulo: 'Quedaron', tipo: 'entero', peso: 1 },
        { titulo: 'Precio', tipo: 'dinero', peso: 0.9 },
        { titulo: 'Quién', peso: 1.25 },
        { titulo: 'Clienta', peso: 1.25 },
        { titulo: 'Detalle', peso: 2.1 },
      ],
      filas: filtrados.map((m) => [
        m.Fecha || '', m.Tipo || '', m.Motivo || '', m.Producto || '', m.Codigo === undefined ? '' : String(m.Codigo), piezas(m),
        quedaronDeMovimiento(m),
        m.Precio === '' || m.Precio === undefined ? '' : Number(m.Precio), m.Usuario || '', m.Cliente || '', m.Detalle || '',
      ]),
    });
  }
  const soloInicial = lista.length > 0 && lista.every((m) => m.Motivo === MOTIVO_INVENTARIO_INICIAL || /anterior al historial/.test(String(m.Motivo || '')));

  return (
    <div className="inventario-tab">
      <p className="muted">
        Aquí queda anotada cada <strong>entrada</strong> (producto nuevo, piezas que se agregan, reembolsos) y cada{' '}
        <strong>salida</strong> (ventas pagadas, piezas que se bajan a mano, productos eliminados). Se anota solo y{' '}
        <strong>nunca se borra</strong>: un producto sigue saliendo aquí aunque ya no lo tengas o lo hayas eliminado.
        Las piezas de un pedido "En proceso" solo están apartadas: la salida se anota hasta que se paga.
        "Quedaron" son las piezas que quedaron en la tienda justo después de ese movimiento (contando las apartadas en
        pedidos "En proceso", que siguen ahí hasta que se pagan).
      </p>

      <div className="stock-personal-toggle">
        <button type="button" className="btn btn-secondary btn-small" onClick={cargar} disabled={cargando}>
          {cargando ? 'Actualizando…' : '🔄 Actualizar'}
        </button>
      </div>

      {error && <p className="info-msg error">No se pudieron cargar las entradas y salidas: {error}</p>}
      {movimientos === null && !error && <p className="info-msg">Cargando entradas y salidas…</p>}

      {movimientos !== null && (
        <>
          <div className="filtro-fechas">
            <label>
              Buscar
              <input type="text" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Producto, código, clienta…" />
            </label>
            <label>
              Desde
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label>
              Hasta
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
            <label>
              Tipo
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                <option value="">Entradas y salidas</option>
                <option value="Entrada">Solo entradas</option>
                <option value="Salida">Solo salidas</option>
              </select>
            </label>
            <label>
              Motivo
              <select value={filtroMotivo} onChange={(e) => setFiltroMotivo(e.target.value)}>
                <option value="">Todos</option>
                {opcionesMotivo.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Quién
              <select value={filtroPersona} onChange={(e) => setFiltroPersona(e.target.value)}>
                <option value="">Todos</option>
                {opcionesPersona.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            {hayFiltros && (
              <button type="button" className="btn btn-secondary btn-small" onClick={quitarFiltros}>
                Quitar filtros
              </button>
            )}
            <BotonesDescarga
              que="las entradas y salidas"
              onExcel={() => descargarMovimientos('excel')}
              onPDF={() => descargarMovimientos('pdf')}
              cuantos={filtrados.length}
            />
          </div>

          <div className="inventario-resumen">
            <span className="inventario-dato">
              <strong>{filtrados.length.toLocaleString('es-MX')}</strong> movimiento{filtrados.length === 1 ? '' : 's'}
              {hayFiltros ? ` de ${lista.length.toLocaleString('es-MX')}` : ''}
            </span>
            <span className="inventario-dato inventario-dato-entrada">
              ▲ Entraron <strong>{totalEntradas.toLocaleString('es-MX')}</strong> piezas
            </span>
            <span className="inventario-dato inventario-dato-salida">
              ▼ Salieron <strong>{totalSalidas.toLocaleString('es-MX')}</strong> piezas
            </span>
          </div>
          {soloInicial && (
            <p className="info-msg aviso inventario-nota-inicio">
              El historial se acaba de activar: por ahora solo trae el "Inventario inicial" (lo que había ese día) y lo que
              ya se había vendido antes. De aquí en adelante se anota solo cada movimiento.
            </p>
          )}

          <div className="table-scroll">
            <table className="data-table inventario-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th>Motivo</th>
                  <th>Producto</th>
                  <th>Código</th>
                  <th>Categoría</th>
                  <th>Piezas</th>
                  <th title="Piezas que quedaron en la tienda justo después de este movimiento: las disponibles más las apartadas en pedidos En proceso">Quedaron</th>
                  <th>Precio</th>
                  <th>Quién</th>
                  <th>Clienta</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody onClickCapture={marcarFilaActiva} onFocusCapture={marcarFilaActiva}>
                {visibles.map((m, i) => {
                  const esEntrada = m.Tipo === 'Entrada';
                  return (
                    <tr key={m.ID || i}>
                      <td>{formatearFechaSolo(m.Fecha)}</td>
                      <td>{formatearHoraSolo(m.Fecha)}</td>
                      <td>
                        <span className={`mov-tipo ${esEntrada ? 'mov-entrada' : 'mov-salida'}`}>{esEntrada ? '▲ Entrada' : '▼ Salida'}</span>
                      </td>
                      <td><CeldaTruncada texto={m.Motivo || '—'} /></td>
                      <td>
                        <div className="stock-nombre-con-foto">
                          {fotoPorProductoId[String(m.ProductoID)] ? (
                            <img
                              src={fotoPorProductoId[String(m.ProductoID)]}
                              alt=""
                              className="stock-thumb"
                              loading="lazy"
                              title="Clic para ver la foto en grande"
                              onClick={() => onVerFoto && onVerFoto(fotoPorProductoId[String(m.ProductoID)])}
                            />
                          ) : (
                            <div className="stock-thumb stock-thumb-vacia">Sin foto</div>
                          )}
                          <span className="stock-nombre-texto"><CeldaTruncada texto={m.Producto || '—'} /></span>
                        </div>
                      </td>
                      <td><CeldaTruncada texto={m.Codigo === '' || m.Codigo === undefined ? '—' : String(m.Codigo)} /></td>
                      <td><CeldaTruncada texto={m.Categoria || '—'} /></td>
                      <td className={`mov-piezas ${esEntrada ? 'mov-entrada' : 'mov-salida'}`}>
                        {esEntrada ? '+' : '−'}{piezas(m).toLocaleString('es-MX')}
                      </td>
                      <td className="mov-numero">{quedaronDeMovimiento(m) === '' ? '—' : quedaronDeMovimiento(m).toLocaleString('es-MX')}</td>
                      <td className="mov-numero">{m.Precio === '' || m.Precio === undefined ? '—' : formatearMoneda(Number(m.Precio) || 0)}</td>
                      <td><CeldaTruncada texto={m.Usuario || '—'} /></td>
                      <td><CeldaTruncada texto={m.Cliente || '—'} /></td>
                      <td><CeldaTruncada texto={m.Detalle || '—'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtrados.length === 0 && (
              <p className="info-msg">
                {lista.length === 0 ? 'Todavía no hay ningún movimiento anotado.' : 'No hay movimientos con los filtros de arriba.'}
              </p>
            )}
          </div>
          <BarraFilas total={filtrados.length} visibles={visibles.length} limite={limiteFilas} onCambiar={setLimiteFilas} nombre="movimientos" />
        </>
      )}

    </div>
  );
}

// ---- Renglón "en uso" de Stock y Pedidos ----
// Pedido de Claudia (2026-10-01): "en Stock y Pedidos, cuando toque una fila
// —su fondo o sus funciones— que se ponga en un azul leve, para así ubicar
// la fila que estamos editando". Al dar clic (o tocar, o llegar con Tab) en
// cualquier parte de un renglón, ese renglón queda marcado en azul claro
// hasta que se toque otro. Se marca directo en la página con un atributo
// ("data-fila-activa"; el color está en global.css), sin volver a dibujar
// la tabla — por eso no estorba ni vuelve lento escribir en los campos.
function marcarFilaActiva(e) {
  const cuerpo = e.currentTarget;
  const fila = e.target && e.target.closest ? e.target.closest('tr') : null;
  // Un clic dentro de un comentario flotante o una ventana no es "tocar la fila".
  if (!fila || fila.parentElement !== cuerpo || fila.dataset.filaActiva) return;
  cuerpo.querySelectorAll('tr[data-fila-activa]').forEach((otra) => {
    delete otra.dataset.filaActiva;
  });
  fila.dataset.filaActiva = '1';
}

// ---- 2. Listas de avisos largas ----
// <ListaVerMas> es un <ul> normal que solo enseña los primeros "limite"
// renglones y, si hay más, un botón "▾ Ver N más" / "▴ Ver menos".
function ListaVerMas({ children, limite = 3, className }) {
  const [abierta, setAbierta] = useState(false);
  const hijos = Children.toArray(children);
  const sobran = hijos.length - limite;
  const visibles = abierta || sobran <= 0 ? hijos : hijos.slice(0, limite);
  return (
    <>
      <ul className={className}>{visibles}</ul>
      {sobran > 0 && (
        <button type="button" className="ver-mas-btn" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}>
          {abierta ? '▴ Ver menos' : `▾ Ver ${sobran} más`}
        </button>
      )}
    </>
  );
}

// Igual que la de arriba pero sin <ul>: para notas sueltas dentro de una
// celda (por ejemplo los "⏳ Le asignaste…" de un producto en Stock).
function GrupoVerMas({ children, limite = 2 }) {
  const [abierto, setAbierto] = useState(false);
  const hijos = Children.toArray(children);
  const sobran = hijos.length - limite;
  if (sobran <= 0) return <>{hijos}</>;
  return (
    <>
      {abierto ? hijos : hijos.slice(0, limite)}
      <button type="button" className="ver-mas-btn" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        {abierto ? '▴ Ver menos' : `▾ Ver ${sobran} más`}
      </button>
    </>
  );
}

// Título del aviso de bajo inventario: "⚠️ N producto(s)…: a, b, c… y 12 más".
function TituloBajoInventario({ alertas, onIr }) {
  const LIMITE = 6;
  const [abierto, setAbierto] = useState(false);
  const sobran = alertas.length - LIMITE;
  const visibles = abierto || sobran <= 0 ? alertas : alertas.slice(0, LIMITE);
  return (
    <>
      ⚠️ {alertas.length} producto(s) con bajo inventario:{' '}
      {visibles.map((a, i) => (
        <span key={a.ID}>
          <button type="button" className="link-button" onClick={() => onIr(a.ID)}>
            {a.Nombre}{a.CodigoPropio ? ` (${a.CodigoPropio})` : ''}
          </button>
          {i < visibles.length - 1 ? ', ' : ''}
        </span>
      ))}
      {sobran > 0 && (
        <>
          {abierto ? ' ' : '… '}
          <button type="button" className="ver-mas-btn ver-mas-btn-enlinea" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
            {abierto ? '▴ Ver menos' : `▾ y ${sobran} más`}
          </button>
        </>
      )}
    </>
  );
}

// Bug reportado por Claudia (2026-09-24): un Nombre/Categoría/Código muy
// largo (sobre todo sin espacios, como los productos de prueba con puras
// "X" seguidas) se salía de su columna en la tabla de Stock y se veía
// encimado sobre las columnas vecinas — la tabla no debe agrandarse ni
// encimarse nunca. Este componente recorta el texto a una sola línea con
// "…" por default (nunca se sale de su columna), y un clic lo expande
// para leerlo completo (envuelto en varias líneas dentro de la misma
// celda, sin romper el layout); otro clic lo vuelve a recortar a su
// tamaño original. Se usa en las columnas Producto, Categoría y Código.
// (2026-10-07) Texto que se puede SELECCIONAR y copiar aunque esté dentro de
// un renglón que se arrastra (Orden del catálogo). Claudia: "que los textos
// podamos copiarlos o más bien seleccionarlos, ya que no puedo: ahí solo hay
// arrastre". Un navegador no deja seleccionar texto dentro de algo
// "arrastrable", así que mientras el mouse está ENCIMA del texto, ese
// renglón deja de serlo; al salir del texto vuelve a como estaba. (Con el
// dedo no hace falta: en celular se arrastra solo desde el ⠿.)
const propsTextoSeleccionable = {
  onMouseEnter: (e) => {
    const renglon = e.currentTarget.closest('[draggable]');
    if (!renglon || renglon.dataset.arrastreAntes !== undefined) return;
    renglon.dataset.arrastreAntes = String(renglon.draggable);
    renglon.draggable = false;
  },
  onMouseLeave: (e) => {
    const renglon = e.currentTarget.closest('[data-arrastre-antes]');
    if (!renglon) return;
    renglon.draggable = renglon.dataset.arrastreAntes === 'true';
    delete renglon.dataset.arrastreAntes;
  },
};

function CeldaTruncada({ texto }) {
  const [expandida, setExpandida] = useState(false);
  if (!texto) return <>{texto}</>;
  return (
    <span
      className={`celda-texto-truncado ${expandida ? 'expandida' : ''}`}
      onClick={() => {
        // Si se acaba de seleccionar texto (para copiarlo), ese clic no
        // cuenta para abrir o recortar la celda.
        try {
          const seleccion = window.getSelection ? window.getSelection() : null;
          if (seleccion && !seleccion.isCollapsed && String(seleccion).trim() !== '') return;
        } catch {
          // Sin "getSelection": se comporta como siempre.
        }
        setExpandida((v) => !v);
      }}
      title={expandida ? 'Clic para recortar' : 'Clic para ver completo'}
    >
      {texto}
    </span>
  );
}

function StockRow({
  producto,
  categoria,
  usuarioId,
  controlTotal,
  usuarios = [],
   misSolicitudesEnProceso = [],
  resaltado = false,
  onActualizar,
  onDirtyChange,
  onEditar,
  onCambiarDisponibilidad,
  onEliminar,
  onVerFoto,
  onSolicitar,
  onOfrecer,
  onAsignarDueno,
  onAlternarNombresDuenos = () => {},
}) {
  const [valor, setValor] = useState(producto.Stock);
  // Arreglo (2026-09-23): antes el botón "Guardar" no avisaba nada mientras
  // se procesaba la petición (podía tardar unos segundos) — con esto se ve
  // "Guardando…" y se bloquea para no mandarla dos veces sin querer.
  const [guardandoStock, setGuardandoStock] = useState(false);
  const stockConocido = useRef(producto.Stock);
  // P14 (2026-10-01): los dos avisos de la columna "Actualizar stock" ya no
  // son texto fijo debajo del campo (ensanchaban la columna y alargaban el
  // renglón): ahora son comentarios flotantes, igual que en Pedidos.
  //   - "No es tuyo": un candadito 🔒 junto al botón; su explicación sale al
  //     pasarle el mouse o darle clic.
  //   - "Solo puedes bajar hasta N": sale solo cuando se escribe una
  //     cantidad que no se puede guardar, pegado al campo.
  const candadoStockRef = useRef(null);
  const campoStockRef = useRef(null);
  const [avisoCandadoStock, setAvisoCandadoStock] = useState(null); // null | 'hover' | 'clic'
  const [avisoMinimoCerrado, setAvisoMinimoCerrado] = useState(false);
  // (2026-10-06) Lo que se acaba de guardar BIEN en este renglón. Si la
  // recarga de los datos tarda en llegar, el renglón ya no se marca "sin
  // guardar" ni deja mandar lo mismo otra vez mientras tanto. Se olvida en
  // cuanto el Stock que manda el servidor cambia (ya llegó la recarga, o
  // alguien más lo movió).
  const [recienGuardado, setRecienGuardado] = useState(null);
  useEffect(() => {
    setRecienGuardado(null);
  }, [producto.Stock]);
  const yaQuedoGuardado = recienGuardado !== null && Number(valor) === recienGuardado;
  const sinGuardar = Number(valor) !== Number(producto.Stock) && !yaQuedoGuardado;
  const llave = `stock:${producto.ID}`;
  const visible = esProductoVisible(producto);
  const foto = primeraFoto(producto.FotoURL);

  // Funcionalidad 2 (Stock personal, 2026-09): a quién(es) le pertenece
  // este producto (puede estar repartido entre varias personas). Si el
  // Admin/Admin Central tiene control total, o si YO soy uno de los
  // dueños, puedo editar esta fila con normalidad. Si el producto todavía
  // no tiene ningún dueño registrado (no debería pasar después de la
  // migración de la Etapa 1), tampoco se bloquea nada, para no dejar una
  // fila inutilizable por un dato faltante.
  const duenos = producto.Duenos || [];
  const soyDueno = duenos.some((d) => String(d.usuarioId) === String(usuarioId) && d.cantidad > 0);
  // (2026-10-09) Candado de Stock — Claudia: "los admin pueden romper el
  // candado, pero deben tener ese bloqueo visual; los trabajadores no, ese
  // bloqueo no se debe de poder abrir". Una fila que no es tuya sale en gris
  // con 🔒 para TODOS. Un Administrador le da clic al 🔒 y confirma para
  // abrirla (solo esa fila, y se vuelve a cerrar al recargar o con 🔓). Un
  // Vendedor no la puede abrir (el servidor también se lo rechaza).
  const [candadoStockAbierto, setCandadoStockAbierto] = useState(false);
  const esAjena = !soyDueno && duenos.length > 0;
  const puedeAbrirCandadoStock = esAjena && controlTotal;
  const puedoEditar = !esAjena || (puedeAbrirCandadoStock && candadoStockAbierto);
  const nombresDuenosFila = duenos.map((d) => d.nombre).filter(Boolean).join(', ');
  function abrirCandadoStock() {
    const confirmar = window.confirm(
      `Este producto no es tuyo${nombresDuenosFila ? ` (es de ${nombresDuenosFila})` : ''}. Vas a poder cambiar información de otra persona. ¿Seguro que quieres continuar?`
    );
    if (confirmar) {
      setCandadoStockAbierto(true);
      setAvisoCandadoStock(null);
    }
  }

  // Aviso en tiempo real (2026-09-23, pedido por Claudia): calcula lo mismo
  // que valida Code.gs (solo puedes bajar hasta lo tuyo) para avisar/​
  // bloquear el botón "Guardar" ANTES de mandar la petición, en vez de que
  // se entere hasta que el backend la rechace.
  const miPropioStock = duenos.find((d) => String(d.usuarioId) === String(usuarioId));
  const miCantidadPropiaStock = miPropioStock ? miPropioStock.cantidad : 0;
  const minimoPermitidoStock =
    duenos.length > 0 ? Math.max(0, Number(producto.Stock) - miCantidadPropiaStock) : 0;
  const excedeMiPropioStock = duenos.length > 0 && Number(valor) < minimoPermitidoStock;

  // "Solicitar": a quién se le está pidiendo una cantidad (guarda el
  // dueño completo, para mostrar el mini-formulario justo debajo de esa
  // persona) y qué cantidad se escribió.
  const [solicitandoA, setSolicitandoA] = useState(null);
  const [cantidadSolicitud, setCantidadSolicitud] = useState('');
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);

  function abrirSolicitar(dueno) {
    setSolicitandoA(dueno);
    setCantidadSolicitud('');
  }

  function confirmarSolicitar() {
    const cantidad = Number(cantidadSolicitud) || 0;
    if (cantidad <= 0 || !solicitandoA) return;
    setEnviandoSolicitud(true);
    onSolicitar(producto, solicitandoA, cantidad)
      .then(() => setSolicitandoA(null))
      .catch(() => {})
      .finally(() => setEnviandoSolicitud(false));
  }

  const [ofreciendoDe, setOfreciendoDe] = useState(null);
  const [destinatarioOferta, setDestinatarioOferta] = useState('');
  const [cantidadOferta, setCantidadOferta] = useState('');
  const [enviandoOferta, setEnviandoOferta] = useState(false);

  function abrirOfrecer(dueno) {
    setOfreciendoDe(dueno);
    setDestinatarioOferta('');
    setCantidadOferta('');
  }

  function confirmarOfrecer() {
    const cantidad = Number(cantidadOferta) || 0;
    if (cantidad <= 0 || !destinatarioOferta || !ofreciendoDe) return;
    const usuarioElegido = usuarios.find((u) => u.ID === destinatarioOferta);
    setEnviandoOferta(true);
    onOfrecer(producto, ofreciendoDe, destinatarioOferta, usuarioElegido ? usuarioElegido.Nombre : '', cantidad)
      .then(() => setOfreciendoDe(null))
      .catch(() => {})
      .finally(() => setEnviandoOferta(false));
  }

  const misOfertasEnProceso = misSolicitudesEnProceso.filter(
    (t) => t.Tipo === 'Oferta' && String(t.ProductoID) === String(producto.ID)
  );
  // Solo para Admin/Admin Central: asignar o reasignar de un jalón a quién
  // le toca una cantidad de este producto.
  const [asignarUsuarioId, setAsignarUsuarioId] = useState('');
  const [asignarCantidad, setAsignarCantidad] = useState('');
  const [asignando, setAsignando] = useState(false);

  function confirmarAsignar() {
    const usuarioElegido = usuarios.find((u) => u.ID === asignarUsuarioId);
    setAsignando(true);
    onAsignarDueno(producto, asignarUsuarioId, usuarioElegido ? usuarioElegido.Nombre : '', Number(asignarCantidad) || 0)
      .then(() => {
        setAsignarUsuarioId('');
        setAsignarCantidad('');
      })
      .catch(() => {})
      .finally(() => setAsignando(false));
  }

  // Si el Stock del producto cambió por FUERA de este cuadrito (por ejemplo,
  // lo editaste desde el formulario de "Editar" y se guardó ahí), sincroniza
  // el cuadro de "Actualizar stock" con el valor nuevo. Sin esto, el cuadro
  // se quedaba pegado con el número viejo y marcaba un falso "cambio sin
  // guardar" aunque ya lo hubieras guardado desde Editar.
  useEffect(() => {
    if (producto.Stock !== stockConocido.current) {
      stockConocido.current = producto.Stock;
      setValor(producto.Stock);
    }
  }, [producto.Stock]);

  // Avisa al Dashboard si esta fila tiene un cambio pendiente de guardar,
  // y con qué texto describirlo en el aviso flotante.
  useEffect(() => {
    const descripcion = sinGuardar
      ? `Stock de "${producto.Nombre}": ${producto.Stock} → ${valor || 0}`
      : '';
    onDirtyChange(llave, sinGuardar, descripcion);
    return () => onDirtyChange(llave, false, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinGuardar, llave, valor]);

    const clasesFila = [!visible && 'fila-oculta', sinGuardar && 'fila-sin-guardar', resaltado && 'fila-resaltada', !puedoEditar && 'fila-ajena'].filter(Boolean).join(' ');

  return (
    <tr id={`stock-fila-${producto.ID}`} className={clasesFila}>
      <td>{formatearFechaSolo(producto.FechaCreacion)}</td>
      <td>{formatearHoraSolo(producto.FechaCreacion)}</td>
      <td>
        <div className="stock-nombre-con-foto">
          {foto ? (
            <img
              src={foto}
              alt={producto.Nombre}
              className="stock-thumb"
              onClick={() => onVerFoto(foto)}
            />
          ) : (
            <div className="stock-thumb stock-thumb-vacia">Sin foto</div>
          )}
          <span className="stock-nombre-texto">
            <CeldaTruncada texto={producto.Nombre} />
            {!visible && <span className="badge badge-oculto">Oculto</span>}
          </span>
        </div>
      </td>
      <td><CeldaTruncada texto={categoria} /></td>
      <td>{producto.CodigoPropio ? <CeldaTruncada texto={producto.CodigoPropio} /> : '—'}</td>
      <td>
        {/* Pendiente P10 de Claudia (2026-10-01): antes aquí solo se veía el
            precio normal aunque el producto estuviera en oferta. Ahora, si
            tiene un precio de oferta válido (mayor a 0 y menor al normal —
            la misma regla del catálogo), se ve el normal tachado y el de
            oferta resaltado, que es el que de verdad se cobra. */}
        {Number(producto.PrecioOferta) > 0 && Number(producto.PrecioOferta) < Number(producto.Precio) ? (
          <span className="stock-precio-oferta" title="En oferta — este es el precio que se cobra">
            <s className="precio-tachado">${Number(producto.Precio).toLocaleString('es-MX')}</s>
            <strong>${Number(producto.PrecioOferta).toLocaleString('es-MX')}</strong>
          </span>
        ) : (
          <>${Number(producto.Precio).toLocaleString('es-MX')}</>
        )}
      </td>
         <td>
        {producto.Stock}
        {Number(producto.Stock) === 0 && <span className="badge badge-agotado">AGOTADO</span>}
      </td>
          <td>
        {duenos.length === 0 ? (
          <span className="muted">Sin asignar</span>
        ) : (
          <ul className="stock-duenos-lista">
            {duenos.map((d) => {
              const esMio = String(d.usuarioId) === String(usuarioId);
              // Funcionalidad 2 (Stock personal, 2026-09): si ya le mandé una
              // solicitud a este dueño por este producto y sigue pendiente,
              // no se ve el botón "Solicitar" — se ve un aviso de que ya se
              // envió, para que quede claro que sí funcionó y no haga falta
              // adivinar ni mandarla dos veces.
              const solicitudEnProceso = misSolicitudesEnProceso.find(
                (t) => String(t.ProductoID) === String(producto.ID) && String(t.DuenoID) === String(d.usuarioId)
              );
              // Funcionalidad (2026-09-22): "disponible" ya no es solo lo
              // que esta persona tiene asignado (d.cantidad) — el backend
              // le resta lo que ya comprometió en otras asignaciones
              // pendientes, para que NADIE, sin importar quién tenga la
              // sesión abierta ni de quién sea la fila, pueda solicitar o
              // asignar más de lo que en verdad queda libre. Si el backend
              // aún no manda ese dato (por ejemplo si no se ha vuelto a
              // desplegar Code.gs), se usa d.cantidad de respaldo.
              const disponibleD = d.disponible !== undefined ? d.disponible : d.cantidad;
              return (
                <li key={d.usuarioId} className={`stock-dueno-linea${esMio ? ' stock-dueno-mio' : ''}`}>
                  {/* Rediseño (2026-10-01, pedido por Claudia con capturas):
                      cada renglón es una mini-cuadrícula de 3 columnas de
                      ancho FIJO (nombre | cantidad | botón), así los
                      nombres, los números y los botones "Asignar a…" /
                      "Solicitar" quedan alineados en todos los renglones y
                      todas las filas. El nombre largo se recorta con "…";
                      clic en el nombre (o en ↔ del encabezado) lo muestra
                      completo, y se regresa solo después de 5 minutos. */}
                  <button
                    type="button"
                    className="stock-dueno-nombre"
                    onClick={onAlternarNombresDuenos}
                    title={`${esMio ? `Yo (${d.nombre})` : d.nombre} — clic para ver/achicar los nombres completos`}
                  >
                    {esMio ? 'Yo' : d.nombre}
                  </button>
                  <strong className="stock-dueno-cantidad">{disponibleD}</strong>
                  <span className="stock-dueno-accion">
                    {!controlTotal && !esMio && !solicitudEnProceso && (
                      <button type="button" className="btn btn-secondary btn-chip" onClick={() => abrirSolicitar(d)}>
                        Solicitar
                      </button>
                    )}
                    {!controlTotal && !esMio && solicitudEnProceso && (
                      <span className="muted campo-nota" title="Ya le enviaste una solicitud, esperando respuesta">⏳ Enviada</span>
                    )}
                    {(esMio || controlTotal) && (
                      <button type="button" className="btn btn-secondary btn-chip" onClick={() => abrirOfrecer(d)}>
                        Asignar a…
                      </button>
                    )}
                  </span>
                                {solicitandoA && solicitandoA.usuarioId === d.usuarioId && (
                    <div className="stock-solicitar-caja">
                                           <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Cantidad"
                        value={cantidadSolicitud}
                        onChange={(e) => setCantidadSolicitud(limitarDigitos(e.target.value, MAX_DIGITOS_STOCK))}
                      />
                                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSolicitandoA(null)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={enviandoSolicitud || !cantidadSolicitud || Number(cantidadSolicitud) > disponibleD || Number(cantidadSolicitud) <= 0}
                        onClick={confirmarSolicitar}
                      >
                        {enviandoSolicitud ? 'Enviando…' : 'Enviar'}
                      </button>
                      {Number(cantidadSolicitud) > disponibleD && (
                        <span className="muted campo-nota">Máximo disponible: {disponibleD}</span>
                      )}
                    </div>
                  )}
                                   {ofreciendoDe && ofreciendoDe.usuarioId === d.usuarioId && (
                    <div className="stock-solicitar-caja">
                      <span className="muted campo-nota">
                        Transferir lo de <strong>{esMio ? 'Yo' : d.nombre}</strong> a:
                      </span>
                      <select value={destinatarioOferta} onChange={(e) => setDestinatarioOferta(e.target.value)}>
                        <option value="">Elige una persona…</option>
                        {usuarios.filter((u) => esActivo(u.Activo) && String(u.ID) !== String(d.usuarioId)).map((u) => (
                          <option key={u.ID} value={u.ID}>{u.Nombre}</option>
                        ))}
                      </select>
                                           <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Cantidad"
                        value={cantidadOferta}
                        onChange={(e) => setCantidadOferta(limitarDigitos(e.target.value, MAX_DIGITOS_STOCK))}
                      />
                                           <button type="button" className="btn btn-secondary btn-small" onClick={() => setOfreciendoDe(null)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        disabled={enviandoOferta || !destinatarioOferta || !cantidadOferta || Number(cantidadOferta) > disponibleD || Number(cantidadOferta) <= 0}
                        onClick={confirmarOfrecer}
                      >
                        {enviandoOferta ? 'Enviando…' : 'Enviar'}
                      </button>
                      {Number(cantidadOferta) > disponibleD && (
                        <span className="muted campo-nota">Máximo disponible: {disponibleD}</span>
                      )}
                    </div>
                  )}
                  {/* P14: si hay muchas asignaciones en espera de este mismo
                      dueño, se ven 2 y "Ver N más" (antes cada una
                      alargaba el renglón del producto). */}
                  <GrupoVerMas limite={2}>
                    {misOfertasEnProceso.filter((t) => String(t.DuenoID) === String(d.usuarioId)).map((t) => (
                      <div key={t.ID} className="muted campo-nota">
                        ⏳ Le asignaste {t.Cantidad} a {t.SolicitanteNombre}, esperando que acepte
                      </div>
                    ))}
                  </GrupoVerMas>
                </li>
              );
                    })}
          </ul>
        )}
      </td>
      <td>{producto.StockMinimo}</td>
      <td>
        <div className="stock-editor">
          <div className="campo-numero-wrapper" ref={campoStockRef}>
            <input
              type="text"
              inputMode="numeric"
              className={excedeMiPropioStock ? 'campo-modificado' : sinGuardar ? 'campo-modificado' : ''}
              value={valor}
              disabled={!puedoEditar || guardandoStock}
              onChange={(e) => {
                setAvisoMinimoCerrado(false);
                setValor(limitarDigitos(e.target.value, MAX_DIGITOS_STOCK));
              }}
            />
            <BotonesPasoNumero
              disabled={!puedoEditar || guardandoStock}
              onSubir={() =>
                setValor((v) => limitarDigitos(String(Math.max(0, (Number(v) || 0) + 1)), MAX_DIGITOS_STOCK))
              }
              onBajar={() =>
                setValor((v) => limitarDigitos(String(Math.max(0, (Number(v) || 0) - 1)), MAX_DIGITOS_STOCK))
              }
            />
          </div>
          <button
            className={`btn btn-small ${guardandoStock ? 'btn-guardando' : ''}`}
            onClick={() => {
              setGuardandoStock(true);
              const valorMandado = Number(valor);
              onActualizar(producto.ID, valor)
                .then(() => setRecienGuardado(valorMandado))
                .catch(() => {})
                .finally(() => setGuardandoStock(false));
            }}
            disabled={!sinGuardar || !puedoEditar || guardandoStock || excedeMiPropioStock}
          >
            {guardandoStock ? 'Guardando…' : 'Guardar'}
          </button>
          {!puedoEditar && (
            <button
              ref={candadoStockRef}
              type="button"
              className={`btn-icono-aviso ${puedeAbrirCandadoStock ? 'btn-candado-stock' : ''}`}
              onMouseEnter={() => setAvisoCandadoStock((v) => v || 'hover')}
              onMouseLeave={() => setAvisoCandadoStock((v) => (v === 'hover' ? null : v))}
              onClick={() => (puedeAbrirCandadoStock ? abrirCandadoStock() : setAvisoCandadoStock((v) => (v === 'clic' ? null : 'clic')))}
              aria-label={puedeAbrirCandadoStock ? 'Este producto no es tuyo — clic para desbloquear esta fila' : 'Este producto no es tuyo'}
              data-candado-stock={puedeAbrirCandadoStock ? 'abrible' : 'cerrado'}
            >
              🔒
            </button>
          )}
          {esAjena && puedoEditar && (
            <button
              type="button"
              className="btn-icono-aviso btn-icono-aviso-abierto"
              onClick={() => setCandadoStockAbierto(false)}
              title="Candado abierto — clic para volver a bloquear esta fila"
              aria-label="Volver a bloquear esta fila"
              data-candado-stock="abierto"
            >
              🔓
            </button>
          )}
        </div>
        {!puedoEditar && (
          <AvisoFlotante
            anclaRef={candadoStockRef}
            abierto={avisoCandadoStock !== null}
            onCerrar={() => setAvisoCandadoStock(null)}
            autoCerrarMs={avisoCandadoStock === 'clic' ? 6000 : 0}
          >
            <strong>No es tuyo{nombresDuenosFila ? ` (es de ${nombresDuenosFila})` : ''}.</strong>{' '}
            {puedeAbrirCandadoStock
              ? 'Como Administrador puedes desbloquear esta fila: dale clic al 🔒 y confirma.'
              : 'Para tener de este producto, usa "Solicitar" junto al nombre de su dueño.'}
          </AvisoFlotante>
        )}
        {puedoEditar && (
          <AvisoFlotante
            anclaRef={campoStockRef}
            abierto={excedeMiPropioStock && !avisoMinimoCerrado}
            onCerrar={() => setAvisoMinimoCerrado(true)}
          >
            <strong>Solo puedes bajar hasta {minimoPermitidoStock}.</strong> De este producto tienes{' '}
            {miCantidadPropiaStock} asignado a ti, y bajar más afectaría el stock de alguien más.
          </AvisoFlotante>
        )}
      </td>
      <td className="celda-acciones">
        <div className="acciones-producto">
          <button type="button" className="btn btn-editar btn-chip" onClick={() => onEditar(producto)} disabled={!puedoEditar}>
            Editar
          </button>
          <button
            type="button"
            className="btn btn-toggle btn-chip"
            onClick={() => onCambiarDisponibilidad(producto)}
            disabled={!puedoEditar}
          >
            {visible ? 'Ocultar' : 'Mostrar'}
          </button>
          <button type="button" className="btn btn-eliminar btn-chip" onClick={() => onEliminar(producto)} disabled={!puedoEditar}>
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}

// Precio guardado en el pedido (fijado al momento del pedido). Los pedidos
// de antes de esta versión no tienen nada guardado ahí, así que en esos
// casos devolvemos null (para mostrar "—" en vez de inventar un $0).
function precioDelPedido(pedido) {
  if (pedido.Precio === undefined || pedido.Precio === null || pedido.Precio === '') return null;
  const numero = Number(pedido.Precio);
  return Number.isNaN(numero) ? null : numero;
}

function formatearMoneda(numero) {
  return `$${numero.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Versión corta de formatearMoneda, sin centavos y abreviando miles con
// "k" (por ejemplo $1.2k en vez de $1,234.00) — se usa SOLO en las
// etiquetas del eje de la gráfica de tendencia, donde no cabe el monto
// completo. En cualquier otro lado (tarjetas, tablas) se sigue usando
// formatearMoneda completo.
function formatearMonedaCorta(numero) {
  const signo = numero < 0 ? '-' : '';
  const abs = Math.abs(numero);
  if (abs >= 1000) {
    return `${signo}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${signo}$${abs.toFixed(0)}`;
}

// ---- Estado de cuenta (pestaña "📄 Estado de cuenta") ----
// Cada vez que un pedido pasa a "Pagado" se registra un "Abono" en la hoja
// Movimientos, y cada vez que pasa a "Reembolsado" se registra un "Cargo".
// Esta pestaña solo muestra esa lista, filtrable por fecha, con sus totales.

function movimientoEnRangoDeFecha(mov, desde, hasta) {
  if (!desde && !hasta) return true;
  if (!mov.Fecha) return false;
  const fecha = new Date(mov.Fecha);
  if (Number.isNaN(fecha.getTime())) return false;
  if (desde && fecha < new Date(`${desde}T00:00:00`)) return false;
  if (hasta && fecha > new Date(`${hasta}T23:59:59`)) return false;
  return true;
}

function formatearFechaHora(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return `${fecha.toLocaleDateString('es-MX')} ${fecha.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

// Texto del rango de fechas elegido, para mostrarlo arriba de la tabla (y,
// sobre todo, en la versión impresa/PDF, donde ya no se ven los cuadros de
// fecha porque se ocultan al imprimir).
function textoRangoFechas(desde, hasta) {
  if (!desde && !hasta) return 'Todos los movimientos registrados';
  const textoDesde = desde ? new Date(`${desde}T00:00:00`).toLocaleDateString('es-MX') : 'el inicio';
  const textoHasta = hasta ? new Date(`${hasta}T00:00:00`).toLocaleDateString('es-MX') : 'hoy';
  return `Del ${textoDesde} al ${textoHasta}`;
}

// ---- Periodos rápidos del Estado de cuenta (2026-10-07) ----
// Claudia: "debo poder seleccionar también fácil los periodos por si quiero
// ver o imprimir, así como en las apps de banco". Un toque pone las fechas
// "Desde" y "Hasta"; también se puede elegir un mes completo de la lista
// (salen los meses que tienen movimientos) o seguir escribiendo las fechas a
// mano. Cada uno regresa [desde, hasta] como "aaaa-mm-dd".
const PERIODOS_ESTADO_CUENTA = [
  { clave: 'hoy', texto: 'Hoy', rango: (hoy) => [hoy, hoy] },
  { clave: 'ayer', texto: 'Ayer', rango: (hoy) => { const d = new Date(hoy); d.setDate(d.getDate() - 1); return [d, d]; } },
  { clave: 'semana', texto: 'Esta semana', rango: (hoy) => [inicioDeSemana(hoy), hoy] },
  { clave: 'mes', texto: 'Este mes', rango: (hoy) => [inicioDeMes(hoy), hoy] },
  { clave: 'mesPasado', texto: 'Mes pasado', rango: (hoy) => [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)] },
  { clave: 'tresMeses', texto: 'Últimos 3 meses', rango: (hoy) => [new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1), hoy] },
  { clave: 'anio', texto: 'Este año', rango: (hoy) => [new Date(hoy.getFullYear(), 0, 1), hoy] },
];
const NOMBRES_DE_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function EstadoCuentaTab({ movimientos, pedidos, productos }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  // Qué periodo rápido está puesto ('' = fechas a mano o sin filtro;
  // 'm:2026-09' = el mes elegido en la lista).
  const [periodo, setPeriodo] = useState('');
  function elegirPeriodo(clave) {
    const elegido = PERIODOS_ESTADO_CUENTA.find((p) => p.clave === clave);
    if (!elegido) return;
    const [inicio, fin] = elegido.rango(new Date());
    setDesde(fechaISOLocal(inicio));
    setHasta(fechaISOLocal(fin));
    setPeriodo(clave);
  }
  function elegirMes(valor) {
    // valor = "aaaa-mm"
    const partes = /^(\d{4})-(\d{2})$/.exec(valor);
    if (!partes) return;
    const anio = Number(partes[1]);
    const mes = Number(partes[2]) - 1;
    setDesde(fechaISOLocal(new Date(anio, mes, 1)));
    setHasta(fechaISOLocal(new Date(anio, mes + 1, 0)));
    setPeriodo(`m:${valor}`);
  }
  function cambiarFechaAMano(campo, valor) {
    setPeriodo('');
    if (campo === 'desde') setDesde(valor);
    else setHasta(valor);
  }
  // Los meses que tienen algún movimiento (del más nuevo al más viejo).
  const mesesConMovimientos = (() => {
    const vistos = new Set();
    (movimientos || []).forEach((m) => {
      const fecha = m.Fecha ? new Date(m.Fecha) : null;
      if (fecha && !Number.isNaN(fecha.getTime())) vistos.add(fechaISOLocal(fecha).slice(0, 7));
    });
    return Array.from(vistos).sort().reverse();
  })();
  // P14 (2026-10-01): "Mostrar 50 / 100 / Todos". OJO con la impresión: esta
  // misma tabla es la que se imprime / se guarda como PDF, así que justo
  // antes de imprimir se dibujan TODOS los renglones (si no, el PDF saldría
  // incompleto) y al terminar se regresa a lo que estaba. Funciona igual
  // con el botón de aquí que con Ctrl+P del navegador.
  const [limiteFilas, setLimiteFilas] = useLimiteFilas('cuenta');
  const [imprimiendo, setImprimiendo] = useState(false);
  useEffect(() => {
    function antesDeImprimir() {
      flushSync(() => setImprimiendo(true));
    }
    function despuesDeImprimir() {
      setImprimiendo(false);
    }
    window.addEventListener('beforeprint', antesDeImprimir);
    window.addEventListener('afterprint', despuesDeImprimir);
    return () => {
      window.removeEventListener('beforeprint', antesDeImprimir);
      window.removeEventListener('afterprint', despuesDeImprimir);
    };
  }, []);

  // Los Movimientos solo guardan el ID del pedido — el nombre del producto y
  // su código propio se buscan aquí usando los Pedidos y Productos que el
  // Dashboard ya tiene cargados, sin tener que guardar nada extra en la
  // hoja de Movimientos.
  const pedidoPorId = {};
  (pedidos || []).forEach((p) => {
    pedidoPorId[p.ID] = p;
  });
  const codigoPorProductoId = {};
  (productos || []).forEach((p) => {
    codigoPorProductoId[p.ID] = p.CodigoPropio || '';
  });

  function productoDelMovimiento(mov) {
    const pedido = pedidoPorId[mov.PedidoID];
    return pedido ? pedido.Producto : '—';
  }

  function codigoDelMovimiento(mov) {
    const pedido = pedidoPorId[mov.PedidoID];
    if (!pedido) return '—';
    return codigoPorProductoId[pedido.ProductoID] || '—';
  }

  const movimientosOrdenados = movimientos.slice().reverse(); // más recientes primero
  const movimientosFiltrados = movimientosOrdenados.filter((m) => movimientoEnRangoDeFecha(m, desde, hasta));
  // P14: en PANTALLA se dibujan los primeros 50 / 100 / todos. Los totales
  // de abajo siempre suman TODOS los movimientos del rango, y al imprimir o
  // guardar como PDF también salen TODOS (ver "imprimiendo").
  const movimientosVisibles = imprimiendo ? movimientosFiltrados : recortarFilas(movimientosFiltrados, limiteFilas);

  const totalAbonos = movimientosFiltrados
    .filter((m) => m.Tipo === 'Abono')
    .reduce((suma, m) => suma + (Number(m.Monto) || 0), 0);
  const totalCargos = movimientosFiltrados
    .filter((m) => m.Tipo === 'Cargo')
    .reduce((suma, m) => suma + (Number(m.Monto) || 0), 0);
  const totalNeto = totalAbonos - totalCargos;

  const hayFiltro = !!(desde || hasta);

  function limpiarFiltro() {
    setDesde('');
    setHasta('');
    setPeriodo('');
  }

  return (
    <div className="estado-cuenta">
      <div className="periodos-rapidos no-imprimir" role="group" aria-label="Periodo del estado de cuenta" data-periodos-cuenta>
        <span className="periodos-rapidos-titulo">Periodo:</span>
        {PERIODOS_ESTADO_CUENTA.map((p) => (
          <button
            key={p.clave}
            type="button"
            className={`analitica-rapido-btn ${periodo === p.clave ? 'activo' : ''}`}
            aria-pressed={periodo === p.clave}
            onClick={() => elegirPeriodo(p.clave)}
            data-periodo={p.clave}
          >
            {p.texto}
          </button>
        ))}
        <button
          type="button"
          className={`analitica-rapido-btn ${!hayFiltro ? 'activo' : ''}`}
          aria-pressed={!hayFiltro}
          onClick={limpiarFiltro}
          data-periodo="todo"
        >
          Todo
        </button>
        {mesesConMovimientos.length > 0 && (
          <label className="periodos-rapidos-mes">
            <span>o un mes:</span>
            <select
              value={periodo.startsWith('m:') ? periodo.slice(2) : ''}
              onChange={(e) => (e.target.value ? elegirMes(e.target.value) : limpiarFiltro())}
              aria-label="Elegir un mes completo"
              data-periodo-mes
            >
              <option value="">— elegir mes —</option>
              {mesesConMovimientos.map((valor) => (
                <option key={valor} value={valor}>
                  {NOMBRES_DE_MESES[Number(valor.slice(5, 7)) - 1]} {valor.slice(0, 4)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="filtro-fechas no-imprimir">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => cambiarFechaAMano('desde', e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => cambiarFechaAMano('hasta', e.target.value)} />
        </label>
        {hayFiltro && (
          <button type="button" className="btn btn-secondary btn-small" onClick={limpiarFiltro}>
            Quitar filtro de fechas
          </button>
        )}
        <button type="button" className="btn btn-primary btn-small" onClick={() => {
          // Se dibujan todos los renglones ANTES de abrir la ventana de
          // impresión (el evento "beforeprint" de arriba hace lo mismo, pero
          // así no se depende de que el navegador lo dispare a tiempo).
          flushSync(() => setImprimiendo(true));
          window.print();
        }}>
          🖨️ Imprimir / Guardar como PDF
        </button>
      </div>

      <p className="muted no-imprimir">
        Para guardarlo como PDF, dale clic a "Imprimir / Guardar como PDF" y, en la ventana que se
        abre, elige "Guardar como PDF" en el destino/impresora.
      </p>

      {/* Todo lo que está DENTRO de este div es lo único que se ve al
          imprimir o guardar como PDF — el resto del panel (menú, pestañas,
          filtros, botones) se oculta automáticamente. */}
      <div id="estado-cuenta-imprimible">
        <div className="estado-cuenta-encabezado-impresion">
          <h2>Estado de cuenta</h2>
          <p className="muted">{textoRangoFechas(desde, hasta)}</p>
        </div>

        <div className="table-scroll">
          <table className="data-table estado-cuenta-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Producto</th>
                <th>Código</th>
                <th>Cargo</th>
                <th>Abono</th>
                <th>Concepto</th>
              </tr>
            </thead>
            <tbody>
              {/* Corrección 2026-09-28 (pedida por Claudia): antes Cargo y
                  Abono vivían juntos en una sola columna "Tipo" (con un
                  badge de color) más una columna "Monto" aparte — para
                  contar rápido cuántos cargos y cuántos abonos hay de un
                  vistazo, pidió que cada uno tenga SU PROPIA columna, con
                  el monto solo puesto del lado que corresponde (y un "—"
                  del otro lado). Esta misma tabla es la que se ve en
                  pantalla Y la que se imprime/guarda como PDF (mismo
                  elemento, ver el "id=estado-cuenta-imprimible" de arriba),
                  así que este cambio se refleja en los dos automáticamente. */}
              {movimientosVisibles.map((m) => (
                <tr key={m.ID}>
                  <td>{formatearFechaHora(m.Fecha)}</td>
                  <td>{m.Cliente || '—'}</td>
                  <td>{productoDelMovimiento(m)}</td>
                  <td>{codigoDelMovimiento(m)}</td>
                  <td>
                    {m.Tipo === 'Cargo' ? (
                      <span className="texto-cargo">{formatearMoneda(Number(m.Monto) || 0)}</span>
                    ) : '—'}
                  </td>
                  <td>
                    {m.Tipo === 'Abono' ? (
                      <span className="texto-abono">{formatearMoneda(Number(m.Monto) || 0)}</span>
                    ) : '—'}
                  </td>
                  <td>{m.Concepto || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {movimientosFiltrados.length === 0 && (
            <p className="info-msg">No hay movimientos en el rango de fechas de arriba.</p>
          )}
        </div>
        {/* No sale en la impresión / PDF (ver ".barra-filas" en global.css). */}
        <BarraFilas
          total={movimientosFiltrados.length}
          visibles={movimientosVisibles.length}
          limite={limiteFilas}
          onCambiar={setLimiteFilas}
          nombre="movimientos"
        />

        <div className="estado-cuenta-totales">
          <p>
            Total de abonos: <strong>{formatearMoneda(totalAbonos)}</strong>
          </p>
          <p>
            Total de cargos: <strong>{formatearMoneda(totalCargos)}</strong>
          </p>
          <p className="estado-cuenta-total-neto">
            Total neto: <strong>{formatearMoneda(totalNeto)}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Bitácora de cambios (pestaña "🗒️ Bitácora") ----
// Cada línea la agrega SOLA el backend cuando alguien agrega/edita/elimina
// un producto, mueve el stock, actualiza un pedido, o reordena/renombra/
// elimina una categoría. Esta pestaña solo muestra esa lista, más reciente
// primero, filtrable por fecha (igual que Estado de cuenta).
// Texto normalizado para comparar nombres de usuario/acción sin que
// importen mayúsculas, acentos ni espacios de sobra ("Claudia" = "CLAUDIA").
function normalizarParaFiltro(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

// ============================================================
// Catálogos por sucursal (2026-10-02)
// ============================================================
// Pedido por Claudia: cada persona con "Catálogo propio" prendido (👤
// Usuarios) tiene su propio catálogo con su propio link. Aquí van las
// piezas del panel: el link (copiar/abrir) y la pestaña "🏪 Mi sucursal".

// Link público del catálogo de una persona. Se arma con la dirección desde
// la que se está viendo el panel, así sirve igual en el sitio real que en
// uno de prueba.
function linkDeSucursal(idUsuario) {
  return `${window.location.origin}/?sucursal=${encodeURIComponent(idUsuario)}`;
}

function LinkSucursal({ idUsuario, compacto = false }) {
  const [copiado, setCopiado] = useState(false);
  const campoRef = useRef(null);
  const link = linkDeSucursal(idUsuario);

  function copiar() {
    const listo = () => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    };
    // Respaldo para navegadores sin portapapeles moderno: se selecciona el
    // texto del cuadrito (queda marcado para copiarlo a mano si hiciera falta).
    const aMano = () => {
      const campo = campoRef.current;
      if (!campo) return;
      campo.focus();
      campo.select();
      try {
        if (document.execCommand('copy')) listo();
      } catch {
        // Se queda seleccionado: se puede copiar con el teclado o el menú.
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(listo).catch(aMano);
    } else {
      aMano();
    }
  }

  return (
    <span className={`link-sucursal${compacto ? ' link-sucursal-compacto' : ''}`}>
      <input
        ref={campoRef}
        type="text"
        readOnly
        value={link}
        onFocus={(e) => e.target.select()}
        aria-label="Link del catálogo de esta sucursal"
      />
      <button type="button" className="btn btn-secondary btn-chip" onClick={copiar}>
        {copiado ? '✓ Copiado' : '📋 Copiar link'}
      </button>
      <a className="btn btn-secondary btn-chip link-sucursal-abrir" href={link} target="_blank" rel="noopener noreferrer">
        Abrir ↗
      </a>
    </span>
  );
}

// "Comentarios" tipo Word (la misma burbuja de AvisoFlotante) para explicar
// algo sin llenar la pantalla de texto — Claudia, 2026-10-03: "que tenga un
// comentario haciéndole hover over o click", "que tenga su comentario
// avisando qué hace para que no se asusten".
//
// <TextoConComentario>: un texto (por ejemplo el título de una columna) con
// rayita punteada; el comentario sale al pasar el mouse Y al darle clic o
// tocarlo (para el celular, donde no hay "pasar el mouse").
function TextoConComentario({ children, comentario }) {
  const anclaRef = useRef(null);
  const [abierto, setAbierto] = useState(null); // null | 'hover' | 'clic'
  return (
    <>
      <button
        type="button"
        ref={anclaRef}
        className="texto-con-comentario"
        onMouseEnter={() => setAbierto((v) => v || 'hover')}
        onMouseLeave={() => setAbierto((v) => (v === 'hover' ? null : v))}
        onClick={() => setAbierto((v) => (v === 'clic' ? null : 'clic'))}
      >
        {children}
      </button>
      <AvisoFlotante
        anclaRef={anclaRef}
        abierto={abierto !== null}
        onCerrar={() => setAbierto(null)}
        autoCerrarMs={abierto === 'clic' ? 9000 : 0}
      >
        {comentario}
      </AvisoFlotante>
    </>
  );
}

// <BotonConComentario>: un botón normal que, al pasarle el mouse por encima,
// enseña en un comentario QUÉ va a hacer (antes de darle clic). El clic hace
// lo de siempre.
function BotonConComentario({ comentario, onClick, children, ...resto }) {
  const anclaRef = useRef(null);
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        ref={anclaRef}
        {...resto}
        onMouseEnter={() => setAbierto(true)}
        onMouseLeave={() => setAbierto(false)}
        onClick={(e) => {
          setAbierto(false);
          onClick?.(e);
        }}
      >
        {children}
      </button>
      <AvisoFlotante anclaRef={anclaRef} abierto={abierto} onCerrar={() => setAbierto(false)}>
        {comentario}
      </AvisoFlotante>
    </>
  );
}

// Pestaña "🏪 Mi sucursal": lo que cada quien decide de SU catálogo. No
// mueve piezas ni toca el catálogo Global — solo qué se ve en el de esa
// sucursal. El Admin Central puede revisar (y ayudar con) el de cualquiera.
function SucursalTab({ sucursales, ventasRecientes = [], usuarioId, esAdminCentral, sesionToken, onCambio, iniciarCarga, terminarCarga, onPedirMas, onVerFoto }) {
  const [elegidaId, setElegidaId] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | catalogo | agotados | ocultos
  const [ocupadoId, setOcupadoId] = useState('');
  const [confirmandoBorrarId, setConfirmandoBorrarId] = useState('');
  const [mensaje, setMensaje] = useState('');
  // Aviso verde de "listo, y esto fue lo que pasó" después de un cambio —
  // para que quede claro (también en el celular, donde no hay comentario
  // al pasar el mouse) que quitar algo del catálogo no borra nada.
  const [mensajeListo, setMensajeListo] = useState('');

  const propia = sucursales.find((s) => String(s.id) === String(usuarioId));
  const sucursal = sucursales.find((s) => String(s.id) === String(elegidaId)) || propia || sucursales[0] || null;

  if (!sucursal) {
    return (
      <p className="info-msg">
        Todavía nadie tiene catálogo propio. Para darle uno a alguien, ve a 👤 Usuarios y prende su interruptor
        "Catálogo propio".
      </p>
    );
  }

  const esLaMia = String(sucursal.id) === String(usuarioId);
  // Estado de cada producto EN ESTE catálogo (columna "En el catálogo"):
  //   'quitado'      → "Oculto": la persona lo quitó de su catálogo (no se
  //                    ve aunque tenga piezas);
  //   'ocultoTienda' → "Oculto": el producto (o su categoría) está oculto en
  //                    toda la tienda, así que tampoco se ve aquí;
  //   'agotado'      → "Agotado": se ve, pero con 0 para pedir;
  //   'catalogo'     → "Visible": se ve y se puede pedir.
  const estadoDe = (p) => {
    if (p.quitado) return 'quitado';
    if (!p.visibleEnTienda) return 'ocultoTienda';
    return p.disponible > 0 ? 'catalogo' : 'agotado';
  };
  const productos = (sucursal.productos || [])
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
  const conteo = { catalogo: 0, agotado: 0, quitado: 0, ocultoTienda: 0 };
  productos.forEach((p) => { conteo[estadoDe(p)] += 1; });
  const estaOculto = (p) => estadoDe(p) === 'quitado' || estadoDe(p) === 'ocultoTienda';
  const visibles = productos.filter((p) => {
    if (filtro === 'todos') return true;
    if (filtro === 'agotados') return estadoDe(p) === 'agotado';
    if (filtro === 'ocultos') return estaOculto(p);
    return estadoDe(p) === 'catalogo';
  });

  function cambiar(p, operacion) {
    setOcupadoId(p.productoId);
    setMensaje('');
    setMensajeListo('');
    iniciarCarga?.();
    const elCatalogo = esLaMia ? 'tu catálogo' : `el catálogo de ${sucursal.nombre}`;
    const lasPiezas = esLaMia ? 'tus piezas' : 'sus piezas';
    const hecho = {
      quitar: `"${p.nombre}" ya no se ve en ${elCatalogo}. No se borró el producto ni se movieron ${lasPiezas}; para regresarlo usa "Volver a poner".`,
      poner: `"${p.nombre}" ya se ve otra vez en ${elCatalogo}.`,
      borrar: `"${p.nombre}" se borró de esta lista. El producto sigue existiendo: si llegan piezas, vuelve a aparecer aquí solo.`,
    }[operacion];
    actualizarCatalogoSucursal({
      sesionToken,
      usuarioId: esLaMia ? undefined : sucursal.id,
      productoId: p.productoId,
      operacion,
    })
      .then(() => {
        setMensajeListo(hecho || '');
        return onCambio();
      })
      .catch((err) => setMensaje(`No se pudo hacer el cambio: ${err.message}`))
      .finally(() => {
        setOcupadoId('');
        setConfirmandoBorrarId('');
        terminarCarga?.();
      });
  }

  // (2026-10-08) La oferta propia de esta sucursal para un producto.
  function cambiarOferta(p, precioOferta) {
    setOcupadoId(p.productoId);
    setMensaje('');
    setMensajeListo('');
    iniciarCarga?.();
    const quitar = String(precioOferta).trim() === '' || Number(precioOferta) === 0;
    return actualizarCatalogoSucursal({
      sesionToken,
      usuarioId: esLaMia ? undefined : sucursal.id,
      productoId: p.productoId,
      operacion: 'oferta',
      precioOferta: quitar ? '' : String(precioOferta).trim(),
    })
      .then(() => {
        setMensajeListo(quitar
          ? `"${p.nombre}" ya no tiene oferta en ${esLaMia ? 'tu' : 'este'} catálogo.`
          : `"${p.nombre}" quedó en oferta a ${formatearMoneda(Number(precioOferta))} en ${esLaMia ? 'tu' : 'este'} catálogo (solo aquí, no en el general).`);
        return onCambio();
      })
      .catch((err) => {
        setMensaje(`No se pudo guardar la oferta: ${err.message}`);
        throw err;
      })
      .finally(() => {
        setOcupadoId('');
        terminarCarga?.();
      });
  }

  const tus = esLaMia ? 'tus' : 'sus';
  const filtros = [
    { clave: 'todos', texto: 'Todos', cuantos: productos.length },
    { clave: 'catalogo', texto: 'Se pueden pedir', cuantos: conteo.catalogo },
    { clave: 'agotados', texto: 'Agotados', cuantos: conteo.agotado },
    { clave: 'ocultos', texto: 'Ocultos', cuantos: conteo.quitado + conteo.ocultoTienda },
  ];

  return (
    <div className="sucursal-tab">
      {/* Explicación de para qué es esta pestaña, como en las demás
          (Claudia, 2026-10-03: "que se me especifique igual que a las demás
          qué hace, para que no se confundan las que lo usen"). */}
      <p className="muted sucursal-explicacion">
        Aquí ves y decides qué sale en el catálogo de {esLaMia ? 'tu sucursal' : `la sucursal ${sucursal.nombre}`}: el que
        se abre con el link de abajo. Solo aparecen los productos de los que {esLaMia ? 'tienes' : 'tiene'} piezas a{' '}
        {esLaMia ? 'tu' : 'su'} nombre. Nada de lo que hagas aquí mueve piezas ni cambia el catálogo general: <strong>Quitar del catálogo</strong> solo lo esconde de este catálogo,{' '}
        <strong>Volver a poner</strong> lo regresa, <strong>Pedir más</strong> te lleva a Stock para pedirle piezas a quien
        tenga, y <strong>Borrar</strong> quita de la lista un producto del que ya no hay piezas.
      </p>
      {esAdminCentral && sucursales.length > 1 && (
        <label className="sucursal-selector">
          Ver la sucursal de:
          <select value={sucursal.id} onChange={(e) => { setElegidaId(e.target.value); setFiltro('todos'); setMensaje(''); setMensajeListo(''); }}>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}{String(s.id) === String(usuarioId) ? ' (yo)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="sucursal-tarjeta">
        <p className="sucursal-tarjeta-titulo">
          Catálogo de sucursal <strong>{sucursal.nombre}</strong>
        </p>
        <p className="muted sucursal-tarjeta-texto">
          Este es el link {esLaMia ? 'de tu catálogo' : 'de su catálogo'}: compártelo con las clientas. Solo enseña los
          productos de los que {esLaMia ? 'tienes' : 'tiene'} piezas a {esLaMia ? 'tu' : 'su'} nombre, y no deja pedir más
          de las que hay.
        </p>
        <LinkSucursal idUsuario={sucursal.id} />
        <p className="sucursal-tarjeta-texto">
          {sucursal.telefonoPedidos ? (
            <>📲 Los pedidos llegan al WhatsApp <strong>{sucursal.telefonoPedidos}</strong>.</>
          ) : (
            <span className="sucursal-aviso">
              ⚠ {esLaMia ? 'No tienes' : 'No tiene'} "Teléfono de pedidos" configurado: por ahora los pedidos de este
              catálogo llegan al WhatsApp del Admin Central. Se cambia en 👤 Usuarios → Editar.
            </span>
          )}
        </p>
      </div>

      <div className="pedidos-resumen-fila sucursal-filtros">
        <ResumenDeVentas
          ventas={ventasRecientes}
          nombre={sucursal.nombre}
          esMio={String(sucursal.id) === String(usuarioId)}
        />
        {filtros.map((f) => (
          <button
            key={f.clave}
            type="button"
            className={`resumen-btn ${filtro === f.clave ? 'activo' : ''}`}
            onClick={() => setFiltro(f.clave)}
          >
            <span>{f.texto}</span>
            <strong>{f.cuantos}</strong>
          </button>
        ))}
      </div>

      {mensaje && <p className="info-msg error">{mensaje}</p>}
      {mensajeListo && <p className="papelera-listo" role="status">✅ {mensajeListo}</p>}

      <div className="table-scroll">
        <table className="data-table sucursal-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Código</th>
              <th>Categoría</th>
              <th>
                <TextoConComentario
                  comentario={<>Piezas que {esLaMia ? 'tienes a tu nombre' : 'esta persona tiene a su nombre'} ahorita (las mismas de la columna Dueño en Stock).</>}
                >
                  {esLaMia ? 'Mis piezas' : 'Sus piezas'}
                </TextoConComentario>
              </th>
              {/* Claudia (2026-10-02/03): "en lugar de que digan Apartadas
                  que digan En proceso y que tenga un comentario haciéndole
                  hover over o click que diga que están apartadas
                  temporalmente en lo que se pagan o cancelan". */}
              <th>
                <TextoConComentario
                  comentario={
                    <>
                      <strong>Piezas apartadas temporalmente.</strong> Son de pedidos de este catálogo que ya están
                      "En proceso", en lo que se pagan o se cancelan. Mientras tanto no se ofrecen a nadie más. Si el
                      pedido se paga, se descuentan; si se cancela, quedan libres otra vez.
                    </>
                  }
                >
                  En proceso
                </TextoConComentario>
              </th>
              <th>
                <TextoConComentario
                  comentario={<>Lo que una clienta puede pedir ahorita en este catálogo: {esLaMia ? 'tus' : 'sus'} piezas menos las que están En proceso.</>}
                >
                  Para pedir
                </TextoConComentario>
              </th>
              <th>
                <TextoConComentario
                  comentario={
                    <>
                      <strong>La oferta de {esLaMia ? 'tu' : 'esta'} sucursal.</strong> Solo sale en el catálogo de{' '}
                      {esLaMia ? 'tu' : 'esta'} sucursal (no en el general), y el pedido se cobra a ese precio. Las ofertas del
                      catálogo general no salen aquí.
                    </>
                  }
                >
                  🔥 Oferta
                </TextoConComentario>
              </th>
              <th>
                <TextoConComentario
                  comentario={
                    <>
                      <strong>Visible:</strong> las clientas lo ven y lo pueden pedir. <strong>Agotado:</strong> lo ven,
                      pero sin piezas para pedir. <strong>Oculto:</strong> no sale en este catálogo.
                    </>
                  }
                >
                  En el catálogo
                </TextoConComentario>
              </th>
              <th>Acciones</th>
            </tr>
          </thead>
          {/* Renglón azul al tocarlo, igual que en Stock y Pedidos (Claudia,
              2026-10-03: "aquí falta la línea azul al presionar algo"). */}
          <tbody onClickCapture={marcarFilaActiva} onFocusCapture={marcarFilaActiva}>
            {visibles.map((p) => {
              const estado = estadoDe(p);
              const oculto = estaOculto(p);
              const ocupado = ocupadoId === p.productoId;
              const sinPiezas = Number(p.cantidad) <= 0;
              return (
                <tr key={p.productoId} className={oculto ? 'fila-oculta' : ''}>
                  {/* Foto y nombre juntos y a la izquierda, igual que en
                      Stock; un nombre largo se recorta con "…" (clic para
                      verlo completo). */}
                  <td className="sucursal-celda-nombre">
                    <div className="stock-nombre-con-foto">
                      {p.foto ? (
                        <img
                          src={p.foto}
                          alt=""
                          className="stock-thumb"
                          loading="lazy"
                          title="Clic para ver la foto en grande"
                          onClick={() => onVerFoto && onVerFoto(p.foto)}
                        />
                      ) : (
                        <div className="stock-thumb stock-thumb-vacia">Sin foto</div>
                      )}
                      <span className="stock-nombre-texto">
                        <CeldaTruncada texto={p.nombre} />
                      </span>
                    </div>
                  </td>
                  <td>{p.codigo ? <CeldaTruncada texto={p.codigo} /> : '—'}</td>
                  <td><CeldaTruncada texto={p.categoria} /></td>
                  <td>{p.cantidad}</td>
                  <td title={p.enProceso > 0 ? `${p.enProceso} pieza(s) apartada(s) temporalmente: en pedidos En proceso, en lo que se pagan o se cancelan` : undefined}>
                    {p.enProceso || 0}
                  </td>
                  <td><strong>{p.disponible}</strong></td>
                  <td className="sucursal-celda-oferta">
                    <OfertaDeSucursal
                      producto={p}
                      ocupado={ocupado}
                      onGuardar={(precioOferta) => cambiarOferta(p, precioOferta)}
                    />
                  </td>
                  <td>
                    {estado === 'catalogo' && (
                      <span className="sucursal-sello sucursal-sello-ok" title="Las clientas lo ven y lo pueden pedir">Visible</span>
                    )}
                    {estado === 'agotado' && (
                      <span className="sucursal-sello sucursal-sello-agotado" title="Las clientas lo ven, pero sale como Agotado: no hay piezas para pedir">Agotado</span>
                    )}
                    {estado === 'quitado' && (
                      <span className="sucursal-sello sucursal-sello-quitado" title={`${esLaMia ? 'Lo quitaste de tu catálogo' : 'Se quitó de su catálogo'}: no sale ahí hasta darle "Volver a poner"`}>Oculto</span>
                    )}
                    {estado === 'ocultoTienda' && (
                      <span
                        className="sucursal-sello sucursal-sello-quitado"
                        title="El producto (o su categoría) está oculto en toda la tienda, desde Stock u Orden del catálogo: no sale en ningún catálogo"
                      >
                        Oculto
                      </span>
                    )}
                    {estado === 'ocultoTienda' && <span className="campo-nota muted sucursal-nota-oculto">en toda la tienda</span>}
                  </td>
                  <td className="celda-acciones">
                    {confirmandoBorrarId === p.productoId ? (
                      <div className="acciones-producto">
                        <span className="campo-nota">¿Borrarlo de {esLaMia ? 'tu' : 'su'} lista?</span>
                        <button type="button" className="btn btn-eliminar btn-chip" disabled={ocupado} onClick={() => cambiar(p, 'borrar')}>
                          Sí, borrar
                        </button>
                        <button type="button" className="btn btn-secondary btn-chip" disabled={ocupado} onClick={() => setConfirmandoBorrarId('')}>
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="acciones-producto">
                        {estado !== 'quitado' && onPedirMas && (
                          <BotonConComentario
                            className={`btn btn-chip ${sinPiezas ? 'btn-editar' : 'btn-secondary'}`}
                            onClick={() => onPedirMas(p.productoId)}
                            comentario={<>Te lleva a este producto en <strong>Stock</strong>, donde puedes pedirle piezas a quien tenga. Aquí no cambia nada.</>}
                          >
                            Pedir más
                          </BotonConComentario>
                        )}
                        {estado === 'quitado' ? (
                          <BotonConComentario
                            className="btn btn-toggle btn-chip"
                            disabled={ocupado}
                            onClick={() => cambiar(p, 'poner')}
                            comentario={<>Vuelve a verse en {esLaMia ? 'tu' : 'su'} catálogo, tal como estaba.</>}
                          >
                            Volver a poner
                          </BotonConComentario>
                        ) : (
                          <BotonConComentario
                            className="btn btn-toggle btn-chip"
                            disabled={ocupado}
                            onClick={() => cambiar(p, 'quitar')}
                            comentario={
                              <>
                                <strong>Solo lo oculta de {esLaMia ? 'tu' : 'su'} catálogo.</strong> No borra el producto ni
                                mueve {tus} piezas, y en los demás catálogos sigue igual. Se regresa cuando quieras con
                                "Volver a poner".
                              </>
                            }
                          >
                            Quitar del catálogo
                          </BotonConComentario>
                        )}
                        {sinPiezas && (
                          <BotonConComentario
                            className="btn btn-eliminar btn-chip"
                            disabled={ocupado}
                            onClick={() => setConfirmandoBorrarId(p.productoId)}
                            comentario={
                              <>
                                Lo borra de <strong>esta lista</strong> porque ya no hay piezas. El producto sigue existiendo
                                en Stock; si después llegan piezas, vuelve a aparecer aquí solo.
                              </>
                            }
                          >
                            Borrar
                          </BotonConComentario>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {productos.length === 0 && (
          <p className="info-msg">
            {esLaMia ? 'Todavía no tienes' : 'Todavía no tiene'} productos a {esLaMia ? 'tu' : 'su'} nombre. En cuanto
            {esLaMia ? ' tengas' : ' tenga'} piezas de un producto (pestaña Stock, columna Dueño), aparece aquí y en el catálogo.
          </p>
        )}
        {productos.length > 0 && visibles.length === 0 && (
          <p className="info-msg">No hay productos en ese grupo.</p>
        )}
      </div>
    </div>
  );
}

const PAPELERA_MINIMIZADA_KEY = 'pyme_papelera_minimizada';

function BitacoraTab({ bitacora, papelera = [], papeleraDias = 30, esAdminCentral = false, sesionToken, onCambio, iniciarCarga, terminarCarga }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  // ---- Papelera (P1 de la lista de Claudia, 2026-10-02) ----
  // "Que haya una opción de restaurar cualquier cambio de la bitácora, como
  // una tipo papelera… con sus respectivos avisos… solo en el Admin
  // Central." Cada renglón de la Bitácora que todavía se puede deshacer
  // trae un botón "↩ Restaurar" (solo lo ve el Admin Central). Al darle
  // clic NO se restaura nada todavía: primero el servidor contesta, en
  // palabras, qué va a cambiar y de qué hay que tener cuidado; se enseña en
  // una ventana y solo se aplica si se confirma.
  const papeleraPorId = {};
  papelera.forEach((p) => { papeleraPorId[String(p.ID)] = p; });
  const hayPapelera = esAdminCentral;
  const [soloRestaurables, setSoloRestaurables] = useState(false);
  // Claudia (2026-10-02): "que el mensaje se pueda minimizar, está muy largo
  // el de la papelera". La explicación se puede encoger a una pastillita
  // ("🗑️ Papelera · N") y se recuerda en este navegador.
  const [papeleraMinimizada, setPapeleraMinimizada] = useState(() => {
    try {
      return localStorage.getItem(PAPELERA_MINIMIZADA_KEY) === '1';
    } catch {
      return false;
    }
  });
  function alternarPapeleraMinimizada() {
    setPapeleraMinimizada((antes) => {
      const ahora = !antes;
      try {
        localStorage.setItem(PAPELERA_MINIMIZADA_KEY, ahora ? '1' : '0');
      } catch {
        // Sin almacenamiento: solo no se recuerda; minimizar sigue funcionando.
      }
      return ahora;
    });
  }
  // { renglon, cargando, plan: { sePuede, motivo, lineas, avisos } | null, error }
  const [restaurando, setRestaurando] = useState(null);
  const [confirmoRestaurar, setConfirmoRestaurar] = useState(false);
  const [aplicandoRestaurar, setAplicandoRestaurar] = useState(false);
  const [avisoRestaurado, setAvisoRestaurado] = useState('');

  function abrirRestaurar(renglon) {
    setAvisoRestaurado('');
    setConfirmoRestaurar(false);
    setRestaurando({ renglon, cargando: true, plan: null, error: '' });
    restaurarCambio({ sesionToken, papeleraId: renglon.ID, soloRevisar: true })
      .then((plan) => {
        setRestaurando((actual) => (actual && actual.renglon.ID === renglon.ID ? { renglon, cargando: false, plan, error: '' } : actual));
      })
      .catch((err) => {
        setRestaurando((actual) => (actual && actual.renglon.ID === renglon.ID ? { renglon, cargando: false, plan: null, error: err.message } : actual));
      });
  }

  function confirmarRestaurar() {
    if (!restaurando || !restaurando.plan || !restaurando.plan.sePuede) return;
    if (restaurando.plan.avisos.length > 0 && !confirmoRestaurar) return;
    const renglon = restaurando.renglon;
    setAplicandoRestaurar(true);
    iniciarCarga?.();
    restaurarCambio({ sesionToken, papeleraId: renglon.ID })
      .then(() => {
        setRestaurando(null);
        setAvisoRestaurado(`Listo: se restauró "${renglon.Accion}" (el del ${formatearFechaHora(renglon.Fecha)}). Quedó anotado en la Bitácora como "Restaurar cambio".`);
        return onCambio?.();
      })
      .catch((err) => {
        setRestaurando((actual) => (actual ? { ...actual, error: err.message } : actual));
      })
      .finally(() => {
        setAplicandoRestaurar(false);
        terminarCarga?.();
      });
  }
  // Filtros nuevos (2026-10-01, pendiente P7 de Claudia: "que la bitácora
  // haya un filtro para filtrar por usuarios u acciones"). Las listas de
  // opciones se arman solas con lo que de verdad existe en la Bitácora, así
  // que nunca hay que darlas de alta a mano.
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [filtroAccion, setFiltroAccion] = useState('');
  const [buscarDetalle, setBuscarDetalle] = useState('');

  const bitacoraOrdenada = bitacora.slice().reverse();

  function opcionesUnicas(campo) {
    const vistos = new Map(); // clave normalizada -> texto tal como aparece la primera vez
    bitacoraOrdenada.forEach((b) => {
      const texto = String(b[campo] || '').trim();
      if (!texto) return;
      const clave = normalizarParaFiltro(texto);
      if (!vistos.has(clave)) vistos.set(clave, texto);
    });
    return Array.from(vistos.entries())
      .map(([clave, texto]) => ({ clave, texto }))
      .sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
  }
  // (2026-10-09) El filtro junta a cada cuenta con su nombre de HOY (ej.
  // "CLAUDIA" y "MARY CRUZ" eran la misma cuenta renombrada). El servidor
  // manda "UsuarioActual"; uno de antes no lo manda y se usa "Usuario".
  const usuarioDeHoy = (b) => String(b.UsuarioActual || b.Usuario || '');
  const opcionesUsuario = (() => {
    const vistos = new Map();
    bitacoraOrdenada.forEach((b) => {
      const texto = usuarioDeHoy(b).trim();
      if (!texto) return;
      const clave = normalizarParaFiltro(texto);
      if (!vistos.has(clave)) vistos.set(clave, texto);
    });
    return Array.from(vistos.entries())
      .map(([clave, texto]) => ({ clave, texto }))
      .sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
  })();
  const opcionesAccion = opcionesUnicas('Accion');

  const textoBuscado = normalizarParaFiltro(buscarDetalle);
  const esRestaurable = (b) => {
    const entrada = papeleraPorId[String(b.ID)];
    return !!entrada && entrada.Estado !== 'Restaurado';
  };
  const cuantosRestaurables = hayPapelera ? bitacoraOrdenada.filter(esRestaurable).length : 0;
  const bitacoraFiltrada = bitacoraOrdenada.filter((b) => (
    movimientoEnRangoDeFecha(b, desde, hasta) &&
    (!filtroUsuario || normalizarParaFiltro(usuarioDeHoy(b)) === filtroUsuario) &&
    (!filtroAccion || normalizarParaFiltro(b.Accion) === filtroAccion) &&
    (!textoBuscado || normalizarParaFiltro(conEtiquetasDeEstado(b.Detalle)).includes(textoBuscado)) &&
    (!(hayPapelera && soloRestaurables) || esRestaurable(b))
  ));

  // P14: de los movimientos que pasan los filtros, cuántos se dibujan (los
  // más recientes primero). Los filtros y el buscador siguen buscando en
  // TODA la Bitácora.
  const [limiteFilas, setLimiteFilas] = useLimiteFilas('bitacora');
  const bitacoraVisible = recortarFilas(bitacoraFiltrada, limiteFilas);

  const hayFiltroFechas = !!(desde || hasta);
  const hayOtrosFiltros = !!(filtroUsuario || filtroAccion || buscarDetalle || (hayPapelera && soloRestaurables));

  function limpiarFiltro() {
    setDesde('');
    setHasta('');
  }
  function limpiarTodo() {
    limpiarFiltro();
    setFiltroUsuario('');
    setFiltroAccion('');
    setBuscarDetalle('');
    setSoloRestaurables(false);
  }

  return (
    <div className="bitacora-tab">
      <div className="filtro-fechas">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label>
          Usuario
          <select value={filtroUsuario} onChange={(e) => setFiltroUsuario(e.target.value)}>
            <option value="">Todos</option>
            {opcionesUsuario.map((o) => (
              <option key={o.clave} value={o.clave}>{o.texto}</option>
            ))}
          </select>
        </label>
        <label>
          Acción
          <select value={filtroAccion} onChange={(e) => setFiltroAccion(e.target.value)}>
            <option value="">Todas</option>
            {opcionesAccion.map((o) => (
              <option key={o.clave} value={o.clave}>{o.texto}</option>
            ))}
          </select>
        </label>
        <label>
          Buscar en el detalle
          <input
            type="text"
            value={buscarDetalle}
            onChange={(e) => setBuscarDetalle(e.target.value)}
            placeholder="Ej. nombre de producto o cliente"
          />
        </label>
        {hayFiltroFechas && !hayOtrosFiltros && (
          <button type="button" className="btn btn-secondary btn-small" onClick={limpiarFiltro}>
            Quitar filtro de fechas
          </button>
        )}
        {hayOtrosFiltros && (
          <button type="button" className="btn btn-secondary btn-small" onClick={limpiarTodo}>
            Quitar todos los filtros
          </button>
        )}
      </div>

      {/* Papelera: explicación corta + filtro, solo para el Admin Central. */}
      {hayPapelera && (
        <div className={`papelera-barra${papeleraMinimizada ? ' papelera-barra-mini' : ''}`}>
          {papeleraMinimizada ? (
            <button
              type="button"
              className="papelera-pastilla"
              onClick={alternarPapeleraMinimizada}
              aria-expanded="false"
              title="Ver la explicación de la papelera"
            >
              🗑️ Papelera · <strong>{cuantosRestaurables}</strong> ▾
            </button>
          ) : (
            <span className="papelera-texto">
              🗑️ <strong>Papelera:</strong> puedes deshacer los cambios de productos, stock y catálogo de los últimos{' '}
              {papeleraDias} días con el botón <strong>↩ Restaurar</strong> de su renglón. Hoy hay{' '}
              <strong>{cuantosRestaurables}</strong> que se pueden restaurar.
            </span>
          )}
          <label className="papelera-filtro">
            <input type="checkbox" checked={soloRestaurables} onChange={(e) => setSoloRestaurables(e.target.checked)} />
            {papeleraMinimizada ? 'Solo lo restaurable' : 'Ver solo lo que se puede restaurar'}
          </label>
          {!papeleraMinimizada && (
            <button
              type="button"
              className="papelera-minimizar"
              onClick={alternarPapeleraMinimizada}
              aria-expanded="true"
              title="Minimizar este mensaje"
            >
              ▴ Minimizar
            </button>
          )}
        </div>
      )}
      {avisoRestaurado && <p className="papelera-listo" role="status">✅ {avisoRestaurado}</p>}

      <p className="muted">
        {textoRangoFechas(desde, hasta)} · {bitacoraFiltrada.length} cambio{bitacoraFiltrada.length === 1 ? '' : 's'}
        {hayOtrosFiltros ? ' con los filtros de arriba' : ''}
      </p>

      <div className="table-scroll">
        <table className="data-table bitacora-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Detalle</th>
              {hayPapelera && <th>Restaurar</th>}
            </tr>
          </thead>
          <tbody onClickCapture={marcarFilaActiva} onFocusCapture={marcarFilaActiva}>
            {bitacoraVisible.map((b) => (
              <tr key={b.ID}>
                <td>{formatearFechaHora(b.Fecha)}</td>
                <td>
                  {usuarioDeHoy(b) || '—'}
                  {b.UsuarioActual && b.Usuario && normalizarParaFiltro(b.UsuarioActual) !== normalizarParaFiltro(b.Usuario) && (
                    <span className="muted bitacora-nombre-antes" title="Así se llamaba esa cuenta cuando se hizo este cambio"> (antes {b.Usuario})</span>
                  )}
                </td>
                <td>{b.Accion || '—'}</td>
                {/* Arreglo (2026-09-28, reportado por Claudia con captura: "en la
                    bitacora no soy capaz de ver bien que cambios agregué").
                    "Detalle" puede traer un texto largo (varios campos
                    cambiados, cada uno con su valor antes/después) que antes
                    se cortaba en una sola línea horizontal sin forma de
                    leerlo completo (la tabla entera usa "white-space:
                    nowrap"). Reusamos "CeldaTruncada" — el mismo componente
                    de "clic para ver completo" que ya se usa en Producto/
                    Categoría/Código de la pestaña Stock — para que cada
                    línea se vea compacta por default y, con un clic, se
                    pueda leer el detalle completo envuelto en varias líneas
                    dentro de la misma celda. */}
                <td><CeldaTruncada texto={b.Detalle ? conEtiquetasDeEstado(b.Detalle) : '—'} /></td>
                {hayPapelera && (
                  <td className="papelera-celda">
                    {(() => {
                      const entrada = papeleraPorId[String(b.ID)];
                      if (!entrada) return <span className="muted">—</span>;
                      if (entrada.Estado === 'Restaurado') {
                        return (
                          <span className="papelera-restaurado" title={entrada.FechaRestaurado ? `Restaurado el ${formatearFechaHora(entrada.FechaRestaurado)}` : undefined}>
                            ✔ Restaurado{entrada.RestauradoPor ? ` por ${entrada.RestauradoPor}` : ''}
                          </span>
                        );
                      }
                      return (
                        <button type="button" className="btn btn-secondary btn-small papelera-btn" onClick={() => abrirRestaurar(b)}>
                          ↩ Restaurar
                        </button>
                      );
                    })()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {bitacoraFiltrada.length === 0 && (
          <p className="info-msg">No hay cambios registrados con los filtros de arriba.</p>
        )}
      </div>
      <BarraFilas
        total={bitacoraFiltrada.length}
        visibles={bitacoraVisible.length}
        limite={limiteFilas}
        onCambiar={setLimiteFilas}
        nombre="cambios"
      />

      {/* Ventana de confirmación de la Papelera. Primero se ve QUÉ va a
          pasar (lo calcula el servidor con los datos de este momento); no se
          cambia nada hasta darle "Restaurar". */}
      {restaurando && (
        <div className="modal-overlay" onClick={() => { if (!aplicandoRestaurar) setRestaurando(null); }}>
          <div className="modal-box modal-box-papelera" onClick={(e) => e.stopPropagation()}>
            <h3>↩ Restaurar este cambio</h3>
            <div className="papelera-cambio">
              <p>
                <strong>{restaurando.renglon.Accion || 'Cambio'}</strong> · {formatearFechaHora(restaurando.renglon.Fecha)} ·{' '}
                {restaurando.renglon.Usuario || '—'}
              </p>
              <p className="muted papelera-cambio-detalle">{conEtiquetasDeEstado(restaurando.renglon.Detalle || '')}</p>
            </div>

            {restaurando.cargando && <p className="muted">Revisando qué pasaría al restaurarlo…</p>}

            {restaurando.plan && !restaurando.plan.sePuede && (
              <div className="aviso-peligro">
                🚫 Este cambio no se puede restaurar: {restaurando.plan.motivo}
              </div>
            )}

            {restaurando.plan && restaurando.plan.sePuede && (
              <>
                <p className="papelera-subtitulo">Esto es lo que va a pasar:</p>
                <ul className="papelera-lineas">
                  {restaurando.plan.lineas.map((linea, i) => <li key={i}>{linea}</li>)}
                </ul>
                {restaurando.plan.avisos.length > 0 && (
                  <div className="aviso-peligro">
                    <strong>⚠️ Antes de restaurar, toma en cuenta:</strong>
                    <ul className="papelera-avisos">
                      {restaurando.plan.avisos.map((aviso, i) => <li key={i}>{aviso}</li>)}
                    </ul>
                    <label className="modal-opcion-checkbox">
                      <input type="checkbox" checked={confirmoRestaurar} onChange={(e) => setConfirmoRestaurar(e.target.checked)} />
                      Sí, entiendo, quiero restaurarlo.
                    </label>
                  </div>
                )}
                <p className="muted">Lo demás no se toca. Restaurar queda anotado en la Bitácora con tu nombre.</p>
              </>
            )}

            {restaurando.error && <p className="info-msg error">Error: {restaurando.error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" disabled={aplicandoRestaurar} onClick={() => setRestaurando(null)}>
                {restaurando.plan && !restaurando.plan.sePuede ? 'Cerrar' : 'Cancelar'}
              </button>
              {restaurando.plan && restaurando.plan.sePuede && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={aplicandoRestaurar || (restaurando.plan.avisos.length > 0 && !confirmoRestaurar)}
                  onClick={confirmarRestaurar}
                >
                  {aplicandoRestaurar ? 'Restaurando…' : '↩ Restaurar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Gestión de usuarios (pestaña "👤 Usuarios", solo Administrador) ----
// Aquí se dan de alta las cuentas de tus vendedores/empleados (y otros
// Administradores, si hace falta), se les cambia la contraseña, se edita su
// nombre/rol, y se activan o inhabilitan sin perder su historial en la
// Bitácora. El backend vuelve a revisar todo esto por su cuenta — esta
// pestaña ni siquiera se le muestra a un Vendedor.
// Funcionalidad 1 (Admin Central, 2026-09): mismo tipo de valor "sí/no" que
// "Activo" (booleano real o texto "TRUE"/"SI"), así que reutilizamos
// `esActivo` para leer la columna "EsAdminCentral" — el nombre de la
// función no encaja perfecto pero la lógica es exactamente la misma.
function esFilaAdminCentral(u) {
  return esActivo(u.EsAdminCentral);
}

// Un Admin ADICIONAL (Administrador normal, sin la bandera EsAdminCentral)
// no puede tocar el Rol ni el Estado (inhabilitar/habilitar) de NINGÚN otro
// Administrador — ni del Admin Central ni de otro Admin adicional. Eso solo
// lo puede hacer el Admin Central. Al Admin Central, además, nadie (ni él
// mismo desde el panel) le puede tocar su Rol ni su Estado. Se usa para
// deshabilitar en pantalla justo lo que el backend de todos modos rechazaría.
function noPuedeTocarAdminDe(u, soyAdminCentral) {
  if (esFilaAdminCentral(u)) return true;
  return u.Rol === 'Administrador' && !soyAdminCentral;
}

// Mismas reglas que revisa el servidor (Code.gs, "usuarioValidoParaLogin_"):
// de 3 a 40 caracteres, sin espacios.
function usuarioValidoParaLogin(texto) {
  const t = String(texto || '').trim();
  return t.length >= 3 && t.length <= 40 && !/\s/.test(t);
}

function UsuariosTab({ usuarios, sesionToken, soyAdminCentral, onCambio, iniciarCarga, terminarCarga }) {
  const [mensaje, setMensaje] = useState('');

  const [agregando, setAgregando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevaContrasena, setNuevaContrasena] = useState('');
  const [nuevoRol, setNuevoRol] = useState('Vendedor');
  // Teléfono de pedidos (2026-09-30, pedido por Claudia): el número de
  // WhatsApp al que le llegan los pedidos de esta persona — hoy solo se usa
  // el de quien esté marcado 👑 Admin Central (para el catálogo Global),
  // pero ya se guarda por persona para cuando existan los catálogos
  // personales. A propósito opcional: se puede dejar vacío.
  const [nuevoTelefonoPedidos, setNuevoTelefonoPedidos] = useState('');
  // (2026-10-09) Zona de la sucursal de esta persona (la ve la clienta al
  // escoger sucursal en el catálogo general).
  const [nuevaZona, setNuevaZona] = useState('');
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);

  const [editando, setEditando] = useState(null); // usuario completo, o null
  const [editNombre, setEditNombre] = useState('');
  // Pendiente P17 de Claudia (2026-10-01): el Admin Central ya puede
  // cambiar también el "usuario" con el que una cuenta inicia sesión.
  const [editUsuario, setEditUsuario] = useState('');
  const [editRol, setEditRol] = useState('Vendedor');
  const [editTelefonoPedidos, setEditTelefonoPedidos] = useState('');
  const [editZona, setEditZona] = useState('');
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  const [cambiandoClave, setCambiandoClave] = useState(null); // usuario, o null
  const [claveNueva, setClaveNueva] = useState('');
  const [guardandoClave, setGuardandoClave] = useState(false);

  const [cambiandoEstadoId, setCambiandoEstadoId] = useState('');

  function abrirAgregar() {
    setNuevoNombre('');
    setNuevoUsuario('');
    setNuevaContrasena('');
    setNuevoRol('Vendedor');
    setNuevoTelefonoPedidos('');
    setNuevaZona('');
    setMensaje('');
    setAgregando(true);
  }

  function confirmarAgregar(e) {
    e.preventDefault();
    if (!nuevoNombre.trim() || !nuevoUsuario.trim() || nuevaContrasena.length < 4) return;
    setGuardandoNuevo(true);
    setMensaje('');
    // Pedido de Claudia (2026-09-29): el círculo de carga (pacman) también
    // debe verse aquí, igual que en Stock/Pedidos — antes solo se veía el
    // botón deshabilitado, sin el indicador global.
    iniciarCarga?.();
    crearUsuario({
      sesionToken,
      nombre: nuevoNombre.trim(),
      usuario: nuevoUsuario.trim(),
      contrasena: nuevaContrasena,
      rol: nuevoRol,
      telefonoPedidos: nuevoTelefonoPedidos.trim(),
      zona: nuevaZona.trim(),
    })
      .then(() => {
        setAgregando(false);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al crear el usuario: ${err.message}`))
      .finally(() => {
        setGuardandoNuevo(false);
        terminarCarga?.();
      });
  }

  function abrirEditar(u) {
    setEditando(u);
    setEditNombre(u.Nombre || '');
    setEditUsuario(u.Usuario || '');
    setEditRol(u.Rol || 'Vendedor');
    setEditTelefonoPedidos(u.TelefonoPedidos || '');
    setEditZona(u.Zona || '');
    setMensaje('');
  }

  function confirmarEditar(e) {
    e.preventDefault();
    if (!editando || !editNombre.trim()) return;
    const usuarioLimpio = editUsuario.trim();
    const cambiaUsuario = soyAdminCentral && usuarioLimpio !== String(editando.Usuario || '').trim();
    if (cambiaUsuario && !usuarioValidoParaLogin(usuarioLimpio)) {
      setMensaje('El usuario debe tener de 3 a 40 caracteres y sin espacios.');
      return;
    }
    setGuardandoEdit(true);
    setMensaje('');
    iniciarCarga?.();
    actualizarUsuario({
      sesionToken,
      usuarioId: editando.ID,
      nombre: editNombre.trim(),
      rol: editRol,
      telefonoPedidos: editTelefonoPedidos.trim(),
      zona: editZona.trim(),
      // Solo se manda si de verdad cambió (y solo el Admin Central puede).
      ...(cambiaUsuario ? { usuario: usuarioLimpio } : {}),
    })
      .then(() => {
        setEditando(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al editar el usuario: ${err.message}`))
      .finally(() => {
        setGuardandoEdit(false);
        terminarCarga?.();
      });
  }

  function abrirCambiarClave(u) {
    setCambiandoClave(u);
    setClaveNueva('');
    setMensaje('');
  }

  function confirmarCambiarClave(e) {
    e.preventDefault();
    if (!cambiandoClave || claveNueva.length < 4) return;
    setGuardandoClave(true);
    setMensaje('');
    iniciarCarga?.();
    cambiarContrasenaUsuario({ sesionToken, usuarioId: cambiandoClave.ID, contrasenaNueva: claveNueva })
      .then(() => {
        setCambiandoClave(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al cambiar la contraseña: ${err.message}`))
      .finally(() => {
        setGuardandoClave(false);
        terminarCarga?.();
      });
  }

  // Catálogos por sucursal (2026-10-02): interruptor "Catálogo propio".
  const [cambiandoCatalogoId, setCambiandoCatalogoId] = useState('');
  function toggleCatalogoPropio(u) {
    setCambiandoCatalogoId(u.ID);
    setMensaje('');
    iniciarCarga?.();
    actualizarCatalogoPropio({ sesionToken, usuarioId: u.ID, activo: !u.CatalogoPropio })
      .then(() => onCambio())
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => {
        setCambiandoCatalogoId('');
        terminarCarga?.();
      });
  }

  function toggleActivo(u) {
    const activo = esActivo(u.Activo);
    setCambiandoEstadoId(u.ID);
    setMensaje('');
    iniciarCarga?.();
    const promesa = activo
      ? inhabilitarUsuario({ sesionToken, usuarioId: u.ID })
      : habilitarUsuario({ sesionToken, usuarioId: u.ID });
    promesa
      .then(() => onCambio())
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => {
        setCambiandoEstadoId('');
        terminarCarga?.();
      });
  }

  return (
    <div className="usuarios-tab">
            <p className="muted">
        Aquí das de alta a tus vendedores/empleados para que puedan entrar al Dashboard con su
        propio usuario y contraseña. Un "Vendedor" puede administrar productos, stock, pedidos y
        categorías, pero no ve la Bitácora, el Estado de cuenta, ni esta pestaña. El sello
        "👑 Admin Central" marca la cuenta que nadie más puede inhabilitar ni degradar de rol — ni
        siquiera otro Administrador; solo el propio Admin Central puede tocar el Rol o el Estado
        de otro Administrador (a un Vendedor lo puede editar cualquier Administrador, como antes).
      </p>

      <div className="orden-barra-superior">
        <button type="button" className="btn btn-secondary" onClick={abrirAgregar}>
          + Agregar usuario
        </button>
      </div>

      {mensaje && <p className="info-msg error">{mensaje}</p>}

      <div className="table-scroll">
        <table className="data-table usuarios-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Tel. de pedidos</th>
              <th title="La ve la clienta al escoger de qué sucursal pide en el catálogo general">Zona</th>
              <th title="Con el interruptor prendido, esa persona tiene su propio catálogo, con su propio link">Catálogo propio</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
                      {usuarios.map((u) => {
              const activo = esActivo(u.Activo);
              const bloqueado = noPuedeTocarAdminDe(u, soyAdminCentral);
              return (
                <tr key={u.ID} className={activo ? '' : 'fila-oculta'}>
                  <td>
                    {u.Nombre}
                    {esFilaAdminCentral(u) && (
                      <span className="badge-admin-central" title="Nadie puede inhabilitarlo ni cambiarle el rol">
                        👑 Admin Central
                      </span>
                    )}
                  </td>
                  <td>{u.Usuario}</td>
                  <td>{u.Rol}</td>
                  {/* Teléfono de pedidos (2026-09-30): el número de WhatsApp
                      al que le llegan los pedidos de esta persona — hoy solo
                      se usa el de 👑 Admin Central, para el catálogo Global.
                      Se muestra aquí para que sea fácil ver/confirmar de un
                      vistazo cuál tiene configurado cada quien. */}
                  <td>{u.TelefonoPedidos || <span className="muted">— sin configurar —</span>}</td>
                  <td data-zona-usuario>{u.Zona || <span className="muted">— sin zona —</span>}</td>
                  {/* Catálogos por sucursal (2026-10-02): interruptor por
                      persona. Prendido = esa persona tiene su catálogo
                      ("CATÁLOGO DE SUCURSAL <NOMBRE>") con su propio link. */}
                  <td className="usuarios-celda-catalogo">
                    <label
                      className="interruptor"
                      title={
                        esFilaAdminCentral(u) && !soyAdminCentral
                          ? 'Solo el Admin Central puede cambiar su propia cuenta'
                          : u.CatalogoPropio
                            ? 'Apagar su catálogo: su link deja de funcionar'
                            : 'Prender su catálogo: tendrá su propio link'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={!!u.CatalogoPropio}
                        disabled={cambiandoCatalogoId === u.ID || (esFilaAdminCentral(u) && !soyAdminCentral)}
                        onChange={() => toggleCatalogoPropio(u)}
                      />
                      <span className="interruptor-riel" aria-hidden="true" />
                      <span className="interruptor-texto">{u.CatalogoPropio ? 'Prendido' : 'Apagado'}</span>
                    </label>
                    {u.CatalogoPropio && activo && <LinkSucursal idUsuario={u.ID} compacto />}
                    {u.CatalogoPropio && !activo && (
                      <span className="campo-nota muted">Cuenta inhabilitada: su link no funciona.</span>
                    )}
                    {u.CatalogoPropio && activo && !u.TelefonoPedidos && (
                      <span className="campo-nota sucursal-aviso">
                        ⚠ Sin teléfono de pedidos: sus pedidos llegan al del Admin Central.
                      </span>
                    )}
                  </td>
                  <td>{activo ? 'Activo' : 'Inhabilitado'}</td>
                                 <td className="celda-acciones">
                    {esFilaAdminCentral(u) && !soyAdminCentral ? (
                      <span
                        className="muted campo-nota"
                        title="Solo el Admin Central puede editar, cambiar la contraseña o inhabilitar esta cuenta"
                      >
                        🔒 Solo el Admin Central puede administrar esta cuenta
                      </span>
                    ) : (
                      <div className="acciones-producto">
                        <button type="button" className="btn btn-editar btn-chip" onClick={() => abrirEditar(u)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-chip"
                          onClick={() => abrirCambiarClave(u)}
                        >
                          Cambiar contraseña
                        </button>
                        {!esFilaAdminCentral(u) && (
                          <button
                            type="button"
                            className="btn btn-toggle btn-chip"
                            onClick={() => toggleActivo(u)}
                            disabled={cambiandoEstadoId === u.ID || bloqueado}
                            title={bloqueado ? 'Solo el Admin Central puede inhabilitar/habilitar a otro Administrador' : ''}
                          >
                            {activo ? 'Inhabilitar' : 'Habilitar'}
                          </button>
                        )}
                      </div>
                    )}
                  </td>   
                </tr>
              );
            })} 
          </tbody>
        </table>
        {usuarios.length === 0 && <p className="info-msg">Todavía no hay usuarios registrados.</p>}
      </div>

      {agregando && (
        <div className="modal-overlay" onClick={() => setAgregando(false)}>
          <form className="modal-box" onClick={(e) => e.stopPropagation()} onSubmit={confirmarAgregar}>
            <h3>Agregar usuario</h3>
            <label className="modal-field">
              Nombre
              <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} autoFocus required />
            </label>
            <label className="modal-field">
              Usuario (para iniciar sesión)
              <input value={nuevoUsuario} onChange={(e) => setNuevoUsuario(e.target.value)} required />
            </label>
            <label className="modal-field">
              Contraseña
              <CampoContrasena
                value={nuevaContrasena}
                onChange={(e) => setNuevaContrasena(e.target.value)}
                minLength={4}
                required
              />
            </label>
            <label className="modal-field">
              Rol
              <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value)}>
                <option value="Vendedor">Vendedor</option>
                <option value="Administrador">Administrador</option>
              </select>
            </label>
            <label className="modal-field">
              Teléfono de pedidos (opcional)
              <input
                value={nuevoTelefonoPedidos}
                onChange={(e) => setNuevoTelefonoPedidos(e.target.value)}
                placeholder="Ej. 521XXXXXXXXXX"
              />
              <span className="muted campo-nota">
                Número de WhatsApp (con código de país, sin espacios ni signos) al que le
                llegarían los pedidos de esta persona. Por ahora solo se usa el de quien esté
                marcado 👑 Admin Central, para el catálogo Global.
              </span>
            </label>
            <label className="modal-field">
              Zona de su sucursal (opcional)
              <input
                value={nuevaZona}
                onChange={(e) => setNuevaZona(e.target.value.slice(0, 80))}
                placeholder="Ej. Tlaxcala centro, o Monterrey - San Nicolás"
                data-campo-zona
              />
              <span className="muted campo-nota">
                En el catálogo general, la clienta la ve al escoger de qué sucursal pide (junto con cuántas piezas tiene).
              </span>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAgregando(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={guardandoNuevo}>
                {guardandoNuevo ? 'Creando…' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

           {editando && (
        <div className="modal-overlay" onClick={() => setEditando(null)}>
          <form className="modal-box" onClick={(e) => e.stopPropagation()} onSubmit={confirmarEditar}>
            <h3>Editar usuario</h3>
            <label className="modal-field">
              Nombre
              <input value={editNombre} onChange={(e) => setEditNombre(e.target.value)} autoFocus required />
            </label>
            {/* Pendiente P17 (2026-10-01): el "usuario" es con lo que esta
                persona inicia sesión (no su nombre). Solo el Admin Central
                lo puede cambiar; el servidor revisa que no esté repetido. */}
            {soyAdminCentral ? (
              <label className="modal-field">
                Usuario (para iniciar sesión)
                <input
                  value={editUsuario}
                  onChange={(e) => setEditUsuario(e.target.value.replace(/\s/g, ''))}
                  autoComplete="off"
                  minLength={3}
                  maxLength={40}
                  required
                />
                {editUsuario.trim() !== String(editando.Usuario || '').trim() && (
                  <span className="muted campo-nota">
                    ⚠️ Desde que guardes, esta persona tendrá que entrar con "{editUsuario.trim()}" en vez de
                    "{editando.Usuario}". Su contraseña no cambia. Avísale.
                  </span>
                )}
              </label>
            ) : (
              <p className="muted campo-nota">Usuario para iniciar sesión: <strong>{editando.Usuario}</strong> (solo el Admin Central lo puede cambiar).</p>
            )}
            <label className="modal-field">
              Rol
              <select
                value={editRol}
                onChange={(e) => setEditRol(e.target.value)}
                disabled={editando && noPuedeTocarAdminDe(editando, soyAdminCentral)}
              >
                <option value="Vendedor">Vendedor</option>
                <option value="Administrador">Administrador</option>
              </select>
              {editando && noPuedeTocarAdminDe(editando, soyAdminCentral) && (
                <span className="muted campo-nota">
                  {esFilaAdminCentral(editando)
                    ? 'El rol del Admin Central no se puede cambiar.'
                    : 'Solo el Admin Central puede cambiarle el rol a otro Administrador.'}
                </span>
              )}
            </label>
            <label className="modal-field">
              Teléfono de pedidos (opcional)
              <input
                value={editTelefonoPedidos}
                onChange={(e) => setEditTelefonoPedidos(e.target.value)}
                placeholder="Ej. 521XXXXXXXXXX"
              />
              <span className="muted campo-nota">
                Número de WhatsApp (con código de país, sin espacios ni signos) al que le
                llegarían los pedidos de esta persona. Por ahora solo se usa el de quien esté
                marcado 👑 Admin Central, para el catálogo Global — cambiarlo aquí y guardar es
                todo lo que hace falta, sin tocar Vercel ni volver a desplegar nada.
              </span>
            </label>
            <label className="modal-field">
              Zona de su sucursal (opcional)
              <input
                value={editZona}
                onChange={(e) => setEditZona(e.target.value.slice(0, 80))}
                placeholder="Ej. Tlaxcala centro, o Monterrey - San Nicolás"
                data-campo-zona
              />
              <span className="muted campo-nota">
                En el catálogo general, la clienta la ve al escoger de qué sucursal pide (junto con cuántas piezas tiene).
              </span>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditando(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={guardandoEdit}>
                {guardandoEdit ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </div>
      )}

     
      {cambiandoClave && (  
        <div className="modal-overlay" onClick={() => setCambiandoClave(null)}>
          <form className="modal-box" onClick={(e) => e.stopPropagation()} onSubmit={confirmarCambiarClave}>
            <h3>Cambiar contraseña de {cambiandoClave.Nombre}</h3>
            <label className="modal-field">
              Contraseña nueva
              <CampoContrasena
                value={claveNueva}
                onChange={(e) => setClaveNueva(e.target.value)}
                minLength={4}
                autoFocus
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCambiandoClave(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={guardandoClave}>
                {guardandoClave ? 'Guardando…' : 'Cambiar contraseña'}
              </button>
            </div>
                 </form>
        </div>
      )}
    </div>
  );
}

// ---- Permisos de pestañas (pestaña "🔐 Permisos", Funcionalidad 1 Paso 2,
// 2026-09) — visible SOLO para el Admin Central; ni siquiera un
// Administrador adicional la ve ni puede llegar a ella. Deja: (1) una
// tabla Rol × Pestaña con casillas para el default de cada Rol, y (2) una
// lista de excepciones por persona (dar o quitar UNA pestaña puntual a
// alguien en concreto, sin tocar el default de su Rol). ----
function PermisosTab({ sesionToken, usuarios, iniciarCarga, terminarCarga }) {
  const [pestanas, setPestanas] = useState([]);
  const [rolDefaults, setRolDefaults] = useState({ Administrador: {}, Vendedor: {} });
  const [overrides, setOverrides] = useState([]);
  // Etapa 4, rediseño del candado de Pedidos (2026-09-28): permiso especial
  // aparte de las pestañas normales (ver comentario junto a
  // CLAVE_CANDADO_PEDIDOS arriba) — se guarda y se muestra por separado,
  // aunque reutiliza exactamente las mismas acciones/tabla de abajo.
  const [permisoCandadoPedidos, setPermisoCandadoPedidos] = useState({ clave: CLAVE_CANDADO_PEDIDOS, etiqueta: 'Editar pedidos de otro dueño (con candado)' });
  // Candado nuevo, aparte (2026-09-30): igual que el de arriba, pero para
  // el permiso especial de marcar pedidos como "Reembolsado".
  const [permisoCandadoReembolsos, setPermisoCandadoReembolsos] = useState({
    clave: CLAVE_CANDADO_REEMBOLSOS,
    etiqueta: 'Marcar pedidos como Reembolsado (con candado)',
  });
  const [permisoOrdenGeneral, setPermisoOrdenGeneral] = useState({ clave: CLAVE_ORDEN_GENERAL, etiqueta: 'Acomodar el catálogo general' });
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [celdaGuardando, setCeldaGuardando] = useState(''); // "Rol:pestana" en curso, o ''

  const [nuevoUsuarioId, setNuevoUsuarioId] = useState('');
  const [nuevaPestana, setNuevaPestana] = useState('');
  const [nuevoPermitido, setNuevoPermitido] = useState('true');
  const [guardandoExcepcion, setGuardandoExcepcion] = useState(false);

  function cargar() {
    setCargando(true);
    listarPermisos(sesionToken)
      .then((res) => {
        setPestanas(res.pestanas || []);
        setRolDefaults(res.rolDefaults || { Administrador: {}, Vendedor: {} });
        setOverrides(res.overrides || []);
        if (res.permisoCandadoPedidos) setPermisoCandadoPedidos(res.permisoCandadoPedidos);
        if (res.permisoCandadoReembolsos) setPermisoCandadoReembolsos(res.permisoCandadoReembolsos);
        if (res.permisoOrdenGeneral) setPermisoOrdenGeneral(res.permisoOrdenGeneral);
        setMensaje('');
      })
      .catch((err) => setMensaje(`Error al cargar permisos: ${err.message}`))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleRolPermiso(rol, pestanaClave, valorActual) {
    const llave = `${rol}:${pestanaClave}`;
    setCeldaGuardando(llave);
    // Pedido de Claudia (2026-09-29): el pacman también debe verse en
    // Permisos, igual que en las demás pestañas que guardan cambios.
    iniciarCarga?.();
    actualizarPermisoRol({ sesionToken, rol, pestana: pestanaClave, permitido: !valorActual })
      .then(cargar)
      .catch((err) => setMensaje(`Error al guardar: ${err.message}`))
      .finally(() => {
        setCeldaGuardando('');
        terminarCarga?.();
      });
  }

  // Solo tiene sentido poner una excepción a alguien que no sea el Admin
  // Central (a él el backend de todos modos la rechazaría) y que esté
  // activo (a alguien inhabilitado no le sirve de nada, no puede entrar).
  const usuariosElegibles = (usuarios || []).filter((u) => !esFilaAdminCentral(u) && esActivo(u.Activo));

  function agregarExcepcion(e) {
    e.preventDefault();
    if (!nuevoUsuarioId || !nuevaPestana) return;
    setGuardandoExcepcion(true);
    iniciarCarga?.();
    actualizarPermisoUsuario({
      sesionToken,
      usuarioId: nuevoUsuarioId,
      pestana: nuevaPestana,
      permitido: nuevoPermitido === 'true',
    })
      .then(() => {
        setNuevoUsuarioId('');
        setNuevaPestana('');
        setNuevoPermitido('true');
        cargar();
      })
      .catch((err) => setMensaje(`Error al guardar la excepción: ${err.message}`))
      .finally(() => {
        setGuardandoExcepcion(false);
        terminarCarga?.();
      });
  }

  function quitarExcepcion(usuarioId, pestanaClave) {
    iniciarCarga?.();
    actualizarPermisoUsuario({ sesionToken, usuarioId, pestana: pestanaClave, quitar: true })
      .then(cargar)
      .catch((err) => setMensaje(`Error al quitar la excepción: ${err.message}`))
      .finally(() => terminarCarga?.());
  }

  function etiquetaDe(pestanaClave) {
    if (pestanaClave === CLAVE_CANDADO_PEDIDOS) return permisoCandadoPedidos.etiqueta;
    if (pestanaClave === CLAVE_CANDADO_REEMBOLSOS) return permisoCandadoReembolsos.etiqueta;
    if (pestanaClave === CLAVE_ORDEN_GENERAL) return permisoOrdenGeneral.etiqueta;
    const encontrada = pestanas.find((p) => p.clave === pestanaClave);
    return encontrada ? encontrada.etiqueta : pestanaClave;
  }

  if (cargando) return <p className="info-msg">Cargando permisos…</p>;

  return (
    <div className="permisos-tab">
      <p className="muted">
        Aquí decides qué pestañas puede ver y usar cada Rol, y puedes hacer
        excepciones para una persona en concreto. Tú (Admin Central) siempre
        ves todas las pestañas, sin importar lo que configures aquí.
      </p>

      {mensaje && <p className="info-msg error">{mensaje}</p>}

      <h3>Por Rol</h3>
      <div className="table-scroll">
        <table className="data-table permisos-tabla-roles">
          <thead>
            <tr>
              <th>Rol</th>
              {pestanas.map((p) => (
                <th key={p.clave}>{p.etiqueta}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['Administrador', 'Vendedor'].map((rol) => (
              <tr key={rol}>
                <td>{rol}</td>
                {pestanas.map((p) => {
                  const valor = !!(rolDefaults[rol] && rolDefaults[rol][p.clave]);
                  const guardandoEstaCelda = celdaGuardando === `${rol}:${p.clave}`;
                  return (
                    <td key={p.clave} className="permisos-celda-checkbox">
                      <input
                        type="checkbox"
                        checked={valor}
                        disabled={guardandoEstaCelda}
                        onChange={() => toggleRolPermiso(rol, p.clave, valor)}
                        title={`${rol} — ${p.etiqueta}: ${valor ? 'permitido' : 'restringido'}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Etapa 4, rediseño del candado de Pedidos (2026-09-28): permiso
          ESPECIAL, separado a propósito de la tabla de pestañas de arriba
          para que no se confunda con "ver o no ver una sección" — esto es
          la capacidad de saltarse el candado de "este pedido no es tuyo"
          en la pestaña Pedidos. Reutiliza la MISMA acción de guardado
          (`toggleRolPermiso`) que la tabla de arriba, solo que con la
          clave especial "candadoPedidos" en vez de una pestaña real. */}
      <h3>Permiso especial: candado de Pedidos</h3>
      <p className="muted">
        Tú (Admin Central) siempre puedes desbloquear un pedido ajeno con el
        candado 🔓 (con confirmación antes de cada vez). Por default, NADIE
        más puede — ni siquiera un Administrador normal: ve el pedido de
        otra persona bloqueado en gris, igual que un Vendedor. Actívalo aquí
        solo si quieres que todo un Rol, o una persona en concreto, también
        pueda desbloquear pedidos ajenos.
      </p>
      <div className="table-scroll">
        <table className="data-table permisos-tabla-roles">
          <thead>
            <tr>
              <th>Rol</th>
              <th>{permisoCandadoPedidos.etiqueta}</th>
            </tr>
          </thead>
          <tbody>
            {['Administrador', 'Vendedor'].map((rol) => {
              const valor = !!(rolDefaults[rol] && rolDefaults[rol][CLAVE_CANDADO_PEDIDOS]);
              const guardandoEstaCelda = celdaGuardando === `${rol}:${CLAVE_CANDADO_PEDIDOS}`;
              return (
                <tr key={rol}>
                  <td>{rol}</td>
                  <td className="permisos-celda-checkbox">
                    <input
                      type="checkbox"
                      checked={valor}
                      disabled={guardandoEstaCelda}
                      onChange={() => toggleRolPermiso(rol, CLAVE_CANDADO_PEDIDOS, valor)}
                      title={`${rol} — ${permisoCandadoPedidos.etiqueta}: ${valor ? 'permitido' : 'restringido'}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Candado nuevo, aparte (2026-09-30, pedido por Claudia): reembolsar
          un pedido es una acción delicada sin importar de quién sea el
          pedido — a diferencia del candado de arriba, esto NO tiene que
          ver con "de quién es el pedido". Mismo patrón de tabla y misma
          acción de guardado (`toggleRolPermiso`), con la clave especial
          "candadoReembolsos". */}
      <h3>Permiso especial: candado de Reembolsos</h3>
      <p className="muted">
        Tú (Admin Central) siempre puedes marcar un pedido como
        "Reembolsado". Por default, NADIE más puede — ni siquiera un
        Administrador normal, ni un Vendedor dueño de su propio pedido.
        Actívalo aquí solo si quieres que todo un Rol, o una persona en
        concreto, también pueda reembolsar sin pedirte permiso cada vez.
      </p>
      <div className="table-scroll">
        <table className="data-table permisos-tabla-roles">
          <thead>
            <tr>
              <th>Rol</th>
              <th>{permisoCandadoReembolsos.etiqueta}</th>
            </tr>
          </thead>
          <tbody>
            {['Administrador', 'Vendedor'].map((rol) => {
              const valor = !!(rolDefaults[rol] && rolDefaults[rol][CLAVE_CANDADO_REEMBOLSOS]);
              const guardandoEstaCelda = celdaGuardando === `${rol}:${CLAVE_CANDADO_REEMBOLSOS}`;
              return (
                <tr key={rol}>
                  <td>{rol}</td>
                  <td className="permisos-celda-checkbox">
                    <input
                      type="checkbox"
                      checked={valor}
                      disabled={guardandoEstaCelda}
                      onChange={() => toggleRolPermiso(rol, CLAVE_CANDADO_REEMBOLSOS, valor)}
                      title={`${rol} — ${permisoCandadoReembolsos.etiqueta}: ${valor ? 'permitido' : 'restringido'}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* (2026-10-08) Quién puede acomodar el catálogo GENERAL en "Orden del
          catálogo". Cada quien siempre puede acomodar el de su sucursal. */}
      <h3>Permiso especial: acomodar el catálogo general</h3>
      <p className="muted">
        En "Orden del catálogo" cada persona acomoda siempre el catálogo de SU sucursal. El catálogo general solo lo
        acomoda quien tenga este permiso (tú, como Admin Central, siempre). De entrada lo tienen los Administradores y
        no los Vendedores; para dárselo a una vendedora en concreto, usa "Excepciones por persona".
      </p>
      <div className="table-scroll">
        <table className="data-table permisos-tabla-roles">
          <thead>
            <tr>
              <th>Rol</th>
              <th>{permisoOrdenGeneral.etiqueta}</th>
            </tr>
          </thead>
          <tbody>
            {['Administrador', 'Vendedor'].map((rol) => {
              const guardado = rolDefaults[rol] ? rolDefaults[rol][CLAVE_ORDEN_GENERAL] : undefined;
              const valor = guardado === undefined ? rol === 'Administrador' : !!guardado;
              const guardandoEstaCelda = celdaGuardando === `${rol}:${CLAVE_ORDEN_GENERAL}`;
              return (
                <tr key={rol}>
                  <td>{rol}</td>
                  <td className="permisos-celda-checkbox">
                    <input
                      type="checkbox"
                      checked={valor}
                      disabled={guardandoEstaCelda}
                      onChange={() => toggleRolPermiso(rol, CLAVE_ORDEN_GENERAL, valor)}
                      title={`${rol} — ${permisoOrdenGeneral.etiqueta}: ${valor ? 'permitido' : 'restringido'}`}
                      data-permiso-orden-general={rol}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Excepciones por persona</h3>
      <p className="muted">
        Usa esto solo para casos especiales: dar o quitar UNA pestaña
        puntual a alguien, sin cambiar el default de todo su Rol.
      </p>

      <form className="permisos-form-excepcion" onSubmit={agregarExcepcion}>
        <label>
          Persona
          <select value={nuevoUsuarioId} onChange={(e) => setNuevoUsuarioId(e.target.value)} required>
            <option value="">Elige…</option>
            {usuariosElegibles.map((u) => (
              <option key={u.ID} value={u.ID}>{u.Nombre} ({u.Rol})</option>
            ))}
          </select>
        </label>
        <label>
          Pestaña / permiso
          <select value={nuevaPestana} onChange={(e) => setNuevaPestana(e.target.value)} required>
            <option value="">Elige…</option>
            {pestanas.map((p) => (
              <option key={p.clave} value={p.clave}>{p.etiqueta}</option>
            ))}
            <option value={CLAVE_CANDADO_PEDIDOS}>🔒 {permisoCandadoPedidos.etiqueta}</option>
            <option value={CLAVE_CANDADO_REEMBOLSOS}>🔒 {permisoCandadoReembolsos.etiqueta}</option>
            <option value={CLAVE_ORDEN_GENERAL}>🌐 {permisoOrdenGeneral.etiqueta}</option>
          </select>
        </label>
        <label>
          Excepción
          <select value={nuevoPermitido} onChange={(e) => setNuevoPermitido(e.target.value)}>
            <option value="true">Permitir (aunque su Rol no la tenga)</option>
            <option value="false">Restringir (aunque su Rol sí la tenga)</option>
          </select>
        </label>
        <button type="submit" className="btn btn-secondary" disabled={guardandoExcepcion}>
          {guardandoExcepcion ? 'Guardando…' : 'Agregar excepción'}
        </button>
      </form>

      {overrides.length === 0 ? (
        <p className="info-msg">No hay ninguna excepción individual guardada.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Pestaña</th>
                <th>Excepción</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={`${o.usuarioId}:${o.pestana}`}>
                  <td>{o.nombre}</td>
                  <td>{etiquetaDe(o.pestana)}</td>
                  <td>{o.permitido ? 'Permitido' : 'Restringido'}</td>
                  <td className="celda-acciones">
                    <button
                      type="button"
                      className="btn btn-secondary btn-chip"
                      onClick={() => quitarExcepcion(o.usuarioId, o.pestana)}
                    >
                      Quitar (volver al default de su Rol)
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Analítica de ventas (pestaña "📈 Analítica de ventas", solo
// Administrador) ----
// Toda la información viene de UNA sola llamada al backend (`analiticaVentas`,
// que lee la hoja Movimientos): total del período con comparación contra el
// período anterior, productos más vendidos, ventas por categoría, ventas por
// vendedor (quién marcó cada pedido como Pagado/Reembolsado) y la tendencia
// día por día. Las gráficas de barras son CSS puro (ancho/alto en %) y la de
// tendencia es una línea en SVG puro — sin ninguna librería nueva, así no hay
// riesgo de romper el despliegue por una dependencia que falte.
const RANGOS_RAPIDOS_ANALITICA = ['Hoy', 'Esta semana', 'Este mes'];

// Gráfica de "Tendencia de ventas por día": una línea con un punto por día,
// dibujada con SVG puro (sin ninguna librería de gráficas). Incluye un eje
// vertical con montos ($) y líneas de referencia punteadas, para que se
// entienda de un vistazo qué valor mide cada altura — antes esto solo se
// veía como barras sin escala, y el monto exacto solo aparecía al pasar el
// mouse encima.
function GraficaLineaTendencia({ serie }) {
  // Arreglo (2026-09-29, reportado por Claudia: "al darle clic a sus
  // puntos ya no dice info"). El CSS de ".analitica-linea-punto" ya traía
  // "cursor: pointer" y se agranda al pasar el mouse (dando a entender que
  // se puede/debe darle clic), pero el único mecanismo real para ver la
  // fecha y el monto era el tooltip NATIVO del navegador (una etiqueta
  // "<title>" de SVG, que solo aparece dejando el mouse quieto encima un
  // instante) — nunca respondía a un clic de verdad, y en pantallas
  // táctiles (celular) ese tooltip nativo prácticamente no aparece nunca.
  // Ahora, al darle clic (o tap) a un punto, se abre un recuadro con la
  // fecha y el monto exacto dibujado directo en la gráfica — se mantiene
  // visible hasta que se le da clic a otro punto o al mismo para cerrarlo.
  // El tooltip nativo del navegador se deja también, como respaldo extra
  // para quien prefiera solo pasar el mouse.
  const [indiceActivo, setIndiceActivo] = useState(null);
  const ANCHO = 600;
  const ALTO = 220;
  const MARGEN_IZQ = 58;
  const MARGEN_DER = 12;
  const MARGEN_SUP = 12;
  const MARGEN_INF = 30;
  const areaAncho = ANCHO - MARGEN_IZQ - MARGEN_DER;
  const areaAlto = ALTO - MARGEN_SUP - MARGEN_INF;

  const valores = serie.map((d) => d.total);
  // El eje siempre incluye el 0, aunque todos los días hayan sido positivos
  // (o negativos), para que la línea nunca "flote" sin punto de referencia.
  const valorMax = Math.max(0, ...valores);
  const valorMin = Math.min(0, ...valores);
  const rango = valorMax - valorMin || 1; // evita dividir entre 0 si todo el período dio $0

  function coordX(indice) {
    return serie.length === 1
      ? MARGEN_IZQ + areaAncho / 2
      : MARGEN_IZQ + (indice / (serie.length - 1)) * areaAncho;
  }
  function coordY(valor) {
    return MARGEN_SUP + areaAlto - ((valor - valorMin) / rango) * areaAlto;
  }

  const puntosLinea = serie.map((d, i) => `${coordX(i)},${coordY(d.total)}`).join(' ');

  // 5 líneas de referencia horizontales, repartidas parejo entre el mínimo
  // y el máximo del rango (incluye el 0 si cae dentro de ese rango).
  const PASOS_EJE = 4;
  const lineasEje = Array.from({ length: PASOS_EJE + 1 }, (_, i) => {
    const valor = valorMin + (rango * i) / PASOS_EJE;
    return { valor, y: coordY(valor) };
  });

  // Si hay muchos días, no caben todas las fechas abajo sin encimarse — se
  // muestra solo cada N-ésima etiqueta (el punto y la línea siguen ahí para
  // todos los días, solo se oculta el TEXTO de la fecha).
  const saltoEtiquetas = Math.max(1, Math.ceil(serie.length / 8));

  const puntoActivo = indiceActivo != null ? serie[indiceActivo] : null;

  return (
    <svg className="analitica-linea-svg" viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="none" role="img">
      {lineasEje.map((linea, i) => (
        <g key={i}>
          <line
            x1={MARGEN_IZQ}
            x2={ANCHO - MARGEN_DER}
            y1={linea.y}
            y2={linea.y}
            className="analitica-linea-eje-rejilla"
          />
          <text
            x={MARGEN_IZQ - 8}
            y={linea.y}
            className="analitica-linea-eje-texto"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatearMonedaCorta(linea.valor)}
          </text>
        </g>
      ))}

      <polyline points={puntosLinea} className="analitica-linea-trazo" fill="none" />

      {serie.map((d, i) => (
        <g key={d.fecha}>
          <circle
            cx={coordX(i)}
            cy={coordY(d.total)}
            r={indiceActivo === i ? 6 : 4}
            className="analitica-linea-punto"
            onClick={() => setIndiceActivo((actual) => (actual === i ? null : i))}
          >
            <title>{`${d.fecha}: ${formatearMoneda(d.total)}`}</title>
          </circle>
          {i % saltoEtiquetas === 0 && (
            <text x={coordX(i)} y={ALTO - 8} className="analitica-linea-eje-texto" textAnchor="middle">
              {d.fecha.slice(5)}
            </text>
          )}
        </g>
      ))}

      {puntoActivo && (() => {
        const x = coordX(indiceActivo);
        const y = coordY(puntoActivo.total);
        const texto = `${puntoActivo.fecha}: ${formatearMoneda(puntoActivo.total)}`;
        const anchoCaja = Math.min(areaAncho, Math.max(90, texto.length * 5.6 + 16));
        let cajaX = x - anchoCaja / 2;
        if (cajaX < MARGEN_IZQ) cajaX = MARGEN_IZQ;
        if (cajaX + anchoCaja > ANCHO - MARGEN_DER) cajaX = ANCHO - MARGEN_DER - anchoCaja;
        const cajaAlto = 22;
        // Si el punto está muy arriba de la gráfica, no cabe una caja
        // encima — en ese caso se dibuja debajo del punto en vez de arriba.
        const arriba = y - cajaAlto - 10 >= 0;
        const cajaY = arriba ? y - cajaAlto - 10 : y + 10;
        return (
          <g className="analitica-linea-tooltip">
            <rect x={cajaX} y={cajaY} width={anchoCaja} height={cajaAlto} rx="4" />
            <text x={cajaX + anchoCaja / 2} y={cajaY + cajaAlto / 2 + 4} textAnchor="middle">
              {texto}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ---- Carrusel de ranking para Analítica (2026-10-01, pendiente P12) ----
// Dos vistas del mismo dato: "🔝 Más vendidos" y "🔻 Menos vendidos". Se
// cambia con las flechas ‹ ›, con los botones de arriba, o deslizando el
// dedo en el celular. Cada vista enseña 5 renglones y "Ver todos (N)" abre
// el resto (y "Ver menos" lo vuelve a cortar).
//   items: lista completa (cada uno con su valor numérico)
//   valorOrden(item): número con el que se ordena y se dibuja la barra
//   desempate(item): (opcional) segundo criterio si valorOrden empata
//   textoValor(item, porcentaje): lo que se escribe a la derecha de la barra
//   excluirDeMenos(item): (opcional) true = no tiene sentido en "menos
//     vendidos" (ej. "Sin registrar" o "Producto eliminado")
const RANKING_VISIBLES_POR_DEFECTO = 5;

function RankingCarrusel({
  titulo,
  items,
  clave,
  etiqueta,
  valorOrden,
  desempate = () => 0,
  textoValor,
  excluirDeMenos = () => false,
  claseRelleno = '',
  nota = null,
  // Cómo se llaman las dos vistas (por omisión, "Más / Menos vendidos").
  nombresVistas = ['🔝 Más vendidos', '🔻 Menos vendidos'],
}) {
  const [vista, setVista] = useState(0); // 0 = más vendidos, 1 = menos vendidos
  const [verTodos, setVerTodos] = useState(false);
  const inicioToqueRef = useRef(null);

  const masVendidos = items
    .slice()
    .sort((a, b) => valorOrden(b) - valorOrden(a) || desempate(b) - desempate(a));
  const menosVendidos = items
    .filter((it) => !excluirDeMenos(it))
    .sort((a, b) => valorOrden(a) - valorOrden(b) || desempate(a) - desempate(b));
  const vistas = [
    { nombre: nombresVistas[0], lista: masVendidos },
    { nombre: nombresVistas[1], lista: menosVendidos },
  ];
  const actual = vistas[vista];
  const visibles = verTodos ? actual.lista : actual.lista.slice(0, RANKING_VISIBLES_POR_DEFECTO);
  const sobran = actual.lista.length - RANKING_VISIBLES_POR_DEFECTO;

  // Barra y porcentaje se calculan contra TODA la lista (no solo lo que se
  // ve), así una barra mide lo mismo en "más" y en "menos" vendidos.
  const maximo = Math.max(0, ...items.map(valorOrden));
  const suma = items.reduce((acc, it) => acc + Math.max(0, valorOrden(it)), 0);
  function porcentajeBarra(valor) {
    if (!maximo || maximo <= 0) return '0%';
    return `${Math.max((valor / maximo) * 100, valor > 0 ? 2 : 0)}%`;
  }
  function porcentaje(valor) {
    if (!suma || suma <= 0) return null;
    return (Math.max(0, valor) / suma) * 100;
  }

  function irA(indice) {
    setVista((indice + vistas.length) % vistas.length);
  }
  function alSoltarToque(e) {
    if (inicioToqueRef.current === null) return;
    const dx = e.changedTouches[0].clientX - inicioToqueRef.current;
    inicioToqueRef.current = null;
    if (Math.abs(dx) > 45) irA(vista + (dx < 0 ? 1 : -1));
  }

  return (
    <section className="analitica-seccion ranking-carrusel">
      <div className="ranking-carrusel-encabezado">
        <h3>{titulo}</h3>
        <div className="ranking-carrusel-controles">
          <button type="button" className="ranking-carrusel-flecha" onClick={() => irA(vista - 1)} aria-label="Vista anterior">
            ‹
          </button>
          {vistas.map((v, i) => (
            <button
              key={v.nombre}
              type="button"
              className={`ranking-carrusel-pestana ${i === vista ? 'activo' : ''}`}
              onClick={() => setVista(i)}
              aria-pressed={i === vista}
            >
              {v.nombre}
            </button>
          ))}
          <button type="button" className="ranking-carrusel-flecha" onClick={() => irA(vista + 1)} aria-label="Vista siguiente">
            ›
          </button>
        </div>
      </div>

      <div
        key={vista}
        className="ranking-carrusel-vista"
        onTouchStart={(e) => { inicioToqueRef.current = e.touches[0].clientX; }}
        onTouchEnd={alSoltarToque}
      >
        {actual.lista.length === 0 ? (
          <p className="info-msg">No hay datos en este rango de fechas.</p>
        ) : (
          <div className="analitica-barras">
            {visibles.map((it, i) => {
              const valor = valorOrden(it);
              return (
                <div className="analitica-barra-fila" key={clave(it)}>
                  <span className="analitica-barra-etiqueta" title={etiqueta(it)}>
                    <span className="ranking-posicion">{i + 1}.</span> {etiqueta(it)}
                  </span>
                  <div className="analitica-barra-pista">
                    <div
                      className={`analitica-barra-relleno ${claseRelleno} ${vista === 1 ? 'ranking-relleno-menos' : ''}`}
                      style={{ width: porcentajeBarra(valor) }}
                    />
                  </div>
                  <span className="analitica-barra-valor">{textoValor(it, porcentaje(valor))}</span>
                </div>
              );
            })}
          </div>
        )}
        {sobran > 0 && (
          <button type="button" className="ranking-ver-todos" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? '▴ Ver menos' : `▾ Ver todos (${actual.lista.length})`}
          </button>
        )}
      </div>

      <div className="ranking-carrusel-puntos" aria-hidden="true">
        {vistas.map((v, i) => (
          <span key={v.nombre} className={`ranking-carrusel-punto ${i === vista ? 'activo' : ''}`} />
        ))}
      </div>
      {vista === 1 && <p className="muted">Incluye también lo que no tuvo ninguna venta en este período (en $0).</p>}
      {nota && <p className="muted">{nota}</p>}
    </section>
  );
}

function AnaliticaTab({ sesionToken }) {
  const [rangoRapido, setRangoRapido] = useState('Este mes');
  const [desde, setDesde] = useState(() => fechaISOLocal(inicioDeMes(new Date())));
  const [hasta, setHasta] = useState(() => fechaISOLocal(new Date()));
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  // Sube cada vez que se da "Reintentar" (vuelve a pedir lo mismo).
  const [intento, setIntento] = useState(0);

  function aplicarRangoRapido(nombre) {
    const hoy = new Date();
    setRangoRapido(nombre);
    if (nombre === 'Hoy') {
      setDesde(fechaISOLocal(hoy));
      setHasta(fechaISOLocal(hoy));
    } else if (nombre === 'Esta semana') {
      setDesde(fechaISOLocal(inicioDeSemana(hoy)));
      setHasta(fechaISOLocal(hoy));
    } else if (nombre === 'Este mes') {
      setDesde(fechaISOLocal(inicioDeMes(hoy)));
      setHasta(fechaISOLocal(hoy));
    }
  }

  function cambiarFechaManual(campo, valor) {
    setRangoRapido(''); // deja de marcarse cualquier botón rápido como activo
    if (campo === 'desde') setDesde(valor);
    else setHasta(valor);
  }

  useEffect(() => {
    if (!desde || !hasta) return;
    setCargando(true);
    setMensaje('');
    analiticaVentas({ sesionToken, desde, hasta })
      .then((res) => setDatos(res))
      .catch((err) => setMensaje(`Error al calcular la analítica: ${err.message}`))
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesionToken, desde, hasta, intento]);

  const cambio = datos && typeof datos.cambioPorcentaje === 'number' ? datos.cambioPorcentaje : null;
  const subio = cambio !== null && cambio >= 0;

  // (2026-10-07, Claudia: "ya no deben salir otros vendedores que no hay,
  // como el de Desconocido o Sin registrar".) En "Vendedores" solo salen las
  // cuentas que existen hoy en 👤 Usuarios (el servidor lo dice con
  // "existe"; con un servidor de antes, que no lo manda, solo se quita "Sin
  // registrar"). Lo que queda fuera se resume en una línea, para que la
  // suma no parezca incompleta sin explicación.
  const todosLosVendedores = (datos && Array.isArray(datos.porVendedor)) ? datos.porVendedor : [];
  const vendedorExiste = (v) => (v.existe === undefined ? v.usuario !== 'Sin registrar' && v.usuario !== 'Desconocido' : !!v.existe);
  const vendedoresQueExisten = todosLosVendedores.filter(vendedorExiste);
  const vendedoresFuera = todosLosVendedores.filter((v) => !vendedorExiste(v));
  const ventasFuera = vendedoresFuera.reduce((suma, v) => suma + (Number(v.cantidadVentas) || 0), 0);
  const totalFuera = vendedoresFuera.reduce((suma, v) => suma + (Number(v.total) || 0), 0);

  // (Las barras y porcentajes de los rankings ahora los calcula
  // RankingCarrusel, contra la lista completa — 2026-10-01.)

  return (
    <div className="analitica-tab">
      <div className="filtro-fechas">
        {RANGOS_RAPIDOS_ANALITICA.map((r) => (
          <button
            key={r}
            type="button"
            className={`analitica-rapido-btn ${rangoRapido === r ? 'activo' : ''}`}
            onClick={() => aplicarRangoRapido(r)}
          >
            {r}
          </button>
        ))}
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => cambiarFechaManual('desde', e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => cambiarFechaManual('hasta', e.target.value)} />
        </label>
      </div>

      {cargando && <p className="info-msg">Calculando…</p>}
      {mensaje && (
        <p className="info-msg error" data-analitica-error>
          {mensaje}{' '}
          {!cargando && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setIntento((n) => n + 1)}>
              🔄 Reintentar
            </button>
          )}
        </p>
      )}

      {datos && (
        <>
          <div className="analitica-tarjeta">
            <span className="analitica-tarjeta-titulo">Ventas netas en el período elegido</span>
            <span className="analitica-tarjeta-monto">{formatearMoneda(datos.totalActual)}</span>
            {cambio !== null ? (
              <span className={`analitica-cambio ${subio ? 'analitica-cambio-positivo' : 'analitica-cambio-negativo'}`}>
                {subio ? '▲' : '▼'} {Math.abs(cambio).toFixed(1)}% vs. el período anterior de igual duración
                ({formatearMoneda(datos.totalAnterior)})
              </span>
            ) : (
              <span className="muted">No hay ventas registradas en el período anterior para comparar.</span>
            )}
          </div>

          {/* Rediseño (2026-10-01, pendiente P12 de Claudia): cada ranking
              es un CARRUSEL con dos vistas — "🔝 Más vendidos" y su
              contraparte "🔻 Menos vendidos" — para ahorrar espacio y pasar
              de una a otra fácil (flechas, puntitos, o deslizando el dedo).
              Cada vista enseña 5 y tiene "Ver todos" para abrir el resto.
              "Menos vendidos" incluye también lo que no vendió nada en el
              período (en $0). Ver RankingCarrusel más abajo. */}
          <RankingCarrusel
            titulo="📦 Productos"
            items={datos.porProducto}
            clave={(p) => p.producto}
            etiqueta={(p) => p.producto}
            valorOrden={(p) => p.total}
            textoValor={(p, pct) => (
              <>
                {formatearMoneda(p.total)} ({p.cantidadVentas} venta{p.cantidadVentas === 1 ? '' : 's'})
                {pct !== null && <span className="analitica-barra-porcentaje"> · {pct.toFixed(1)}%</span>}
              </>
            )}
            excluirDeMenos={(p) => p.producto === 'Producto eliminado'}
          />

          <RankingCarrusel
            titulo="🗂️ Categorías"
            items={datos.porCategoria}
            clave={(c) => c.categoria}
            etiqueta={(c) => c.categoria}
            valorOrden={(c) => c.total}
            claseRelleno="analitica-barra-relleno-categoria"
            textoValor={(c, pct) => (
              <>
                {formatearMoneda(c.total)}
                {pct !== null && <span className="analitica-barra-porcentaje"> · {pct.toFixed(1)}%</span>}
              </>
            )}
          />

          <RankingCarrusel
            titulo="🧑‍💼 Vendedores"
            nombresVistas={['🔝 Vendedores que más venden', '🔻 Vendedores que menos venden']}
            items={vendedoresQueExisten}
            clave={(v) => v.usuario}
            etiqueta={(v) => v.usuario}
            valorOrden={(v) => v.cantidadVentas}
            desempate={(v) => v.total}
            claseRelleno="analitica-barra-relleno-vendedor"
            textoValor={(v, pct) => (
              <>
                {v.cantidadVentas} venta{v.cantidadVentas === 1 ? '' : 's'} · {formatearMoneda(v.total)}
                {pct !== null && <span className="analitica-barra-porcentaje"> · {pct.toFixed(1)}%</span>}
              </>
            )}
            nota={
              <>
                "Vendedor" es quién marcó cada pedido como Pagado/Reembolsado desde el panel. Solo salen las
                personas que hoy existen en 👤 Usuarios.
                {(ventasFuera > 0 || Math.abs(totalFuera) >= 0.005) && (
                  <span data-vendedores-fuera>
                    {' '}No se muestra{ventasFuera === 1 ? '' : 'n'} {ventasFuera} venta{ventasFuera === 1 ? '' : 's'} ({formatearMoneda(totalFuera)}) de
                    cuentas que ya no existen o que no quedaron registradas.
                  </span>
                )}
              </>
            }
          />

          <section className="analitica-seccion">
            <h3>📈 Tendencia de ventas por día</h3>
            {datos.serieTiempo.length === 0 ? (
              <p className="info-msg">No hay ventas en este rango de fechas.</p>
            ) : (
              <GraficaLineaTendencia serie={datos.serieTiempo} />
            )}
            <p className="muted">
              Cada punto es el total neto de ventas de ese día (abonos menos cargos). Dale clic a un
              punto para ver la fecha y el monto exacto (vuelve a darle clic para cerrarlo).
            </p>
          </section>
        </>
      )}
    </div>
  );
}

// Campo de contraseña con "ojito" para ver/ocultar lo que se escribió
// (2026-10-01, pendiente P2 de Claudia). Se usa en el login y en los dos
// modales de Usuarios (crear usuario / cambiar contraseña). Recibe los
// mismos props que un <input> normal.
//
// Corrección del mismo día (Claudia, con capturas): el ícono era un emoji
// (👁️ / 🙈) que no combinaba con el diseño, y además estaba AL REVÉS — el
// ojo abierto salía cuando la contraseña estaba oculta. Ahora son dos
// dibujos de línea sencillos, del mismo estilo, y el ícono dice el ESTADO:
//   ojo cerrado (tachado)  -> la contraseña NO se ve
//   ojo abierto            -> la contraseña SÍ se ve
// (2026-10-06) También lo usan los botones de "Ocultar" de "Orden del
// catálogo", con el mismo significado: ojo abierto = se ve en el catálogo,
// ojo tachado = está oculta. "tamano" es el lado del dibujo, en pixeles.
function IconoOjo({ abierto, tamano = 20 }) {
  return (
    <svg
      className="icono-ojo"
      data-ojo={abierto ? 'abierto' : 'cerrado'}
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!abierto && <path d="M4 4l16 16" />}
    </svg>
  );
}

function CampoContrasena(props) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="campo-contrasena">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="campo-contrasena-ojo"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'La contraseña se ve — clic para ocultarla' : 'La contraseña está oculta — clic para verla'}
        title={visible ? 'La contraseña se ve — clic para ocultarla' : 'La contraseña está oculta — clic para verla'}
      >
        <IconoOjo abierto={visible} />
      </button>
    </span>
  );
}

// ---- Aviso flotante "tipo comentario de Word" (2026-09-30, pedido por
// Claudia con capturas) ----
// Antes, los avisos de la columna Estado de Pedidos ("Ya pasó más de 1
// hora...", "🔒 No te pertenece este pedido.", "No tienes el permiso para
// reembolsar...", "⏳ Ya enviaste una solicitud...") eran párrafos fijos
// DENTRO de la celda: salían siempre, aunque nadie hubiera intentado nada, y
// hacían cada fila mucho más alta. Claudia pidió que solo salgan cuando se
// intenta justo la acción que quieren prevenir, y "en forma tipo comentario
// de Word": una burbujita que FLOTA al lado del campo (encima de la tabla,
// sin empujar ni ensanchar nada), y que se cierra sola, con la ✕, o al dar
// clic en cualquier otro lado.
//
// Se dibuja con un "portal" directo en <body> y con posición fija en la
// pantalla (no dentro de la celda), para que la caja con scroll de la tabla
// nunca la recorte. Se acomoda a la DERECHA del campo (como los comentarios
// de Word en el margen); si no cabe, a la izquierda. Si la página o la tabla
// se desplazan, se cierra (en vez de quedarse flotando fuera de lugar).
function AvisoFlotante({ anclaRef, abierto, onCerrar, autoCerrarMs = 0, children }) {
  const burbujaRef = useRef(null);
  const onCerrarRef = useRef(onCerrar);
  onCerrarRef.current = onCerrar;

  useLayoutEffect(() => {
    const burbuja = burbujaRef.current;
    const ancla = anclaRef && anclaRef.current;
    if (!abierto || !burbuja || !ancla) return;
    const r = ancla.getBoundingClientRect();
    const ancho = burbuja.offsetWidth;
    const alto = burbuja.offsetHeight;
    const MARGEN = 8;
    const SEPARACION = 10;
    let left = r.right + SEPARACION;
    let lado = 'lado-derecha';
    if (left + ancho > window.innerWidth - MARGEN) {
      left = r.left - SEPARACION - ancho;
      lado = 'lado-izquierda';
    }
    left = Math.max(MARGEN, left);
    let top = r.top + r.height / 2 - 18;
    top = Math.max(MARGEN, Math.min(top, window.innerHeight - alto - MARGEN));
    const centroAncla = r.top + r.height / 2 - top;
    burbuja.style.left = `${left}px`;
    burbuja.style.top = `${top}px`;
    burbuja.style.setProperty('--flecha-top', `${Math.max(12, Math.min(centroAncla, alto - 12))}px`);
    burbuja.classList.remove('lado-derecha', 'lado-izquierda');
    burbuja.classList.add(lado);
    burbuja.style.visibility = 'visible';
  }, [abierto, anclaRef, children]);

  useEffect(() => {
    if (!abierto) return undefined;
    function cerrar() { onCerrarRef.current(); }
    function alTocarAfuera(e) {
      if (burbujaRef.current && burbujaRef.current.contains(e.target)) return;
      if (anclaRef && anclaRef.current && anclaRef.current.contains(e.target)) return;
      cerrar();
    }
    document.addEventListener('mousedown', alTocarAfuera);
    document.addEventListener('touchstart', alTocarAfuera);
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);
    const temporizador = autoCerrarMs > 0 ? setTimeout(cerrar, autoCerrarMs) : null;
    return () => {
      document.removeEventListener('mousedown', alTocarAfuera);
      document.removeEventListener('touchstart', alTocarAfuera);
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
      if (temporizador) clearTimeout(temporizador);
    };
  }, [abierto, autoCerrarMs, anclaRef]);

  if (!abierto || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={burbujaRef} className="comentario-flotante" role="status" style={{ visibility: 'hidden', left: 0, top: 0 }}>
      <button type="button" className="comentario-flotante-cerrar" onClick={() => onCerrarRef.current()} aria-label="Cerrar aviso">
        ✕
      </button>
      {children}
    </div>,
    document.body
  );
}

// ============================================================================
// TICKETS (2026-10-06) — recibos de los pedidos pagados
// ============================================================================
// Pedido de Claudia (diseño de septiembre, afinado el 2026-10-06): al quedar
// "Pagado" un pedido se le puede sacar su ticket (a mano, por lote o solo,
// si está prendido el automático); un ticket junta los pedidos de la misma
// clienta; se puede editar, cancelar y descargar en PDF tipo recibo (80 mm)
// con su folio y un código QR.
// (2026-10-07, Claudia: "el QR me lleva al panel de admin, eso es
// inconcebible… ni de chiste al panel".) El QR ya NO abre este panel: abre
// una página pública que solo enseña ese ticket a la clienta, con su botón
// para bajarlo otra vez en PDF (ver TicketPublico.jsx).
// El ticket es un DOCUMENTO: nada de lo que se haga aquí mueve pedidos,
// stock ni dinero.
const ESTADO_TICKET_CANCELADO = 'Cancelado';
const HORAS_MISMA_COMPRA = 24; // igual que HORAS_MISMA_COMPRA_ en Code.gs

// Lo que lleva el QR: la página PÚBLICA de ese ticket (la dirección del
// catálogo + el folio + la clave larga del ticket, que manda el servidor).
// Nunca la dirección del panel. Si el servidor todavía es uno de antes (no
// manda la clave), el QR lleva solo el folio escrito.
function enlaceDeTicket(ticket) {
  const folio = String((ticket && ticket.Folio) || '');
  const clave = String((ticket && ticket.Clave) || '');
  // (2026-10-09) Sin clave NO hay QR (antes llevaba el folio escrito). Así
  // un QR nunca puede llevar a otro lado que no sea el ticket digital.
  if (!folio || !clave) return '';
  try {
    return `${window.location.origin}/?ticket=${encodeURIComponent(folio)}&c=${encodeURIComponent(clave)}`;
  } catch {
    return folio;
  }
}

function tiendaDeTickets(configuracion) {
  return (configuracion && configuracion.tienda) || {};
}

// Baja uno o varios tickets en UN archivo PDF (cada ticket en su hoja).
function bajarTicketsEnPDF(tickets, configuracion) {
  if (!tickets || tickets.length === 0) throw new Error('No hay ningún ticket que descargar.');
  const nombre = tickets.length === 1 ? `ticket-${tickets[0].Folio}` : `tickets-${fechaParaArchivo()}`;
  descargarTicketPDF(
    nombre,
    tickets.map((ticket) => ({ ticket, tienda: tiendaDeTickets(configuracion), enlace: enlaceDeTicket(ticket) }))
  );
}

// Los renglones de un ticket (si en la hoja alguien dejó algo raro, se ignora).
function renglonesDeTicket(ticket) {
  return (Array.isArray(ticket.Items) ? ticket.Items : []).filter((it) => it && typeof it === 'object');
}

function piezasDeTicket(ticket) {
  return renglonesDeTicket(ticket).reduce((suma, it) => suma + (Number(it.cantidad) || 0), 0);
}

// Lo que lleva el fondo oscuro de una ventana para cerrarla con un clic
// AFUERA: solo si el clic empezó y terminó en el fondo (seleccionar texto
// arrastrando y soltar afuera no cuenta) y solo si "permitido".
function useCerrarConClicAfuera(onCerrar, permitido) {
  const empezoAfuera = useRef(false);
  return {
    onMouseDown: (e) => {
      empezoAfuera.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      if (permitido && empezoAfuera.current && e.target === e.currentTarget) onCerrar();
      empezoAfuera.current = false;
    },
  };
}

// El código QR dibujado en pantalla (el mismo que sale en el PDF).
function CodigoQR({ texto, lado = 132 }) {
  if (!texto) return null;
  const qr = crearQR(texto);
  if (!qr) return null;
  const n = qr.lado + 8; // con su orilla blanca
  let trazo = '';
  qr.celdas.forEach((fila, y) => {
    fila.forEach((oscura, x) => {
      if (oscura) trazo += `M${x + 4} ${y + 4}h1v1h-1z`;
    });
  });
  return (
    <svg className="ticket-qr" width={lado} height={lado} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Código QR del ticket">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={trazo} fill="#000000" />
    </svg>
  );
}

// Cómo se ve el ticket (en pantalla; el PDF sale con este mismo acomodo).
function VistaDeTicket({ ticket, tienda }) {
  const cancelado = ticket.Estado === ESTADO_TICKET_CANCELADO;
  const items = renglonesDeTicket(ticket);
  const piezas = piezasDeTicket(ticket);
  // Igual que el PDF: si el ticket se sacó otro día que la compra, las dos fechas.
  const diaDe = (valor) => (valor ? new Date(valor).toDateString() : '');
  const otroDia = !!(ticket.FechaCompra && ticket.Fecha && diaDe(ticket.FechaCompra) !== diaDe(ticket.Fecha));
  return (
    <div className={`ticket-papel ${cancelado ? 'ticket-papel-cancelado' : ''}`}>
      {cancelado && <p className="ticket-papel-sello">*** TICKET CANCELADO ***</p>}
      {tienda.nombre && <p className="ticket-papel-tienda">{tienda.nombre}</p>}
      {tienda.direccion && <p className="ticket-papel-chico">{tienda.direccion}</p>}
      {tienda.telefono && <p className="ticket-papel-chico">Tel. {tienda.telefono}</p>}
      {(tienda.nombre || tienda.direccion || tienda.telefono) && <hr />}
      <p className="ticket-papel-titulo">TICKET DE COMPRA</p>
      <p className="ticket-papel-folio">Folio {ticket.Folio}</p>
      <p><strong>{otroDia ? 'Fecha de compra:' : 'Fecha:'}</strong> {formatearFechaHora(ticket.FechaCompra || ticket.Fecha)}</p>
      {otroDia && <p><strong>Ticket emitido:</strong> {formatearFechaHora(ticket.Fecha)}</p>}
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
                  {it.codigo ? `Cód. ${it.codigo} · ` : ''}{formatearMoneda(Number(it.precio) || 0)} c/u
                </span>
              </td>
              <td>{formatearMoneda(Number(it.importe) || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <p className="ticket-papel-total"><span>TOTAL</span><span>{formatearMoneda(Number(ticket.Total) || 0)}</span></p>
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
        {enlaceDeTicket(ticket) ? (
          <CodigoQR texto={enlaceDeTicket(ticket)} />
        ) : (
          <p className="muted ticket-sin-qr" data-ticket-sin-qr>Sin QR: falta subir el Code.gs nuevo (con "Nueva versión").</p>
        )}
        <p className="ticket-papel-folio-chico">Folio {ticket.Folio}</p>
      </div>
      {tienda.mensaje && <p className="ticket-papel-mensaje">{tienda.mensaje}</p>}
    </div>
  );
}

// Ventana de UN ticket: verlo, descargarlo, editarlo, volver a armarlo o
// cancelarlo. Las acciones regresan una promesa; si truena, aquí se enseña
// el error y la ventana se queda abierta.
function ModalTicket({ ticket, configuracion, puedeVerPedidos, onCerrar, onGuardar, onRehacer, onCancelar, onVerPedidos }) {
  const [modo, setModo] = useState('ver'); // 'ver' | 'editar' | 'cancelar'
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  // (2026-10-07) El "listo" se quita solo (salvo el que trae un enlace para
  // copiar a mano: ese se queda hasta que se cierre la ventana).
  useQuitarSolo(aviso, () => setAviso(''), aviso && aviso.indexOf('http') === -1 ? DURACION_AVISO_MS : 0);
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [renglones, setRenglones] = useState([]);
  const [motivo, setMotivo] = useState('');
  const tienda = tiendaDeTickets(configuracion);
  const cancelado = ticket.Estado === ESTADO_TICKET_CANCELADO;
  const desactualizado = ticket.Desactualizado || [];

  function empezarAEditar() {
    setCliente(ticket.Cliente || '');
    setTelefono(ticket.Telefono || '');
    setNotas(ticket.Notas || '');
    setRenglones(renglonesDeTicket(ticket).map((it) => ({ ...it, cantidad: String(it.cantidad ?? ''), precio: String(it.precio ?? '') })));
    setError('');
    setAviso('');
    setModo('editar');
  }
  function cambiarRenglon(indice, campo, valor) {
    setRenglones((antes) => antes.map((r, i) => (i === indice ? { ...r, [campo]: valor } : r)));
  }
  // Un renglón está bien si trae descripción, una cantidad entera de 1 o
  // más y un precio escrito (puede ser 0, pero no vacío): así lo que se ve
  // en el formulario es justo lo que se guarda.
  const cantidadValida = (r) => /^\d+$/.test(String(r.cantidad).trim()) && Number(r.cantidad) >= 1;
  const precioValido = (r) => String(r.precio).trim() !== '' && Number.isFinite(Number(r.precio)) && Number(r.precio) >= 0;
  const renglonValido = (r) => !!String(r.descripcion || '').trim() && cantidadValida(r) && precioValido(r);
  const totalEditado = renglones.reduce((suma, r) => suma + (cantidadValida(r) && precioValido(r) ? Number(r.cantidad) * Number(r.precio) : 0), 0);
  const edicionInvalida = renglones.length === 0 || renglones.some((r) => !renglonValido(r));
  const pedidosQueSalen = (ticket.PedidoIDs || []).filter((id) => !renglones.some((r) => String(r.pedidoId || '') === String(id))).length;

  function correr(promesa, alTerminar) {
    setOcupado(true);
    setError('');
    setAviso('');
    return Promise.resolve(promesa)
      .then((res) => {
        if (alTerminar) alTerminar(res);
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setOcupado(false));
  }
  function guardar() {
    correr(
      onGuardar(ticket, {
        cliente,
        telefono,
        notas,
        items: renglones.map((r) => ({
          pedidoId: r.pedidoId || '',
          productoId: r.productoId || '',
          descripcion: String(r.descripcion || '').trim(),
          codigo: String(r.codigo || '').trim(),
          cantidad: Number(r.cantidad),
          precio: Number(r.precio),
        })),
      }),
      () => {
        setModo('ver');
        setAviso('Cambios guardados en el ticket.');
      }
    );
  }
  function rehacer() {
    // Desde "Editar" borra lo escrito a mano: se pregunta antes.
    if (modo === 'editar' && !window.confirm('Esto borra lo que escribiste a mano en el ticket y vuelve a tomar clienta, productos, cantidades y precios de sus pedidos que siguen pagados. ¿Continuar?')) return;
    correr(onRehacer(ticket), () => {
      setModo('ver');
      setAviso('El ticket se volvió a armar con sus pedidos que siguen pagados.');
    });
  }
  function cancelar() {
    correr(onCancelar(ticket, motivo.trim()), () => {
      setModo('ver');
      setAviso('El ticket quedó cancelado. Sus pedidos siguen igual y ya pueden tener otro ticket.');
    });
  }
  function descargar() {
    try {
      bajarTicketsEnPDF([ticket], configuracion);
      setError('');
      setAviso('Se descargó el PDF. Búscalo en tus Descargas.');
    } catch (err) {
      setError(`No se pudo armar el PDF: ${err.message}`);
    }
  }

  // (2026-10-09, Claudia: "la opción de copiar enlace para la clienta…
  // quítalo, basta con el QR") Ya no hay botón de "Copiar enlace": la
  // clienta llega a su ticket digital solo con el QR.

  // El clic afuera solo cierra mientras se está VIENDO el ticket: al editar
  // o cancelar se sale con sus botones, para no perder lo escrito sin querer.
  const fondo = useCerrarConClicAfuera(onCerrar, !ocupado && modo === 'ver');

  return (
    <div className="modal-overlay modal-overlay-ticket" {...fondo}>
      <div className="modal-box modal-box-ancho modal-ticket" data-ticket-folio={ticket.Folio}>
        <h3>
          🎫 Ticket {ticket.Folio}{' '}
          {cancelado ? <span className="ticket-chip ticket-chip-cancelado">Cancelado</span> : <span className="ticket-chip ticket-chip-vigente">Vigente</span>}
        </h3>
        <p className="muted ticket-datos-internos">
          Lo generó {ticket.CreadoPor || '—'} el {formatearFechaHora(ticket.Fecha)}
          {ticket.Origen ? ` (${String(ticket.Origen).toLowerCase()})` : ''}
          {ticket.EditadoPor ? ` · Editado por ${ticket.EditadoPor} el ${formatearFechaHora(ticket.EditadoEl)}` : ''}
          {cancelado ? ` · Cancelado por ${ticket.CanceladoPor || '—'} el ${formatearFechaHora(ticket.CanceladoEl)}${ticket.MotivoCancelacion ? `: ${ticket.MotivoCancelacion}` : ''}` : ''}
        </p>

        {error && <p className="info-msg error ticket-msg">{error}</p>}
        {aviso && !error && (
          <p className={`ticket-listo ${aviso.indexOf('http') === -1 ? 'aviso-tocable' : ''}`} role="status" onClick={aviso.indexOf('http') === -1 ? () => setAviso('') : undefined}>
            ✅ {aviso}
          </p>
        )}

        {!cancelado && desactualizado.length > 0 && modo === 'ver' && (
          <div className="ticket-aviso-cambio" role="alert">
            <strong>⚠️ Este ticket ya no coincide con sus pedidos:</strong>
            <ul>
              {desactualizado.map((d) => (
                <li key={d.pedidoId}>
                  {d.cambio ? (
                    <>El pedido de "{d.producto || 'un producto'}" <strong>{d.cambio}</strong>.</>
                  ) : (
                    <>"{d.producto || 'Un pedido'}" ahora está <strong>{d.estado === 'Eliminado' ? 'eliminado' : etiquetaEstadoPedido(d.estado)}</strong>.</>
                  )}
                </li>
              ))}
            </ul>
            <div className="ticket-aviso-cambio-botones">
              <button type="button" className="btn btn-secondary btn-small" onClick={rehacer} disabled={ocupado} data-ticket-accion="rehacer">
                ↺ Volver a armar con lo que sigue pagado
              </button>
              <span className="muted">o edítalo a mano, o cancélalo.</span>
            </div>
          </div>
        )}

        {modo === 'ver' && <VistaDeTicket ticket={ticket} tienda={tienda} />}

        {modo === 'editar' && (
          <div className="ticket-edicion">
            <p className="modal-aviso">
              Esto cambia <strong>solo lo que dice el ticket</strong>. No mueve pedidos, stock ni dinero (eso se hace en Pedidos).
            </p>
            <div className="ticket-edicion-campos">
              <label className="modal-field">
                Cliente
                <input value={cliente} maxLength={80} onChange={(e) => setCliente(e.target.value)} />
              </label>
              <label className="modal-field">
                Teléfono
                <input value={telefono} maxLength={30} inputMode="tel" onChange={(e) => setTelefono(e.target.value)} />
              </label>
            </div>
            <div className="table-scroll">
              <table className="data-table ticket-edicion-tabla">
                <thead>
                  <tr><th>Cant.</th><th>Descripción</th><th>Código</th><th>Precio c/u</th><th>Importe</th><th /></tr>
                </thead>
                <tbody>
                  {renglones.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input className={`ticket-input-cant ${cantidadValida(r) ? '' : 'ticket-input-mal'}`} inputMode="numeric" value={r.cantidad} aria-label="Cantidad" onChange={(e) => cambiarRenglon(i, 'cantidad', limitarDigitos(e.target.value, MAX_DIGITOS_STOCK).split('.')[0])} />
                      </td>
                      <td>
                        <input className={`ticket-input-desc ${String(r.descripcion || '').trim() ? '' : 'ticket-input-mal'}`} value={r.descripcion || ''} maxLength={120} aria-label="Descripción" onChange={(e) => cambiarRenglon(i, 'descripcion', e.target.value)} />
                      </td>
                      <td>
                        <input className="ticket-input-cod" value={r.codigo || ''} maxLength={40} aria-label="Código" onChange={(e) => cambiarRenglon(i, 'codigo', e.target.value)} />
                      </td>
                      <td>
                        <input className={`ticket-input-precio ${precioValido(r) ? '' : 'ticket-input-mal'}`} inputMode="decimal" value={r.precio} aria-label="Precio por pieza" onChange={(e) => cambiarRenglon(i, 'precio', limitarDigitos(e.target.value, MAX_DIGITOS_PRECIO))} />
                      </td>
                      <td className="ticket-edicion-importe">
                        {cantidadValida(r) && precioValido(r) ? formatearMoneda(Number(r.cantidad) * Number(r.precio)) : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-eliminar btn-small"
                          onClick={() => setRenglones((antes) => antes.filter((_, k) => k !== i))}
                          disabled={renglones.length <= 1 || ocupado}
                          title={renglones.length <= 1 ? 'El ticket debe llevar al menos un producto' : 'Quitar este renglón del ticket. Su pedido no cambia (sigue pagado), pero sale de este ticket y queda libre para sacarle el suyo.'}
                          aria-label="Quitar este renglón del ticket"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ticket-edicion-total">Total del ticket: <strong>{formatearMoneda(totalEditado)}</strong></p>
            {edicionInvalida && (
              <p className="ticket-aviso-espera">
                Para guardar, cada renglón necesita su descripción, una cantidad de 1 o más y su precio (puede ser 0, pero no vacío).
              </p>
            )}
            {pedidosQueSalen > 0 && !edicionInvalida && (
              <p className="ticket-aviso-espera">
                Al guardar, {pedidosQueSalen === 1 ? 'el pedido del renglón que quitaste sale' : `los ${pedidosQueSalen} pedidos de los renglones que quitaste salen`} de este
                ticket: {pedidosQueSalen === 1 ? 'queda' : 'quedan'} como "pagado sin ticket" (el pedido en sí no cambia).
              </p>
            )}
            <label className="modal-field">
              Nota (sale en el ticket)
              <textarea value={notas} maxLength={300} rows={2} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. Apartado con anticipo, se entrega el sábado" />
            </label>
          </div>
        )}

        {modo === 'cancelar' && (
          <div className="ticket-edicion">
            <p className="modal-aviso ticket-aviso-rojo">
              Vas a <strong>cancelar el ticket {ticket.Folio}</strong>. Sus pedidos NO cambian (siguen pagados, con su stock y su dinero
              igual); solo quedan libres para sacarles otro ticket. El folio {ticket.Folio} ya no se vuelve a usar.
            </p>
            <label className="modal-field">
              ¿Por qué se cancela? (opcional)
              <input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Se capturó mal" autoFocus />
            </label>
          </div>
        )}

        <div className="modal-actions ticket-acciones">
          {modo === 'ver' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={ocupado}>Cerrar</button>
              {puedeVerPedidos && (
                <button type="button" className="btn btn-secondary" onClick={() => onVerPedidos(ticket)} disabled={ocupado} data-ticket-accion="pedidos" title="Abre Pedidos con solo los pedidos de este ticket (ahí se cambia su estado, por ejemplo para un reembolso)">
                  📋 Ver sus pedidos
                </button>
              )}
              {!cancelado && (
                <>
                  <button type="button" className="btn btn-eliminar" onClick={() => { setMotivo(''); setError(''); setAviso(''); setModo('cancelar'); }} disabled={ocupado} data-ticket-accion="cancelar">
                    🚫 Cancelar ticket
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={empezarAEditar} disabled={ocupado} data-ticket-accion="editar">
                    ✏️ Editar
                  </button>
                </>
              )}
              <button type="button" className="btn btn-primary" onClick={descargar} disabled={ocupado} data-ticket-accion="pdf">
                ⬇ Descargar PDF
              </button>
            </>
          )}
          {modo === 'editar' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => { setModo('ver'); setError(''); }} disabled={ocupado}>No guardar</button>
              <button type="button" className="btn btn-secondary" onClick={rehacer} disabled={ocupado} title="Borra lo escrito a mano y vuelve a tomar clienta, productos, cantidades y precios de los pedidos que siguen pagados" data-ticket-accion="rehacer">
                ↺ Volver a tomar los datos de los pedidos
              </button>
              <button type="button" className="btn btn-primary" onClick={guardar} disabled={ocupado || edicionInvalida} data-ticket-accion="guardar">
                {ocupado ? 'Guardando…' : '💾 Guardar ticket'}
              </button>
            </>
          )}
          {modo === 'cancelar' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModo('ver')} disabled={ocupado}>No cancelar</button>
              <button type="button" className="btn btn-eliminar" onClick={cancelar} disabled={ocupado} data-ticket-accion="confirmar-cancelar">
                {ocupado ? 'Cancelando…' : 'Sí, cancelar el ticket'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Ventana del botón 🎫 de un pedido pagado: enseña con qué otros pedidos
// pagados de esa clienta se puede juntar, y genera UN ticket.
function ModalGenerarTicket({ pedidos, inicialId, onCerrar, onGenerar }) {
  const inicial = pedidos.find((p) => String(p.ID) === String(inicialId)) || pedidos[0];
  const [elegidos, setElegidos] = useState(() => {
    const margen = HORAS_MISMA_COMPRA * 60 * 60 * 1000;
    const ancla = new Date(inicial.Fecha).getTime();
    return new Set(
      pedidos
        .filter((p) => String(p.ID) === String(inicial.ID) || Math.abs(new Date(p.Fecha).getTime() - ancla) <= margen)
        .map((p) => String(p.ID))
    );
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const total = pedidos.filter((p) => elegidos.has(String(p.ID))).reduce((suma, p) => suma + p.Cantidad * p.Precio, 0);
  function alternar(id) {
    setElegidos((antes) => {
      const copia = new Set(antes);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }
  function generar() {
    setOcupado(true);
    setError('');
    Promise.resolve(onGenerar(Array.from(elegidos)))
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setOcupado(false));
  }
  const fondo = useCerrarConClicAfuera(onCerrar, !ocupado);
  return (
    <div className="modal-overlay modal-overlay-ticket" {...fondo}>
      <div className="modal-box modal-box-ancho modal-generar-ticket">
        <h3>🎫 Generar ticket — {inicial.Cliente || 'Cliente sin nombre'}</h3>
        {pedidos.length > 1 ? (
          <p className="muted">
            Esta clienta tiene {pedidos.length} pedidos pagados sin ticket. Los marcados van juntos en <strong>un solo ticket</strong>
            {' '}(ya vienen marcados los de la misma compra).
          </p>
        ) : (
          <p className="muted">Se va a generar el ticket de este pedido pagado.</p>
        )}
        {inicial.SinResolver > 0 && (
          <p className="ticket-aviso-espera">
            ⏳ Esta clienta todavía tiene <strong>{inicial.SinResolver}</strong> pedido{inicial.SinResolver === 1 ? '' : 's'} de esta misma compra
            sin resolver (Pendiente o En proceso). Puedes esperar a que se resuelva{inicial.SinResolver === 1 ? '' : 'n'} para que todo salga en un
            solo ticket, o generarlo ya con lo pagado.
          </p>
        )}
        {error && <p className="info-msg error ticket-msg">{error}</p>}
        <ul className="ticket-lote-lista">
          {pedidos.map((p) => (
            <li key={p.ID}>
              <label>
                <input type="checkbox" checked={elegidos.has(String(p.ID))} onChange={() => alternar(String(p.ID))} disabled={ocupado} />
                <span className="ticket-lote-producto">{p.Cantidad} x {p.Producto}{p.Codigo ? ` (${p.Codigo})` : ''}</span>
                <span className="ticket-lote-fecha">{formatearFechaHora(p.Fecha)}</span>
                <span className="ticket-lote-importe">{formatearMoneda(p.Cantidad * p.Precio)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="ticket-edicion-total">Total del ticket: <strong>{formatearMoneda(total)}</strong></p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={generar} disabled={ocupado || elegidos.size === 0} data-ticket-accion="generar">
            {ocupado ? 'Generando…' : '🎫 Generar ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}

// La pestaña "🎫 Tickets".
function TicketsTab({
  tickets,
  pedidosParaTicket,
  configuracion,
  puedeConfigurar,
  tienda,
  setTienda,
  folioBuscado,
  onFolioAtendido,
  onCrear,
  onAbrirTicket,
  onVerPedidos,
  onGuardarConfiguracion,
}) {
  const [buscar, setBuscar] = useState('');
  const [filtroEstado, setFiltroEstado] = useState(''); // '' | 'Vigente' | 'Cancelado' | 'aviso'
  const [limiteFilas, setLimiteFilas] = useLimiteFilas('tickets');
  // { tipo: 'ok' | 'error', texto, folios, donde: 'lote' | undefined }
  // Con donde: 'lote' sale junto a la lista de abajo (donde se dio el clic).
  const [aviso, setAviso] = useState(null);
  // (2026-10-07) Se quita solo: un "listo" a los pocos segundos (más si trae
  // el botón para bajar el PDF), un error bastante después. Y al tocarlo.
  useQuitarSolo(aviso, () => setAviso(null), !aviso ? 0 : aviso.tipo !== 'ok' ? DURACION_AVISO_ERROR_MS : aviso.folios && aviso.folios.length > 0 ? 30000 : DURACION_AVISO_MS);
  // ---- Por lote ----
  const [elegidos, setElegidos] = useState(() => new Set());
  const [filtroProducto, setFiltroProducto] = useState('');
  const [generando, setGenerando] = useState(false);
  const [limiteClientes, setLimiteClientes] = useLimiteFilas('ticketsLote');
  // ---- Datos de la tienda ----
  // "tienda" (lo que se va escribiendo; null = sin tocar) vive en el panel,
  // para que no se pierda al cambiar de pestaña antes de guardar.
  const tiendaGuardada = tiendaDeTickets(configuracion);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [avisoConfig, setAvisoConfig] = useState(null);
  useQuitarSolo(avisoConfig, () => setAvisoConfig(null), !avisoConfig ? 0 : avisoConfig.tipo === 'ok' ? DURACION_AVISO_MS : DURACION_AVISO_ERROR_MS);
  // Mientras se guarda el interruptor, se enseña ya como se eligió (si no,
  // la palomita tardaba uno o dos segundos en moverse y parecía que no servía).
  const [automaticoElegido, setAutomaticoElegido] = useState(null);
  const automaticos = automaticoElegido !== null ? automaticoElegido : !!(configuracion && configuracion.automaticos);
  const tiendaVista = tienda || tiendaGuardada;
  const tiendaCambio = !!tienda && ['nombre', 'direccion', 'telefono', 'mensaje'].some((c) => String(tienda[c] || '') !== String(tiendaGuardada[c] || ''));

  // Se llegó con un folio (por el QR o desde Pedidos): se busca y, si está, se abre.
  const folioAtendidoRef = useRef('');
  useEffect(() => {
    if (!folioBuscado || folioAtendidoRef.current === folioBuscado) return;
    folioAtendidoRef.current = folioBuscado;
    setBuscar(folioBuscado);
    setFiltroEstado('');
    const encontrado = tickets.find((t) => String(t.Folio).toLowerCase() === String(folioBuscado).toLowerCase());
    if (encontrado) onAbrirTicket(encontrado);
    else setAviso({ tipo: 'error', texto: `No encontré el ticket ${folioBuscado}. Puede que no exista o que no sea de los que tú puedes ver.` });
    onFolioAtendido();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folioBuscado, tickets]);

  const texto = normalizarParaFiltro(buscar);
  const filtrados = tickets.filter((t) => {
    if (filtroEstado === 'aviso' && !(t.Estado !== ESTADO_TICKET_CANCELADO && (t.Desactualizado || []).length > 0)) return false;
    if ((filtroEstado === 'Vigente' || filtroEstado === 'Cancelado') && (t.Estado === ESTADO_TICKET_CANCELADO ? 'Cancelado' : 'Vigente') !== filtroEstado) return false;
    if (!texto) return true;
    const donde = normalizarParaFiltro(
      [t.Folio, t.Cliente, t.Telefono, t.Vendedor, t.CreadoPor, renglonesDeTicket(t).map((it) => `${it.descripcion} ${it.codigo}`).join(' ')].join(' ')
    );
    return donde.includes(texto);
  });
  const visibles = recortarFilas(filtrados, limiteFilas);
  const conAviso = tickets.filter((t) => t.Estado !== ESTADO_TICKET_CANCELADO && (t.Desactualizado || []).length > 0).length;
  const totalVigentes = filtrados.filter((t) => t.Estado !== ESTADO_TICKET_CANCELADO).reduce((suma, t) => suma + (Number(t.Total) || 0), 0);

  // ---- Pedidos pagados sin ticket, juntos por clienta ----
  const productosDelLote = Array.from(new Set(pedidosParaTicket.map((p) => p.Producto).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  // Si el producto elegido ya no tiene pedidos pendientes de ticket (se les
  // acaba de generar), el filtro se quita solo.
  const productoElegido = productosDelLote.includes(filtroProducto) ? filtroProducto : '';
  const pedidosDelLote = productoElegido ? pedidosParaTicket.filter((p) => p.Producto === productoElegido) : pedidosParaTicket;
  const grupos = [];
  const grupoPorClave = {};
  pedidosDelLote.forEach((p) => {
    if (!grupoPorClave[p.ClaveCliente]) {
      grupoPorClave[p.ClaveCliente] = { clave: p.ClaveCliente, cliente: p.Cliente, telefono: p.Telefono, pedidos: [] };
      grupos.push(grupoPorClave[p.ClaveCliente]);
    }
    grupoPorClave[p.ClaveCliente].pedidos.push(p);
  });
  const gruposVisibles = recortarFilas(grupos, limiteClientes);
  // Solo cuenta (y solo se manda) lo marcado que SE ESTÁ VIENDO con el
  // filtro de producto: nunca se genera algo que no está a la vista.
  const pedidosMarcados = pedidosDelLote.filter((p) => elegidos.has(String(p.ID)));
  const elegidosVigentes = pedidosMarcados.map((p) => String(p.ID));
  const clientesElegidos = new Set(pedidosMarcados.map((p) => p.ClaveCliente)).size;
  const marcadosFueraDeVista = pedidosParaTicket.filter((p) => elegidos.has(String(p.ID))).length - pedidosMarcados.length;

  function alternarPedido(id) {
    setElegidos((antes) => {
      const copia = new Set(antes);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }
  function alternarGrupo(grupo) {
    const ids = grupo.pedidos.map((p) => String(p.ID));
    setElegidos((antes) => {
      const copia = new Set(antes);
      const todos = ids.every((id) => copia.has(id));
      ids.forEach((id) => (todos ? copia.delete(id) : copia.add(id)));
      return copia;
    });
  }
  function elegirLosQueSeVen() {
    setElegidos((antes) => {
      const copia = new Set(antes);
      pedidosDelLote.forEach((p) => copia.add(String(p.ID)));
      return copia;
    });
  }
  async function generarLote() {
    if (elegidosVigentes.length === 0 || generando) return;
    setGenerando(true);
    setAviso(null);
    const folios = [];
    const saltados = [];
    try {
      // El servidor recibe máximo 300 pedidos por vez: si son más, se manda
      // por partes, una tras otra.
      const TANDA = 250;
      for (let desde = 0; desde < elegidosVigentes.length; desde += TANDA) {
        // eslint-disable-next-line no-await-in-loop
        const res = await onCrear(elegidosVigentes.slice(desde, desde + TANDA), true);
        (res.creados || []).forEach((c) => folios.push(c.Folio));
        (res.omitidos || []).forEach((o) => saltados.push(o));
      }
      setElegidos(new Set());
      setAviso({
        tipo: 'ok',
        donde: 'lote',
        folios,
        texto:
          `Se ${folios.length === 1 ? 'generó el ticket' : `generaron ${folios.length} tickets:`} ${folios.length > 12 ? `${folios[0]} … ${folios[folios.length - 1]}` : folios.join(', ')}.` +
          (saltados.length > 0 ? ` Se ${saltados.length === 1 ? 'saltó 1 pedido' : `saltaron ${saltados.length} pedidos`}: ${saltados.slice(0, 3).map((o) => o.motivo).join(' ')}${saltados.length > 3 ? '…' : ''}` : ''),
      });
    } catch (err) {
      setAviso({
        tipo: 'error',
        donde: 'lote',
        texto: `${err.message || String(err)}${folios.length > 0 ? ` (Antes de fallar sí se generaron ${folios.length}: ${folios[0]} … ${folios[folios.length - 1]}.)` : ''}`,
      });
    } finally {
      setGenerando(false);
    }
  }
  function descargarVarios(lista, que) {
    try {
      bajarTicketsEnPDF(lista, configuracion);
      setAviso({ tipo: 'ok', texto: `Se descargó el PDF con ${que}. Búscalo en tus Descargas.` });
    } catch (err) {
      setAviso({ tipo: 'error', texto: `No se pudo armar el PDF: ${err.message}` });
    }
  }

  function guardarConfiguracion(cambios, textoListo) {
    setGuardandoConfig(true);
    setAvisoConfig(null);
    Promise.resolve(onGuardarConfiguracion(cambios))
      .then(() => {
        if (cambios.tienda) setTienda(null);
        setAvisoConfig({ tipo: 'ok', texto: textoListo });
      })
      .catch((err) => setAvisoConfig({ tipo: 'error', texto: err.message || String(err) }))
      .finally(() => {
        setGuardandoConfig(false);
        setAutomaticoElegido(null);
      });
  }

  // El aviso de lo último que se hizo. Sale donde se dio el clic: arriba
  // (descargas de la tabla) o junto a la lista de "por lote".
  const avisoJSX = aviso && (
    <p
      className={`${aviso.tipo === 'ok' ? 'ticket-listo' : 'info-msg error ticket-msg'} aviso-tocable`}
      role="status"
      data-ticket-aviso={aviso.donde || 'arriba'}
      title="Toca este aviso para quitarlo"
      onClick={(e) => { if (!(e.target.closest && e.target.closest('button'))) setAviso(null); }}
    >
      {aviso.tipo === 'ok' ? '✅ ' : ''}{aviso.texto}
      {aviso.tipo === 'ok' && aviso.folios && aviso.folios.length > 0 && (
        <button
          type="button"
          className="btn btn-secondary btn-small ticket-listo-boton"
          data-ticket-accion="pdf-recientes"
          onClick={() => {
            const folios = aviso.folios;
            descargarVarios(tickets.filter((t) => folios.includes(t.Folio)), folios.length === 1 ? `el ticket ${folios[0]}` : `esos ${folios.length} tickets`);
          }}
        >
          ⬇ Descargar {aviso.folios.length === 1 ? 'su PDF' : `los ${aviso.folios.length} en un PDF`}
        </button>
      )}
    </p>
  );

  return (
    <div className="tickets-tab">
      <AyudaMinimizable clave="tickets" titulo="Cómo funcionan los tickets">
        <p className="muted">
          Un <strong>ticket</strong> es el recibo de uno o varios pedidos <strong>pagados</strong> de la misma clienta. Se genera con el botón 🎫
          del pedido (en Pedidos), aquí abajo por lote, o solo al marcar "Pagado" si prendes el modo automático. Cada ticket lleva su{' '}
          <strong>folio</strong> y un <strong>código QR</strong>: al leerlo con la cámara del celular, la clienta ve su ticket y lo puede descargar
          otra vez (solo el ticket: no se abre nada del panel).
        </p>
        <p className="muted">
          El ticket es solo un documento: editarlo o cancelarlo <strong>no mueve pedidos, stock ni dinero</strong>. Para un reembolso se
          sigue usando Pedidos (desde el ticket hay un botón que te lleva a sus pedidos).
        </p>
      </AyudaMinimizable>

      {aviso && aviso.donde !== 'lote' && avisoJSX}

      {/* ---- Tickets generados ---- */}
      <div className="filtro-fechas">
        <label>
          Buscar ticket
          <input type="text" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Folio, clienta, teléfono, producto…" data-ticket-buscar />
        </label>
        <label>
          Ver
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="Vigente">Solo vigentes</option>
            <option value="Cancelado">Solo cancelados</option>
            <option value="aviso">Los que ya no coinciden con sus pedidos{conAviso > 0 ? ` (${conAviso})` : ''}</option>
          </select>
        </label>
        {(buscar || filtroEstado) && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => { setBuscar(''); setFiltroEstado(''); }}>
            Quitar filtros
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => descargarVarios(filtrados, `${filtrados.length} ticket${filtrados.length === 1 ? '' : 's'}`)}
          disabled={filtrados.length === 0}
          data-ticket-accion="pdf-todos"
          title="Baja en UN archivo PDF todos los tickets que se ven ahora (cada uno en su hoja)"
        >
          ⬇ {filtrados.length === 1 ? 'PDF del que se ve' : `PDF de los ${filtrados.length} que se ven`}
        </button>
      </div>
      <p className="muted">
        {filtrados.length} ticket{filtrados.length === 1 ? '' : 's'}
        {filtrados.length !== tickets.length ? ` de ${tickets.length}` : ''} · vigentes: {formatearMoneda(totalVigentes)}
        {conAviso > 0 && filtroEstado !== 'aviso' && (
          <button type="button" className="ticket-enlace-aviso" onClick={() => setFiltroEstado('aviso')}>
            ⚠️ {conAviso} ya no coincide{conAviso === 1 ? '' : 'n'} con sus pedidos
          </button>
        )}
      </p>
      <div className="table-scroll">
        <table className="data-table tickets-table">
          <thead>
            <tr>
              <th>Folio</th><th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Productos</th><th>Total</th><th>Estado</th><th>Le atendió</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody onClickCapture={marcarFilaActiva} onFocusCapture={marcarFilaActiva}>
            {visibles.map((t) => {
              const cancelado = t.Estado === ESTADO_TICKET_CANCELADO;
              const piezas = piezasDeTicket(t);
              return (
                <tr key={t.ID} className={cancelado ? 'ticket-fila-cancelada' : ''} data-ticket-fila={t.Folio}>
                  <td>
                    <button type="button" className="ticket-folio-boton" onClick={() => onAbrirTicket(t)} title={`Abrir el ticket ${t.Folio}`}>
                      <strong>{t.Folio}</strong>
                    </button>
                  </td>
                  <td>{formatearFechaHora(t.FechaCompra || t.Fecha)}</td>
                  <td><CeldaTruncada texto={t.Cliente || '—'} /></td>
                  <td>{t.Telefono || '—'}</td>
                  <td>
                    <CeldaTruncada texto={renglonesDeTicket(t).map((it) => `${it.cantidad} x ${it.descripcion}`).join(' · ') || '—'} />
                    <span className="muted ticket-piezas">{piezas} pieza{piezas === 1 ? '' : 's'}</span>
                  </td>
                  <td className="mov-numero">{formatearMoneda(Number(t.Total) || 0)}</td>
                  <td>
                    {cancelado ? <span className="ticket-chip ticket-chip-cancelado">Cancelado</span> : <span className="ticket-chip ticket-chip-vigente">Vigente</span>}
                    {!cancelado && (t.Desactualizado || []).length > 0 && (
                      <span className="ticket-chip ticket-chip-aviso" title="Alguno de sus pedidos ya no está pagado. Ábrelo para verlo.">⚠️ Revisar</span>
                    )}
                  </td>
                  <td><CeldaTruncada texto={t.Vendedor || t.CreadoPor || '—'} /></td>
                  <td className="ticket-acciones-celda">
                    <button type="button" className="btn btn-small" onClick={() => onAbrirTicket(t)} data-ticket-accion="ver">Ver</button>
                    {onVerPedidos && (t.PedidoIDs || []).length > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => onVerPedidos(t)}
                        data-ticket-accion="mostrar-en-pedidos"
                        title={`Ir a Pedidos y ver iluminado${(t.PedidoIDs || []).length === 1 ? ' el pedido' : 's los ' + (t.PedidoIDs || []).length + ' pedidos'} del ticket ${t.Folio}`}
                      >
                        📋 Mostrar en pedidos
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => descargarVarios([t], `el ticket ${t.Folio}`)} data-ticket-accion="pdf-fila" title={`Descargar el ticket ${t.Folio} en PDF`}>
                      ⬇ PDF
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {tickets.length === 0 && <p className="info-msg">Todavía no hay ningún ticket. Genera el primero aquí abajo, o con el botón 🎫 de un pedido pagado.</p>}
        {tickets.length > 0 && filtrados.length === 0 && <p className="info-msg">Ningún ticket coincide con lo que buscas.</p>}
      </div>
      <BarraFilas total={filtrados.length} visibles={visibles.length} limite={limiteFilas} onCambiar={setLimiteFilas} nombre="tickets" />

      {/* ---- Pedidos pagados sin ticket (por lote) ---- */}
      <section className="tickets-lote">
        <h3>Pedidos pagados sin ticket <span className="orden-conteo">({pedidosParaTicket.length})</span></h3>
        {aviso && aviso.donde === 'lote' && avisoJSX}
        {pedidosParaTicket.length === 0 ? (
          <p className="muted">Todos los pedidos pagados que puedes ver ya tienen su ticket.</p>
        ) : (
          <>
            <p className="muted">
              Marca los pedidos y genera sus tickets de un jalón: sale <strong>un ticket por clienta</strong> (se juntan sus pedidos marcados).
              Con "Producto" puedes quedarte solo con los pedidos de un producto.
            </p>
            <div className="filtro-fechas">
              <label>
                Producto
                <select value={productoElegido} onChange={(e) => setFiltroProducto(e.target.value)} data-ticket-producto>
                  <option value="">Todos los productos</option>
                  {productosDelLote.map((nombre) => (
                    <option key={nombre} value={nombre}>{nombre}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-secondary btn-small" onClick={elegirLosQueSeVen} disabled={generando} data-ticket-accion="marcar-todos">
                {pedidosDelLote.length === 1 ? 'Marcar el que se ve' : `Marcar los ${pedidosDelLote.length} que se ven`}
              </button>
              {(elegidosVigentes.length > 0 || marcadosFueraDeVista > 0) && (
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setElegidos(new Set())} disabled={generando}>
                  Quitar marcas
                </button>
              )}
              <button type="button" className="btn btn-primary btn-small" onClick={generarLote} disabled={generando || elegidosVigentes.length === 0} data-ticket-accion="generar-lote">
                {generando
                  ? 'Generando…'
                  : elegidosVigentes.length === 0
                    ? '🎫 Generar tickets'
                    : `🎫 Generar ${clientesElegidos} ticket${clientesElegidos === 1 ? '' : 's'} (${elegidosVigentes.length} pedido${elegidosVigentes.length === 1 ? '' : 's'})`}
              </button>
            </div>
            {marcadosFueraDeVista > 0 && (
              <p className="muted">
                Tienes {marcadosFueraDeVista} pedido{marcadosFueraDeVista === 1 ? '' : 's'} marcado{marcadosFueraDeVista === 1 ? '' : 's'} de otros productos que
                ahora no se ve{marcadosFueraDeVista === 1 ? '' : 'n'}: solo se generan los que están a la vista.
              </p>
            )}
            <ul className="tickets-lote-grupos">
              {gruposVisibles.map((g) => {
                const ids = g.pedidos.map((p) => String(p.ID));
                const marcados = ids.filter((id) => elegidos.has(id)).length;
                const totalGrupo = g.pedidos.reduce((suma, p) => suma + p.Cantidad * p.Precio, 0);
                const sinResolver = Math.max(0, ...g.pedidos.map((p) => p.SinResolver || 0));
                return (
                  <li key={g.clave} className="tickets-lote-grupo" data-ticket-cliente={g.cliente}>
                    <label className="tickets-lote-cliente">
                      <input
                        type="checkbox"
                        checked={marcados === ids.length}
                        ref={(el) => { if (el) el.indeterminate = marcados > 0 && marcados < ids.length; }}
                        onChange={() => alternarGrupo(g)}
                        disabled={generando}
                      />
                      <strong>{g.cliente || 'Cliente sin nombre'}</strong>
                      {g.telefono && <span className="muted">{g.telefono}</span>}
                      <span className="tickets-lote-total">{g.pedidos.length} pedido{g.pedidos.length === 1 ? '' : 's'} · {formatearMoneda(totalGrupo)}</span>
                    </label>
                    {sinResolver > 0 && (
                      <p className="ticket-aviso-espera">
                        ⏳ Todavía tiene {sinResolver} pedido{sinResolver === 1 ? '' : 's'} de esta compra sin resolver (Pendiente o En proceso).
                      </p>
                    )}
                    <ul className="ticket-lote-lista">
                      {g.pedidos.map((p) => (
                        <li key={p.ID}>
                          <label>
                            <input type="checkbox" checked={elegidos.has(String(p.ID))} onChange={() => alternarPedido(String(p.ID))} disabled={generando} data-ticket-pedido={p.ID} />
                            <span className="ticket-lote-producto">{p.Cantidad} x {p.Producto}{p.Codigo ? ` (${p.Codigo})` : ''}{p.SucursalNombre ? ` · 🏪 ${p.SucursalNombre}` : ''}</span>
                            <span className="ticket-lote-fecha">{formatearFechaHora(p.Fecha)}</span>
                            <span className="ticket-lote-importe">{formatearMoneda(p.Cantidad * p.Precio)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <BarraFilas total={grupos.length} visibles={gruposVisibles.length} limite={limiteClientes} onCambiar={setLimiteClientes} nombre="clientas" />
          </>
        )}
      </section>

      {/* ---- Modo automático y datos de la tienda ---- */}
      <section className="tickets-config">
        <h3>⚙️ Modo automático y datos de la tienda</h3>
        {avisoConfig && (
          <p className={`${avisoConfig.tipo === 'ok' ? 'ticket-listo' : 'info-msg error ticket-msg'} aviso-tocable`} role="status" title="Toca este aviso para quitarlo" onClick={() => setAvisoConfig(null)}>
            {avisoConfig.tipo === 'ok' ? '✅ ' : ''}{avisoConfig.texto}
          </p>
        )}
        <label className={`tickets-interruptor ${automaticos ? 'tickets-interruptor-prendido' : ''}`}>
          <input
            type="checkbox"
            checked={automaticos}
            disabled={!puedeConfigurar || guardandoConfig}
            data-ticket-automatico
            onChange={(e) => {
              const prender = e.target.checked;
              setAutomaticoElegido(prender);
              guardarConfiguracion(
                { automaticos: prender },
                prender
                  ? 'Modo automático PRENDIDO: el ticket sale solo al marcar "Pagado".'
                  : 'Modo automático APAGADO: los tickets se generan solo a mano.'
              );
            }}
          />
          <span>
            <strong>Generar el ticket solo al marcar "Pagado"</strong> — está {automaticos ? 'PRENDIDO' : 'APAGADO'}.
            <span className="muted tickets-interruptor-nota">
              Prendido: en cuanto un pedido queda "Pagado" sale su ticket. Si esa clienta tiene más pedidos de la misma compra (hechos con
              menos de {HORAS_MISMA_COMPRA} horas de diferencia) todavía Pendientes o En proceso, espera a que se resuelvan todos y saca uno
              solo. Apagado: solo se generan a mano.
            </span>
          </span>
        </label>
        {!puedeConfigurar && <p className="muted">Solo un Administrador puede cambiar esto y los datos de la tienda.</p>}
        <div className="tickets-tienda">
          <label className="modal-field">
            Nombre de la tienda
            <input value={tiendaVista.nombre || ''} maxLength={60} disabled={!puedeConfigurar || guardandoConfig} onChange={(e) => setTienda({ ...tiendaVista, nombre: e.target.value })} placeholder="Ej. Bolsas Claudia" data-tienda="nombre" />
          </label>
          <label className="modal-field">
            Teléfono
            <input value={tiendaVista.telefono || ''} maxLength={40} disabled={!puedeConfigurar || guardandoConfig} onChange={(e) => setTienda({ ...tiendaVista, telefono: e.target.value })} placeholder="Ej. 55 1234 5678" data-tienda="telefono" />
          </label>
          <label className="modal-field tickets-tienda-ancho">
            Dirección
            <input value={tiendaVista.direccion || ''} maxLength={160} disabled={!puedeConfigurar || guardandoConfig} onChange={(e) => setTienda({ ...tiendaVista, direccion: e.target.value })} placeholder="Calle, número, colonia, ciudad" data-tienda="direccion" />
          </label>
          <label className="modal-field tickets-tienda-ancho">
            Mensaje al final del ticket
            <input value={tiendaVista.mensaje || ''} maxLength={200} disabled={!puedeConfigurar || guardandoConfig} onChange={(e) => setTienda({ ...tiendaVista, mensaje: e.target.value })} placeholder="Ej. ¡Gracias por tu compra!" data-tienda="mensaje" />
          </label>
        </div>
        {puedeConfigurar && (
          <div className="tickets-tienda-botones">
            <button type="button" className="btn btn-primary btn-small" disabled={!tiendaCambio || guardandoConfig} data-ticket-accion="guardar-tienda" onClick={() => guardarConfiguracion({ tienda }, 'Datos de la tienda guardados. Salen en los tickets que descargues desde ahora (también en los ya generados).')}>
              {guardandoConfig ? 'Guardando…' : '💾 Guardar datos de la tienda'}
            </button>
            {tiendaCambio && (
              <button type="button" className="btn btn-secondary btn-small" disabled={guardandoConfig} onClick={() => setTienda(null)}>
                Descartar
              </button>
            )}
            {!tiendaGuardada.nombre && <span className="muted">Mientras no pongas el nombre, el ticket sale sin encabezado de tienda.</span>}
          </div>
        )}
      </section>
    </div>
  );
}

// ---- Avisos que se quitan solos (2026-10-07) ----
// Claudia, con captura del aviso "🎫 Se generó el ticket T-00012.": "esos
// avisos deben de tener sus tiempos de estar, ya que si siempre están ahí no
// es versátil, o que también al tocarlos se desvanezcan".
// Ahora un aviso se desvanece solo a los pocos segundos (uno largo dura un
// poco más, para que dé tiempo de leerlo; un error dura bastante más) y
// también al tocarlo. Los que describen algo que SIGUE pasando ("Sigue
// cargando…", "Una acción está tardando…") no se quitan por tiempo: esos los
// quita el panel cuando la situación termina (pero sí al tocarlos).
const DURACION_AVISO_MS = 9000;
const DURACION_AVISO_MAXIMA_MS = 20000;
const DURACION_AVISO_ERROR_MS = 25000;
const DESVANECER_AVISO_MS = 400;

function avisoDescribeAlgoEnCurso(texto) {
  return texto === AVISO_PONIENDOSE_AL_DIA || texto === AVISO_ESPERA_CANCELADA ||
    texto.startsWith('Sigue cargando') || texto.startsWith('Error al cargar datos');
}

function duracionDeAviso(texto) {
  if (avisoDescribeAlgoEnCurso(texto)) return 0;
  if (texto.startsWith('Error')) return DURACION_AVISO_ERROR_MS;
  return Math.min(DURACION_AVISO_MAXIMA_MS, DURACION_AVISO_MS + texto.length * 45);
}

// El aviso de arriba del panel. "onQuitar(texto)" lo borra (solo si sigue
// siendo ese mismo texto: uno más nuevo no se toca).
function MensajeDelPanel({ texto, onQuitar }) {
  const [saliendo, setSaliendo] = useState(false);
  const onQuitarRef = useRef(onQuitar);
  onQuitarRef.current = onQuitar;
  useEffect(() => {
    setSaliendo(false);
    const dura = texto ? duracionDeAviso(texto) : 0;
    if (!(dura > 0)) return undefined;
    const reloj = setTimeout(() => setSaliendo(true), dura);
    return () => clearTimeout(reloj);
  }, [texto]);
  useEffect(() => {
    if (!saliendo) return undefined;
    const reloj = setTimeout(() => onQuitarRef.current(texto), DESVANECER_AVISO_MS);
    return () => clearTimeout(reloj);
  }, [saliendo, texto]);
  if (!texto) return null;
  return (
    <p
      className={`info-msg ${texto.startsWith('Error') ? 'error' : 'aviso'} mensaje-temporal ${saliendo ? 'mensaje-temporal-saliendo' : ''}`}
      role="status"
      title="Toca este aviso para quitarlo"
      onClick={() => setSaliendo(true)}
      data-mensaje-panel
    >
      {texto}
      <span className="mensaje-temporal-x" aria-hidden="true">✕</span>
    </p>
  );
}

// ---- Oferta propia de una sucursal (2026-10-08) ----
// En "Mi sucursal", por producto: "🔥 $250" (o "—") y un ✏️ para ponerla,
// cambiarla o quitarla. Debe ser menor que el precio normal.
function OfertaDeSucursal({ producto, ocupado, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const normal = Number(producto.precio) || 0;
  const actual = Number(producto.precioOferta) || 0;
  const escrito = String(valor).trim();
  const numero = Number(escrito);
  const malo = escrito !== '' && (!Number.isFinite(numero) || numero < 0 || (numero > 0 && !(numero < normal)));
  function abrir() {
    setValor(actual > 0 ? String(actual) : '');
    setEditando(true);
  }
  function guardar(precio) {
    Promise.resolve(onGuardar(precio)).then(() => setEditando(false), () => {});
  }
  if (!editando) {
    return (
      <span className="sucursal-oferta" data-oferta-sucursal={actual > 0 ? 'si' : 'no'}>
        {/* (2026-10-09, Claudia: "no está mostrando correctamente los
            tachados") El precio normal TACHADO junto al de oferta, igual que
            en Stock y en el catálogo. */}
        {actual > 0 ? (
          <span className="sucursal-oferta-precios" title="En oferta en esta sucursal — este es el precio que se cobra aquí">
            <s className="precio-tachado">{formatearMoneda(normal)}</s>
            <span className="sucursal-oferta-precio">🔥 {formatearMoneda(actual)}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        )}
        <button type="button" className="btn btn-secondary btn-chip" onClick={abrir} disabled={ocupado} data-oferta-editar>
          {actual > 0 ? '✏️' : '+ Oferta'}
        </button>
      </span>
    );
  }
  return (
    <span className="sucursal-oferta sucursal-oferta-editando">
      <input
        type="text"
        inputMode="decimal"
        value={valor}
        onChange={(e) => setValor(e.target.value.replace(/[^0-9.]/g, '').slice(0, 10))}
        placeholder={`Menos de ${normal}`}
        className={malo ? 'pedido-reembolso-mal' : ''}
        aria-label="Precio de oferta en esta sucursal"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !malo && escrito !== '') guardar(escrito);
          if (e.key === 'Escape') setEditando(false);
        }}
        data-oferta-precio
      />
      <button type="button" className="btn btn-primary btn-chip" disabled={ocupado || malo || escrito === ''} onClick={() => guardar(escrito)} data-oferta-guardar>
        Guardar
      </button>
      {actual > 0 && (
        <button type="button" className="btn btn-secondary btn-chip" disabled={ocupado} onClick={() => guardar('')} data-oferta-quitar>
          Quitar
        </button>
      )}
      <button type="button" className="btn btn-secondary btn-chip" onClick={() => setEditando(false)} aria-label="Cancelar">✕</button>
      {malo && <span className="pedido-reembolso-error">Debe ser menor que {formatearMoneda(normal)}.</span>}
    </span>
  );
}

// ---- Lo vendido hoy / esta semana / este mes (2026-10-08) ----
// Claudia: "quiero que podamos ver rápidamente por vendedor cuánto hemos
// vendido en el día, en la semana y en el mes, en Pedidos y Sucursales, a
// lado de los filtros… eso es personal por usuario". Suma los pagos de
// pedidos menos sus reembolsos (lo que el servidor manda en
// "ventasRecientes"). "nombre": de quién (null = de todos, solo para
// Admin). La semana empieza el lunes; todo con la hora de esta computadora.
function sumaDeVentas(ventas, nombre) {
  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const diaSemana = (ahora.getDay() + 6) % 7; // 0 = lunes
  const inicioSemana = inicioDia - diaSemana * 24 * 3600 * 1000;
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  const suma = { hoy: 0, semana: 0, mes: 0 };
  (ventas || []).forEach((v) => {
    if (nombre !== null && v.u !== nombre) return;
    const t = new Date(v.f).getTime();
    if (Number.isNaN(t)) return;
    const monto = Number(v.m) || 0;
    if (t >= inicioDia) suma.hoy += monto;
    if (t >= inicioSemana) suma.semana += monto;
    if (t >= inicioMes) suma.mes += monto;
  });
  return suma;
}
function ResumenDeVentas({ ventas, nombre, esMio }) {
  if (nombre === undefined || nombre === '') return null;
  const suma = sumaDeVentas(ventas, nombre);
  const quien = nombre === null ? 'Todos' : esMio ? 'Yo' : nombre;
  const dinero = (n) => formatearMoneda(Math.round(n * 100) / 100);
  return (
    <span
      className="resumen-ventas"
      title={`Lo vendido por ${nombre === null ? 'todos' : esMio ? `ti (${nombre})` : nombre}: pagos de pedidos menos reembolsos. La semana cuenta desde el lunes.`}
      data-resumen-ventas
    >
      <span className="resumen-ventas-quien">💰 {quien}:</span>
      <span>Hoy <strong data-venta-hoy>{dinero(suma.hoy)}</strong></span>
      <span>Semana <strong data-venta-semana>{dinero(suma.semana)}</strong></span>
      <span>Mes <strong data-venta-mes>{dinero(suma.mes)}</strong></span>
    </span>
  );
}

// Para los avisos de adentro de una pestaña: los quita solos pasado "ms"
// (0 = no se quita por tiempo).
function useQuitarSolo(valor, quitar, ms) {
  const quitarRef = useRef(quitar);
  quitarRef.current = quitar;
  useEffect(() => {
    if (!valor || !(ms > 0)) return undefined;
    const reloj = setTimeout(() => quitarRef.current(), ms);
    return () => clearTimeout(reloj);
  }, [valor, ms]);
}

// El aviso mini de Pedidos (2026-10-07; desde el 2026-10-08 empieza
// MINIMIZADO: Claudia, "que no sature la vista, que esté minimizado"): es un
// 💡 al final de "Pedidos por estado"; al tocarlo explica en una línea que al
// tocar un pedido se iluminan en amarillo los demás productos que ese mismo
// cliente pidió juntos. Se vuelve a minimizar solo a los pocos segundos.
const DURACION_AVISO_COMPRA_MS = 12000;
function AvisoDeCompra() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (!abierto) return undefined;
    const reloj = setTimeout(() => setAbierto(false), DURACION_AVISO_COMPRA_MS);
    return () => clearTimeout(reloj);
  }, [abierto]);
  if (!abierto) {
    return (
      <button
        type="button"
        className="compra-aviso-mini"
        onClick={() => setAbierto(true)}
        title="¿Cómo ver juntos los productos de un mismo pedido?"
        aria-label="Ver el aviso de pedidos de varios productos"
        data-compra-aviso="mini"
      >
        💡
      </button>
    );
  }
  return (
    <span className="compra-aviso" role="note" data-compra-aviso="abierto">
      <span className="compra-aviso-texto">
        💡 Toca un pedido: se iluminan en <strong>amarillo</strong> los demás productos que ese mismo cliente pidió juntos, y arriba de la tabla sale una barrita para cambiarles el estatus a todos y guardarlos de un jalón.
      </span>
      <button type="button" className="compra-aviso-cerrar" onClick={() => setAbierto(false)} title="Minimizar este aviso (queda el 💡 para volver a leerlo)" aria-label="Minimizar este aviso">
        ✕
      </button>
    </span>
  );
}

// (2026-10-07) El motivo de un reembolso, MINIMIZADO: un botoncito
// "📝 Motivo" que al tocarlo enseña el texto completo (y otra vez lo
// guarda). Claudia: "que pueda verlo… pero minimizable para que no desborde".
// Se usa en el renglón del pedido y en los avisos de reembolso.
function MotivoMinimizable({ texto, abiertoAlInicio = false }) {
  const [abierto, setAbierto] = useState(abiertoAlInicio);
  const motivo = String(texto || '').trim();
  if (!motivo) return null;
  return (
    <span className={`motivo-mini ${abierto ? 'motivo-mini-abierto' : ''}`} data-motivo-reembolso={abierto ? 'abierto' : 'cerrado'}>
      <button
        type="button"
        className="motivo-mini-boton"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        title={abierto ? 'Ocultar el motivo' : `Ver por qué se reembolsa: ${motivo}`}
      >
        📝 Motivo {abierto ? '▴' : '▾'}
      </button>
      {abierto && <span className="motivo-mini-texto">{motivo}</span>}
    </span>
  );
}

function PedidoRow({
  pedido,
  categoria,
  codigo,
  duenos = [],
  sucursalNombre = '',
  usuarioId,
  puedeSaltarCandado,
  soloDeSuSucursal = false,
  puedeReembolsar,
  montoReembolsado,
  solicitudReembolsoPendiente,
  resaltado,
  destello = false,
  enCompraActiva = false,
  ordenGeneral = null,
  guardandoJunto = false,
  onRegistrarPendiente,
  ticket,
  puedeGenerarTicket = false,
  onTicket,
  onGuardar,
  onDirtyChange,
  onAbrirNota,
}) {
  // Etapa 4 (Pedidos por dueño) — REDISEÑADO 2026-09-28 a pedido explícito
  // de Claudia. Diseño anterior (2026-09-26): cualquier Admin/Admin Central
  // tenía edición total automática (`controlTotal`) y solo Estado/Cantidad
  // se bloqueaban; Teléfono/Notas quedaban siempre editables. Claudia pidió
  // corregir eso:
  //   1. Teléfono y Notas se bloquean IGUAL que Estado/Cantidad — los 4
  //      campos, sin excepción, si el pedido no es tuyo.
  //   2. Un Administrador NORMAL (no Admin Central) ya NO tiene edición
  //      automática — ve el pedido ajeno bloqueado en gris, IGUAL que un
  //      Vendedor, para evitar un clic accidental sobre información de
  //      ventas de otra persona.
  //   3. Solo el Admin Central puede saltarse el bloqueo, y NUNCA en
  //      silencio: aparece un candado 🔒 que, al dar clic, pide una
  //      confirmación explícita antes de desbloquear esa fila en concreto.
  //   4. Cualquier otra persona (Admin normal o Vendedor) solo obtiene esa
  //      misma capacidad si se le concede a propósito desde 🔐 Permisos
  //      (permiso especial nuevo "candadoPedidos", por Rol o por persona,
  //      APAGADO por default para todos salvo el Admin Central).
  // `puedeSaltarCandado` ya viene calculado desde el componente padre como
  // `esAdminCentral || permisos.candadoPedidos` — aquí solo se usa.
  const soyDuenoDelPedido = duenos.some((d) => String(d.usuarioId) === String(usuarioId) && d.cantidad > 0);
  const sinDuenoAsignado = duenos.length === 0;
  // El candado empieza CERRADO siempre que la fila se dibuja — no se
  // recuerda entre refrescos ni entre pedidos, a propósito: cada vez que se
  // vaya a tocar un pedido ajeno hay que confirmar de nuevo, nunca queda
  // "desbloqueado para siempre" por accidente.
  const [candadoAbierto, setCandadoAbierto] = useState(false);
  const puedoEditarPedido = soyDuenoDelPedido || sinDuenoAsignado || (puedeSaltarCandado && candadoAbierto);

  // Aviso flotante (tipo comentario de Word) de esta fila — ver
  // "AvisoFlotante" arriba. Solo uno a la vez; cada tipo se ancla al campo o
  // iconito que lo provocó:
  //   'reabrir'             → al menú de Estado (se intentó reabrir un
  //                           Cancelado de hace más de 1 hora)
  //   'reembolsoSinPermiso' → al menú de Estado (se eligió "Reembolsado" sin
  //                           tener el permiso directo)
  //   'noEsTuyo'            → al iconito 🔒 (pedido ajeno)
  //   'candadoAbierto'      → al iconito 🔓 (se acaba de desbloquear)
  //   'solicitudPendiente'  → al iconito ⏳ (ya se mandó la solicitud)
  const [avisoAbierto, setAvisoAbierto] = useState(null);
  const selectEstadoRef = useRef(null);
  const iconoCandadoRef = useRef(null);
  const iconoCandadoAbiertoRef = useRef(null);
  const iconoPendienteRef = useRef(null);
  const anclaDelAviso = {
    reabrir: selectEstadoRef,
    reembolsoSinPermiso: selectEstadoRef,
    noEsTuyo: iconoCandadoRef,
    candadoAbierto: iconoCandadoAbiertoRef,
    solicitudPendiente: iconoPendienteRef,
  }[avisoAbierto] || null;
  function alternarAviso(tipo) {
    setAvisoAbierto((actual) => (actual === tipo ? null : tipo));
  }

  function handleAbrirCandado() {
    const confirmar = window.confirm(
      'Vas a alterar información de ventas de un producto que no es tuyo. ¿Seguro que quieres continuar?'
    );
    if (confirmar) {
      setCandadoAbierto(true);
      setAvisoAbierto('candadoAbierto');
    } else {
      setAvisoAbierto(null);
    }
  }

  // Corrección 2026-09-28 (reportada por Claudia): faltaba la manera de
  // "quitar" el candado otra vez después de haberlo abierto — la única forma
  // de volver a bloquear la fila era refrescar toda la página. Volver a
  // bloquear es la dirección segura (nunca alteras nada al hacerlo), así que
  // esto no pide confirmación, a diferencia de abrirlo.
  function handleCerrarCandado() {
    setCandadoAbierto(false);
    setAvisoAbierto(null);
  }

  const [cantidad, setCantidad] = useState(pedido.Cantidad);
  const [telefono, setTelefono] = useState(() => textoSeguro(pedido.Telefono));
  const [notas, setNotas] = useState(() => notasIniciales(pedido));
  const [estado, setEstado] = useState(pedido.Estado);
  // Monto que se va a registrar como "Cargo" si guardas este pedido con
  // Estado = "Reembolsado". Se precarga con el total del pedido en cuanto
  // eliges "Reembolsado" en el menú, pero se puede borrar y escribir otro
  // número (por ejemplo, para un reembolso parcial).
  const [montoReembolso, setMontoReembolso] = useState('');
  // (2026-10-07) Por qué se reembolsa: obligatorio (ver la cajita de abajo).
  const [motivoReembolso, setMotivoReembolso] = useState('');
  const [guardando, setGuardando] = useState(false);
  const llave = `pedido:${pedido.ID}`;

  const telefonoOriginal = textoSeguro(pedido.Telefono);
  const notasOriginal = notasIniciales(pedido);
  const precioPedido = precioDelPedido(pedido);
  const totalPedido = precioPedido !== null ? precioPedido * (Number(cantidad) || 0) : null;

  // Arreglo (2026-09-30, reportado por Claudia): "haySolicitudPendienteReembolso"
  // significa que YA se mandó la solicitud de este reembolso al Administrador
  // (viene del servidor, ver "solicitudReembolsoPendientePorPedidoId" en el
  // componente padre) — mientras esté pendiente, que el Estado elegido
  // ("Reembolsado") no coincida todavía con el Estado real del pedido
  // ("Pagado") ya NO cuenta como "un cambio sin guardar": ya se guardó, lo
  // único que falta es que el Administrador la confirme o la cancele, y eso
  // no depende de esta pantalla. Antes, al no distinguir estos dos casos, la
  // fila se quedaba marcada como "sin guardar" (y bloqueando la salida de la
  // página con el aviso del navegador) hasta que el Administrador respondía.
  const haySolicitudPendienteReembolso = !!solicitudReembolsoPendiente;
  const cambioCantidad = String(cantidad) !== String(pedido.Cantidad);
  const cambioTelefono = telefono !== telefonoOriginal;
  const cambioNotas = notas !== notasOriginal;
  const cambioEstado = estado !== pedido.Estado && !(haySolicitudPendienteReembolso && estado === 'Reembolsado');
  const sinGuardar = cambioCantidad || cambioTelefono || cambioNotas || cambioEstado;

  // Reembolsos (2026-10-07, pedido por Claudia): al elegir "Reembolsado" la
  // cajita de monto ya trae escrito el TOTAL del pedido ("para evitar
  // reescribir"), y se puede cambiar por menos (reembolso parcial) pero
  // nunca por más de lo que costó el pedido. Lo que ahora obliga a
  // detenerse antes de guardar es el MOTIVO: hay que escribir por qué se
  // reembolsa. (El 2026-09-30 la cajita se había dejado vacía a propósito
  // para que nadie guardara sin revisar; ese papel lo hace ahora el motivo.)
  // Un pedido sin precio guardado vale $0 para el servidor: su tope es $0.
  // (2026-10-08) El tope es lo que se COBRÓ: la cantidad guardada del pedido
  // (no la que se esté escribiendo en la cajita; el servidor no deja cambiar
  // la cantidad en el mismo guardado que el reembolso).
  const topeReembolso = precioPedido !== null ? Math.round(precioPedido * (Number(pedido.Cantidad) || 1) * 100) / 100 : 0;
  function handleCambiarEstado(nuevoEstado) {
    // Aviso flotante (2026-09-30, pedido por Claudia): "En proceso" se
    // sigue OFRECIENDO en el menú de un Cancelado aunque ya haya pasado la
    // 1a hora — así el aviso sale justo cuando alguien intenta reabrirlo (y
    // no pegado en la celda todo el tiempo). El cambio NO se aplica: el
    // menú se queda en "Cancelado".
    if (pedido.Estado === 'Cancelado' && nuevoEstado === 'En proceso' && !puedeReabrirCancelado) {
      setAvisoAbierto('reabrir');
      return;
    }
    if (nuevoEstado === 'Reembolsado' && estado !== 'Reembolsado') {
      setMontoReembolso(String(topeReembolso));
      setMotivoReembolso('');
      if (!puedeReembolsar && !haySolicitudPendienteReembolso) setAvisoAbierto('reembolsoSinPermiso');
    } else {
      setAvisoAbierto(null);
    }
    setEstado(nuevoEstado);
  }

  // "reembolsoYaConfirmado": el pedido YA quedó guardado como Reembolsado
  // en el servidor (viene del Estado real del pedido, no de lo que esté
  // elegido sin guardar todavía) — a partir de aquí la cajita de monto ya
  // no debe aparecer NUNCA más, solo un texto fijo con lo que se reembolsó.
  // "seleccionandoReembolsoPendiente": se eligió "Reembolsado" pero
  // TODAVÍA no se ha guardado — aquí es cuando sí debe verse la cajita
  // (editable) para escribir el monto.
  const reembolsoYaConfirmado = pedido.Estado === 'Reembolsado';
  const seleccionandoReembolsoPendiente = estado === 'Reembolsado' && !reembolsoYaConfirmado;
  // Bloquea "Guardar" (lo deja en gris) mientras se esté por marcar
  // "Reembolsado" y falte algo: un monto válido (mayor a $0 y sin pasar del
  // total del pedido; si el pedido es de $0, solo $0) o el motivo. El
  // servidor revisa lo mismo. Con una solicitud ya enviada no se pide nada.
  const montoEscrito = String(montoReembolso).trim();
  const montoNumero = Number(montoEscrito);
  const pidiendoReembolso = seleccionandoReembolsoPendiente && !haySolicitudPendienteReembolso;
  const montoPasaDelTope = pidiendoReembolso && montoEscrito !== '' && Number.isFinite(montoNumero) && montoNumero > topeReembolso;
  const montoMalEscrito = pidiendoReembolso && (
    montoEscrito === '' || !Number.isFinite(montoNumero) || montoNumero < 0 || (topeReembolso > 0 && !(montoNumero > 0))
  );
  const faltaMotivoReembolso = pidiendoReembolso && motivoReembolso.trim() === '';
  const montoReembolsoInvalido = montoMalEscrito || montoPasaDelTope || faltaMotivoReembolso;
  const tituloReembolsoIncompleto = montoPasaDelTope
    ? `No se puede reembolsar más de ${formatearMoneda(topeReembolso)} (lo que costó este pedido)`
    : montoMalEscrito
      ? 'Escribe el monto a reembolsar antes de guardar'
      : faltaMotivoReembolso
        ? 'Escribe por qué se reembolsa antes de guardar'
        : '';
  // El motivo ya guardado: el del pedido reembolsado o, mientras espera
  // respuesta, el de su solicitud.
  const motivoGuardado = String(
    (reembolsoYaConfirmado ? pedido.MotivoReembolso : haySolicitudPendienteReembolso ? solicitudReembolsoPendiente.Motivo : '') || ''
  ).trim();

  // Candado nuevo (2026-09-30): un pedido "Cancelado" ya no se puede
  // regresar a "En proceso" después de 1 hora de haberse cancelado. El
  // servidor YA lo rechaza (ver Code.gs) — esto es solo para no siquiera
  // OFRECER esa opción en el menú si ya se sabe que se va a rechazar. Un
  // pedido de ANTES de que existiera la columna "FechaCambioEstado" se
  // trata como "ya pasó el límite", mismo criterio que usa el servidor.
  const LIMITE_REABRIR_CANCELADO_MS = 60 * 60 * 1000; // 1 hora
  const puedeReabrirCancelado =
    pedido.Estado === 'Cancelado' &&
    !!pedido.FechaCambioEstado &&
    Date.now() - new Date(pedido.FechaCambioEstado).getTime() <= LIMITE_REABRIR_CANCELADO_MS;

  // OJO: este efecto depende de los VALORES actuales (cantidad, telefono,
  // notas, estado), no solo de los booleanos "cambió sí/no". Si solo
  // dependiera de los booleanos, una vez que "cambioTelefono" pasa a true
  // ya no se vuelve a ejecutar con cada letra que seguías escribiendo, y el
  // aviso se quedaba pegado mostrando solo el primer caracter que tecleaste
  // (por ejemplo mostraba "2" en vez del teléfono completo). También por
  // esto el aviso a veces no se apagaba después de guardar.
  useEffect(() => {
    const cambios = [];
    if (cambioCantidad) cambios.push(`Cantidad: ${pedido.Cantidad} → ${cantidad || 0}`);
    if (cambioTelefono) cambios.push(`Teléfono: "${telefonoOriginal || 'vacío'}" → "${telefono || 'vacío'}"`);
    if (cambioNotas) cambios.push(`Notas: "${notasOriginal || 'sin nota'}" → "${notas || 'sin nota'}"`);
    if (cambioEstado) cambios.push(`Estado: ${etiquetaEstadoPedido(pedido.Estado)} → ${etiquetaEstadoPedido(estado)}`);
    const descripcion = cambios.length > 0 ? `Pedido de ${pedido.Cliente} — ${cambios.join(' · ')}` : '';
    onDirtyChange(llave, sinGuardar, descripcion);
    return () => onDirtyChange(llave, false, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cantidad, telefono, notas, estado, pedido, llave, haySolicitudPendienteReembolso]);

  // Lo que se manda al guardar. Con una solicitud de reembolso ya enviada el
  // menú sigue en "Reembolsado", pero el pedido de verdad sigue como estaba:
  // se manda su Estado real (no se vuelve a pedir el reembolso).
  function cambioParaGuardar() {
    if (haySolicitudPendienteReembolso && estado === 'Reembolsado') return { cantidad, telefono, notas, estado: pedido.Estado };
    const cambio = { cantidad, telefono, notas, estado };
    if (pidiendoReembolso) {
      cambio.montoReembolso = montoEscrito;
      cambio.motivoReembolso = motivoReembolso.trim();
    }
    return cambio;
  }
  function handleGuardar() {
    setGuardando(true);
    onGuardar(pedido.ID, cambioParaGuardar()).finally(() => setGuardando(false));
  }

  // ---- Pedido de varios productos (2026-10-06) ----
  // Lo que este renglón tiene escrito, para cuando se guardan varios con un
  // solo botón (el panel lo lee en ese momento). "listo": false si todavía
  // falta el monto del reembolso.
  const datosParaGuardarRef = useRef(null);
  datosParaGuardarRef.current = {
    listo: !montoReembolsoInvalido,
    cambio: cambioParaGuardar(),
  };
  useEffect(() => {
    if (!onRegistrarPendiente) return undefined;
    onRegistrarPendiente(pedido.ID, () => datosParaGuardarRef.current);
    return () => onRegistrarPendiente(pedido.ID, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.ID]);
  // "Estatus para todos": cuando el panel elige uno para este pedido de
  // varios productos, este renglón lo pone en su menú — solo si lo puede
  // editar y si ese estatus es un paso válido desde como está guardado.
  // (Elegir "— elegir —" lo regresa a como está guardado.)
  const fichaDeOrdenGeneral = ordenGeneral ? ordenGeneral.ficha : 0;
  const fichaAtendidaRef = useRef(fichaDeOrdenGeneral);
  useEffect(() => {
    if (!ordenGeneral || fichaAtendidaRef.current === ordenGeneral.ficha) return;
    fichaAtendidaRef.current = ordenGeneral.ficha;
    if (!puedoEditarPedido) return;
    const destino = ordenGeneral.estado;
    if (!destino) {
      setEstado(pedido.Estado);
      setAvisoAbierto(null);
      return;
    }
    if (estadoCanonicoPedido(pedido.Estado) === destino) return;
    if (!opcionesEstadoPedido(pedido.Estado).includes(destino)) return;
    if (estadoCanonicoPedido(pedido.Estado) === 'Cancelado' && destino === 'En proceso' && !puedeReabrirCancelado) return;
    setAvisoAbierto(null);
    if (destino === 'Reembolsado') {
      // Con una solicitud ya enviada no se pide otra.
      if (haySolicitudPendienteReembolso) return;
      setMontoReembolso(String(topeReembolso));
      setMotivoReembolso(ordenGeneral.motivo || '');
    }
    setEstado(destino);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fichaDeOrdenGeneral]);
  // El motivo "para todos" que se va escribiendo en la barrita.
  const motivoDeOrdenGeneral = ordenGeneral && ordenGeneral.estado === 'Reembolsado' ? ordenGeneral.motivo || '' : null;
  useEffect(() => {
    if (motivoDeOrdenGeneral === null || !puedoEditarPedido) return;
    if (estado !== 'Reembolsado' || pedido.Estado === 'Reembolsado' || haySolicitudPendienteReembolso) return;
    setMotivoReembolso(motivoDeOrdenGeneral);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motivoDeOrdenGeneral]);

  const fecha = new Date(pedido.Fecha);
  const deHoy = esFechaDeHoy(pedido.Fecha);

  return (
    <tr
      id={`pedido-fila-${pedido.ID}`}
      data-pedido-id={pedido.ID}
      className={[
        sinGuardar && 'fila-sin-guardar',
        resaltado && 'fila-resaltada',
        deHoy && 'fila-de-hoy',
        enCompraActiva && 'fila-misma-compra',
        destello && 'fila-nueva-destello',
      ].filter(Boolean).join(' ')}
    >
      <td>{fecha.toLocaleDateString('es-MX')}</td>
      <td>{fecha.toLocaleTimeString('es-MX')}</td>
      {/* Bug reportado por Claudia (2026-09-28, con captura): un Cliente o
          Producto con texto muy largo y sin espacios (como los productos de
          prueba con puras "x" seguidas) se salía de su columna y se veía
          encimado sobre Precio/Total, rompiendo la fila entera. Mismo bug
          que ya se había corregido en Stock — reusamos el mismo componente
          "CeldaTruncada" aquí para Cliente, Producto, Categoría y Código,
          que son los 4 campos de texto libre de este renglón (no deben
          romper la tabla bajo ninguna circunstancia). */}
      {/* (2026-10-07) Aquí iba una marquita "🧺5" en los pedidos de varios
          productos; a Claudia la confundía y se quitó. Para ver juntos los
          productos de un mismo pedido basta tocar cualquiera de sus
          renglones: los demás se iluminan en amarillo. */}
      <td><CeldaTruncada texto={pedido.Cliente} /></td>
      <td>
        <input
          type="tel"
          inputMode="numeric"
          className={`pedido-input-tel ${cambioTelefono ? 'campo-modificado' : ''}`}
          value={telefono}
          onChange={(e) => setTelefono(limitarTelefono(e.target.value))}
          disabled={!puedoEditarPedido}
          title={!puedoEditarPedido ? 'Bloqueado: este pedido no es tuyo' : undefined}
        />
      </td>
      <td><CeldaTruncada texto={pedido.Producto} /></td>
      <td><CeldaTruncada texto={categoria} /></td>
      <td>{codigo ? <CeldaTruncada texto={codigo} /> : '—'}</td>
      <td>
        <input
          type="text"
          inputMode="numeric"
          className={`pedido-input-cant ${cambioCantidad ? 'campo-modificado' : ''}`}
          value={cantidad}
          onChange={(e) => setCantidad(limitarDigitos(e.target.value, MAX_DIGITOS_CANTIDAD))}
          disabled={!puedoEditarPedido}
        />
      </td>
      <td>{precioPedido !== null ? formatearMoneda(precioPedido) : '—'}</td>
      <td>{totalPedido !== null ? formatearMoneda(totalPedido) : '—'}</td>
      <td>
        {/* Cuadro compacto de siempre + un botón de lupa para ver/editar la
            nota completa en grande cuando haga falta (nota larga). Los dos
            comparten el mismo valor, así que lo que escribas en uno se ve
            reflejado en el otro. */}
        <div className="pedido-notas-celda">
          <input
            className={`pedido-input-notas ${cambioNotas ? 'campo-modificado' : ''}`}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Sin notas"
            disabled={!puedoEditarPedido}
            title={!puedoEditarPedido ? 'Bloqueado: este pedido no es tuyo' : undefined}
          />
          <button
            type="button"
            className="pedido-notas-zoom-btn"
            onClick={() => onAbrirNota(pedido.Cliente, notas, setNotas)}
            title="Ver nota completa"
            disabled={!puedoEditarPedido}
          >
            🔍
          </button>
        </div>
      </td>
      <td>
        {/* Rediseño (2026-09-30, pedido por Claudia con capturas): los
            avisos de esta columna ya NO son párrafos fijos dentro de la
            celda (salían siempre y hacían cada fila mucho más alta) — ahora
            son burbujitas flotantes "tipo comentario de Word" (ver
            "AvisoFlotante") que solo salen al intentar la acción que
            quieren prevenir, o al dar clic en el iconito (🔒 / 🔓 / ⏳) que
            queda junto al menú, del mismo alto que el menú, sin agrandar la
            fila. Lo único que se queda dentro de la celda es la cajita de
            "Monto a reembolsar" (hay que escribir ahí) y el renglón corto de
            "Reembolsado: $X" (es un dato, no un aviso). */}
        <div className="pedido-estado-linea">
          <select
            ref={selectEstadoRef}
            className={cambioEstado ? 'campo-modificado' : ''}
            value={estado}
            onChange={(e) => handleCambiarEstado(e.target.value)}
            disabled={!puedoEditarPedido}
          >
            {/* Flujo de Estados (2026-09-29): solo se ofrecen los siguientes
                pasos válidos desde el Estado GUARDADO del pedido (nunca desde
                el que esté seleccionado sin guardar todavía). "En proceso"
                viniendo de "Cancelado" se sigue ofreciendo aunque ya haya
                pasado la 1a hora, a propósito: al elegirlo NO se aplica, solo
                sale el aviso flotante de por qué (ver handleCambiarEstado; el
                servidor de todos modos lo rechazaría). "Reembolsado" se
                ofrece aunque no se tenga el permiso directo: guardarlo manda
                una SOLICITUD al Administrador. */}
            {opcionesEstadoPedido(pedido.Estado).map((opcion) => (
              <option key={opcion} value={opcion}>{etiquetaEstadoPedido(opcion)}</option>
            ))}
          </select>
          {!puedoEditarPedido && (
            <button
              ref={iconoCandadoRef}
              type="button"
              className="btn-icono-aviso"
              onClick={() => alternarAviso('noEsTuyo')}
              title="No te pertenece este pedido"
              aria-label="No te pertenece este pedido"
            >
              🔒
            </button>
          )}
          {puedoEditarPedido && candadoAbierto && !soyDuenoDelPedido && !sinDuenoAsignado && (
            <button
              ref={iconoCandadoAbiertoRef}
              type="button"
              className="btn-icono-aviso btn-icono-aviso-abierto"
              onClick={handleCerrarCandado}
              title="Candado abierto — clic para volver a bloquear esta fila"
              aria-label="Volver a bloquear esta fila"
            >
              🔓
            </button>
          )}
          {/* Tickets (2026-10-06): 🎫 junto al Estado. Con ticket (🎫✓, en
              verde): lo abre. Pagado y sin ticket (🎫): ofrece generarlo. Va
              solo el ícono, sin el folio escrito, para no ensanchar la
              columna; el folio sale al dejar el mouse encima y al abrirlo. */}
          {(ticket || puedeGenerarTicket) && onTicket && (
            <button
              type="button"
              className={`btn-icono-aviso btn-ticket ${ticket ? 'btn-ticket-hecho' : ''}`}
              onClick={() => onTicket(pedido)}
              data-ticket-pedido-boton={ticket ? ticket.Folio : 'generar'}
              title={ticket ? `Ticket ${ticket.Folio} — clic para verlo o descargarlo` : 'Generar el ticket de este pedido pagado'}
              aria-label={ticket ? `Ver el ticket ${ticket.Folio}` : 'Generar el ticket de este pedido'}
            >
              🎫{ticket ? <span className="btn-ticket-listo" aria-hidden="true">✓</span> : null}
            </button>
          )}
          {haySolicitudPendienteReembolso && (
            <button
              ref={iconoPendienteRef}
              type="button"
              className="btn-icono-aviso"
              onClick={() => alternarAviso('solicitudPendiente')}
              title="Solicitud de reembolso pendiente"
              aria-label="Solicitud de reembolso pendiente"
            >
              ⏳
            </button>
          )}
        </div>
        {pidiendoReembolso && (
          <div className="pedido-reembolso-caja" data-reembolso-caja>
            <label>
              Monto a reembolsar
              <input
                type="text"
                inputMode="decimal"
                className={`pedido-input-reembolso ${montoPasaDelTope || montoMalEscrito ? 'pedido-reembolso-mal' : ''}`}
                value={montoReembolso}
                onChange={(e) => setMontoReembolso(limitarDigitos(e.target.value, MAX_DIGITOS_PRECIO))}
                onFocus={(e) => e.target.select()}
                placeholder={`Total: ${topeReembolso}`}
                disabled={!puedoEditarPedido}
                data-reembolso-monto
              />
            </label>
            {montoPasaDelTope && (
              <span className="pedido-reembolso-error" role="alert">Máximo {formatearMoneda(topeReembolso)} (lo que costó el pedido).</span>
            )}
            <label>
              ¿Por qué se reembolsa?
              <textarea
                className={`pedido-input-motivo ${faltaMotivoReembolso ? 'pedido-motivo-falta' : ''}`}
                rows={3}
                maxLength={500}
                value={motivoReembolso}
                onChange={(e) => setMotivoReembolso(e.target.value)}
                placeholder="Especifica por qué quieres reembolsar"
                disabled={!puedoEditarPedido}
                data-reembolso-motivo
              />
            </label>
          </div>
        )}
        {reembolsoYaConfirmado && (
          <p className="muted campo-nota">
            Reembolsado:{' '}
            {montoReembolsado !== undefined ? formatearMoneda(montoReembolsado) : 'Sin registrar (antes de esta función)'}
          </p>
        )}
        {motivoGuardado && <MotivoMinimizable texto={motivoGuardado} />}
        <AvisoFlotante
          anclaRef={anclaDelAviso}
          abierto={!!avisoAbierto && !!anclaDelAviso}
          onCerrar={() => setAvisoAbierto(null)}
          autoCerrarMs={avisoAbierto === 'noEsTuyo' ? 0 : 7000}
        >
          {avisoAbierto === 'reabrir' && (
            <>Ya pasó más de 1 hora desde que se canceló — este pedido ya no se puede reabrir.</>
          )}
          {avisoAbierto === 'reembolsoSinPermiso' && (
            <>
              🔒 No tienes el permiso para reembolsar directo — si guardas con "Reembolsado" elegido, se le envía
              una solicitud al Administrador para que la confirme o la cancele.
            </>
          )}
          {avisoAbierto === 'noEsTuyo' && (
            <>
              🔒 No te pertenece este pedido.{sucursalNombre ? ` Es un pedido de la sucursal ${sucursalNombre}: solo ella lo atiende.` : ''}
              {puedeSaltarCandado ? (
                <div className="comentario-flotante-acciones">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={handleAbrirCandado}
                    title="Vas a alterar información de ventas de un producto que no es tuyo"
                  >
                    🔓 Desbloquear
                  </button>
                </div>
              ) : soloDeSuSucursal && sucursalNombre ? (
                <> Solo {sucursalNombre} lo puede atender.</>
              ) : (
                <> Solo su dueño (o el Admin Central) lo puede cambiar.</>
              )}
            </>
          )}
          {avisoAbierto === 'candadoAbierto' && (
            <>🔓 Candado abierto — estás editando un pedido que no es tuyo. Para volver a bloquearlo, da clic en el 🔓.</>
          )}
          {avisoAbierto === 'solicitudPendiente' && haySolicitudPendienteReembolso && (
            <>
              ⏳ Ya enviaste una solicitud de reembolso por{' '}
              {formatearMoneda(Number(solicitudReembolsoPendiente.MontoSolicitado) || 0)} — pendiente de que el
              Administrador la confirme o la cancele.
              {motivoGuardado ? <> Motivo: "{motivoGuardado}".</> : null}
            </>
          )}
        </AvisoFlotante>
      </td>
      <td>
        {/* Catálogos por sucursal (2026-10-02): sello para distinguir de un
            vistazo los pedidos que llegaron por el catálogo de una persona
            (son solo de ella) de los del catálogo Global. */}
        {sucursalNombre && (
          <span className="pedido-sucursal-sello" title="Este pedido llegó por el catálogo de esa sucursal: es solo de esa persona">
            🏪 Sucursal
          </span>
        )}
        {duenos.length === 0 ? (
          <span className="muted">Sin asignar</span>
        ) : (
          <ul className="pedido-duenos-lista">
            {duenos.filter((d) => d.cantidad > 0).map((d) => (
              <li key={d.usuarioId} className={String(d.usuarioId) === String(usuarioId) ? 'pedido-dueno-yo' : ''}>
                {String(d.usuarioId) === String(usuarioId) ? `Yo (${d.nombre})` : d.nombre}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        {/* Arreglo (2026-09-30, pedido por Claudia): "una vez se haga la
            solicitud debe de decir en Guardar, en vez de Guardar, 'en
            espera' o 'pendiente'" — así ya no parece un botón normal
            esperando a que le den clic otra vez.
            2026-10-05: decía "Pendiente" y se confundía con el ESTADO
            "Pendiente" de los pedidos; Claudia eligió "Esperando…". */}
        <button
          className="btn btn-small"
          onClick={handleGuardar}
          disabled={!sinGuardar || guardando || guardandoJunto || montoReembolsoInvalido}
          title={
            haySolicitudPendienteReembolso
              ? 'Ya enviaste una solicitud de reembolso — pendiente de que el Administrador la confirme o la cancele'
              : montoReembolsoInvalido
                ? tituloReembolsoIncompleto
                : undefined
          }
        >
          {haySolicitudPendienteReembolso ? 'Esperando…' : guardando || (guardandoJunto && sinGuardar) ? 'Guardando…' : 'Guardar'}
        </button>
      </td>
    </tr>
  );
}
