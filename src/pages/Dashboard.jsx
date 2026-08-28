import { useEffect, useState } from 'react';
import {
  listarProductosAdmin,
  listarPedidos,
  obtenerAlertas,
  actualizarStock,
  actualizarEstadoPedido,
  crearProducto,
} from '../api.js';

const STORAGE_KEY = 'pyme_admin_key';

export default function Dashboard() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
  const [autenticado, setAutenticado] = useState(!!sessionStorage.getItem(STORAGE_KEY));
  const [inputKey, setInputKey] = useState('');
  const [tab, setTab] = useState('stock'); // stock | pedidos | alertas
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');

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

  function handleActualizarEstado(pedidoId, nuevoEstado) {
    actualizarEstadoPedido({ adminKey, pedidoId, nuevoEstado })
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
        <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>Stock</button>
        <button className={tab === 'pedidos' ? 'active' : ''} onClick={() => setTab('pedidos')}>
          Pedidos ({pedidos.length})
        </button>
        <button className={tab === 'alertas' ? 'active' : ''} onClick={() => setTab('alertas')}>
          Alertas ({alertas.length})
        </button>
        <button className={tab === 'nuevo' ? 'active' : ''} onClick={() => setTab('nuevo')}>
          + Agregar producto
        </button>
      </div>

      {tab === 'stock' && (
        <table className="data-table">
          <thead>
            <tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Mínimo</th><th>Actualizar</th></tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <StockRow key={p.ID} producto={p} onActualizar={handleActualizarStock} />
            ))}
          </tbody>
        </table>
      )}

      {tab === 'pedidos' && (
        <table className="data-table">
          <thead>
            <tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th>Cant.</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {pedidos.slice().reverse().map((ped) => (
              <tr key={ped.ID}>
                <td>{new Date(ped.Fecha).toLocaleString('es-MX')}</td>
                <td>{ped.Cliente} {ped.Telefono && `(${ped.Telefono})`}</td>
                <td>{ped.Producto}</td>
                <td>{ped.Cantidad}</td>
                <td>
                  <select
                    value={ped.Estado}
                    onChange={(e) => handleActualizarEstado(ped.ID, e.target.value)}
                  >
                    <option>Pendiente</option>
                    <option>Confirmado</option>
                    <option>Entregado</option>
                    <option>Cancelado</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <NuevoProductoForm
          adminKey={adminKey}
          onCreado={() => {
            cargarTodo(adminKey);
            setTab('stock');
          }}
        />
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
  fotoUrl: '',
  descripcion: '',
};

function NuevoProductoForm({ adminKey, onCreado }) {
  const [form, setForm] = useState(FORM_INICIAL);
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
    crearProducto({ adminKey, ...form })
      .then(() => {
        setForm(FORM_INICIAL);
        setMensaje('Producto agregado correctamente ✅');
        onCreado();
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
          Stock inicial
          <input type="number" min="0" value={form.stock} onChange={handleChange('stock')} />
        </label>
        <label>
          Stock mínimo
          <input type="number" min="0" value={form.stockMinimo} onChange={handleChange('stockMinimo')} />
        </label>
        <label className="form-grid-wide">
          URL de la foto
          <input
            value={form.fotoUrl}
            onChange={handleChange('fotoUrl')}
            placeholder="https://i.imgur.com/..."
          />
        </label>
        <label className="form-grid-wide">
          Descripción
          <input value={form.descripcion} onChange={handleChange('descripcion')} />
        </label>
      </div>

      {mensaje && (
        <p className={`info-msg ${mensaje.startsWith('Error') ? 'error' : ''}`}>{mensaje}</p>
      )}

      <button type="submit" className="btn btn-primary" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Agregar producto'}
      </button>
    </form>
  );
}

function StockRow({ producto, onActualizar }) {
  const [valor, setValor] = useState(producto.Stock);

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
          disabled={Number(valor) === Number(producto.Stock)}
        >
          Guardar
        </button>
      </td>
    </tr>
  );
}
