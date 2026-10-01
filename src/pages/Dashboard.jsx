import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  login,
  // Arreglo de rendimiento (2026-09-25): `cargarPanelCompleto` reemplaza a
  // las 8 llamadas sueltas que antes se usaban aquí (listarProductosAdmin,
  // listarPedidos, obtenerAlertas, listarOpciones, listarMovimientos,
  // listarBitacora, listarUsuarios, listarTransferencias) — todas siguen
  // existiendo en api.js/Code.gs por si algún día hacen falta sueltas, pero
  // el Dashboard ya no las usa una por una.
  cargarPanelCompleto,
  agregarOpcion,
  eliminarOpcion,
  actualizarStock,
  actualizarPedido,
  crearProducto,
  actualizarProducto,
  cambiarDisponibilidad,
  eliminarProducto,
    actualizarOrdenMultiple,
  actualizarOrdenCategorias,
  actualizarOrdenOfertas,
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
} from '../api.js';
import ImageUploader from '../components/ImageUploader.jsx';
import ImageLightbox from '../components/ImageLightbox.jsx';

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

// Cada cuánto se refresca solo el Dashboard en segundo plano (milisegundos).
const INTERVALO_REFRESCO_MS = 6000;

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
function conLimiteDeTiempo(promesa, etiqueta, opciones = {}) {
  const esLectura = !!opciones.esLectura;
  let ms = opciones.ms || TIEMPO_MAXIMO_ESPERA_MS;
  if (!esLectura && !primeraEscrituraDeLaSesionYaHecha_) {
    ms = Math.max(ms, TIEMPO_MAXIMO_CARGA_INICIAL_MS);
    primeraEscrituraDeLaSesionYaHecha_ = true;
  }
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(() => {
        const segundos = Math.round(ms / 1000);
        const error = new Error(
          esLectura
            ? `Sigue cargando… la conexión está tardando más de lo normal (más de ${segundos}s). Se va a seguir intentando solo — si tarda mucho más, dale clic a "Actualizar".`
            : `${etiqueta}: el servidor está tardando más de lo normal (más de ${segundos}s). Es posible que el cambio sí se haya guardado del lado del servidor — revisa antes de repetirlo.`
        );
        error.esLimiteDeTiempo = true;
        reject(error);
      }, ms)
    ),
  ]);
}

const ESTADOS_PEDIDO = ['Sin solicitud', 'En proceso', 'Pagado', 'Reembolsado', 'Cancelado'];

// Flujo de Estados de Pedido (2026-09-29, diseño explícito de Claudia):
// desde cada Estado solo se puede avanzar a los que se listan aquí — nunca
// saltarse pasos ni regresar a mano. Mismo mapa que ya se validaba en
// "Code.gs" (acción "actualizarPedido"); aquí se usa solo para que el menú
// desplegable de Estado de cada pedido NO OFREZCA siquiera las opciones
// que el servidor de todos modos rechazaría — así Claudia no se topa con
// el error después de elegir, ve directamente las opciones válidas.
//   - "Sin solicitud" → únicamente "En proceso".
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
  'Sin solicitud': ['Sin solicitud', 'En proceso'],
  'En proceso': ['En proceso', 'Pagado', 'Cancelado'],
  Pagado: ['Pagado', 'Reembolsado'],
  Cancelado: ['Cancelado', 'En proceso'],
  Reembolsado: ['Reembolsado'],
};

