import { useEffect, useState } from 'react';
import ProductCard from '../components/ProductCard.jsx';
import SolicitudModal from '../components/SolicitudModal.jsx';
import { listarProductos, crearPedido } from '../api.js';

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

function buildWhatsAppLink(producto, nombre) {
  const phone = import.meta.env.VITE_WHATSAPP_NUMBER;
  const mensaje =
    `Hola, soy ${nombre}.\n` +
    `Me interesa este producto:\n` +
    `🛍️ ${producto.Nombre}\n` +
    `💲 $${producto.Precio}\n` +
    `¿Sigue disponible?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

export default function Catalog() {
  const [productos, setProductos] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [error, setError] = useState('');
  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [clienteGuardado, setClienteGuardado] = useState(() => leerClienteGuardado());

  useEffect(() => {
    function cargarProductos() {
      listarProductos()
        .then((data) => {
          setProductos(data.productos);
          setEstado('listo');
        })
        .catch((err) => {
          setError(err.message);
          setEstado('error');
        });
    }

    cargarProductos();

    // Vuelve a pedir el catálogo cada 20 segundos, en segundo plano, para
    // que si el administrador cambia el stock, oculta o edita un producto,
    // los clientes lo vean reflejado solos sin tener que recargar la página.
    const intervalo = setInterval(cargarProductos, 20000);
    return () => clearInterval(intervalo);
  }, []);

  // Registra el pedido y abre WhatsApp. Se usa tanto si el cliente acaba
  // de escribir sus datos en el modal, como si ya los teníamos guardados
  // de una visita anterior en este mismo navegador.
  function registrarYAbrirWhatsApp(producto, { nombre, telefono }) {
    window.open(buildWhatsAppLink(producto, nombre), '_blank', 'noopener,noreferrer');

    crearPedido({
      cliente: nombre,
      telefono,
      producto: producto.Nombre,
      productoId: producto.ID,
      cantidad: 1,
      notas: 'Generado desde el catálogo web',
    }).catch((err) => console.warn('No se pudo registrar el pedido:', err.message));
  }

  // Se llama cuando el cliente le da clic a "Solicitar por WhatsApp".
  // Si ya tenemos sus datos guardados en este navegador, NO le volvemos a
  // preguntar: vamos directo a WhatsApp. Si es su primera vez, mostramos
  // el modal para pedirle nombre y teléfono una sola vez.
  function handleSolicitar(producto) {
    if (clienteGuardado) {
      registrarYAbrirWhatsApp(producto, clienteGuardado);
    } else {
      setProductoSeleccionado(producto);
    }
  }

  // Se llama cuando el cliente confirma el modal (primera vez).
  function handleConfirmarSolicitud({ nombre, telefono }) {
    const producto = productoSeleccionado;
    setProductoSeleccionado(null);

    guardarCliente({ nombre, telefono });
    setClienteGuardado({ nombre, telefono });

    registrarYAbrirWhatsApp(producto, { nombre, telefono });
  }

  function handleCambiarDatos() {
    borrarClienteGuardado();
    setClienteGuardado(null);
  }

  if (estado === 'cargando') return <p className="info-msg">Cargando catálogo…</p>;
  if (estado === 'error') return <p className="info-msg error">No se pudo cargar el catálogo: {error}</p>;
  if (productos.length === 0) return <p className="info-msg">Aún no hay productos disponibles.</p>;

  return (
    <>
      {clienteGuardado && (
        <p className="cliente-actual">
          Vas a pedir como <strong>{clienteGuardado.nombre}</strong> ({clienteGuardado.telefono}).{' '}
          <button type="button" className="link-button" onClick={handleCambiarDatos}>
            ¿No eres tú? Cambiar datos
          </button>
        </p>
      )}

      <div className="catalog-grid">
        {productos.map((p) => (
          <ProductCard key={p.ID} producto={p} onSolicitar={handleSolicitar} />
        ))}
      </div>

      {productoSeleccionado && (
        <SolicitudModal
          producto={productoSeleccionado}
          onClose={() => setProductoSeleccionado(null)}
          onConfirm={handleConfirmarSolicitud}
        />
      )}
    </>
  );
}
