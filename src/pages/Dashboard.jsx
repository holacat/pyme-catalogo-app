import { useEffect, useRef, useState } from 'react';
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

// Texto (▲, ▼ o ↕) que se muestra junto al nombre de la columna, para que
// Claudia vea de un vistazo si esa columna está ordenando la tabla y en
// qué dirección.
function indicadorOrdenStock(orden, campo) {
  if (!orden || orden.campo !== campo) return '↕';
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
function conLimiteDeTiempo(promesa, etiqueta, opciones = {}) {
  const ms = opciones.ms || TIEMPO_MAXIMO_ESPERA_MS;
  const esLectura = !!opciones.esLectura;
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
      .then(() => cargarTodo(sesionToken, { silencioso: true }))
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
        <input
          type="password"
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
  productos.forEach((p) => {
    categoriaPorProductoId[p.ID] = categoriaDeProducto(p);
    codigoPorProductoId[p.ID] = p.CodigoPropio || '';
  });

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
  const conteoPorEstado = pedidosPorFecha.reduce((acc, p) => {
    acc[p.Estado] = (acc[p.Estado] || 0) + 1;
    return acc;
  }, {});
  const pedidosFiltrados = filtroEstado
    ? pedidosPorFecha.filter((p) => p.Estado === filtroEstado)
    : pedidosPorFecha;

  const filtroPedidoFechaActivo = !!(filtroPedidoDesde || filtroPedidoHasta);

  function limpiarFiltroPedidoFecha() {
    setFiltroPedidoDesde('');
    setFiltroPedidoHasta('');
  }

  return (
    <div className="dashboard">
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

      {alertas.length > 0 && (
        <div className="alert-banner">
          ⚠️ {alertas.length} producto(s) con bajo inventario:{' '}
          {alertas.map((a, i) => (
            <span key={a.ID}>
              <button type="button" className="link-button" onClick={() => irAStockYResaltar(a.ID)}>
                {a.Nombre}{a.CodigoPropio ? ` (${a.CodigoPropio})` : ''}
              </button>
              {i < alertas.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}

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

         <div className="tabs">
        {puedeVer('stock') && (
          <button className={tab === 'stock' ? 'active' : ''} onClick={() => cambiarTab('stock')}>Stock</button>
        )}
        {puedeVer('pedidos') && (
          <button className={tab === 'pedidos' ? 'active' : ''} onClick={() => cambiarTab('pedidos')}>
            Pedidos ({pedidos.length})
          </button>
        )}
        {puedeVer('alertas') && (
          <button className={tab === 'alertas' ? 'active' : ''} onClick={() => cambiarTab('alertas')}>
            Alertas ({alertas.length})
          </button>
        )}
        {puedeVer('cuenta') && (
          <button className={tab === 'cuenta' ? 'active' : ''} onClick={() => cambiarTab('cuenta')}>
            📄 Estado de cuenta
          </button>
        )}
        {puedeVer('bitacora') && (
          <button className={tab === 'bitacora' ? 'active' : ''} onClick={() => cambiarTab('bitacora')}>
            🗒️ Bitácora
          </button>
        )}
        {puedeVer('usuarios') && (
          <button className={tab === 'usuarios' ? 'active' : ''} onClick={() => cambiarTab('usuarios')}>
            👤 Usuarios
          </button>
        )}
        {puedeVer('analitica') && (
          <button className={tab === 'analitica' ? 'active' : ''} onClick={() => cambiarTab('analitica')}>
            📈 Analítica de ventas
          </button>
        )}
        {puedeVer('orden') && (
          <button className={tab === 'orden' ? 'active' : ''} onClick={() => cambiarTab('orden')}>
            🔀 Orden del catálogo
          </button>
        )}
        {puedeVer('nuevo') && (
          <button className={tab === 'nuevo' ? 'active' : ''} onClick={() => cambiarTab('nuevo')}>
            + Agregar producto
          </button>
        )}
        {esAdminCentral && (
          <button className={tab === 'permisos' ? 'active' : ''} onClick={() => cambiarTab('permisos')}>
            🔐 Permisos
          </button>
        )}
      </div>

      {!puedeVer(tab) && tab !== 'permisos' && (
        <p className="info-msg">
          Ya no tienes acceso a esta pestaña. Elige otra de arriba, o pídele al Admin Central que revise tus permisos.
        </p>
      )}

           {tab === 'stock' && puedeVer('stock') && (
        <>
          {transferenciasPendientes.length > 0 && (
            <div className="transferencias-pendientes-panel">
              <p className="transferencias-pendientes-titulo">
                📥 Tienes {transferenciasPendientes.length} solicitud{transferenciasPendientes.length === 1 ? '' : 'es'} de stock pendiente{transferenciasPendientes.length === 1 ? '' : 's'}:
              </p>
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
            </div>
          )}

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

          <div className="table-scroll">
            <table className="data-table stock-table">
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
                  <th>Dueño</th>
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
                  />
                ))}
              </tbody>
            </table>
            {productosFiltrados.length === 0 && (
              <p className="info-msg">Ningún producto coincide con la búsqueda o los filtros de arriba.</p>
            )}
          </div>

          {esAdministrador && <TransferenciasHistorialTab transferencias={transferencias} />}
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

          {/* Tablita de conteo por estado, ARRIBA de la tabla (no al lado),
              para no quitarle ancho a la tabla y así evitar que tenga que
              hacer scroll hacia los lados. Los números ya respetan el
              filtro de fechas de arriba, si está activo. */}
          <div className="pedidos-resumen-fila">
            <span className="pedidos-resumen-titulo">Pedidos por estado:</span>
            <button
              type="button"
              className={`resumen-btn ${filtroEstado === '' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('')}
            >
              <span>Todos</span>
              <strong>{pedidosPorFecha.length}</strong>
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

          <div className="table-scroll">
            <table className="data-table pedidos-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Categoría</th><th>Código</th>
                  <th>Cant.</th><th>Precio</th><th>Total</th><th>Notas</th><th>Estado</th><th>Guardar</th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.map((ped) => (
                  <PedidoRow
                    key={`${ped.ID}-${resetToken}`}
                    pedido={ped}
                    categoria={categoriaPorProductoId[ped.ProductoID] || '—'}
                    codigo={codigoPorProductoId[ped.ProductoID] || '—'}
                    onGuardar={handleGuardarPedido}
                    onDirtyChange={marcarSucio}
                    onAbrirNota={(cliente, valor, onChange) => setNotaEnZoom({ cliente, valor, onChange })}
                  />
                ))}
              </tbody>
            </table>
            {pedidosFiltrados.length === 0 && (
              <p className="info-msg">Ningún pedido coincide con el estado o el rango de fechas de arriba.</p>
            )}
          </div>
        </>
      )}

                      {tab === 'alertas' && puedeVer('alertas') && (
        <>
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
        />
      )}

      {tab === 'analitica' && puedeVer('analitica') && <AnaliticaTab sesionToken={sesionToken} />}

      {tab === 'orden' && puedeVer('orden') && (
        <OrdenTab
          productos={productos}
          opciones={opciones}
          sesionToken={sesionToken}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
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
            setTab('stock');
            return cargarTodo(sesionToken, { silencioso: true });
          }}
        />
      )}

      {tab === 'permisos' && esAdminCentral && (
        <PermisosTab sesionToken={sesionToken} usuarios={usuarios} />
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
  const form = usaEstadoExterno ? formExterno : formInterno;
  const setForm = usaEstadoExterno ? setFormExterno : setFormInterno;
  const fotos = usaEstadoExterno ? fotosExterno : fotosInterno;
  const setFotos = usaEstadoExterno ? setFotosExterno : setFotosInterno;
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');

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
    const datos = {
      sesionToken,
      ...form,
      duenoId: duenoIdFinal,
      duenoNombre: duenoSeleccionado ? duenoSeleccionado.Nombre : (duenoIdFinal === usuarioId ? nombreSesion : ''),
      fotoUrl: fotos.join('|'),
    };
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
          <input value={form.nombre} onChange={handleChangeTexto('nombre', MAX_CARACTERES_NOMBRE)} required maxLength={MAX_CARACTERES_NOMBRE} list="lista-nombre" />
          <datalist id="lista-nombre">
            {(opciones.nombre || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="form-label-fila">
            Código propio
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('codigoPropio')} title="Administrar opciones predeterminadas de Código propio">
              ⚙️
            </button>
          </span>
          <input
            value={form.codigoPropio}
            onChange={handleChangeTexto('codigoPropio', MAX_CARACTERES_CODIGO)}
            placeholder="Ej. PLY-001"
            maxLength={MAX_CARACTERES_CODIGO}
            list="lista-codigoPropio"
          />
          <datalist id="lista-codigoPropio">
            {(opciones.codigoPropio || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="form-label-fila">
            Categoría
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('categoria')} title="Administrar opciones predeterminadas de Categoría">
              ⚙️
            </button>
          </span>
          <input value={form.categoria} onChange={handleChangeTexto('categoria', MAX_CARACTERES_CATEGORIA)} maxLength={MAX_CARACTERES_CATEGORIA} list="lista-categoria" />
          <datalist id="lista-categoria">
            {(opciones.categoria || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="form-label-fila">
            Marca
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('marca')} title="Administrar opciones predeterminadas de Marca">
              ⚙️
            </button>
          </span>
          <input value={form.marca} onChange={handleChangeTexto('marca', MAX_CARACTERES_MARCA)} maxLength={MAX_CARACTERES_MARCA} list="lista-marca" />
          <datalist id="lista-marca">
            {(opciones.marca || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="form-label-fila">
            Talla / Medida
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('talla')} title="Administrar opciones predeterminadas de Talla / Medida">
              ⚙️
            </button>
          </span>
          <input value={form.talla} onChange={handleChangeTexto('talla', MAX_CARACTERES_TALLA)} maxLength={MAX_CARACTERES_TALLA} list="lista-talla" />
          <datalist id="lista-talla">
            {(opciones.talla || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
              <label>
          <span className="form-label-fila">
            Color
            <button type="button" className="gestor-opciones-btn" onClick={() => abrirGestor('color')} title="Administrar opciones predeterminadas de Color">
              ⚙️
            </button>
          </span>
          <input value={form.color} onChange={handleChangeTexto('color', MAX_CARACTERES_COLOR)} maxLength={MAX_CARACTERES_COLOR} list="lista-color" />
          <datalist id="lista-color">
            {(opciones.color || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
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
        <ImageUploader sesionToken={sesionToken} value={fotos} onChange={setFotos} />
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

// Pestaña para acomodar en qué orden se ven los productos en el catálogo
// público, dentro de su propia categoría (con botones ▲ / ▼, más sencillos
// de usar con precisión que arrastrar); para renombrar una categoría
// completa de un jalón; para ocultarla/mostrarla del catálogo sin tocar sus
// productos; para agregar una categoría nueva vacía; y para quitar o borrar
// una categoría completa (con o sin sus productos).
function OrdenTab({ productos, opciones, sesionToken, onCambio }) {
  const categoriasPredeterminadas = opciones.categoria || [];
  const categoriasOcultas = opciones.categoriaOculta || [];
  const categoriaOrdenExplicito = opciones.categoriaOrden || [];

  const [gruposLocal, setGruposLocal] = useState(() =>
    agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito)
  );
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');

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

  // Si los productos o las opciones (categorías nuevas, renombradas,
  // ocultas) cambian desde fuera, se vuelve a acomodar la lista con los
  // datos más recientes.
    useEffect(() => {
    setGruposLocal(agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas, categoriaOrdenExplicito));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, opciones]);

  // Sube (dirección -1) o baja (dirección +1) un producto UN lugar dentro
  // de su categoría. Mucho más preciso que arrastrar: cada clic mueve
  // exactamente un lugar, sin riesgo de soltarlo en la fila equivocada.
   function moverProducto(nombreCategoria, indice, direccion) {
    setGruposLocal((prev) => {
      const nuevos = prev.map((g) => ({ ...g, productos: g.productos.slice() }));
      const grupo = nuevos.find((g) => g.nombre === nombreCategoria);
      if (!grupo) return prev;

      const destino = indice + direccion;
      if (destino < 0 || destino >= grupo.productos.length) return prev;

      const [movido] = grupo.productos.splice(indice, 1);
      grupo.productos.splice(destino, 0, movido);

      // Bug reportado por Claudia (2026-09): antes, la Bitácora solo decía
      // "N producto(s) reordenado(s)" (el total de la categoría, porque se
      // renumera toda de un jalón), lo cual era confuso al mover UN solo
      // producto. Aquí armamos un resumen explícito — qué producto se movió
      // y respecto a cuál otro quedó — y se lo mandamos al backend para que
      // lo use en la Bitácora en vez de solo el conteo.
      const nombreMovido = movido.Nombre || 'Este producto';
      let resumen;
      if (direccion > 0) {
        const vecinoArriba = grupo.productos[destino - 1];
        resumen = vecinoArriba
          ? `${nombreMovido}: se movió debajo de "${vecinoArriba.Nombre || 'otro producto'}" (categoría ${nombreCategoria})`
          : `${nombreMovido}: ahora es el último de la categoría ${nombreCategoria}`;
      } else {
        const vecinoAbajo = grupo.productos[destino + 1];
        resumen = vecinoAbajo
          ? `${nombreMovido}: se movió arriba de "${vecinoAbajo.Nombre || 'otro producto'}" (categoría ${nombreCategoria})`
          : `${nombreMovido}: ahora es el primero de la categoría ${nombreCategoria}`;
      }

      guardarOrdenDeCategoria(grupo, resumen);
      return nuevos;
    });
  }

  // Renumera 1, 2, 3... toda la categoría según cómo haya quedado
  // acomodada, y manda todos esos números juntos en una sola llamada.
  // `resumen` (texto legible de qué producto se movió y a dónde) se manda
  // aparte para que la Bitácora sea explícita en vez de solo un conteo.
   function guardarOrdenDeCategoria(grupo, resumen) {
    const cambios = grupo.productos.map((p, i) => ({ productoId: p.ID, orden: i + 1 }));
    setGuardando(true);
    setMensaje('');
    actualizarOrdenMultiple({ sesionToken, cambios, resumen })
      .then(() => onCambio())
      .catch((err) => setMensaje(`Error al guardar el orden: ${err.message}`))
      .finally(() => setGuardando(false));
  }

  // Sube (dirección -1) o baja (dirección +1) una CATEGORÍA COMPLETA un
  // lugar entre las demás — no confundir con moverProducto, que mueve un
  // producto DENTRO de su categoría. Bug reportado por Claudia (2026-09):
  // no existía ninguna forma directa de decidir en qué orden aparecen las
  // categorías entre sí en el catálogo público. Como el backend guarda
  // ese orden como una lista completa (ver actualizarOrdenCategorias en
  // api.js/Code.gs), aquí se manda SIEMPRE la lista de todas las
  // categorías ya en su nuevo acomodo, igual que guardarOrdenDeCategoria
  // manda todos los productos de una categoría de un jalón.
  function moverCategoria(indice, direccion) {
    setGruposLocal((prev) => {
      const destino = indice + direccion;
      if (destino < 0 || destino >= prev.length) return prev;

      const nuevos = prev.slice();
      const [movida] = nuevos.splice(indice, 1);
      nuevos.splice(destino, 0, movida);

      const vecina = direccion > 0 ? nuevos[destino - 1] : nuevos[destino + 1];
      const resumen = vecina
        ? `Categoría "${movida.nombre}": se movió ${direccion > 0 ? 'debajo' : 'arriba'} de "${vecina.nombre}"`
        : `Categoría "${movida.nombre}": ahora es la ${direccion > 0 ? 'última' : 'primera'}`;

      setGuardando(true);
      setMensaje('');
      actualizarOrdenCategorias({ sesionToken, categorias: nuevos.map((g) => g.nombre), resumen })
        .then(() => onCambio())
        .catch((err) => setMensaje(`Error al guardar el orden de categorías: ${err.message}`))
        .finally(() => setGuardando(false));

      return nuevos;
    });
  }

  function abrirRenombrar(nombreActual) {
    setRenombrando(nombreActual);
    setNombreNuevo(nombreActual === 'Otros' ? '' : nombreActual);
  }

  function confirmarRenombrar() {
    const nuevo = nombreNuevo.trim();
    if (!nuevo || !renombrando) return;
    setGuardandoNombre(true);
    renombrarCategoria({ sesionToken, categoriaAnterior: renombrando, categoriaNueva: nuevo })
      .then(() => {
        setRenombrando(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al renombrar la categoría: ${err.message}`))
      .finally(() => setGuardandoNombre(false));
  }

  function abrirAgregarCategoria() {
    setNombreCategoriaNueva('');
    setAgregandoCategoria(true);
  }

  function confirmarAgregarCategoria() {
    const nombre = nombreCategoriaNueva.trim();
    if (!nombre) return;
    setGuardandoCategoriaNueva(true);
    agregarOpcion({ sesionToken, campo: 'categoria', valor: nombre })
      .then(() => {
        setAgregandoCategoria(false);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al agregar la categoría: ${err.message}`))
      .finally(() => setGuardandoCategoriaNueva(false));
  }

  // Ocultar/mostrar es reversible y NO toca los productos ni su categoría:
  // solo agrega o quita el nombre de la categoría de una listita aparte
  // ("categoriaOculta"), que el catálogo público revisa antes de mostrar
  // cada producto.
  function toggleOcultarCategoria(grupo) {
    setOcultandoCategoria(grupo.nombre);
    setMensaje('');
    const promesa = grupo.oculta
      ? eliminarOpcion({ sesionToken, campo: 'categoriaOculta', valor: grupo.nombre })
      : agregarOpcion({ sesionToken, campo: 'categoriaOculta', valor: grupo.nombre });
    promesa
      .then(() => onCambio())
      .catch((err) =>
        setMensaje(`Error al ${grupo.oculta ? 'volver a mostrar' : 'ocultar'} la categoría: ${err.message}`)
      )
      .finally(() => setOcultandoCategoria(''));
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
    eliminarCategoria({ sesionToken, categoria: eliminando.nombre, borrarProductos: borrarProductosTambien })
      .then(() => {
        setEliminando(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al quitar/borrar la categoría: ${err.message}`))
      .finally(() => setGuardandoEliminar(false));
  }

  return (
    <div className="orden-catalogo">
          <p className="muted">
        Usa las flechitas ▲ y ▼ chiquitas de cada producto para subirlo o bajarlo, un lugar a la
        vez, dentro de su categoría. Usa las flechitas ▲ y ▼ grandes, junto al nombre de cada
        categoría, para cambiar en qué orden aparecen las categorías completas entre sí (cuál se
        ve primero, cuál al final) en el catálogo público. En ambos casos el cambio se guarda
        solo, no hace falta darle a ningún botón de "Guardar".
      </p>

      <div className="orden-barra-superior">
        <button type="button" className="btn btn-secondary" onClick={abrirAgregarCategoria}>
          + Agregar categoría
        </button>
      </div>

      {guardando && <p className="info-msg">Guardando orden…</p>}
      {mensaje && <p className="info-msg error">{mensaje}</p>}

          {gruposLocal.map((grupo, indiceCategoria) => (
        <section key={grupo.nombre} className={`orden-categoria-box ${grupo.oculta ? 'categoria-oculta' : ''}`}>
          <div className="orden-categoria-header">
            <div className="orden-botones-mover">
              <button
                type="button"
                className="orden-mover-btn"
                onClick={() => moverCategoria(indiceCategoria, -1)}
                disabled={indiceCategoria === 0}
                title="Subir esta categoría un lugar"
                aria-label="Subir esta categoría un lugar"
              >
                ▲
              </button>
              <button
                type="button"
                className="orden-mover-btn"
                onClick={() => moverCategoria(indiceCategoria, 1)}
                disabled={indiceCategoria === gruposLocal.length - 1}
                title="Bajar esta categoría un lugar"
                aria-label="Bajar esta categoría un lugar"
              >
                ▼
              </button>
            </div>
            <h3>
              {grupo.nombre}
              {grupo.oculta && <span className="badge badge-oculto">Oculta del catálogo</span>}
            </h3>
            <div className="orden-categoria-botones">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => abrirRenombrar(grupo.nombre)}
              >
                ✏️ Renombrar
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => toggleOcultarCategoria(grupo)}
                disabled={ocultandoCategoria === grupo.nombre}
              >
                {grupo.oculta ? '👁️ Mostrar' : '🙈 Ocultar'}
              </button>
              <button
                type="button"
                className="btn btn-eliminar btn-small"
                onClick={() => abrirEliminar(grupo)}
              >
                🗑️ Eliminar
              </button>
            </div>
          </div>

          {grupo.productos.length === 0 ? (
            <p className="muted">Todavía no hay productos en esta categoría.</p>
          ) : (
            <ul className="orden-lista">
              {grupo.productos.map((p, i) => (
                <li key={p.ID} className="orden-fila">
                  <div className="orden-botones-mover">
                    <button
                      type="button"
                      className="orden-mover-btn"
                      onClick={() => moverProducto(grupo.nombre, i, -1)}
                      disabled={i === 0}
                      title="Subir un lugar"
                      aria-label="Subir un lugar"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="orden-mover-btn"
                      onClick={() => moverProducto(grupo.nombre, i, 1)}
                      disabled={i === grupo.productos.length - 1}
                      title="Bajar un lugar"
                      aria-label="Bajar un lugar"
                    >
                      ▼
                    </button>
                  </div>
                  {primeraFoto(p.FotoURL) ? (
                    <img src={primeraFoto(p.FotoURL)} alt={p.Nombre} className="orden-thumb" />
                  ) : (
                    <div className="orden-thumb orden-thumb-vacia">Sin foto</div>
                  )}
                  <span className="orden-nombre">{p.Nombre}</span>
                  {!esProductoVisible(p) && <span className="badge badge-oculto">Oculto</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

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
      <td>${Number(producto.Precio).toLocaleString('es-MX')}</td>
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
                <li key={d.usuarioId} className={esMio ? 'stock-dueno-mio' : ''}>
                  <span>
                    {esMio ? 'Yo' : d.nombre}: <strong>{disponibleD}</strong>
                  </span>
                  {!controlTotal && !esMio && !solicitudEnProceso && (
                    <button type="button" className="btn btn-secondary btn-chip" onClick={() => abrirSolicitar(d)}>
                      Solicitar
                    </button>
                  )}
                  {!controlTotal && !esMio && solicitudEnProceso && (
                    <span className="muted campo-nota">⏳ Enviada, esperando respuesta</span>
                  )}
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
                  {(esMio || controlTotal) && (
                    <button type="button" className="btn btn-secondary btn-chip" onClick={() => abrirOfrecer(d)}>
                      Asignar a…
                    </button>
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

// ---- Historial de transferencias (solo Administrador/Admin Central,
// dentro de la pestaña Stock) — lista completa de solicitudes, más
// reciente primero, con un botón para mostrarla/ocultarla. ----
function TransferenciasHistorialTab({ transferencias }) {
  const [abierto, setAbierto] = useState(false);
  const ordenadas = (transferencias || []).slice().reverse();

  return (
    <div className="transferencias-historial">
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto((a) => !a)}>
        {abierto ? '▲ Ocultar historial de transferencias' : '▼ Ver historial de transferencias'}
      </button>
      {abierto && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Solicitante</th>
                <th>Dueño</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((t) => (
                <tr key={t.ID}>
                  <td>{formatearFechaHora(t.Fecha)}</td>
                  <td>{t.SolicitanteNombre}</td>
                  <td>{t.DuenoNombre}</td>
                  <td>{t.Producto}</td>
                  <td>{t.Cantidad}</td>
                  <td>{t.Estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ordenadas.length === 0 && <p className="info-msg">Todavía no hay transferencias registradas.</p>}
        </div>
      )}
    </div>
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
                <th>Tipo</th>
                <th>Monto</th>
                <th>Concepto</th>
              </tr>
            </thead>
            <tbody>
              {movimientosFiltrados.map((m) => (
                <tr key={m.ID}>
                  <td>{formatearFechaHora(m.Fecha)}</td>
                  <td>{m.Cliente || '—'}</td>
                  <td>{productoDelMovimiento(m)}</td>
                  <td>{codigoDelMovimiento(m)}</td>
                  <td>
                    <span className={`badge-movimiento ${m.Tipo === 'Abono' ? 'badge-abono' : 'badge-cargo'}`}>
                      {m.Tipo}
                    </span>
                  </td>
                  <td>{formatearMoneda(Number(m.Monto) || 0)}</td>
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
function BitacoraTab({ bitacora }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const bitacoraOrdenada = bitacora.slice().reverse();
  const bitacoraFiltrada = bitacoraOrdenada.filter((b) => movimientoEnRangoDeFecha(b, desde, hasta));

  const hayFiltro = !!(desde || hasta);

  function limpiarFiltro() {
    setDesde('');
    setHasta('');
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
        {hayFiltro && (
          <button type="button" className="btn btn-secondary btn-small" onClick={limpiarFiltro}>
            Quitar filtro de fechas
          </button>
        )}
      </div>

      <p className="muted">{textoRangoFechas(desde, hasta)}</p>

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
                <td>{b.Detalle || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bitacoraFiltrada.length === 0 && (
          <p className="info-msg">No hay cambios registrados en el rango de fechas de arriba.</p>
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

function UsuariosTab({ usuarios, sesionToken, soyAdminCentral, onCambio }) {
  const [mensaje, setMensaje] = useState('');

  const [agregando, setAgregando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevaContrasena, setNuevaContrasena] = useState('');
  const [nuevoRol, setNuevoRol] = useState('Vendedor');
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);

  const [editando, setEditando] = useState(null); // usuario completo, o null
  const [editNombre, setEditNombre] = useState('');
  const [editRol, setEditRol] = useState('Vendedor');
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
    setMensaje('');
    setAgregando(true);
  }

  function confirmarAgregar(e) {
    e.preventDefault();
    if (!nuevoNombre.trim() || !nuevoUsuario.trim() || nuevaContrasena.length < 4) return;
    setGuardandoNuevo(true);
    setMensaje('');
    crearUsuario({
      sesionToken,
      nombre: nuevoNombre.trim(),
      usuario: nuevoUsuario.trim(),
      contrasena: nuevaContrasena,
      rol: nuevoRol,
    })
      .then(() => {
        setAgregando(false);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al crear el usuario: ${err.message}`))
      .finally(() => setGuardandoNuevo(false));
  }

  function abrirEditar(u) {
    setEditando(u);
    setEditNombre(u.Nombre || '');
    setEditRol(u.Rol || 'Vendedor');
    setMensaje('');
  }

  function confirmarEditar(e) {
    e.preventDefault();
    if (!editando || !editNombre.trim()) return;
    setGuardandoEdit(true);
    setMensaje('');
    actualizarUsuario({ sesionToken, usuarioId: editando.ID, nombre: editNombre.trim(), rol: editRol })
      .then(() => {
        setEditando(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al editar el usuario: ${err.message}`))
      .finally(() => setGuardandoEdit(false));
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
    cambiarContrasenaUsuario({ sesionToken, usuarioId: cambiandoClave.ID, contrasenaNueva: claveNueva })
      .then(() => {
        setCambiandoClave(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al cambiar la contraseña: ${err.message}`))
      .finally(() => setGuardandoClave(false));
  }

  function toggleActivo(u) {
    const activo = esActivo(u.Activo);
    setCambiandoEstadoId(u.ID);
    setMensaje('');
    const promesa = activo
      ? inhabilitarUsuario({ sesionToken, usuarioId: u.ID })
      : habilitarUsuario({ sesionToken, usuarioId: u.ID });
    promesa
      .then(() => onCambio())
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => setCambiandoEstadoId(''));
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
              <input
                type="password"
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
              <input
                type="password"
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
function PermisosTab({ sesionToken, usuarios }) {
  const [pestanas, setPestanas] = useState([]);
  const [rolDefaults, setRolDefaults] = useState({ Administrador: {}, Vendedor: {} });
  const [overrides, setOverrides] = useState([]);
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
    actualizarPermisoRol({ sesionToken, rol, pestana: pestanaClave, permitido: !valorActual })
      .then(cargar)
      .catch((err) => setMensaje(`Error al guardar: ${err.message}`))
      .finally(() => setCeldaGuardando(''));
  }

  // Solo tiene sentido poner una excepción a alguien que no sea el Admin
  // Central (a él el backend de todos modos la rechazaría) y que esté
  // activo (a alguien inhabilitado no le sirve de nada, no puede entrar).
  const usuariosElegibles = (usuarios || []).filter((u) => !esFilaAdminCentral(u) && esActivo(u.Activo));

  function agregarExcepcion(e) {
    e.preventDefault();
    if (!nuevoUsuarioId || !nuevaPestana) return;
    setGuardandoExcepcion(true);
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
      .finally(() => setGuardandoExcepcion(false));
  }

  function quitarExcepcion(usuarioId, pestanaClave) {
    actualizarPermisoUsuario({ sesionToken, usuarioId, pestana: pestanaClave, quitar: true })
      .then(cargar)
      .catch((err) => setMensaje(`Error al quitar la excepción: ${err.message}`));
  }

  function etiquetaDe(pestanaClave) {
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
          Pestaña
          <select value={nuevaPestana} onChange={(e) => setNuevaPestana(e.target.value)} required>
            <option value="">Elige…</option>
            {pestanas.map((p) => (
              <option key={p.clave} value={p.clave}>{p.etiqueta}</option>
            ))}
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
          <circle cx={coordX(i)} cy={coordY(d.total)} r="4" className="analitica-linea-punto">
            <title>{`${d.fecha}: ${formatearMoneda(d.total)}`}</title>
          </circle>
          {i % saltoEtiquetas === 0 && (
            <text x={coordX(i)} y={ALTO - 8} className="analitica-linea-eje-texto" textAnchor="middle">
              {d.fecha.slice(5)}
            </text>
          )}
        </g>
      ))}
    </svg>
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

  const maxProducto = datos && datos.porProducto.length > 0 ? Math.max(...datos.porProducto.map((p) => p.total)) : 0;
  const maxCategoria = datos && datos.porCategoria.length > 0 ? Math.max(...datos.porCategoria.map((c) => c.total)) : 0;
  const maxVendedor = datos && datos.porVendedor.length > 0 ? Math.max(...datos.porVendedor.map((v) => v.cantidadVentas)) : 0;

  // Convierte un valor a un porcentaje de ancho/alto de barra entre 0% y
  // 100%. Si el valor es negativo (por ejemplo, un producto con más
  // reembolsos que ventas en el rango) se deja una barra mínima de 2% en
  // vez de un ancho negativo, que rompería el layout.
  function porcentajeBarra(valor, maximo) {
    if (!maximo || maximo <= 0) return '0%';
    const pct = (valor / maximo) * 100;
    return `${Math.max(pct, 2)}%`;
  }

  // Qué porcentaje representa `valor` dentro de la suma de TODO lo que se
  // está mostrando en esa misma lista (no del total general del período).
  // Por ejemplo, en "Productos más vendidos" (que solo enseña el top 10),
  // el 100% es la suma de esos 10 productos, no de todas las ventas del
  // período. Devuelve null si no hay nada que repartir (evita "NaN%").
  function porcentajeDeLista(valor, sumaTotal) {
    if (!sumaTotal || sumaTotal <= 0) return null;
    return (valor / sumaTotal) * 100;
  }

  const sumaProductoVisible = datos ? datos.porProducto.reduce((s, p) => s + p.total, 0) : 0;
  const sumaCategoriaVisible = datos ? datos.porCategoria.reduce((s, c) => s + c.total, 0) : 0;
  const sumaVentasVendedor = datos ? datos.porVendedor.reduce((s, v) => s + v.cantidadVentas, 0) : 0;

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

          <section className="analitica-seccion">
            <h3>📦 Productos más vendidos</h3>
            {datos.porProducto.length === 0 ? (
              <p className="info-msg">No hay ventas en este rango de fechas.</p>
            ) : (
              <div className="analitica-barras">
                {datos.porProducto.map((p) => (
                  <div className="analitica-barra-fila" key={p.producto}>
                    <span className="analitica-barra-etiqueta" title={p.producto}>{p.producto}</span>
                    <div className="analitica-barra-pista">
                      <div className="analitica-barra-relleno" style={{ width: porcentajeBarra(p.total, maxProducto) }} />
                    </div>
                    <span className="analitica-barra-valor">
                      {formatearMoneda(p.total)} ({p.cantidadVentas} venta{p.cantidadVentas === 1 ? '' : 's'})
                      {porcentajeDeLista(p.total, sumaProductoVisible) !== null && (
                        <span className="analitica-barra-porcentaje">
                          {' '}
                          · {porcentajeDeLista(p.total, sumaProductoVisible).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="analitica-seccion">
            <h3>🗂️ Ventas por categoría</h3>
            {datos.porCategoria.length === 0 ? (
              <p className="info-msg">No hay ventas en este rango de fechas.</p>
            ) : (
              <div className="analitica-barras">
                {datos.porCategoria.map((c) => (
                  <div className="analitica-barra-fila" key={c.categoria}>
                    <span className="analitica-barra-etiqueta" title={c.categoria}>{c.categoria}</span>
                    <div className="analitica-barra-pista">
                      <div
                        className="analitica-barra-relleno analitica-barra-relleno-categoria"
                        style={{ width: porcentajeBarra(c.total, maxCategoria) }}
                      />
                    </div>
                    <span className="analitica-barra-valor">
                      {formatearMoneda(c.total)}
                      {porcentajeDeLista(c.total, sumaCategoriaVisible) !== null && (
                        <span className="analitica-barra-porcentaje">
                          {' '}
                          · {porcentajeDeLista(c.total, sumaCategoriaVisible).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="analitica-seccion">
            <h3>🧑‍💼 Ventas por vendedor</h3>
            {datos.porVendedor.length === 0 ? (
              <p className="info-msg">No hay ventas en este rango de fechas.</p>
            ) : (
              <div className="analitica-barras">
                {datos.porVendedor.map((v) => (
                  <div className="analitica-barra-fila" key={v.usuario}>
                    <span className="analitica-barra-etiqueta" title={v.usuario}>{v.usuario}</span>
                    <div className="analitica-barra-pista">
                      <div
                        className="analitica-barra-relleno analitica-barra-relleno-vendedor"
                        style={{ width: porcentajeBarra(v.cantidadVentas, maxVendedor) }}
                      />
                    </div>
                    <span className="analitica-barra-valor">
                      {v.cantidadVentas} venta{v.cantidadVentas === 1 ? '' : 's'} · {formatearMoneda(v.total)}
                      {porcentajeDeLista(v.cantidadVentas, sumaVentasVendedor) !== null && (
                        <span className="analitica-barra-porcentaje">
                          {' '}
                          · {porcentajeDeLista(v.cantidadVentas, sumaVentasVendedor).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted">
              "Vendedor" es quién marcó cada pedido como Pagado/Reembolsado desde el Dashboard. Los
              movimientos guardados antes de esta función aparecen como "Sin registrar".
            </p>
          </section>

          <section className="analitica-seccion">
            <h3>📈 Tendencia de ventas por día</h3>
            {datos.serieTiempo.length === 0 ? (
              <p className="info-msg">No hay ventas en este rango de fechas.</p>
            ) : (
              <GraficaLineaTendencia serie={datos.serieTiempo} />
            )}
            <p className="muted">
              Cada punto es el total neto de ventas de ese día (abonos menos cargos). Pasa el mouse
              sobre un punto para ver la fecha y el monto exacto.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function PedidoRow({ pedido, categoria, codigo, onGuardar, onDirtyChange, onAbrirNota }) {
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

  const cambioCantidad = String(cantidad) !== String(pedido.Cantidad);
  const cambioTelefono = telefono !== telefonoOriginal;
  const cambioNotas = notas !== notasOriginal;
  const cambioEstado = estado !== pedido.Estado;
  const sinGuardar = cambioCantidad || cambioTelefono || cambioNotas || cambioEstado;

  // Al elegir "Reembolsado" en el menú (viniendo de cualquier otro estado),
  // precargamos la cajita de monto con el total del pedido. Si Claudia
  // vuelve a cambiar de estado y regresa a "Reembolsado", se recalcula de
  // nuevo con la cantidad que tenga en ese momento.
  function handleCambiarEstado(nuevoEstado) {
    if (nuevoEstado === 'Reembolsado' && estado !== 'Reembolsado') {
      setMontoReembolso(totalPedido !== null ? totalPedido.toFixed(2) : '');
    }
    setEstado(nuevoEstado);
  }

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
  }, [cantidad, telefono, notas, estado, pedido, llave]);

  function handleGuardar() {
    setGuardando(true);
    const payload = { cantidad, telefono, notas, estado };
    if (estado === 'Reembolsado') payload.montoReembolso = montoReembolso;
    onGuardar(pedido.ID, payload).finally(() => setGuardando(false));
  }

  const fecha = new Date(pedido.Fecha);

  return (
    <tr className={sinGuardar ? 'fila-sin-guardar' : ''}>
      <td>{fecha.toLocaleDateString('es-MX')}</td>
      <td>{fecha.toLocaleTimeString('es-MX')}</td>
      <td>{pedido.Cliente}</td>
      <td>
        <input
          type="tel"
          inputMode="numeric"
          className={`pedido-input-tel ${cambioTelefono ? 'campo-modificado' : ''}`}
          value={telefono}
          onChange={(e) => setTelefono(limitarTelefono(e.target.value))}
        />
      </td>
      <td>{pedido.Producto}</td>
      <td>{categoria}</td>
      <td>{codigo}</td>
      <td>
        <input
          type="text"
          inputMode="numeric"
          className={`pedido-input-cant ${cambioCantidad ? 'campo-modificado' : ''}`}
          value={cantidad}
          onChange={(e) => setCantidad(limitarDigitos(e.target.value, MAX_DIGITOS_CANTIDAD))}
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
          />
          <button
            type="button"
            className="pedido-notas-zoom-btn"
            onClick={() => onAbrirNota(pedido.Cliente, notas, setNotas)}
            title="Ver nota completa"
          >
            🔍
          </button>
        </div>
      </td>
      <td>
        <select
          className={cambioEstado ? 'campo-modificado' : ''}
          value={estado}
          onChange={(e) => handleCambiarEstado(e.target.value)}
        >
          <option>Sin solicitud</option>
          <option>En proceso</option>
          <option>Pagado</option>
          <option>Reembolsado</option>
          <option>Cancelado</option>
        </select>
        {estado === 'Reembolsado' && (
          <div className="pedido-reembolso-caja">
            <label>
              Monto a reembolsar
              <input
                type="text"
                inputMode="decimal"
                className="pedido-input-reembolso"
                value={montoReembolso}
                onChange={(e) => setMontoReembolso(limitarDigitos(e.target.value, MAX_DIGITOS_PRECIO))}
              />
            </label>
          </div>
        )}
      </td>
      <td>
        <button className="btn btn-small" onClick={handleGuardar} disabled={!sinGuardar || guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </td>
    </tr>
  );
}