// Si el Estado guardado no es ninguno de los 5 conocidos (dato viejo o
// atípico), se muestran los 5 sin restringir — mismo respaldo que ya usa
// "Code.gs" para no atorar un dato raro.
function opcionesEstadoPedido(estadoActual) {
  return SIGUIENTE_ESTADO_VALIDO_PEDIDO[estadoActual] || ESTADOS_PEDIDO;
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
  'stock', 'pedidos', 'alertas', 'orden', 'nuevo', 'cuenta', 'bitacora', 'usuarios', 'analitica',
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

export default function Dashboard() {
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
  const [bitacora, setBitacora] = useState([]);
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

  // 'todo' muestra el stock completo (con el dueño de cada quien); 'mio'
  // filtra solo los productos donde yo tengo algo asignado.
  const [filtroStockPersonal, setFiltroStockPersonal] = useState('todo');
   const esAdministrador = rol === 'Administrador';
  // Funcionalidad 1, Paso 2 (Permisos de pestañas, 2026-09): reemplaza los
  // "esAdministrador &&" que antes decidían a mano qué pestañas se ven. El
  // Admin Central siempre tiene todo en `true` (el backend ya se lo manda
  // así calculado); para los demás, `permisos` refleja el default de su Rol
  // más cualquier excepción individual que le haya puesto el Admin Central.
  function puedeVer(pestana) {
    return !!permisos[pestana];
  }
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
  function iniciarCarga() {
    setCargasEnCurso((n) => n + 1);
  }
  function terminarCarga() {
    setCargasEnCurso((n) => Math.max(0, n - 1));
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
      setMensaje(
        'Una acción tardó demasiado en responder y se canceló la espera. Es posible que sí se haya guardado del lado del servidor — revisa antes de repetirla.'
      );
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
  const [filtroPedidoDueno, setFiltroPedidoDueno] = useState('');
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
      if (e.key === 'Escape' && !fotoAmpliada && !notaEnZoom && sinGuardar.size > 0) {
        cancelarCambios();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinGuardar, fotoAmpliada, notaEnZoom]);

  // `silencioso: true` se usa para los refrescos automáticos de fondo: no
  // muestra "Actualizando…" ni mensajes de error a cada rato, para no ser
  // molesto. Los refrescos que sí pide Claudia directamente (guardar algo,
  // iniciar sesión) siguen mostrando el aviso normal.
   function cargarTodo(token, opciones = {}) {
    const silencioso = !!opciones.silencioso;
    // Fix "switcheo" de sesión (2026-09): "número de turno" de quien pidió estos datos.
    const miSesionId = sesionIdRef.current;
    if (!silencioso) {
      setCargando(true);
      iniciarCarga();
    }
  
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
                   return conLimiteDeTiempo(cargarPanelCompleto(token), 'Cargar datos', { ms: TIEMPO_MAXIMO_CARGA_INICIAL_MS, esLectura: true })
          .then((r) => {
        // Fix "switcheo" de sesión (2026-09): si ya cambiamos de sesión, ignoramos esta respuesta vieja.
        if (miSesionId !== sesionIdRef.current) return;
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
        setBitacora(r.bitacora || []);
        setUsuarios(r.usuarios || []);
        setTransferencias(r.transferencias || []);
        // Arreglo (2026-09-25, reportado por Claudia: el aviso de "sigue
        // cargando" se quedó pegado en pantalla para siempre, ni el
        // refresco automático de cada 6s lo quitaba). Antes esta línea
        // SOLO limpiaba el mensaje en una carga NO silenciosa — un
        // refresco de fondo que sí tuvo éxito nunca tocaba un aviso viejo.
        // Ahora, si lo que había en pantalla era justo un aviso o error de
        // ESTA misma función (cargar datos), se quita solo en cuanto
        // cualquier carga (silenciosa o no) sí funciona — así el aviso
        // desaparece apenas la conexión se recupera, sin que Claudia tenga
        // que darle clic a "Actualizar" a mano.
        setMensaje((prev) => {
          if (!silencioso) return '';
          return prev && (prev.startsWith('Sigue cargando') || prev.startsWith('Error al cargar datos'))
            ? ''
            : prev;
        });
      })
            .catch((err) => {
        // Fix "switcheo" de sesión (2026-09): mismo control que arriba, para no reaccionar a una respuesta vieja.
        if (miSesionId !== sesionIdRef.current) return;
        // Si el servidor dice que la sesión ya no es válida (expiró, la
        // cuenta se inhabilitó, o quedó guardado un token viejo de otra
        // sesión), cerramos sesión automáticamente en vez de dejar el
        // panel abierto sin poder cargar ni guardar nada.
        if (err.sesionInvalida) {
          handleLogout();
          setErrorLogin(err.message || 'Tu sesión ya no es válida. Vuelve a iniciar sesión.');
          return;
        }
        // Arreglo (2026-09-25, pedido por Claudia: el mensaje de "tardó
        // demasiado" al abrir el panel se veía como un error grave y
        // asustaba, cuando en realidad Apps Script solo estaba tardando en
        // "despertar"). Si fue justo por el límite de tiempo (no un error
        // real del servidor), usamos el aviso tranquilo que ya trae
        // `conLimiteDeTiempo` tal cual — no lo marcamos como "Error". Un
        // fallo de verdad (por ejemplo el servidor contestó pero con un
        // problema) sí se muestra como error.
        if (!silencioso) {
          setMensaje(err.esLimiteDeTiempo ? err.message : `Error al cargar datos: ${err.message}`);
        }
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
  }

  useEffect(() => {
    if (autenticado) cargarTodo(sesionToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado]);

  // Refresco automático en segundo plano: así los pedidos nuevos y los
  // cambios de stock se ven casi al instante, sin tener que darle
  // "Actualizar" a mano. Se pausa si hay cambios sin guardar o si está
  // abierto el formulario de agregar/editar producto, para no interrumpir.
  useEffect(() => {
    if (!autenticado) return;
    const intervalo = setInterval(() => {
      if (sinGuardar.size === 0 && !productoEditando && tab !== 'nuevo') {
        cargarTodo(sesionToken, { silencioso: true });
      }
    }, INTERVALO_REFRESCO_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado, sesionToken, rol, permisos, sinGuardar, productoEditando, tab]);

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
    setBitacora([]);
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
    setFiltroPedidoDueno('');
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

  function handleGuardarPedido(pedidoId, { cantidad, telefono, notas, estado, montoReembolso }) {
    iniciarCarga();
    return conLimiteDeTiempo(
      actualizarPedido({ sesionToken, pedidoId, cantidad, telefono, notas, estado, montoReembolso }),
      'Actualizar pedido'
    )
      .then((res) => cargarTodo(sesionToken, { silencioso: true }).then(() => res))
      .then((res) => {
        // Candado de Reembolsos (2026-09-30, pedido por Claudia): si el
        // pedido no cambió de Estado de verdad porque hacía falta permiso,
        // el servidor creó una solicitud en vez de rechazar — avisamos aquí
        // para que no parezca que el guardado no hizo nada.
        if (res && res.solicitudReembolsoCreada) {
          setMensaje('Tu solicitud de reembolso se envió al Administrador — en cuanto la confirme o la cancele, este pedido pasará a "Reembolsado" (o se quedará como está).');
        }
      })
      .catch((err) => setMensaje(`Error al actualizar pedido: ${err.message}`))
      .finally(terminarCarga);
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
      `¿Seguro que quieres eliminar "${producto.Nombre}" para siempre? Esta acción no se puede deshacer desde la app.`
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
    setTab('pedidos');
    setPedidoResaltadoId(pedidoId);
    setTimeout(() => setPedidoResaltadoId(null), 4000);
  }

  // Feature pedido por Claudia (2026-09): cambia a la pestaña Stock y marca
  // el producto para que su fila se resalte en amarillo un momento.
  function irAStockYResaltar(productoId) {
    setTab('stock');
    setProductoResaltadoId(productoId);
    setTimeout(() => setProductoResaltadoId(null), 4000);
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
  const productosFiltrados =
    filtroStockPersonal === 'mio'
      ? productosOrdenadosPorColumna.filter(esDuenoDelProducto)
      : productosOrdenadosPorColumna;

  const filtroFechaActivo = !!(filtroDesde || filtroHasta);
  const hayFiltrosStockActivos =
    filtroFechaActivo || !!filtroCategoriaStock || !!busquedaStock.trim() || filtroStockPersonal === 'mio';

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
  }
  // Pedidos: igual que los productos, más recientes primero. Además se
  // pueden filtrar por fecha (Desde/Hasta) y por Estado con la tablita de
  // conteos de la derecha.
  const pedidosOrdenados = pedidos.slice().reverse();

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
  function pedidoEsDelDueno(pedido) {
    if (!filtroPedidoDueno) return true;
    return (duenosPorProductoId[pedido.ProductoID] || []).some(
      (d) => String(d.usuarioId) === String(filtroPedidoDueno) && d.cantidad > 0
    );
  }
  const pedidosPorDueno = pedidosPorFecha.filter(pedidoEsDelDueno);

  const conteoPorEstado = pedidosPorDueno.reduce((acc, p) => {
    acc[p.Estado] = (acc[p.Estado] || 0) + 1;
    return acc;
  }, {});
  const pedidosFiltrados = filtroEstado
    ? pedidosPorDueno.filter((p) => p.Estado === filtroEstado)
    : pedidosPorDueno;

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
  // Con el ancho normal de la columna caben ~12 letras en mayúsculas (lo
  // justo para "TRABAJADOR 1"); más largo que eso se recorta con "…".
  const hayNombresDuenoRecortados = largoNombreDuenoMasLargo > 12;
  const anchoNombresDuenosExpandidos = `${(Math.min(Math.max(largoNombreDuenoMasLargo, 6), 40) * 0.72).toFixed(2)}em`;

  // ---- Avisos (2026-10-01, pedido por Claudia con capturas) ----
  // Piezas reutilizables: la misma lista se muestra en Alertas Y arriba de
  // la pestaña donde se atiende (solicitudes de stock arriba de Stock,
  // reembolsos arriba de Pedidos), sin duplicar el código.
  const listaSolicitudesStock = (
    <ul className="transferencias-pendientes-lista">
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
              </ul>
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
            <ul className="transferencias-en-proceso-lista solicitudes-reembolso-lista">
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
                        {formatearFechaSolo(s.Fecha)} a las {formatearHoraSolo(s.Fecha)}
                      </>
                    ) : (
                      <>
                        ⏳ Tu solicitud para reembolsar{' '}
                        <strong>{formatearMoneda(Number(s.MontoSolicitado) || 0)}</strong> de{' '}
                        <button type="button" className="link-button" onClick={() => irAPedidoYResaltar(s.PedidoID)}>
                          "{s.Producto}"{codigoPorProductoId[s.ProductoID] ? ` (${codigoPorProductoId[s.ProductoID]})` : ''}
                        </button>
                        {' '}sigue en camino — el Administrador todavía no la confirma ni la cancela.
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
            </ul>
          )}
          {solicitudesReembolsoResueltas.length > 0 && (
            <ul className="transferencias-resueltas-lista solicitudes-reembolso-lista">
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
                    {s.RespondidoPor ? <> por <strong>{s.RespondidoPor}</strong></> : null}
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
            </ul>
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
      titulo: (
        <>
          ⚠️ {alertas.length} producto(s) con bajo inventario:{' '}
          {alertas.map((a, i) => (
            <span key={a.ID}>
              <button type="button" className="link-button" onClick={() => irAStockYResaltar(a.ID)}>
                {a.Nombre}{a.CodigoPropio ? ` (${a.CodigoPropio})` : ''}
              </button>
              {i < alertas.length - 1 ? ', ' : ''}
            </span>
          ))}
        </>
      ),
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
      {mensaje && (
        <p className={`info-msg ${mensaje.startsWith('Error') ? 'error' : 'aviso'}`}>{mensaje}</p>
      )}
      {cargando && <p className="info-msg">Actualizando…</p>}

      {/* Aviso flotante: se queda pegado abajo de la pantalla aunque hagas
          scroll, y lista EXACTAMENTE qué dato(s) cambiaste sin guardar. */}
      {sinGuardar.size > 0 && (
        <div className="aviso-flotante">
          <p className="aviso-flotante-titulo">
            ⚠️ Tienes {sinGuardar.size} cambio(s) sin guardar:
          </p>
          <ul>
            {Array.from(sinGuardar.values()).map((descripcion, i) => (
              <li key={i}>{descripcion}</li>
            ))}
          </ul>
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
          { clave: 'pedidos', texto: `Pedidos (${pedidos.length})`, visible: puedeVer('pedidos') },
          { clave: 'alertas', texto: `Alertas (${conteoAlertasPestana})`, visible: puedeVer('alertas') },
          { clave: 'cuenta', texto: '📄 Estado de cuenta', visible: puedeVer('cuenta') },
          { clave: 'bitacora', texto: '🗒️ Bitácora', visible: puedeVer('bitacora') },
          { clave: 'usuarios', texto: '👤 Usuarios', visible: puedeVer('usuarios') },
          { clave: 'analitica', texto: '📈 Analítica de ventas', visible: puedeVer('analitica') },
          { clave: 'orden', texto: '🔀 Orden del catálogo', visible: puedeVer('orden') },
          { clave: 'nuevo', texto: '+ Agregar producto', visible: puedeVer('nuevo') },
          { clave: 'permisos', texto: '🔐 Permisos', visible: esAdminCentral },
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

      {!puedeVer(tab) && tab !== 'permisos' && (
        <p className="info-msg">
          Ya no tienes acceso a esta pestaña. Elige otra de arriba, o pídele al Admin Central que revise tus permisos.
        </p>
      )}

           {tab === 'stock' && puedeVer('stock') && (
        <>

          <div className="stock-personal-toggle">
            <button
              type="button"
              className={`resumen-btn ${filtroStockPersonal === 'todo' ? 'activo' : ''}`}
              onClick={() => setFiltroStockPersonal('todo')}
            >
              Todo el stock
            </button>
            <button
              type="button"
              className={`resumen-btn ${filtroStockPersonal === 'mio' ? 'activo' : ''}`}
              onClick={() => setFiltroStockPersonal('mio')}
            >
              Mi stock personal
            </button>
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
              className={`data-table stock-table${duenosExpandidos ? ' duenos-expandidos' : ''}`}
              style={duenosExpandidos ? { '--ancho-nombre-dueno': anchoNombresDuenosExpandidos } : undefined}
            >
              <thead>
                <tr>
                  <th>
                    <button type="button" className="orden-header-btn" onClick={() => cambiarOrdenStock('fecha')}>
                      Fecha agregado <span className="orden-header-flecha">{indicadorOrdenStock(ordenStock, 'fecha')}</span>
                    </button>
                  </th>
                  <th>Hora agregado</th>
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
                    Dueño
                    {/* Aclarado (2026-10-01, Claudia: "no entiendo cuál es la
                        función de la flecha"): antes era un ↔ sin texto, que
                        además salía aunque ningún nombre estuviera recortado.
                        Ahora dice qué hace, y solo aparece cuando de verdad
                        hay algún nombre recortado con "…" en la tabla. */}
                    {(hayNombresDuenoRecortados || duenosExpandidos) && (
                      <button
                        type="button"
                        className="btn-expandir-duenos"
                        onClick={() => setDuenosExpandidos((v) => !v)}
                        title={
                          duenosExpandidos
                            ? 'Vuelve a recortar los nombres largos (se recortan solos después de 5 minutos)'
                            : 'Algunos nombres están recortados con "…" — clic para verlos completos'
                        }
                      >
                        {duenosExpandidos ? '↩ Recortar nombres' : '🔍 Ver nombres completos'}
                      </button>
                    )}
                  </th>
                  <th>Mínimo</th>
                  <th>Actualizar stock</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((p) => (
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
        </>
      )}

           {tab === 'pedidos' && puedeVer('pedidos') && (
        <>
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
            {esAdministrador ? (
              <label className="pedidos-filtro-dueno-admin">
                Ver pedidos de:
                <select
                  value={filtroPedidoDueno}
                  onChange={(e) => setFiltroPedidoDueno(e.target.value)}
                >
                  <option value="">Todos</option>
                  {usuarios.filter((u) => esActivo(u.Activo)).map((u) => (
                    <option key={u.ID} value={u.ID}>{u.Nombre}</option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <button
                  type="button"
                  className={`resumen-btn ${filtroPedidoDueno === '' ? 'activo' : ''}`}
                  onClick={() => setFiltroPedidoDueno('')}
                >
                  Todos los pedidos
                </button>
                <button
                  type="button"
                  className={`resumen-btn ${filtroPedidoDueno === usuarioId ? 'activo' : ''}`}
                  onClick={() => setFiltroPedidoDueno(usuarioId)}
                >
                  Mis pedidos
                </button>
              </>
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
              className={`resumen-btn ${filtroEstado === '' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('')}
            >
              <span>Todos</span>
              <strong>{pedidosPorDueno.length}</strong>
            </button>
            {ESTADOS_PEDIDO.map((estadoOpcion) => (
              <button
                key={estadoOpcion}
                type="button"
                className={`resumen-btn ${filtroEstado === estadoOpcion ? 'activo' : ''}`}
                onClick={() => setFiltroEstado(estadoOpcion)}
              >
                <span>{estadoOpcion}</span>
                <strong>{conteoPorEstado[estadoOpcion] || 0}</strong>
              </button>
            ))}
          </div>

          <div className="table-scroll table-scroll-fijo">
            <table className="data-table pedidos-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Categoría</th><th>Código</th>
                  <th>Cant.</th><th>Precio</th><th>Total</th><th>Notas</th><th>Estado</th><th>Dueño(s)</th><th>Guardar</th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.map((ped) => (
                  <PedidoRow
                    key={`${ped.ID}-${resetToken}`}
                    pedido={ped}
                    categoria={categoriaPorProductoId[ped.ProductoID] || '—'}
                    codigo={codigoPorProductoId[ped.ProductoID] || '—'}
                    duenos={duenosPorProductoId[ped.ProductoID] || []}
                    usuarioId={usuarioId}
                    puedeSaltarCandado={esAdminCentral || !!permisos[CLAVE_CANDADO_PEDIDOS]}
                    puedeReembolsar={puedeResponderReembolso}
                    montoReembolsado={montoReembolsadoPorPedidoId[ped.ID]}
                    solicitudReembolsoPendiente={solicitudReembolsoPendientePorPedidoId[ped.ID]}
                    resaltado={ped.ID === pedidoResaltadoId}
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
            <ul className="transferencias-en-proceso-lista">
              {transferenciasEnProceso.map((t) => (
                <li key={t.ID}>
                                  {t.Tipo === 'Oferta' ? (
                    <>⏳ Le asignaste <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''} a <strong>{t.SolicitanteNombre}</strong>, esperando que acepte</>
                  ) : (
                    <>⏳ Esperando respuesta de <strong>{t.DuenoNombre}</strong> por <strong>{t.Cantidad}</strong> de "{t.Producto}"{codigoPorProductoId[t.ProductoID] ? ` (${codigoPorProductoId[t.ProductoID]})` : ''}</>
                  )}
                </li>
              ))}
            </ul>
          )}
                  {transferenciasResueltas.length > 0 && (
            <ul className="transferencias-resueltas-lista">
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
            </ul>
          )}
          {transferenciasAplicadas.length > 0 && (
            <ul className="transferencias-resueltas-lista">
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
            </ul>
          )}
          {bloqueReembolsos}
                   <ul className="alert-list">
            {alertas.length === 0 && <li>Sin alertas de bajo inventario 🎉</li>}
            {alertas.map((a) => (
              <li key={a.ID}>
                <button type="button" className="link-button" onClick={() => irAStockYResaltar(a.ID)}>
                  <strong>{a.Nombre}</strong>{a.CodigoPropio ? ` (${a.CodigoPropio})` : ''} — quedan {a.Stock} (mínimo {a.StockMinimo})
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'cuenta' && puedeVer('cuenta') && (
        <EstadoCuentaTab movimientos={movimientos} pedidos={pedidos} productos={productos} />
      )}

      {tab === 'bitacora' && puedeVer('bitacora') && <BitacoraTab bitacora={bitacora} />}

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

      {tab === 'orden' && puedeVer('orden') && (
        <OrdenTab
          key={`orden-${resetToken}`}
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
function CampoConOpciones({ id, valor, onChange, opciones = [], placeholder, maxLength, required }) {
  const [abierta, setAbierta] = useState(false);
  const wrapperRef = useRef(null);

  // Cierra la lista si se hace clic fuera de este campo (en vez de usar
  // onBlur del <input>, que se dispararía ANTES del clic en una opción y
  // la cerraría antes de que ese clic pudiera registrarse).
  useEffect(() => {
    if (!abierta) return undefined;
    function alHacerClicFuera(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setAbierta(false);
      }
    }
    document.addEventListener('mousedown', alHacerClicFuera);
    return () => document.removeEventListener('mousedown', alHacerClicFuera);
  }, [abierta]);

  function elegirOpcion(v) {
    onChange(v);
    setAbierta(false);
  }

  return (
    <div className="campo-opciones" ref={wrapperRef}>
      <input
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setAbierta(true)}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        autoComplete="off"
      />
      {abierta && opciones.length > 0 && (
        <ul className="campo-opciones-lista">
          {opciones.map((v) => (
            <li key={v}>
              {/* onMouseDown con preventDefault (en vez de onClick solo) para
                  que el clic elija la opción ANTES de que el <input> pierda
                  el foco — así no hay parpadeo ni carrera con el cierre por
                  clic-fuera de arriba. */}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); elegirOpcion(v); }}>
                {v}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Sirve tanto para dar de alta un producto nuevo como para editar uno que
// ya existe: si le pasas `productoExistente`, precarga sus datos y guarda
// con "actualizarProducto" en vez de "crearProducto".
function ProductoForm({ sesionToken, opciones = {}, setOpciones, usuarios = [], esAdministrador = false, usuarioId = '', nombreSesion = '', productoExistente, onGuardado, onOpcionesActualizadas, onCancelar, formExterno, setFormExterno, fotosExterno, setFotosExterno, iniciarCarga, terminarCarga }) {
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
    <form className="new-product-form" onSubmit={handleSubmit}>
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
            <select value={form.duenoId} onChange={handleChange('duenoId')}>
              <option value="">Admin Central (default)</option>
              {usuarios.filter((u) => esActivo(u.Activo)).map((u) => (
                <option key={u.ID} value={u.ID}>{u.Nombre}</option>
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
function OrdenTab({ productos, opciones, sesionToken, onCambio, iniciarCarga, terminarCarga, onDirtyChange }) {
  const categoriasPredeterminadas = opciones.categoria || [];
  const categoriasOcultas = opciones.categoriaOculta || [];
  const categoriaOrdenExplicito = opciones.categoriaOrden || [];
  const ofertasOrdenGuardado = opciones.ofertasOrden || [];
  const zonaOfertasOculta = (opciones.ofertasOculta || []).length > 0;

  const [gruposLocal, setGruposLocal] = useState(() =>
    agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito)
  );
  const [ofertasLocal, setOfertasLocal] = useState(() => ordenarOfertas(productos, ofertasOrdenGuardado));
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

  function acomodarDesdeServidor() {
    setGruposLocal(agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito));
    setOfertasLocal(ordenarOfertas(productos, ofertasOrdenGuardado));
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

  function alternarContraida(nombre) {
    setContraidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(nombre)) siguiente.delete(nombre);
      else siguiente.add(nombre);
      return siguiente;
    });
  }

  // ---- Arrastrar y soltar (en computadora) ----
  function propsArrastre(lista, indice, alSoltar) {
    return {
      draggable: !guardando,
      onDragStart: (e) => {
        setArrastre({ lista, indice });
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(indice)); } catch { /* algunos navegadores */ }
      },
      onDragOver: (e) => {
        if (!arrastre || arrastre.lista !== lista) return;
        e.preventDefault();
        if (!sobre || sobre.lista !== lista || sobre.indice !== indice) setSobre({ lista, indice });
      },
      onDrop: (e) => {
        e.preventDefault();
        if (arrastre && arrastre.lista === lista && arrastre.indice !== indice) alSoltar(arrastre.indice, indice);
        setArrastre(null);
        setSobre(null);
      },
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

  // Un renglón de producto (se usa igual en una categoría y en Ofertas).
  function filaProducto({ p, i, total, lista, clave, onMover }) {
    return (
      <li key={p.ID} id={`orden-${clave}`} className={clasesFila(lista, i, clave)} {...propsArrastre(lista, i, (desde, hasta) => onMover(desde, hasta))}>
        <span className="orden-agarradera" aria-hidden="true" title="Arrastra para mover">⠿</span>
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
        <span className="orden-nombre">{p.Nombre}</span>
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
  const todasContraidas = gruposLocal.length > 0 && gruposLocal.every((g) => contraidas.has(g.nombre));

  return (
    <div className="orden-catalogo">
      <p className="muted">
        Acomoda todo lo que quieras y al final dale <strong>💾 Guardar orden</strong> (un solo guardado). Para mover
        algo: escribe el número de lugar en su cajita y da Enter (por ejemplo, del 10 al 2 de un jalón), usa ▲ ▼ para
        moverlo de uno en uno, o arrástralo desde ⠿. Lo que muevas se queda resaltado en su lugar nuevo.
      </p>

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
          onClick={() => setContraidas(todasContraidas ? new Set() : new Set(gruposLocal.map((g) => g.nombre)))}
          title="Con las categorías contraídas es más fácil acomodar el orden de las categorías entre sí"
        >
          {todasContraidas ? '▾ Expandir todas' : '▸ Contraer todas'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={abrirAgregarCategoria} disabled={bloqueoPorCambios} title={tituloBloqueo}>
          + Agregar categoría
        </button>
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

      {/* ---- Zona 🔥 Ofertas (2026-10-01, pendiente P11) ---- */}
      {(ofertasLocal.length > 0 || zonaOfertasOculta) && (!textoBuscadoOrden || ofertasVisibles.length > 0) && (
        <section className={`orden-categoria-box orden-ofertas-box ${zonaOfertasOculta ? 'categoria-oculta' : ''}`}>
          <div className="orden-categoria-header">
            <h3>
              🔥 Ofertas <span className="orden-conteo">({ofertasLocal.length})</span>
              {zonaOfertasOculta && <span className="badge badge-oculto">Oculta del catálogo</span>}
            </h3>
            <div className="orden-categoria-botones">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={toggleZonaOfertas}
                disabled={cambiandoZonaOfertas || bloqueoPorCambios}
                title={tituloBloqueo}
              >
                {zonaOfertasOculta ? 'Mostrar zona' : 'Ocultar zona'}
              </button>
            </div>
          </div>
          <p className="muted orden-ofertas-nota">
            Es el carrusel de "🔥 Ofertas" que sale hasta arriba del catálogo. Aquí decides en qué orden van. Ocultar
            la zona NO quita los productos ni su precio de oferta: siguen saliendo en su categoría de siempre. Para
            sacar un producto de Ofertas, edítalo en Stock (quítale el precio de oferta).
          </p>
          {ofertasLocal.length === 0 ? (
            <p className="muted">Ahorita no hay ningún producto en oferta.</p>
          ) : (
            <ul className="orden-lista">
              {ofertasVisibles.map(({ p, i }) =>
                filaProducto({ p, i, total: ofertasLocal.length, lista: 'ofertas', clave: `o:${p.ID}`, onMover: moverOfertaA })
              )}
            </ul>
          )}
        </section>
      )}

      {gruposVisibles.length === 0 && textoBuscadoOrden && ofertasVisibles.length === 0 && (
        <p className="info-msg">No hay ningún producto ni categoría con "{busquedaOrden}".</p>
      )}

      {gruposVisibles.map(({ grupo, indiceCategoria, filas }) => {
        const contraida = !textoBuscadoOrden && contraidas.has(grupo.nombre);
        return (
          <section
            key={grupo.nombre}
            id={`orden-c:${grupo.nombre}`}
            className={`orden-categoria-box ${grupo.oculta ? 'categoria-oculta' : ''} ${resaltado === `c:${grupo.nombre}` ? 'orden-fila-movida' : ''}`}
          >
            <div className="orden-categoria-header">
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
                {grupo.nombre} <span className="orden-conteo">({grupo.productos.length})</span>
                {grupo.oculta && <span className="badge badge-oculto">Oculta del catálogo</span>}
              </h3>
              <div className="orden-categoria-botones">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => abrirRenombrar(grupo.nombre)}
                  disabled={bloqueoPorCambios}
                  title={tituloBloqueo}
                >
                  ✏️ Renombrar
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => toggleOcultarCategoria(grupo)}
                  disabled={ocultandoCategoria === grupo.nombre || bloqueoPorCambios}
                  title={tituloBloqueo}
                >
                  {grupo.oculta ? 'Mostrar' : 'Ocultar'}
                </button>
                <button
                  type="button"
                  className="btn btn-eliminar btn-small"
                  onClick={() => abrirEliminar(grupo)}
                  disabled={bloqueoPorCambios}
                  title={tituloBloqueo}
                >
                  🗑️ Eliminar
                </button>
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
              Borrar la categoría Y sus {eliminando.cantidad} producto{eliminando.cantidad === 1 ? '' : 's'}{' '}
              para siempre.
            </label>

            {borrarProductosTambien && (
              <div className="aviso-peligro">
                ⚠️ Esto NO se puede deshacer desde la app: se van a borrar {eliminando.cantidad}{' '}
                producto{eliminando.cantidad === 1 ? '' : 's'} de tu inventario para siempre.
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

// Bug reportado por Claudia (2026-09-24): un Nombre/Categoría/Código muy
// largo (sobre todo sin espacios, como los productos de prueba con puras
// "X" seguidas) se salía de su columna en la tabla de Stock y se veía
// encimado sobre las columnas vecinas — la tabla no debe agrandarse ni
// encimarse nunca. Este componente recorta el texto a una sola línea con
// "…" por default (nunca se sale de su columna), y un clic lo expande
// para leerlo completo (envuelto en varias líneas dentro de la misma
// celda, sin romper el layout); otro clic lo vuelve a recortar a su
// tamaño original. Se usa en las columnas Producto, Categoría y Código.
function CeldaTruncada({ texto }) {
  const [expandida, setExpandida] = useState(false);
  if (!texto) return <>{texto}</>;
  return (
    <span
      className={`celda-texto-truncado ${expandida ? 'expandida' : ''}`}
      onClick={() => setExpandida((v) => !v)}
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
  const sinGuardar = Number(valor) !== Number(producto.Stock);
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
  const puedoEditar = controlTotal || soyDueno || duenos.length === 0;

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

    const clasesFila = [!visible && 'fila-oculta', sinGuardar && 'fila-sin-guardar', resaltado && 'fila-resaltada'].filter(Boolean).join(' ');

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
            <s>${Number(producto.Precio).toLocaleString('es-MX')}</s>
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
                  {misOfertasEnProceso.filter((t) => String(t.DuenoID) === String(d.usuarioId)).map((t) => (
                    <div key={t.ID} className="muted campo-nota">
                      ⏳ Le asignaste {t.Cantidad} a {t.SolicitanteNombre}, esperando que acepte
                    </div>
                  ))}
                </li>
              );
                    })}
          </ul>
        )}
      </td>
      <td>{producto.StockMinimo}</td>
      <td>
        <div className="stock-editor">
          <div className="campo-numero-wrapper">
            <input
              type="text"
              inputMode="numeric"
              className={excedeMiPropioStock ? 'campo-modificado' : sinGuardar ? 'campo-modificado' : ''}
              value={valor}
              disabled={!puedoEditar || guardandoStock}
              onChange={(e) => setValor(limitarDigitos(e.target.value, MAX_DIGITOS_STOCK))}
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
              onActualizar(producto.ID, valor)
                .catch(() => {})
                .finally(() => setGuardandoStock(false));
            }}
            disabled={!sinGuardar || !puedoEditar || guardandoStock || excedeMiPropioStock}
          >
            {guardandoStock ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {!puedoEditar && <p className="muted campo-nota">🔒 No es tuyo — usa "Solicitar" junto al dueño.</p>}
        {puedoEditar && excedeMiPropioStock && (
          <p className="muted campo-nota aviso-stock-propio">
            Solo puedes bajar hasta {minimoPermitidoStock} — de este producto tienes {miCantidadPropiaStock} asignado
            a ti, y bajar más afectaría el stock de alguien más.
          </p>
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

function EstadoCuentaTab({ movimientos, pedidos, productos }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

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
  }

  return (
    <div className="estado-cuenta">
      <div className="filtro-fechas no-imprimir">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        {hayFiltro && (
          <button type="button" className="btn btn-secondary btn-small" onClick={limpiarFiltro}>
            Quitar filtro de fechas
          </button>
        )}
        <button type="button" className="btn btn-primary btn-small" onClick={() => window.print()}>
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
              {movimientosFiltrados.map((m) => (
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

function BitacoraTab({ bitacora }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
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
  const opcionesUsuario = opcionesUnicas('Usuario');
  const opcionesAccion = opcionesUnicas('Accion');

  const textoBuscado = normalizarParaFiltro(buscarDetalle);
  const bitacoraFiltrada = bitacoraOrdenada.filter((b) => (
    movimientoEnRangoDeFecha(b, desde, hasta) &&
    (!filtroUsuario || normalizarParaFiltro(b.Usuario) === filtroUsuario) &&
    (!filtroAccion || normalizarParaFiltro(b.Accion) === filtroAccion) &&
    (!textoBuscado || normalizarParaFiltro(b.Detalle).includes(textoBuscado))
  ));

  const hayFiltroFechas = !!(desde || hasta);
  const hayOtrosFiltros = !!(filtroUsuario || filtroAccion || buscarDetalle);

  function limpiarFiltro() {
    setDesde('');
    setHasta('');
  }
  function limpiarTodo() {
    limpiarFiltro();
    setFiltroUsuario('');
    setFiltroAccion('');
    setBuscarDetalle('');
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
            </tr>
          </thead>
          <tbody>
            {bitacoraFiltrada.map((b) => (
              <tr key={b.ID}>
                <td>{formatearFechaHora(b.Fecha)}</td>
                <td>{b.Usuario || '—'}</td>
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
                <td><CeldaTruncada texto={b.Detalle || '—'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {bitacoraFiltrada.length === 0 && (
          <p className="info-msg">No hay cambios registrados con los filtros de arriba.</p>
        )}
      </div>
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
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);

  const [editando, setEditando] = useState(null); // usuario completo, o null
  const [editNombre, setEditNombre] = useState('');
  // Pendiente P17 de Claudia (2026-10-01): el Admin Central ya puede
  // cambiar también el "usuario" con el que una cuenta inicia sesión.
  const [editUsuario, setEditUsuario] = useState('');
  const [editRol, setEditRol] = useState('Vendedor');
  const [editTelefonoPedidos, setEditTelefonoPedidos] = useState('');
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
    { nombre: '🔝 Más vendidos', lista: masVendidos },
    { nombre: '🔻 Menos vendidos', lista: menosVendidos },
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
  }, [sesionToken, desde, hasta]);

  const cambio = datos && typeof datos.cambioPorcentaje === 'number' ? datos.cambioPorcentaje : null;
  const subio = cambio !== null && cambio >= 0;

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
      {mensaje && <p className="info-msg error">{mensaje}</p>}

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
            items={datos.porVendedor}
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
            excluirDeMenos={(v) => v.usuario === 'Sin registrar'}
            nota={
              <>
                "Vendedor" es quién marcó cada pedido como Pagado/Reembolsado desde el Dashboard. Las ventas
                de antes de que existiera esta función se reconocen con la Bitácora cuando se puede; si no,
                salen como "Sin registrar".
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
function IconoOjo({ abierto }) {
  return (
    <svg
      width="20"
      height="20"
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

function PedidoRow({
  pedido,
  categoria,
  codigo,
  duenos = [],
  usuarioId,
  puedeSaltarCandado,
  puedeReembolsar,
  montoReembolsado,
  solicitudReembolsoPendiente,
  resaltado,
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

  // Arreglo (2026-09-30, pedido por Claudia): antes, al elegir "Reembolsado"
  // en el menú, la cajita de monto se precargaba SOLA con el total del
  // pedido — eso permitía guardar de inmediato sin que nadie hubiera
  // escrito ni revisado a propósito el monto. Ahora la cajita empieza
  // VACÍA a propósito (con el total sugerido nomás como "placeholder", de
  // referencia) — hay que escribir un monto mayor a cero a propósito antes
  // de que "Guardar" se habilite (ver "montoReembolsoInvalido" abajo).
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
      setMontoReembolso('');
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
  // "Reembolsado" y todavía no se haya escrito un monto mayor a cero — tal
  // como pidió Claudia: "que aún no se cambie ni deje guardar... hasta que
  // se especifique el monto a reembolsar ya permitirá guardar".
  const montoReembolsoInvalido = seleccionandoReembolsoPendiente && !(Number(montoReembolso) > 0);

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
    if (cambioEstado) cambios.push(`Estado: ${pedido.Estado} → ${estado}`);
    const descripcion = cambios.length > 0 ? `Pedido de ${pedido.Cliente} — ${cambios.join(' · ')}` : '';
    onDirtyChange(llave, sinGuardar, descripcion);
    return () => onDirtyChange(llave, false, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cantidad, telefono, notas, estado, pedido, llave, haySolicitudPendienteReembolso]);

  function handleGuardar() {
    setGuardando(true);
    const payload = { cantidad, telefono, notas, estado };
    if (estado === 'Reembolsado') payload.montoReembolso = montoReembolso;
    onGuardar(pedido.ID, payload).finally(() => setGuardando(false));
  }

  const fecha = new Date(pedido.Fecha);

  return (
    <tr
      id={`pedido-fila-${pedido.ID}`}
      className={[sinGuardar && 'fila-sin-guardar', resaltado && 'fila-resaltada'].filter(Boolean).join(' ')}
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
              <option key={opcion}>{opcion}</option>
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
        {seleccionandoReembolsoPendiente && !haySolicitudPendienteReembolso && (
          <div className="pedido-reembolso-caja">
            <label>
              Monto a reembolsar
              <input
                type="text"
                inputMode="decimal"
                className="pedido-input-reembolso"
                value={montoReembolso}
                onChange={(e) => setMontoReembolso(limitarDigitos(e.target.value, MAX_DIGITOS_PRECIO))}
                placeholder={totalPedido !== null ? `Ej. ${totalPedido.toFixed(2)} (total)` : 'Escribe el monto'}
                disabled={!puedoEditarPedido}
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
              🔒 No te pertenece este pedido.
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
            </>
          )}
        </AvisoFlotante>
      </td>
      <td>
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
            esperando a que le den clic otra vez. */}
        <button
          className="btn btn-small"
          onClick={handleGuardar}
          disabled={!sinGuardar || guardando || montoReembolsoInvalido}
          title={
            haySolicitudPendienteReembolso
              ? 'Ya enviaste una solicitud de reembolso — pendiente de que el Administrador la confirme o la cancele'
              : montoReembolsoInvalido
                ? 'Escribe el monto a reembolsar antes de guardar'
                : undefined
          }
        >
          {haySolicitudPendienteReembolso ? 'Pendiente' : guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </td>
    </tr>
  );
}
