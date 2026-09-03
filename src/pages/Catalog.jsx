import { useEffect, useRef, useState } from 'react';
import ProductCard from '../components/ProductCard.jsx';
import SolicitudModal from '../components/SolicitudModal.jsx';
import CarritoModal from '../components/CarritoModal.jsx';
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

// Mensaje de WhatsApp para pedir UN solo producto al instante.
function buildWhatsAppLink(producto, nombre, cantidad) {
  const phone = import.meta.env.VITE_WHATSAPP_NUMBER;
  const subtotal = Number(producto.Precio) * cantidad;
  const lineaCantidad =
    cantidad > 1 ? `Cantidad: ${cantidad}\n💲 Subtotal: $${subtotal.toLocaleString('es-MX')}\n` : '';
  const mensaje =
    `Hola, soy ${nombre}.\n` +
    `Me interesa este producto:\n` +
    `🛍️ ${producto.Nombre}\n` +
    `💲 $${Number(producto.Precio).toLocaleString('es-MX')}\n` +
    lineaCantidad +
    `¿Sigue disponible?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

// Mensaje de WhatsApp para pedir VARIOS productos juntos (carrito).
function buildWhatsAppLinkCarrito(items, nombre) {
  const phone = import.meta.env.VITE_WHATSAPP_NUMBER;
  const lineas = items
    .map(
      ({ producto, cantidad }) =>
        `🛍️ ${producto.Nombre} x${cantidad} — $${(Number(producto.Precio) * cantidad).toLocaleString('es-MX')}`
    )
    .join('\n');
  const total = items.reduce((acc, { producto, cantidad }) => acc + Number(producto.Precio) * cantidad, 0);
  const mensaje =
    `Hola, soy ${nombre}.\n` +
    `Me interesan estos productos:\n` +
    `${lineas}\n` +
    `💲 Total aproximado: $${total.toLocaleString('es-MX')}\n` +
    `¿Siguen disponibles?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

// Agrupa la lista de productos (que YA viene ordenada por categoría y por
// "Orden" desde el backend) en bloques por categoría, conservando el orden
// en que vienen. Los productos sin categoría se juntan bajo "Otros", para
// que ninguno se quede sin mostrarse.
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
  const [puedeIzquierda, setPuedeIzquierda] = useState(false);
  const [puedeDerecha, setPuedeDerecha] = useState(false);

  function actualizarFlechas() {
    const el = scrollRef.current;
    if (!el) return;
    setPuedeIzquierda(el.scrollLeft > 4);
    setPuedeDerecha(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  // Vuelve a calcular si hacen falta flechas cada vez que cambia la lista
  // de productos mostrados (por ejemplo, si uno se agota y desaparece).
  useEffect(() => {
    actualizarFlechas();
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
      {puedeIzquierda && (
        <button
          type="button"
                    className="categoria-carrusel-flecha categoria-carrusel-flecha-izq"
          onClick={() => desplazar(-1)}
          aria-label="Ver productos anteriores"
        >
          ‹
        </button>
      )}
      <div className="categoria-carrusel" ref={scrollRef} onScroll={actualizarFlechas}>
        {children}
      </div>
      {puedeDerecha && (
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

export default function Catalog() {
  const [productos, setProductos] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [error, setError] = useState('');

  // Qué se está mostrando ahorita: el catálogo dividido en categorías (lo
  // normal), una sola categoría abierta completa ("Ver más de esta
  // categoría"), o el catálogo entero mezclado ("Ver catálogo completo").
  const [vista, setVista] = useState({ tipo: 'categorias' });

  // Pedido de UN producto al instante: { producto, cantidad } o null.
  const [solicitudActual, setSolicitudActual] = useState(null);

  // Carrito con VARIOS productos: lista de { producto, cantidad }.
  const [carrito, setCarrito] = useState([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  // true cuando el cliente ya revisó el carrito y le falta dar nombre/teléfono.
  const [pidiendoDatosCarrito, setPidiendoDatosCarrito] = useState(false);

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

    // Vuelve a pedir el catálogo cada 5 segundos, en segundo plano, para
    // que si el administrador cambia el stock, oculta o edita un producto,
    // los clientes lo vean reflejado solos sin tener que recargar la página.
    const intervalo = setInterval(cargarProductos, 5000);
    return () => clearInterval(intervalo);
  }, []);

  // ---- Pedido instantáneo de UN producto ----

  function registrarYAbrirWhatsApp(producto, cantidad, { nombre, telefono }) {
    window.open(buildWhatsAppLink(producto, nombre, cantidad), '_blank', 'noopener,noreferrer');

    crearPedido({
      cliente: nombre,
      telefono,
      producto: producto.Nombre,
      productoId: producto.ID,
      cantidad,
      notas: '',
    }).catch((err) => console.warn('No se pudo registrar el pedido:', err.message));
  }

  // Se llama cuando el cliente le da clic a "Solicitar por WhatsApp".
  // Si ya tenemos sus datos guardados en este navegador, NO le volvemos a
  // preguntar: vamos directo a WhatsApp. Si es su primera vez, mostramos
  // el modal para pedirle nombre y teléfono una sola vez.
  function handleSolicitar(producto, cantidad) {
    if (clienteGuardado) {
      registrarYAbrirWhatsApp(producto, cantidad, clienteGuardado);
    } else {
      setSolicitudActual({ producto, cantidad });
    }
  }

  // Se llama cuando el cliente confirma el modal (primera vez) del pedido
  // instantáneo de un solo producto.
  function handleConfirmarSolicitud({ nombre, telefono }) {
    const actual = solicitudActual;
    setSolicitudActual(null);
    if (!actual) return;

    guardarCliente({ nombre, telefono });
    setClienteGuardado({ nombre, telefono });

    registrarYAbrirWhatsApp(actual.producto, actual.cantidad, { nombre, telefono });
  }

  // ---- Carrito con varios productos ----

  // Agrega un producto al carrito. Si ya estaba, le suma la cantidad
  // (sin pasarse del stock disponible).
  function handleAgregarCarrito(producto, cantidad) {
    setCarrito((prev) => {
      const stockDisponible = Number(producto.Stock) || 0;
      const idx = prev.findIndex((it) => it.producto.ID === producto.ID);
      if (idx === -1) {
        return [...prev, { producto, cantidad: Math.min(cantidad, stockDisponible) }];
      }
      const copia = [...prev];
      copia[idx] = {
        ...copia[idx],
        cantidad: Math.min(stockDisponible, copia[idx].cantidad + cantidad),
      };
      return copia;
    });
  }

  function handleQuitarDelCarrito(productoId) {
    setCarrito((prev) => prev.filter((it) => it.producto.ID !== productoId));
  }

  function handleCambiarCantidadCarrito(productoId, nuevaCantidad) {
    setCarrito((prev) =>
      prev.map((it) => {
        if (it.producto.ID !== productoId) return it;
        const stockDisponible = Number(it.producto.Stock) || 0;
        const cantidad = Math.max(1, Math.min(stockDisponible, nuevaCantidad));
        return { ...it, cantidad };
      })
    );
  }

  function registrarYAbrirWhatsAppCarrito(items, { nombre, telefono }) {
    window.open(buildWhatsAppLinkCarrito(items, nombre), '_blank', 'noopener,noreferrer');

    // Cada producto queda como su propia fila en la hoja de Pedidos (mismo
    // cliente y teléfono), para que se vean igual que los demás pedidos.
    items.forEach(({ producto, cantidad }) => {
      crearPedido({
        cliente: nombre,
        telefono,
        producto: producto.Nombre,
        productoId: producto.ID,
        cantidad,
        notas: '',
      }).catch((err) => console.warn('No se pudo registrar el pedido:', err.message));
    });
  }

  // Se llama al darle "Continuar" dentro del modal del carrito.
  function handleContinuarCarrito() {
    setCarritoAbierto(false);
    if (clienteGuardado) {
      registrarYAbrirWhatsAppCarrito(carrito, clienteGuardado);
      setCarrito([]);
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

    registrarYAbrirWhatsAppCarrito(carrito, { nombre, telefono });
    setCarrito([]);
  }

  function handleCambiarDatos() {
    borrarClienteGuardado();
    setClienteGuardado(null);
  }

  if (estado === 'cargando') return <p className="info-msg">Cargando catálogo…</p>;
  if (estado === 'error') return <p className="info-msg error">No se pudo cargar el catálogo: {error}</p>;
  if (productos.length === 0) return <p className="info-msg">Aún no hay productos disponibles.</p>;

  const totalProductosEnCarrito = carrito.length;
  const grupos = agruparPorCategoria(productos);
  const grupoAbierto = vista.tipo === 'categoria' ? grupos.find((g) => g.nombre === vista.nombre) : null;

  // Chiquita función de ayuda para no repetir el mismo bloque de
  // ProductCard en las tres vistas (categorías, una categoría, todo).
  function tarjetas(listaProductos) {
    return listaProductos.map((p) => (
      <ProductCard
        key={p.ID}
        producto={p}
        onSolicitar={handleSolicitar}
        onAgregarCarrito={handleAgregarCarrito}
      />
    ));
  }

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

      {/* ---- Vista normal: categorías, cada una en su propia cajita con
          su propio carrusel horizontal ---- */}
      {vista.tipo === 'categorias' && (
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

          {grupos.map((grupo) => (
            <section key={grupo.nombre} className="categoria-seccion">
              <h2 className="categoria-titulo">{grupo.nombre}</h2>
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
      {vista.tipo === 'categoria' && (
        <>
          <button
            type="button"
            className="btn btn-secondary volver-btn"
            onClick={() => setVista({ tipo: 'categorias' })}
          >
            ← Volver a categorías
          </button>
          <h2 className="categoria-titulo-completo">{vista.nombre}</h2>
          {grupoAbierto && grupoAbierto.productos.length > 0 ? (
            <div className="catalog-grid">{tarjetas(grupoAbierto.productos)}</div>
          ) : (
            <p className="info-msg">Ya no hay productos disponibles en esta categoría.</p>
          )}
        </>
      )}

      {/* ---- Vista del catálogo completo, todas las categorías mezcladas ---- */}
      {vista.tipo === 'todo' && (
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

      {totalProductosEnCarrito > 0 && (
        <button type="button" className="carrito-flotante" onClick={() => setCarritoAbierto(true)}>
          🛒 {totalProductosEnCarrito} producto{totalProductosEnCarrito === 1 ? '' : 's'} — Ver pedido
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

      {solicitudActual && (
        <SolicitudModal
          producto={solicitudActual.producto}
          cantidad={solicitudActual.cantidad}
          onClose={() => setSolicitudActual(null)}
          onConfirm={handleConfirmarSolicitud}
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
