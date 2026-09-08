import { useEffect, useRef, useState } from 'react';
import {
  login,
  listarProductosAdmin,
  listarPedidos,
  obtenerAlertas,
  listarOpciones,
  agregarOpcion,
  eliminarOpcion,
  actualizarStock,
  actualizarPedido,
  listarMovimientos,
  listarBitacora,
  crearProducto,
  actualizarProducto,
  cambiarDisponibilidad,
  eliminarProducto,
  actualizarOrdenMultiple,
  renombrarCategoria,
  eliminarCategoria,
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  cambiarContrasenaUsuario,
  inhabilitarUsuario,
  habilitarUsuario,
  analiticaVentas,
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

const MAX_DIGITOS_STOCK = 9; // hasta 999,999,999 piezas
const MAX_DIGITOS_PRECIO = 9; // hasta 999,999,999 (con hasta 2 decimales)
const MAX_DIGITOS_CANTIDAD = 4; // hasta 9,999 piezas por pedido

// Cada cuánto se refresca solo el Dashboard en segundo plano (milisegundos).
const INTERVALO_REFRESCO_MS = 5000;

const ESTADOS_PEDIDO = ['Sin solicitud', 'En proceso', 'Pagado', 'Reembolsado', 'Cancelado'];

// Ya no existe una sola "clave de administrador" compartida: cada persona
// inicia sesión con su propio usuario y contraseña (hoja "Usuarios"), y el
// servidor regresa un "token" de sesión que se guarda aquí, junto con el
// Rol y el Nombre de esa persona. Todo en sessionStorage (no localStorage):
// se pide de nuevo si cierras el navegador, para que un celular/compu
// compartido no se quede con la sesión de alguien abierta para siempre.
const TOKEN_KEY = 'pyme_sesion_token';
const ROL_KEY = 'pyme_sesion_rol';
const NOMBRE_KEY = 'pyme_sesion_nombre';

// Normaliza valores de "sí/no" que pueden venir como booleano real
// (true/false) o como texto ("TRUE", "SI"), igual que hace el backend.
function esActivo(valor) {
  return valor === true || String(valor).toUpperCase() === 'TRUE' || String(valor).toUpperCase() === 'SI';
}

export default function Dashboard() {
  const [sesionToken, setSesionToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [rol, setRol] = useState(() => sessionStorage.getItem(ROL_KEY) || '');
  const [nombreSesion, setNombreSesion] = useState(() => sessionStorage.getItem(NOMBRE_KEY) || '');
  const [autenticado, setAutenticado] = useState(!!sessionStorage.getItem(TOKEN_KEY));
  // Mientras esto sea true, NO mostramos el panel: estamos comprobando (o
  // volviendo a comprobar) que la sesión guardada todavía sea válida contra
  // el servidor, para no dejar ver la estructura del Dashboard a alguien
  // que en realidad no tiene una sesión correcta.
  const [verificandoSesion, setVerificandoSesion] = useState(() => !!sessionStorage.getItem(TOKEN_KEY));
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
  const esAdministrador = rol === 'Administrador';
  // Opciones predeterminadas para los campos de "+ Agregar producto"
  // (Nombre, Código propio, Categoría, Marca, Talla, Color). Se guarda como
  // { categoria: ['Bolsas', 'Zapatos'], color: ['Rojo'], ... }. A propósito
  // NO se llena sola con el historial de productos: solo tiene lo que se
  // agregó a mano desde "Administrar opciones predeterminadas".
  const [opciones, setOpciones] = useState({});
  const [cargando, setCargando] = useState(false);
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
    if (!silencioso) setCargando(true);
    // "Estado de cuenta", "Bitácora" y "Usuarios" solo las puede ver un
    // Administrador — ni siquiera las pedimos si quien entró es Vendedor,
    // así el servidor no tiene que rechazarlas una por una.
    const pedirSoloAdmin = rol === 'Administrador';
    return Promise.all([
      listarProductosAdmin(token),
      listarPedidos(token),
      obtenerAlertas(token),
      listarOpciones(token),
      pedirSoloAdmin ? listarMovimientos(token) : Promise.resolve({ movimientos: [] }),
      pedirSoloAdmin ? listarBitacora(token) : Promise.resolve({ bitacora: [] }),
      pedirSoloAdmin ? listarUsuarios(token) : Promise.resolve({ usuarios: [] }),
    ])
      .then(([p, o, a, op, mv, b, us]) => {
        setProductos(p.productos);
        setPedidos(o.pedidos);
        setAlertas(a.alertas);
        setOpciones(op.opciones || {});
        setMovimientos(mv.movimientos || []);
        setBitacora(b.bitacora || []);
        setUsuarios(us.usuarios || []);
        if (!silencioso) setMensaje('');
      })
      .catch((err) => {
        // Si el servidor dice que la sesión ya no es válida (expiró, la
        // cuenta se inhabilitó, o quedó guardado un token viejo de otra
        // sesión), cerramos sesión automáticamente en vez de dejar el
        // panel abierto sin poder cargar ni guardar nada.
        if (err.sesionInvalida) {
          handleLogout();
          setErrorLogin(err.message || 'Tu sesión ya no es válida. Vuelve a iniciar sesión.');
          return;
        }
        if (!silencioso) setMensaje(`Error al cargar datos: ${err.message}`);
      })
      .finally(() => {
        if (!silencioso) setCargando(false);
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
  }, [autenticado, sesionToken, rol, sinGuardar, productoEditando, tab]);

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
        sessionStorage.setItem(TOKEN_KEY, res.token);
        sessionStorage.setItem(ROL_KEY, res.rol);
        sessionStorage.setItem(NOMBRE_KEY, res.nombre);
        setSesionToken(res.token);
        setRol(res.rol);
        setNombreSesion(res.nombre);
        setInputContrasena('');
        setTab('stock');
        setAutenticado(true);
        setVerificandoSesion(false);
      })
      .catch((err) => setErrorLogin(err.message || 'No se pudo iniciar sesión'))
      .finally(() => setVerificandoLogin(false));
  }

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ROL_KEY);
    sessionStorage.removeItem(NOMBRE_KEY);
    setAutenticado(false);
    setSesionToken('');
    setRol('');
    setNombreSesion('');
    setInputUsuario('');
    setInputContrasena('');
    setTab('stock');
  }

  function handleActualizarStock(productoId, nuevoStock) {
    actualizarStock({ sesionToken, productoId, nuevoStock })
      .then(() => cargarTodo(sesionToken))
      .catch((err) => setMensaje(`Error al actualizar stock: ${err.message}`));
  }

  function handleGuardarPedido(pedidoId, { cantidad, telefono, notas, estado, montoReembolso }) {
    return actualizarPedido({ sesionToken, pedidoId, cantidad, telefono, notas, estado, montoReembolso })
      .then(() => cargarTodo(sesionToken))
      .catch((err) => setMensaje(`Error al actualizar pedido: ${err.message}`));
  }

  function handleCambiarDisponibilidad(producto) {
    const nuevoValor = !esProductoVisible(producto);
    cambiarDisponibilidad({ sesionToken, productoId: producto.ID, disponible: nuevoValor })
      .then(() => cargarTodo(sesionToken))
      .catch((err) => setMensaje(`Error al cambiar visibilidad: ${err.message}`));
  }

  function handleEliminarProducto(producto) {
    const confirmar = window.confirm(
      `¿Seguro que quieres eliminar "${producto.Nombre}" para siempre? Esta acción no se puede deshacer desde la app.`
    );
    if (!confirmar) return;
    eliminarProducto({ sesionToken, productoId: producto.ID })
      .then(() => cargarTodo(sesionToken))
      .catch((err) => setMensaje(`Error al eliminar producto: ${err.message}`));
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
  const productosFiltrados = ordenarProductosStock(productosBuscados, ordenStock);

  const filtroFechaActivo = !!(filtroDesde || filtroHasta);
  const hayFiltrosStockActivos = filtroFechaActivo || !!filtroCategoriaStock || !!busquedaStock.trim();

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
      <div className="dashboard-header">
        <h2>Panel de administración</h2>
        <div className="dashboard-header-acciones">
          <span className="muted texto-usuario-conectado">
            Sesión: <strong>{nombreSesion || 'Sin nombre'}</strong> · {rol || '—'}
          </span>
          <button className="btn btn-secondary" onClick={handleLogout}>Cerrar sesión</button>
        </div>
      </div>

      {alertas.length > 0 && (
        <div className="alert-banner">
          ⚠️ {alertas.length} producto(s) con bajo inventario: {alertas.map((a) => a.Nombre).join(', ')}
        </div>
      )}

      {mensaje && <p className="info-msg error">{mensaje}</p>}
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
        <button className={tab === 'stock' ? 'active' : ''} onClick={() => cambiarTab('stock')}>Stock</button>
        <button className={tab === 'pedidos' ? 'active' : ''} onClick={() => cambiarTab('pedidos')}>
          Pedidos ({pedidos.length})
        </button>
        <button className={tab === 'alertas' ? 'active' : ''} onClick={() => cambiarTab('alertas')}>
          Alertas ({alertas.length})
        </button>
        {esAdministrador && (
          <button className={tab === 'cuenta' ? 'active' : ''} onClick={() => cambiarTab('cuenta')}>
            📄 Estado de cuenta
          </button>
        )}
        {esAdministrador && (
          <button className={tab === 'bitacora' ? 'active' : ''} onClick={() => cambiarTab('bitacora')}>
            🗒️ Bitácora
          </button>
        )}
        {esAdministrador && (
          <button className={tab === 'usuarios' ? 'active' : ''} onClick={() => cambiarTab('usuarios')}>
            👤 Usuarios
          </button>
        )}
        {esAdministrador && (
          <button className={tab === 'analitica' ? 'active' : ''} onClick={() => cambiarTab('analitica')}>
            📈 Analítica de ventas
          </button>
        )}
        <button className={tab === 'orden' ? 'active' : ''} onClick={() => cambiarTab('orden')}>
          🔀 Orden del catálogo
        </button>
        <button className={tab === 'nuevo' ? 'active' : ''} onClick={() => cambiarTab('nuevo')}>
          + Agregar producto
        </button>
      </div>

      {tab === 'stock' && (
        <>
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
                    onActualizar={handleActualizarStock}
                    onDirtyChange={marcarSucio}
                    onEditar={setProductoEditando}
                    onCambiarDisponibilidad={handleCambiarDisponibilidad}
                    onEliminar={handleEliminarProducto}
                    onVerFoto={setFotoAmpliada}
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

      {tab === 'pedidos' && (
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

      {tab === 'alertas' && (
        <ul className="alert-list">
          {alertas.length === 0 && <li>Sin alertas de bajo inventario 🎉</li>}
          {alertas.map((a) => (
            <li key={a.ID}>
              <strong>{a.Nombre}</strong> — quedan {a.Stock} (mínimo {a.StockMinimo})
            </li>
          ))}
        </ul>
      )}

      {tab === 'cuenta' && esAdministrador && (
        <EstadoCuentaTab movimientos={movimientos} pedidos={pedidos} productos={productos} />
      )}

      {tab === 'bitacora' && esAdministrador && <BitacoraTab bitacora={bitacora} />}

      {tab === 'usuarios' && esAdministrador && (
        <UsuariosTab
          usuarios={usuarios}
          sesionToken={sesionToken}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
        />
      )}

      {tab === 'analitica' && esAdministrador && <AnaliticaTab sesionToken={sesionToken} />}

      {tab === 'orden' && (
        <OrdenTab
          productos={productos}
          opciones={opciones}
          sesionToken={sesionToken}
          onCambio={() => cargarTodo(sesionToken, { silencioso: true })}
        />
      )}

      {tab === 'nuevo' && (
        <ProductoForm
          sesionToken={sesionToken}
          opciones={opciones}
          onOpcionesActualizadas={() => cargarTodo(sesionToken, { silencioso: true })}
          onGuardado={() => {
            cargarTodo(sesionToken);
            setTab('stock');
          }}
        />
      )}

      {productoEditando && (
        <div className="modal-overlay" onClick={() => setProductoEditando(null)}>
          <div className="modal-box modal-box-ancho" onClick={(e) => e.stopPropagation()}>
            <h3>Editar producto</h3>
            <ProductoForm
              sesionToken={sesionToken}
              opciones={opciones}
              onOpcionesActualizadas={() => cargarTodo(sesionToken, { silencioso: true })}
              productoExistente={productoEditando}
              onGuardado={() => {
                setProductoEditando(null);
                cargarTodo(sesionToken);
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
function ProductoForm({ sesionToken, opciones = {}, productoExistente, onGuardado, onOpcionesActualizadas, onCancelar }) {
  const esEdicion = !!productoExistente;
  const [form, setForm] = useState(() => (esEdicion ? formDesdeProducto(productoExistente) : FORM_INICIAL));
  const [fotos, setFotos] = useState(() => (esEdicion ? fotosDesdeProducto(productoExistente) : []));
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');

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
      .then(() => onOpcionesActualizadas?.())
      .catch((err) => setMensaje(`Error al quitar la opción: ${err.message}`));
  }

  function handleChange(campo) {
    return (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  }

  // Para campos numéricos (precio, stock, etc.): igual que handleChange,
  // pero corta el texto a una cantidad máxima de dígitos para que no se
  // puedan escribir números absurdamente grandes. Sigue usando <input
  // type="number"> para no perder las flechitas de subir/bajar.
  function handleChangeNumero(campo, maxDigitos) {
    return (e) => setForm((f) => ({ ...f, [campo]: limitarDigitos(e.target.value, maxDigitos) }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.precio) {
      setMensaje('Error: el nombre y el precio de venta son obligatorios.');
      return;
    }
    setEnviando(true);
    setMensaje('');

    const datos = { sesionToken, ...form, fotoUrl: fotos.join('|') };
    const promesa = esEdicion
      ? actualizarProducto({ ...datos, productoId: productoExistente.ID })
      : crearProducto(datos);

    promesa
      .then(() => {
        if (!esEdicion) {
          setForm(FORM_INICIAL);
          setFotos([]);
        }
        setMensaje(esEdicion ? 'Cambios guardados ✅' : 'Producto agregado correctamente ✅');
        onGuardado();
      })
      .catch((err) => setMensaje(`Error: ${err.message}`))
      .finally(() => setEnviando(false));
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
          <input value={form.nombre} onChange={handleChange('nombre')} required list="lista-nombre" />
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
            onChange={handleChange('codigoPropio')}
            placeholder="Ej. PLY-001"
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
          <input value={form.categoria} onChange={handleChange('categoria')} list="lista-categoria" />
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
          <input value={form.marca} onChange={handleChange('marca')} list="lista-marca" />
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
          <input value={form.talla} onChange={handleChange('talla')} list="lista-talla" />
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
          <input value={form.color} onChange={handleChange('color')} list="lista-color" />
          <datalist id="lista-color">
            {(opciones.color || []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          Precio de venta*
          <input
            type="number"
            min="0"
            value={form.precio}
            onChange={handleChangeNumero('precio', MAX_DIGITOS_PRECIO)}
            required
          />
        </label>
        <label>
          Precio de compra
          <input
            type="number"
            min="0"
            value={form.precioCompra}
            onChange={handleChangeNumero('precioCompra', MAX_DIGITOS_PRECIO)}
          />
        </label>
        <label>
          Stock {esEdicion ? '' : 'inicial'}
          <input
            type="number"
            min="0"
            value={form.stock}
            onChange={handleChangeNumero('stock', MAX_DIGITOS_STOCK)}
          />
        </label>
        <label>
          Stock mínimo
          <input
            type="number"
            min="0"
            value={form.stockMinimo}
            onChange={handleChangeNumero('stockMinimo', MAX_DIGITOS_STOCK)}
          />
        </label>
        <label className="form-grid-wide">
          Descripción
          <input value={form.descripcion} onChange={handleChange('descripcion')} />
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
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Agregar producto'}
        </button>
        {esEdicion && (
          <button type="button" className="btn btn-secondary" onClick={onCancelar}>
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
function agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas) {
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
  return grupos;
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

  const [gruposLocal, setGruposLocal] = useState(() =>
    agruparParaOrden(productos, categoriasPredeterminadas, categoriasOcultas)
  );
  const [gu
