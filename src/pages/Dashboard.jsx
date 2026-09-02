import { useEffect, useRef, useState } from 'react';
import {
  listarProductosAdmin,
  listarPedidos,
  obtenerAlertas,
  listarOpciones,
  agregarOpcion,
  eliminarOpcion,
  actualizarStock,
  actualizarPedido,
  crearProducto,
  actualizarProducto,
  cambiarDisponibilidad,
  eliminarProducto,
  actualizarOrdenMultiple,
  renombrarCategoria,
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

const MAX_DIGITOS_STOCK = 6; // hasta 999,999 piezas
const MAX_DIGITOS_PRECIO = 7; // hasta 9,999,999 (con hasta 2 decimales)
const MAX_DIGITOS_CANTIDAD = 4; // hasta 9,999 piezas por pedido

// Cada cuánto se refresca solo el Dashboard en segundo plano (milisegundos).
const INTERVALO_REFRESCO_MS = 5000;

const ESTADOS_PEDIDO = ['Pendiente', 'Confirmado', 'Entregado', 'Cancelado'];

const STORAGE_KEY = 'pyme_admin_key';

export default function Dashboard() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [autenticado, setAutenticado] = useState(!!sessionStorage.getItem(STORAGE_KEY));
  // Mientras esto sea true, NO mostramos el panel: estamos comprobando (o
  // volviendo a comprobar) que la clave guardada todavía sea válida contra
  // el servidor, para no dejar ver la estructura del Dashboard a alguien
  // que en realidad no tiene una clave correcta.
  const [verificandoSesion, setVerificandoSesion] = useState(() => !!sessionStorage.getItem(STORAGE_KEY));
  const [inputKey, setInputKey] = useState('');
  const [verificandoLogin, setVerificandoLogin] = useState(false);
  const [errorLogin, setErrorLogin] = useState('');
  const [tab, setTab] = useState('stock'); // stock | pedidos | alertas | orden | nuevo
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [alertas, setAlertas] = useState([]);
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
  const [filtroEstado, setFiltroEstado] = useState('');
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
  function cargarTodo(key, opciones = {}) {
    const silencioso = !!opciones.silencioso;
    if (!silencioso) setCargando(true);
    return Promise.all([listarProductosAdmin(key), listarPedidos(key), obtenerAlertas(key), listarOpciones(key)])
      .then(([p, o, a, op]) => {
        setProductos(p.productos);
        setPedidos(o.pedidos);
        setAlertas(a.alertas);
        setOpciones(op.opciones || {});
        if (!silencioso) setMensaje('');
      })
      .catch((err) => {
        // Si el servidor dice que la clave no es válida (se cambió el
        // ADMIN_KEY, o quedó guardada una vieja de otra sesión), cerramos
        // sesión automáticamente en vez de dejar el panel abierto sin
        // poder cargar ni guardar nada — eso sí sería un hueco de seguridad.
        if (err.message === 'No autorizado') {
          handleLogout();
          setErrorLogin('Tu clave ya no es válida. Vuelve a iniciar sesión.');
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
    if (autenticado) cargarTodo(adminKey);
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
        cargarTodo(adminKey, { silencioso: true });
      }
    }, INTERVALO_REFRESCO_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado, adminKey, sinGuardar, productoEditando, tab]);

  // Antes de dejar entrar al panel, comprobamos la clave contra el
  // servidor. Si está mal, NUNCA se activa `autenticado` — así nadie que
  // escriba una clave equivocada llega a ver la estructura del Dashboard
  // (pestañas, formulario de agregar producto, etc.), aunque sea sin datos.
  function handleLogin(e) {
    e.preventDefault();
    const clave = inputKey.trim();
    if (!clave) return;
    setVerificandoLogin(true);
    setErrorLogin('');
    listarProductosAdmin(clave)
      .then(() => {
        sessionStorage.setItem(STORAGE_KEY, clave);
        setAdminKey(clave);
        setAutenticado(true);
        setVerificandoSesion(false);
      })
      .catch((err) => {
        setErrorLogin(
          err.message === 'No autorizado'
            ? 'Clave incorrecta. Verifica que la hayas escrito bien (cópiala y pégala para evitar errores de dedo) e intenta de nuevo.'
            : `No se pudo verificar la clave: ${err.message}`
        );
      })
      .finally(() => setVerificandoLogin(false));
  }

  function handleLogout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setAutenticado(false);
    setAdminKey('');
    setInputKey('');
  }

  function handleActualizarStock(productoId, nuevoStock) {
    actualizarStock({ adminKey, productoId, nuevoStock })
      .then(() => cargarTodo(adminKey))
      .catch((err) => setMensaje(`Error al actualizar stock: ${err.message}`));
  }

  function handleGuardarPedido(pedidoId, { cantidad, telefono, notas, estado }) {
    return actualizarPedido({ adminKey, pedidoId, cantidad, telefono, notas, estado })
      .then(() => cargarTodo(adminKey))
      .catch((err) => setMensaje(`Error al actualizar pedido: ${err.message}`));
  }

  function handleCambiarDisponibilidad(producto) {
    const nuevoValor = !esProductoVisible(producto);
    cambiarDisponibilidad({ adminKey, productoId: producto.ID, disponible: nuevoValor })
      .then(() => cargarTodo(adminKey))
      .catch((err) => setMensaje(`Error al cambiar visibilidad: ${err.message}`));
  }

  function handleEliminarProducto(producto) {
    const confirmar = window.confirm(
      `¿Seguro que quieres eliminar "${producto.Nombre}" para siempre? Esta acción no se puede deshacer desde la app.`
    );
    if (!confirmar) return;
    eliminarProducto({ adminKey, productoId: producto.ID })
      .then(() => cargarTodo(adminKey))
      .catch((err) => setMensaje(`Error al eliminar producto: ${err.message}`));
  }

  if (!autenticado) {
    return (
      <form className="login-box" onSubmit={handleLogin}>
        <h2>Acceso administrador</h2>
        <p className="muted">
          Ingresa la clave de administrador para entrar al panel de control.
        </p>
        {errorLogin && <p className="info-msg error">{errorLogin}</p>}
        <input
          type="password"
          placeholder="Clave de administrador"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
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

  const productosFiltrados = productosOrdenados.filter(productoEnRangoDeFecha);
  const filtroFechaActivo = !!(filtroDesde || filtroHasta);

  // Pedidos: igual que los productos, más recientes primero. Además se
  // pueden filtrar por Estado con la tablita de conteos de la derecha.
  const pedidosOrdenados = pedidos.slice().reverse();
  const conteoPorEstado = pedidosOrdenados.reduce((acc, p) => {
    acc[p.Estado] = (acc[p.Estado] || 0) + 1;
    return acc;
  }, {});
  const pedidosFiltrados = filtroEstado
    ? pedidosOrdenados.filter((p) => p.Estado === filtroEstado)
    : pedidosOrdenados;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Panel de administración</h2>
        <button className="btn btn-secondary" onClick={handleLogout}>Cerrar sesión</button>
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
            {filtroFechaActivo && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setFiltroDesde('');
                  setFiltroHasta('');
                }}
              >
                Quitar filtro
              </button>
            )}
            {filtroFechaActivo && (
              <span className="filtro-fechas-conteo">
                Mostrando {productosFiltrados.length} de {productosOrdenados.length} productos
              </span>
            )}
          </div>

          <div className="table-scroll">
            <table className="data-table stock-table">
              <thead>
                <tr>
                  <th>Fecha agregado</th><th>Hora agregado</th><th>Producto</th><th>Código</th><th>Precio</th><th>Stock</th>
                  <th>Mínimo</th><th>Actualizar stock</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map((p) => (
                  <StockRow
                    key={`${p.ID}-${resetToken}`}
                    producto={p}
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
              <p className="info-msg">Ningún producto fue agregado en ese rango de fechas.</p>
            )}
          </div>
        </>
      )}

      {tab === 'pedidos' && (
        <>
          {/* Tablita de conteo por estado, ARRIBA de la tabla (no al lado),
              para no quitarle ancho a la tabla y así evitar que tenga que
              hacer scroll hacia los lados. */}
          <div className="pedidos-resumen-fila">
            <span className="pedidos-resumen-titulo">Pedidos por estado:</span>
            <button
              type="button"
              className={`resumen-btn ${filtroEstado === '' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('')}
            >
              <span>Todos</span>
              <strong>{pedidosOrdenados.length}</strong>
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
                  <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Producto</th>
                  <th>Cant.</th><th>Notas</th><th>Estado</th><th>Guardar</th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.map((ped) => (
                  <PedidoRow
                    key={`${ped.ID}-${resetToken}`}
                    pedido={ped}
                    onGuardar={handleGuardarPedido}
                    onDirtyChange={marcarSucio}
                    onAbrirNota={(cliente, valor, onChange) => setNotaEnZoom({ cliente, valor, onChange })}
                  />
                ))}
              </tbody>
            </table>
            {pedidosFiltrados.length === 0 && (
              <p className="info-msg">No hay pedidos con ese estado.</p>
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

      {tab === 'orden' && (
        <OrdenTab
          productos={productos}
          adminKey={adminKey}
          onCambio={() => cargarTodo(adminKey, { silencioso: true })}
        />
      )}

      {tab === 'nuevo' && (
        <ProductoForm
          adminKey={adminKey}
          opciones={opciones}
          onOpcionesActualizadas={() => cargarTodo(adminKey, { silencioso: true })}
          onGuardado={() => {
            cargarTodo(adminKey);
            setTab('stock');
          }}
        />
      )}

      {productoEditando && (
        <div className="modal-overlay" onClick={() => setProductoEditando(null)}>
          <div className="modal-box modal-box-ancho" onClick={(e) => e.stopPropagation()}>
            <h3>Editar producto</h3>
            <ProductoForm
              adminKey={adminKey}
              opciones={opciones}
              onOpcionesActualizadas={() => cargarTodo(adminKey, { silencioso: true })}
              productoExistente={productoEditando}
              onGuardado={() => {
                setProductoEditando(null);
                cargarTodo(adminKey);
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
function ProductoForm({ adminKey, opciones = {}, productoExistente, onGuardado, onOpcionesActualizadas, onCancelar }) {
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
        ? eliminarOpcion({ adminKey, campo: campoGestion, valor: editandoValorOriginal }).then(() =>
            agregarOpcion({ adminKey, campo: campoGestion, valor })
          )
        : agregarOpcion({ adminKey, campo: campoGestion, valor });

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
    eliminarOpcion({ adminKey, campo: campoGestion, valor })
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

    const datos = { adminKey, ...form, fotoUrl: fotos.join('|') };
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
        <ImageUploader adminKey={adminKey} value={fotos} onChange={setFotos} />
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
// mostrando primero los más nuevos (igual que hace el catálogo público),
// mientras no los hayas arrastrado todavía. Los productos sin categoría se
// juntan bajo "Otros", igual que en el catálogo.
function agruparParaOrden(productos) {
  const masNuevosPrimero = productos.slice().reverse();
  const grupos = [];
  const indicePorCategoria = {};
  masNuevosPrimero.forEach((p) => {
    const nombreCategoria = String(p.Categoria || '').trim() || 'Otros';
    if (!(nombreCategoria in indicePorCategoria)) {
      indicePorCategoria[nombreCategoria] = grupos.length;
      grupos.push({ nombre: nombreCategoria, productos: [] });
    }
    grupos[indicePorCategoria[nombreCategoria]].productos.push(p);
  });
  grupos.forEach((g) => {
    g.productos.sort((a, b) => (Number(a.Orden) || 0) - (Number(b.Orden) || 0));
  });
  return grupos;
}

// Pestaña para arrastrar los productos y acomodar en qué orden se ven en
// el catálogo público, dentro de su propia categoría — y para renombrar una
// categoría completa de un jalón (en vez de editar producto por producto).
function OrdenTab({ productos, adminKey, onCambio }) {
  const [gruposLocal, setGruposLocal] = useState(() => agruparParaOrden(productos));
  const [arrastrando, setArrastrando] = useState(null); // { categoria, productoId }
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [renombrando, setRenombrando] = useState(null); // nombre de categoría actual, o null
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [guardandoNombre, setGuardandoNombre] = useState(false);

  // Si los productos cambian desde fuera (agregaste uno nuevo, o llegó el
  // refresco automático) y no estás a medio arrastrar nada, se vuelve a
  // acomodar la lista con los datos más recientes.
  useEffect(() => {
    if (!arrastrando) setGruposLocal(agruparParaOrden(productos));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos]);

  function handleDragStart(categoria, productoId) {
    setArrastrando({ categoria, productoId });
  }

  function handleDragOverFila(e) {
    e.preventDefault();
  }

  function handleDropEnFila(categoria, productoIdDestino) {
    if (!arrastrando || arrastrando.categoria !== categoria || arrastrando.productoId === productoIdDestino) {
      setArrastrando(null);
      return;
    }

    setGruposLocal((prev) => {
      const nuevos = prev.map((g) => ({ ...g, productos: g.productos.slice() }));
      const grupo = nuevos.find((g) => g.nombre === categoria);
      if (!grupo) return prev;

      const indiceOrigen = grupo.productos.findIndex((p) => p.ID === arrastrando.productoId);
      const indiceDestino = grupo.productos.findIndex((p) => p.ID === productoIdDestino);
      if (indiceOrigen === -1 || indiceDestino === -1) return prev;

      const [movido] = grupo.productos.splice(indiceOrigen, 1);
      grupo.productos.splice(indiceDestino, 0, movido);

      guardarOrdenDeCategoria(grupo);
      return nuevos;
    });

    setArrastrando(null);
  }

  // Renumera 1, 2, 3... toda la categoría según cómo haya quedado
  // acomodada, y manda todos esos números juntos en una sola llamada.
  function guardarOrdenDeCategoria(grupo) {
    const cambios = grupo.productos.map((p, i) => ({ productoId: p.ID, orden: i + 1 }));
    setGuardando(true);
    setMensaje('');
    actualizarOrdenMultiple({ adminKey, cambios })
      .then(() => onCambio())
      .catch((err) => setMensaje(`Error al guardar el orden: ${err.message}`))
      .finally(() => setGuardando(false));
  }

  function abrirRenombrar(nombreActual) {
    setRenombrando(nombreActual);
    setNombreNuevo(nombreActual === 'Otros' ? '' : nombreActual);
  }

  function confirmarRenombrar() {
    const nuevo = nombreNuevo.trim();
    if (!nuevo || !renombrando) return;
    setGuardandoNombre(true);
    renombrarCategoria({ adminKey, categoriaAnterior: renombrando, categoriaNueva: nuevo })
      .then(() => {
        setRenombrando(null);
        onCambio();
      })
      .catch((err) => setMensaje(`Error al renombrar la categoría: ${err.message}`))
      .finally(() => setGuardandoNombre(false));
  }

  return (
    <div className="orden-catalogo">
      <p className="muted">
        Arrastra los productos hacia arriba o hacia abajo para acomodar el orden en que se ven en
        el catálogo público, dentro de su misma categoría. El cambio se guarda solo, no hace falta
        darle a ningún botón de "Guardar".
      </p>
      {guardando && <p className="info-msg">Guardando orden…</p>}
      {mensaje && <p className="info-msg error">{mensaje}</p>}

      {gruposLocal.map((grupo) => (
        <section key={grupo.nombre} className="orden-categoria-box">
          <div className="orden-categoria-header">
            <h3>{grupo.nombre}</h3>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => abrirRenombrar(grupo.nombre)}
            >
              ✏️ Renombrar categoría
            </button>
          </div>
          <ul className="orden-lista">
            {grupo.productos.map((p) => (
              <li
                key={p.ID}
                className={`orden-fila ${arrastrando?.productoId === p.ID ? 'arrastrando' : ''}`}
                draggable
                onDragStart={() => handleDragStart(grupo.nombre, p.ID)}
                onDragOver={handleDragOverFila}
                onDrop={() => handleDropEnFila(grupo.nombre, p.ID)}
              >
                <span className="orden-agarradera" title="Arrastra para reordenar">⠿</span>
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
    </div>
  );
}

function StockRow({ producto, onActualizar, onDirtyChange, onEditar, onCambiarDisponibilidad, onEliminar, onVerFoto }) {
  const [valor, setValor] = useState(producto.Stock);
  const stockConocido = useRef(producto.Stock);
  const sinGuardar = Number(valor) !== Number(producto.Stock);
  const llave = `stock:${producto.ID}`;
  const visible = esProductoVisible(producto);
  const foto = primeraFoto(producto.FotoURL);

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

  const clasesFila = [!visible && 'fila-oculta', sinGuardar && 'fila-sin-guardar'].filter(Boolean).join(' ');

  return (
    <tr className={clasesFila}>
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
          <span>
            {producto.Nombre}
            {!visible && <span className="badge badge-oculto">Oculto</span>}
          </span>
        </div>
      </td>
      <td>{producto.CodigoPropio || '—'}</td>
      <td>${Number(producto.Precio).toLocaleString('es-MX')}</td>
      <td>{producto.Stock}</td>
      <td>{producto.StockMinimo}</td>
      <td>
        <div className="stock-editor">
          <input
            type="number"
            min="0"
            className={sinGuardar ? 'campo-modificado' : ''}
            value={valor}
            onChange={(e) => setValor(limitarDigitos(e.target.value, MAX_DIGITOS_STOCK))}
          />
          <button
            className="btn btn-small"
            onClick={() => onActualizar(producto.ID, valor)}
            disabled={!sinGuardar}
          >
            Guardar
          </button>
        </div>
      </td>
      <td className="celda-acciones">
        <div className="acciones-producto">
          <button type="button" className="btn btn-editar btn-chip" onClick={() => onEditar(producto)}>
            Editar
          </button>
          <button type="button" className="btn btn-toggle btn-chip" onClick={() => onCambiarDisponibilidad(producto)}>
            {visible ? 'Ocultar' : 'Mostrar'}
          </button>
          <button type="button" className="btn btn-eliminar btn-chip" onClick={() => onEliminar(producto)}>
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}

function PedidoRow({ pedido, onGuardar, onDirtyChange, onAbrirNota }) {
  const [cantidad, setCantidad] = useState(pedido.Cantidad);
  const [telefono, setTelefono] = useState(() => textoSeguro(pedido.Telefono));
  const [notas, setNotas] = useState(() => notasIniciales(pedido));
  const [estado, setEstado] = useState(pedido.Estado);
  const [guardando, setGuardando] = useState(false);
  const llave = `pedido:${pedido.ID}`;

  const telefonoOriginal = textoSeguro(pedido.Telefono);
  const notasOriginal = notasIniciales(pedido);

  const cambioCantidad = String(cantidad) !== String(pedido.Cantidad);
  const cambioTelefono = telefono !== telefonoOriginal;
  const cambioNotas = notas !== notasOriginal;
  const cambioEstado = estado !== pedido.Estado;
  const sinGuardar = cambioCantidad || cambioTelefono || cambioNotas || cambioEstado;

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
    onGuardar(pedido.ID, { cantidad, telefono, notas, estado }).finally(() => setGuardando(false));
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
      <td>
        <input
          type="number"
          min="1"
          className={`pedido-input-cant ${cambioCantidad ? 'campo-modificado' : ''}`}
          value={cantidad}
          onChange={(e) => setCantidad(limitarDigitos(e.target.value, MAX_DIGITOS_CANTIDAD))}
        />
      </td>
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
          onChange={(e) => setEstado(e.target.value)}
        >
          <option>Pendiente</option>
          <option>Confirmado</option>
          <option>Entregado</option>
          <option>Cancelado</option>
        </select>
      </td>
      <td>
        <button className="btn btn-small" onClick={handleGuardar} disabled={!sinGuardar || guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </td>
    </tr>
  );
}
