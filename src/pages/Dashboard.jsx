import { useEffect, useRef, useState } from 'react';
import {
  listarProductosAdmin,
  listarPedidos,
  obtenerAlertas,
  actualizarStock,
  actualizarPedido,
  crearProducto,
  actualizarProducto,
  cambiarDisponibilidad,
  eliminarProducto,
} from '../api.js';
import ImageUploader from '../components/ImageUploader.jsx';

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

function formatearFechaCorta(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-MX');
}

const MAX_DIGITOS_STOCK = 6; // hasta 999,999 piezas
const MAX_DIGITOS_PRECIO = 7; // hasta 9,999,999 (con hasta 2 decimales)
const MAX_DIGITOS_CANTIDAD = 4; // hasta 9,999 piezas por pedido

// Cada cuánto se refresca solo el Dashboard en segundo plano (milisegundos).
const INTERVALO_REFRESCO_MS = 5000;

const STORAGE_KEY = 'pyme_admin_key';

export default function Dashboard() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [autenticado, setAutenticado] = useState(!!sessionStorage.getItem(STORAGE_KEY));
  const [inputKey, setInputKey] = useState('');
  const [tab, setTab] = useState('stock'); // stock | pedidos | alertas | nuevo
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [productoEditando, setProductoEditando] = useState(null);

  // Mapa de llaves (con prefijo "stock:" o "pedido:") -> descripción del
  // cambio pendiente de guardar. Mientras este mapa no esté vacío, avisamos
  // antes de cambiar de pestaña o cerrar la página, para no perder el
  // cambio por un descuido. La descripción es lo que se le muestra a
  // Claudia para que sepa EXACTAMENTE qué dato movió.
  const [sinGuardar, setSinGuardar] = useState(() => new Map());

  function marcarSucio(llave, sucio, descripcion) {
    setSinGuardar((prev) => {
      const next = new Map(prev);
      if (sucio) next.set(llave, descripcion || 'Un campo cambió');
      else next.delete(llave);
      return next;
    });
  }

  function cambiarTab(nuevaTab) {
    if (sinGuardar.size > 0) {
      const salir = window.confirm(
        'Tienes cambios sin guardar. Si continúas se van a perder. ¿Quieres salir de todas formas?'
      );
      if (!salir) return;
      setSinGuardar(new Map());
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

  // `silencioso: true` se usa para los refrescos automáticos de fondo: no
  // muestra "Actualizando…" ni mensajes de error a cada rato, para no ser
  // molesto. Los refrescos que sí pide Claudia directamente (guardar algo,
  // iniciar sesión) siguen mostrando el aviso normal.
  function cargarTodo(key, opciones = {}) {
    const silencioso = !!opciones.silencioso;
    if (!silencioso) setCargando(true);
    Promise.all([listarProductosAdmin(key), listarPedidos(key), obtenerAlertas(key)])
      .then(([p, o, a]) => {
        setProductos(p.productos);
        setPedidos(o.pedidos);
        setAlertas(a.alertas);
        if (!silencioso) setMensaje('');
      })
      .catch((err) => {
        if (!silencioso) setMensaje(`Error al cargar datos: ${err.message}`);
      })
      .finally(() => {
        if (!silencioso) setCargando(false);
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

  function handleLogin(e) {
    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEY, inputKey);
    setAdminKey(inputKey);
    setAutenticado(true);
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
          Ingresa la clave de administrador (la misma que configuraste como
          <code> ADMIN_KEY</code> en Apps Script).
        </p>
        <input
          type="password"
          placeholder="Clave de administrador"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary">Entrar</button>
      </form>
    );
  }

  // Más recientes primero: los productos y pedidos se guardan agregándolos
  // al final del Google Sheet, así que para mostrar los más nuevos arriba
  // simplemente invertimos el orden en el que llegaron.
  const productosOrdenados = productos.slice().reverse();

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
        <button className={tab === 'nuevo' ? 'active' : ''} onClick={() => cambiarTab('nuevo')}>
          + Agregar producto
        </button>
      </div>

      {tab === 'stock' && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Producto</th><th>Código</th><th>Agregado</th><th>Precio</th><th>Stock</th>
                <th>Mínimo</th><th>Actualizar stock</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productosOrdenados.map((p) => (
                <StockRow
                  key={p.ID}
                  producto={p}
                  onActualizar={handleActualizarStock}
                  onDirtyChange={marcarSucio}
                  onEditar={setProductoEditando}
                  onCambiarDisponibilidad={handleCambiarDisponibilidad}
                  onEliminar={handleEliminarProducto}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pedidos' && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Producto</th>
                <th>Cant.</th><th>Notas</th><th>Estado</th><th>Guardar</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.slice().reverse().map((ped) => (
                <PedidoRow
                  key={ped.ID}
                  pedido={ped}
                  onGuardar={handleGuardarPedido}
                  onDirtyChange={marcarSucio}
                />
              ))}
            </tbody>
          </table>
        </div>
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

      {tab === 'nuevo' && (
        <ProductoForm
          adminKey={adminKey}
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

// Sirve tanto para dar de alta un producto nuevo como para editar uno que
// ya existe: si le pasas `productoExistente`, precarga sus datos y guarda
// con "actualizarProducto" en vez de "crearProducto".
function ProductoForm({ adminKey, productoExistente, onGuardado, onCancelar }) {
  const esEdicion = !!productoExistente;
  const [form, setForm] = useState(() => (esEdicion ? formDesdeProducto(productoExistente) : FORM_INICIAL));
  const [fotos, setFotos] = useState(() => (esEdicion ? fotosDesdeProducto(productoExistente) : []));
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');

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
      <div className="form-grid">
        <label>
          Nombre*
          <input value={form.nombre} onChange={handleChange('nombre')} required />
        </label>
        <label>
          Código propio (opcional)
          <input
            value={form.codigoPropio}
            onChange={handleChange('codigoPropio')}
            placeholder="Ej. PLY-001"
          />
        </label>
        <label>
          Categoría
          <input value={form.categoria} onChange={handleChange('categoria')} />
        </label>
        <label>
          Marca
          <input value={form.marca} onChange={handleChange('marca')} />
        </label>
        <label>
          Talla / Medida
          <input value={form.talla} onChange={handleChange('talla')} />
        </label>
        <label>
          Color
          <input value={form.color} onChange={handleChange('color')} />
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
    </form>
  );
}

function StockRow({ producto, onActualizar, onDirtyChange, onEditar, onCambiarDisponibilidad, onEliminar }) {
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
      <td>
        <div className="stock-nombre-con-foto">
          {foto ? (
            <img src={foto} alt={producto.Nombre} className="stock-thumb" />
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
      <td>{formatearFechaCorta(producto.FechaCreacion)}</td>
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

function PedidoRow({ pedido, onGuardar, onDirtyChange }) {
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
        <input
          className={`pedido-input-notas ${cambioNotas ? 'campo-modificado' : ''}`}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Sin notas"
        />
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
