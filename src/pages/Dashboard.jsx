import { useEffect, useState } from 'react';
import {
  listarProductosAdmin,
  listarPedidos,
  obtenerAlertas,
  actualizarStock,
  actualizarPedido,
  crearProducto,
  actualizarProducto,
} from '../api.js';
import ImageUploader from '../components/ImageUploader.jsx';

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

  // Llaves (con prefijo "stock:" o "pedido:") de filas que tienen un cambio
  // escrito pero todavía no guardado. Mientras este set no esté vacío,
  // avisamos antes de cambiar de pestaña o cerrar la página, para no
  // perder el cambio por un descuido.
  const [sinGuardar, setSinGuardar] = useState(() => new Set());

  function marcarSucio(llave, sucio) {
    setSinGuardar((prev) => {
      const next = new Set(prev);
      if (sucio) next.add(llave);
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
      setSinGuardar(new Set());
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

  function cargarTodo(key) {
    setCargando(true);
    Promise.all([listarProductosAdmin(key), listarPedidos(key), obtenerAlertas(key)])
      .then(([p, o, a]) => {
        setProductos(p.productos);
        setPedidos(o.pedidos);
        setAlertas(a.alertas);
        setMensaje('');
      })
      .catch((err) => setMensaje(`Error al cargar datos: ${err.message}`))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    if (autenticado) cargarTodo(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado]);

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
        <>
          {sinGuardar.size > 0 && (
            <p className="alert-banner">
              ⚠️ Tienes {sinGuardar.size} cambio(s) sin guardar. Dale clic a "Guardar" en cada fila
              antes de salir de esta pestaña.
            </p>
          )}
          <table className="data-table">
            <thead>
              <tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Mínimo</th><th>Actualizar</th><th>Editar</th></tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <StockRow
                  key={p.ID}
                  producto={p}
                  onActualizar={handleActualizarStock}
                  onDirtyChange={marcarSucio}
                  onEditar={setProductoEditando}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'pedidos' && (
        <>
          {sinGuardar.size > 0 && (
            <p className="alert-banner">
              ⚠️ Tienes {sinGuardar.size} cambio(s) sin guardar. Dale clic a "Guardar" en cada fila
              antes de salir de esta pestaña.
            </p>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Producto</th>
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
          <input type="number" min="0" value={form.precio} onChange={handleChange('precio')} required />
        </label>
        <label>
          Precio de compra
          <input type="number" min="0" value={form.precioCompra} onChange={handleChange('precioCompra')} />
        </label>
        <label>
          Stock {esEdicion ? '' : 'inicial'}
          <input type="number" min="0" value={form.stock} onChange={handleChange('stock')} />
        </label>
        <label>
          Stock mínimo
          <input type="number" min="0" value={form.stockMinimo} onChange={handleChange('stockMinimo')} />
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

function StockRow({ producto, onActualizar, onDirtyChange, onEditar }) {
  const [valor, setValor] = useState(producto.Stock);
  const sinGuardar = Number(valor) !== Number(producto.Stock);
  const llave = `stock:${producto.ID}`;

  // Avisa al Dashboard si esta fila tiene un cambio pendiente de guardar.
  useEffect(() => {
    onDirtyChange(llave, sinGuardar);
    return () => onDirtyChange(llave, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinGuardar, llave]);

  return (
    <tr>
      <td>{producto.Nombre}</td>
      <td>${Number(producto.Precio).toLocaleString('es-MX')}</td>
      <td>{producto.Stock}</td>
      <td>{producto.StockMinimo}</td>
      <td className="stock-editor">
        <input
          type="number"
          min="0"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <button
          className="btn btn-small"
          onClick={() => onActualizar(producto.ID, valor)}
          disabled={!sinGuardar}
        >
          Guardar
        </button>
      </td>
      <td>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onEditar(producto)}>
          Editar
        </button>
      </td>
    </tr>
  );
}

function PedidoRow({ pedido, onGuardar, onDirtyChange }) {
  const [cantidad, setCantidad] = useState(pedido.Cantidad);
  const [telefono, setTelefono] = useState(pedido.Telefono || '');
  const [notas, setNotas] = useState(pedido.Notas || '');
  const [estado, setEstado] = useState(pedido.Estado);
  const [guardando, setGuardando] = useState(false);
  const llave = `pedido:${pedido.ID}`;

  const sinGuardar =
    String(cantidad) !== String(pedido.Cantidad) ||
    telefono !== (pedido.Telefono || '') ||
    notas !== (pedido.Notas || '') ||
    estado !== pedido.Estado;

  useEffect(() => {
    onDirtyChange(llave, sinGuardar);
    return () => onDirtyChange(llave, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinGuardar, llave]);

  function handleGuardar() {
    setGuardando(true);
    onGuardar(pedido.ID, { cantidad, telefono, notas, estado }).finally(() => setGuardando(false));
  }

  return (
    <tr>
      <td>{new Date(pedido.Fecha).toLocaleString('es-MX')}</td>
      <td>{pedido.Cliente}</td>
      <td>
        <input
          className="pedido-input-tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
      </td>
      <td>{pedido.Producto}</td>
      <td>
        <input
          type="number"
          min="1"
          className="pedido-input-cant"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
      </td>
      <td>
        <input
          className="pedido-input-notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Notas…"
        />
      </td>
      <td>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
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
