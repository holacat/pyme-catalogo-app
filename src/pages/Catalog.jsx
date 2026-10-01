import { useEffect, useRef, useState } from 'react';
import ProductCard, { obtenerInfoOferta } from '../components/ProductCard.jsx';
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

// Precio que de verdad se cobra por unidad (2026-10-01, bug real
// encontrado al revisar los pendientes de Claudia): si el producto tiene
// un precio de oferta válido, se usa ESE — antes el carrito y el mensaje de
// WhatsApp usaban siempre el precio normal, aunque la tarjeta enseñara el
// de oferta. Misma regla que la tarjeta ("obtenerInfoOferta") y que el
// servidor al registrar el pedido (Code.gs, "crearPedido").
function precioQueSeCobra(producto) {
  const { precioOferta } = obtenerInfoOferta(producto);
  return precioOferta !== null ? precioOferta : Number(producto.Precio) || 0;
}

// Mensaje de WhatsApp para pedir VARIOS productos juntos (carrito).
// "telefonoDinamico" (2026-09-30, pedido por Claudia): el número ya NO está
// fijo en la variable de entorno de Vercel — el servidor lo manda junto con
// el catálogo (ver "cargarProductos" más abajo), leyéndolo del campo
// "Teléfono de pedidos" de quien esté marcado 👑 Admin Central en el
// Dashboard (pestaña 👤 Usuarios) — así Claudia lo puede cambiar ella
// misma, sin tocar Vercel ni volver a desplegar nada. Si por algún motivo
// todavía no está configurado (campo vacío), se usa la variable de entorno
// vieja como respaldo, para no dejar el catálogo sin número de un día para
// otro.
function buildWhatsAppLinkCarrito(items, nombre, telefonoDinamico) {
  const phone = telefonoDinamico || import.meta.env.VITE_WHATSAPP_NUMBER;
  const lineas = items
    .map(({ producto, cantidad }) => {
      const unitario = precioQueSeCobra(producto);
      const normal = Number(producto.Precio) || 0;
      const notaOferta = unitario < normal
        ? ` (oferta: $${unitario.toLocaleString('es-MX')} c/u, antes $${normal.toLocaleString('es-MX')})`
        : '';
      return `🛍️ ${producto.Nombre} x${cantidad} — $${(unitario * cantidad).toLocaleString('es-MX')}${notaOferta}`;
    })
    .join('\n');
  const total = items.reduce((acc, { producto, cantidad }) => acc + precioQueSeCobra(producto) * cantidad, 0);
  const piezas = items.reduce((acc, { cantidad }) => acc + cantidad, 0);
  const mensaje =
    `Hola, soy ${nombre}.\n` +
    `Me interesan estos productos:\n` +
    `${lineas}\n` +
    `📦 Total de piezas: ${piezas}\n` +
    `💲 Total aproximado: $${total.toLocaleString('es-MX')}\n` +
    `¿Siguen disponibles?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

// Agrupa la lista de productos (que YA viene ordenada por categoría y por
// "Orden" desde el backend) en bloques por categoría, conservando el orden
// en que vienen. Los productos sin categoría se juntan bajo "Otros", para
// que ninguno se quede sin mostrarse.
// ---- Buscador y filtros del catálogo (2026-10-01, pendiente P9 de
// Claudia: "añadir un buscador de productos o categorías y filtro por
// precio o marca o color para el catálogo público") ----
// Texto sin acentos ni mayúsculas, para que "camisa" encuentre "CAMISÁ".
function normalizarBusqueda(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Lista de valores distintos de un campo (ej. todas las marcas), sin
// repetir por mayúsculas/acentos, ordenada alfabéticamente.
function valoresDistintos(productos, campo) {
  const vistos = new Map();
  productos.forEach((p) => {
    const texto = String(p[campo] || '').trim();
    if (!texto) return;
    const clave = normalizarBusqueda(texto);
    if (!vistos.has(clave)) vistos.set(clave, texto);
  });
  return Array.from(vistos.entries())
    .map(([clave, texto]) => ({ clave, texto }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
}

const FILTROS_VACIOS = { categoria: '', marca: '', color: '', precioMin: '', precioMax: '', soloOfertas: false };

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
  // A diferencia de antes, esto YA NO cambia según hacia dónde te deslizaste:
  // una vez que hay más productos de los que caben en pantalla, las DOS
  // flechas se quedan visibles siempre, no se esconden nunca.
  const [hayDesbordamiento, setHayDesbordamiento] = useState(false);

  function actualizarDesbordamiento() {
    const el = scrollRef.current;
    if (!el) return;
    setHayDesbordamiento(el.scrollWidth > el.clientWidth + 4);
  }

  // Vuelve a calcular si hacen falta flechas cada vez que cambia la lista
  // de productos mostrados (por ejemplo, si uno se agota y desaparece).
  useEffect(() => {
    actualizarDesbordamiento();
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
      {hayDesbordamiento && (
        <button
          type="button"
          className="categoria-carrusel-flecha categoria-carrusel-flecha-izq"
          onClick={() => desplazar(-1)}
          aria-label="Ver productos anteriores"
        >
          ‹
        </button>
      )}
      <div className="categoria-carrusel" ref={scrollRef}>
        {children}
      </div>
      {hayDesbordamiento && (
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

// Arreglo (2026-09-25, reportado por Claudia con captura: el nombre de una
// categoría de prueba, muy largo y sin espacios, se desbordaba fuera de la
// pantalla en el título de la sección). Igual que ya se hizo con el nombre
// del producto y su Categoría en ProductCard.jsx, aquí se recorta el título
// a un tamaño razonable con la posibilidad de verlo completo dándole
// "Ver más". Se usa tanto para el título de cada categoría en la vista
// normal como para el título grande de "Ver más de X".
function TituloCategoria({ nombre, className }) {
  const [abierto, setAbierto] = useState(false);
  const LIMITE = 40;
  const nombreCompleto = nombre || '';
  const esLargo = nombreCompleto.length > LIMITE;
  const mostrado = !esLargo || abierto ? nombreCompleto : nombreCompleto.slice(0, LIMITE) + '…';
  return (
    <div className="categoria-titulo-envoltura">
      <h2 className={className}>{mostrado}</h2>
      {esLargo && (
        <button
          type="button"
          className="link-button categoria-titulo-ver-mas"
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? 'Ver menos' : 'Ver más'}
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
  // Buscador y filtros (2026-10-01, pendiente P9). Mientras haya algo
  // escrito o algún filtro puesto, se enseña la lista de resultados (de
  // todas las categorías juntas) en vez de la vista normal.
  const [busqueda, setBusqueda] = useState('');
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [ordenResultados, setOrdenResultados] = useState('relevancia');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  // Carrito con VARIOS productos: lista de { producto, cantidad }.
  const [carrito, setCarrito] = useState([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  // true cuando el cliente ya revisó el carrito y le falta dar nombre/teléfono.
  const [pidiendoDatosCarrito, setPidiendoDatosCarrito] = useState(false);

  const [clienteGuardado, setClienteGuardado] = useState(() => leerClienteGuardado());

  // Bug reportado por Claudia (2026-09-30): pidió un producto de prueba y
  // NO apareció solo en la pestaña Pedidos del Dashboard — hasta que le dio
  // manualmente "Actualizar" ahí sí apareció. Causa real: "crearPedido" se
  // mandaba "al aire" (sin esperar su respuesta) justo DESPUÉS de abrir
  // WhatsApp, y si esa petición fallaba, el único aviso era un
  // "console.warn" que nadie ve (ni la clienta ni Claudia) — el pedido se
  // podía perder en silencio total. Además, en celular, saltar a la app de
  // WhatsApp puede hacer que el navegador quede en segundo plano justo
  // cuando esas peticiones apenas iban a mandarse, lo que también puede
  // retrasarlas o interrumpirlas sin ningún aviso. Con estos dos estados
  // nuevos, ahora SÍ se espera a que el pedido quede registrado en el
  // servidor ANTES de mandar a la clienta a WhatsApp (ver
  // "registrarYAbrirWhatsAppCarrito" más abajo), y si algo falla se avisa
  // claramente con un botón para "Reintentar" en vez de fallar callado.
  const [registrandoPedido, setRegistrandoPedido] = useState(false);
  const [errorRegistroPedido, setErrorRegistroPedido] = useState('');

  // Teléfono de pedidos del catálogo Global (2026-09-30) — viene del
  // servidor junto con el catálogo (ver "cargarProductos" más abajo), en
  // vez de estar fijo en una variable de entorno. Ver nota junto a
  // "buildWhatsAppLinkCarrito" arriba.
  const [telefonoPedidos, setTelefonoPedidos] = useState('');
  // Zona "🔥 Ofertas" (2026-10-01, pendiente P11): desde "Orden del
  // catálogo" se puede ocultar completa y acomodar el orden de su carrusel;
  // el servidor manda las dos cosas junto con el catálogo.
  const [ofertasOculta, setOfertasOculta] = useState(false);
  const [ofertasOrden, setOfertasOrden] = useState([]);

  // Arreglo (2026-09-25, reportado por Claudia: "al salirme del catálogo y
  // volverme a meter tengo que actualizarlo manualmente, ya que si no dice
  // 'no se pudo cargar el catálogo, failed to fetch'... el usuario se va a
  // asustar"). Aquí había DOS problemas:
  // 1) Esta pantalla ya reintentaba sola cada 5 segundos en segundo plano
  //    (la idea siempre fue no depender de que el cliente actualice a
  //    mano), pero si esa recarga en SEGUNDO PLANO fallaba UNA sola vez
  //    (por ejemplo, el celular se queda sin señal un instante justo al
  //    volver de otra app o de segundo plano), el código borraba TODO el
  //    catálogo que ya se había cargado bien y lo reemplazaba con una
  //    pantalla de error — aunque los productos ya estuvieran ahí y
  //    perfectamente visibles un segundo antes. Ahora una recarga en
  //    segundo plano que falla ya NO borra el catálogo que ya se veía: se
  //    queda tal cual estaba, y el siguiente intento automático (5
  //    segundos después) lo repone solo, sin que el cliente note nada.
  // 2) La pantalla de error de la carga INICIAL (cuando todavía no hay
  //    nada en pantalla) sí puede aparecer — por ejemplo si el celular
  //    abre la página sin conexión — pero se veía como un error técnico
  //    ("Failed to fetch") sin ninguna pista de qué hacer. Ahora explica
  //    en palabras simples que puede ser la conexión, aclara que se sigue
  //    intentando solo, y agrega un botón "🔄 Actualizar" para reintentar
  //    de inmediato sin tener que refrescar la página completa a mano.
  function cargarProductos() {
    listarProductos()
      .then((data) => {
        setProductos(data.productos);
        // Arreglo (2026-09-30): si esta recarga en particular no trajera el
        // campo (por ejemplo, una respuesta vieja en caché), no borramos un
        // número que ya se había cargado bien antes — solo lo actualizamos
        // cuando de verdad viene algo.
        if (data.telefonoPedidos !== undefined) setTelefonoPedidos(data.telefonoPedidos || '');
        if (data.ofertasOculta !== undefined) setOfertasOculta(!!data.ofertasOculta);
        if (Array.isArray(data.ofertasOrden)) setOfertasOrden(data.ofertasOrden.map(String));
        setEstado('listo');
      })
      .catch((err) => {
        setEstado((estadoPrevio) => {
          // Si ya había un catálogo cargado y visible, una falla de la
          // recarga silenciosa en segundo plano NO debe borrarlo de la
          // pantalla — se deja tal cual y el siguiente intento automático
          // (5s después) lo arregla solo.
          if (estadoPrevio === 'listo') return 'listo';
          setError(err.message);
          return 'error';
        });
      });
  }

  useEffect(() => {
    cargarProductos();

    // Vuelve a pedir el catálogo cada 5 segundos, en segundo plano, para
    // que si el administrador cambia el stock, oculta o edita un producto,
    // los clientes lo vean reflejado solos sin tener que recargar la página.
    const intervalo = setInterval(cargarProductos, 5000);
    return () => clearInterval(intervalo);
  }, []);

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

  // Arreglo (2026-09-30): ahora se ESPERA (con Promise.all) a que TODOS los
  // productos del carrito queden registrados en la hoja de Pedidos, y solo
  // si eso funciona bien se abre WhatsApp y se vacía el carrito. Antes el
  // orden era al revés (abrir WhatsApp primero, registrar "al aire"
  // después sin esperar nada) — ver la nota junto a "registrandoPedido"
  // arriba de por qué eso podía perder un pedido en silencio.
  async function registrarYAbrirWhatsAppCarrito(items, { nombre, telefono }) {
    if (registrandoPedido) return; // evita doble envío si alguien alcanza a darle "Reintentar" dos veces
    setErrorRegistroPedido('');
    setRegistrandoPedido(true);
    try {
      // Cada producto queda como su propia fila en la hoja de Pedidos
      // (mismo cliente y teléfono), para que se vean igual que los demás
      // pedidos.
      await Promise.all(
        items.map(({ producto, cantidad }) =>
          crearPedido({
            cliente: nombre,
            telefono,
            producto: producto.Nombre,
            productoId: producto.ID,
            cantidad,
            notas: '',
          })
        )
      );
      window.open(buildWhatsAppLinkCarrito(items, nombre, telefonoPedidos), '_blank', 'noopener,noreferrer');
      setCarrito([]);
    } catch (err) {
      // El carrito NO se vacía si esto falla, para que "Reintentar" pueda
      // volver a mandar exactamente lo mismo sin que la clienta tenga que
      // rehacer su pedido desde cero.
      setErrorRegistroPedido(
        'No pudimos registrar tu pedido (puede ser tu conexión a internet). Tu pedido sigue guardado aquí — dale "Reintentar".'
      );
    } finally {
      setRegistrandoPedido(false);
    }
  }

  // Se llama al darle "Continuar" dentro del modal del carrito.
  function handleContinuarCarrito() {
    setCarritoAbierto(false);
    if (clienteGuardado) {
      registrarYAbrirWhatsAppCarrito(carrito, clienteGuardado);
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
  }

  // Botón "Reintentar" del aviso de error: usa el carrito y los datos del
  // cliente tal como se quedaron (ninguno de los dos se borra si falla el
  // registro), así que reintentar es simplemente volver a llamar a la
  // misma función con lo que ya se tenía.
  function handleReintentarRegistroPedido() {
    if (clienteGuardado) registrarYAbrirWhatsAppCarrito(carrito, clienteGuardado);
  }

  function handleCambiarDatos() {
    borrarClienteGuardado();
    setClienteGuardado(null);
  }

  if (estado === 'cargando') return <p className="info-msg">Cargando catálogo…</p>;
  if (estado === 'error') {
    return (
      <div className="catalogo-error-carga">
        <p className="info-msg aviso">
          No se pudo cargar el catálogo — puede ser que se haya perdido la conexión un momento.
          Se está intentando de nuevo solo; si tarda mucho, dale clic a "Actualizar".
        </p>
        <button type="button" className="btn btn-secondary" onClick={cargarProductos}>
          🔄 Actualizar
        </button>
      </div>
    );
  }
  if (productos.length === 0) return <p className="info-msg">Aún no hay productos disponibles.</p>;

  const totalProductosEnCarrito = carrito.length;
  const grupos = agruparPorCategoria(productos);
  // Bug 10 (Ofertas, 2026-09): un producto en oferta aparece AQUÍ y TAMBIÉN
  // en su categoría normal de más abajo — no se quita de su categoría, la
  // zona de Ofertas es solo un acceso rápido a lo más llamativo.
  //
  // Arreglo (2026-09-23, pedido por Claudia): "productos" ya viene agrupado
  // por categoría (ver ordenarProductos_ en Code.gs), así que si se
  // filtraba directo de ahí, el orden dentro de Ofertas terminaba siendo
  // "por categoría" y no "por qué tan reciente es" — un producto nuevo en
  // una categoría que cae más adelante en esa lista podía verse hasta el
  // fondo del carrusel aunque fuera el más nuevo de todos. Aquí sí se
  // reordena por fecha de creación, de más nuevo a más viejo, sin importar
  // la categoría de cada uno.
  //
  // Orden a mano (2026-10-01, P11): si en "Orden del catálogo" se acomodó
  // el carrusel de Ofertas, se respeta ESE orden; las ofertas nuevas que
  // todavía no se han acomodado van al principio (la más nueva primero),
  // para que una oferta recién puesta nunca quede escondida al fondo. La
  // MISMA regla se usa en el Dashboard ("ordenarOfertas").
  const posicionOferta = (p) => {
    const i = ofertasOrden.indexOf(String(p.ID));
    return i === -1 ? -1 : i;
  };
  const productosEnOferta = productos
    .filter((p) => obtenerInfoOferta(p).enOferta)
    .slice()
    .sort((a, b) => {
      const pa = posicionOferta(a);
      const pb = posicionOferta(b);
      if (pa === -1 && pb === -1) return new Date(b.FechaCreacion) - new Date(a.FechaCreacion);
      if (pa === -1) return -1;
      if (pb === -1) return 1;
      return pa - pb;
    });
  const grupoAbierto = vista.tipo === 'categoria' ? grupos.find((g) => g.nombre === vista.nombre) : null;

  // ---- Buscador y filtros (P9) ----
  const opcionesCategoria = grupos.map((g) => g.nombre);
  const opcionesMarca = valoresDistintos(productos, 'Marca');
  const opcionesColor = valoresDistintos(productos, 'Color');
  const textoBuscado = normalizarBusqueda(busqueda);
  const precioMinimo = filtros.precioMin === '' ? null : Number(filtros.precioMin);
  const precioMaximo = filtros.precioMax === '' ? null : Number(filtros.precioMax);
  const cantidadFiltrosActivos =
    (filtros.categoria ? 1 : 0) +
    (filtros.marca ? 1 : 0) +
    (filtros.color ? 1 : 0) +
    (precioMinimo !== null || precioMaximo !== null ? 1 : 0) +
    (filtros.soloOfertas ? 1 : 0);
  const buscando = textoBuscado !== '' || cantidadFiltrosActivos > 0;

  function puntajeBusqueda(p) {
    if (!textoBuscado) return 0;
    const nombre = normalizarBusqueda(p.Nombre);
    if (nombre.startsWith(textoBuscado)) return 3;
    if (nombre.includes(textoBuscado)) return 2;
    return 1; // coincidió en otro campo (categoría, marca, color, descripción…)
  }
  const resultados = buscando
    ? productos
        .filter((p) => {
          if (textoBuscado) {
            const donde = normalizarBusqueda(
              [p.Nombre, p.Categoria, p.Marca, p.Color, p.Talla, p.Descripcion, p.CodigoPropio].join(' ')
            );
            if (!textoBuscado.split(/\s+/).every((palabra) => donde.includes(palabra))) return false;
          }
          if (filtros.categoria && (String(p.Categoria || '').trim() || 'Otros') !== filtros.categoria) return false;
          if (filtros.marca && normalizarBusqueda(p.Marca) !== filtros.marca) return false;
          if (filtros.color && normalizarBusqueda(p.Color) !== filtros.color) return false;
          const precio = precioQueSeCobra(p);
          if (precioMinimo !== null && precio < precioMinimo) return false;
          if (precioMaximo !== null && precio > precioMaximo) return false;
          if (filtros.soloOfertas && !obtenerInfoOferta(p).enOferta) return false;
          return true;
        })
        .sort((a, b) => {
          if (ordenResultados === 'precioMenor') return precioQueSeCobra(a) - precioQueSeCobra(b);
          if (ordenResultados === 'precioMayor') return precioQueSeCobra(b) - precioQueSeCobra(a);
          if (ordenResultados === 'nuevos') return new Date(b.FechaCreacion) - new Date(a.FechaCreacion);
          return puntajeBusqueda(b) - puntajeBusqueda(a);
        })
    : [];

  function cambiarFiltro(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
  }
  function limpiarBusqueda() {
    setBusqueda('');
    setFiltros(FILTROS_VACIOS);
    setOrdenResultados('relevancia');
  }

  // Chiquita función de ayuda para no repetir el mismo bloque de
  // ProductCard en las tres vistas (categorías, una categoría, todo).
  function tarjetas(listaProductos) {
    return listaProductos.map((p) => (
      <ProductCard
        key={p.ID}
        producto={p}
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

      {/* Aviso mientras se registra el pedido en el servidor (2026-09-30) —
          se muestra justo antes de saltar a WhatsApp, para que la clienta
          sepa que hay que esperar un momento en vez de pensar que la app se
          congeló. */}
      {registrandoPedido && <p className="info-msg aviso">Registrando tu pedido…</p>}

      {/* Si el registro falla, se avisa claramente y se ofrece reintentar
          con el mismo carrito (que NO se borra en ese caso) en vez de
          fallar en silencio (que era el bug original). */}
      {errorRegistroPedido && (
        <div className="catalogo-error-carga">
          <p className="info-msg error">{errorRegistroPedido}</p>
          <button type="button" className="btn btn-secondary" onClick={handleReintentarRegistroPedido}>
            🔄 Reintentar
          </button>
        </div>
      )}

      {/* ---- Buscador y filtros (2026-10-01, pendiente P9) — arriba de
          todas las vistas. ---- */}
      <div className="catalogo-buscador">
        <div className="catalogo-buscador-fila">
          <div className="catalogo-buscador-campo">
            <span className="catalogo-buscador-icono" aria-hidden="true">🔍</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto, categoría, marca, color…"
              aria-label="Buscar en el catálogo"
            />
            {busqueda && (
              <button type="button" className="catalogo-buscador-borrar" onClick={() => setBusqueda('')} aria-label="Borrar búsqueda">
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            className={`btn btn-secondary catalogo-filtros-btn${cantidadFiltrosActivos > 0 ? ' activo' : ''}`}
            onClick={() => setFiltrosAbiertos((v) => !v)}
            aria-expanded={filtrosAbiertos}
          >
            ⚙️ Filtros{cantidadFiltrosActivos > 0 ? ` (${cantidadFiltrosActivos})` : ''}
          </button>
        </div>
        {filtrosAbiertos && (
          <div className="catalogo-filtros-panel">
            <label>
              Categoría
              <select value={filtros.categoria} onChange={(e) => cambiarFiltro('categoria', e.target.value)}>
                <option value="">Todas</option>
                {opcionesCategoria.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {opcionesMarca.length > 0 && (
              <label>
                Marca
                <select value={filtros.marca} onChange={(e) => cambiarFiltro('marca', e.target.value)}>
                  <option value="">Todas</option>
                  {opcionesMarca.map((m) => <option key={m.clave} value={m.clave}>{m.texto}</option>)}
                </select>
              </label>
            )}
            {opcionesColor.length > 0 && (
              <label>
                Color
                <select value={filtros.color} onChange={(e) => cambiarFiltro('color', e.target.value)}>
                  <option value="">Todos</option>
                  {opcionesColor.map((c) => <option key={c.clave} value={c.clave}>{c.texto}</option>)}
                </select>
              </label>
            )}
            <label>
              Precio desde
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={filtros.precioMin}
                onChange={(e) => cambiarFiltro('precioMin', e.target.value)}
                placeholder="$ mín."
              />
            </label>
            <label>
              hasta
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={filtros.precioMax}
                onChange={(e) => cambiarFiltro('precioMax', e.target.value)}
                placeholder="$ máx."
              />
            </label>
            {productosEnOferta.length > 0 && (
              <label className="catalogo-filtro-check">
                <input
                  type="checkbox"
                  checked={filtros.soloOfertas}
                  onChange={(e) => cambiarFiltro('soloOfertas', e.target.checked)}
                />
                Solo ofertas 🔥
              </label>
            )}
          </div>
        )}
      </div>

      {/* ---- Resultados de búsqueda/filtros: reemplazan a la vista normal
          mientras haya algo escrito o algún filtro puesto. ---- */}
      {buscando && (
        <>
          <div className="catalogo-resultados-encabezado">
            <h2 className="categoria-titulo-completo">
              {resultados.length} resultado{resultados.length === 1 ? '' : 's'}
            </h2>
            <label className="catalogo-orden">
              Ordenar:
              <select value={ordenResultados} onChange={(e) => setOrdenResultados(e.target.value)}>
                <option value="relevancia">Más parecidos</option>
                <option value="precioMenor">Precio: menor a mayor</option>
                <option value="precioMayor">Precio: mayor a menor</option>
                <option value="nuevos">Más nuevos</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={limpiarBusqueda}>
              ✕ Quitar búsqueda y filtros
            </button>
          </div>
          {resultados.length > 0 ? (
            <div className="catalog-grid">{tarjetas(resultados)}</div>
          ) : (
            <p className="info-msg">
              No encontramos productos con eso. Prueba con otra palabra o quita algún filtro.
            </p>
          )}
        </>
      )}

      {/* ---- Vista normal: categorías, cada una en su propia cajita con
          su propio carrusel horizontal ---- */}
      {!buscando && vista.tipo === 'categorias' && (
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

          {productosEnOferta.length > 0 && !ofertasOculta && (
            <section className="categoria-seccion categoria-seccion-ofertas">
              <h2 className="categoria-titulo categoria-titulo-ofertas">🔥 Ofertas</h2>
              <CategoriaCarrusel>{tarjetas(productosEnOferta)}</CategoriaCarrusel>
            </section>
          )}

          {grupos.map((grupo) => (
            <section key={grupo.nombre} className="categoria-seccion">
              <TituloCategoria nombre={grupo.nombre} className="categoria-titulo" />
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
      {!buscando && vista.tipo === 'categoria' && (
        <>
          <button
            type="button"
            className="btn btn-secondary volver-btn"
            onClick={() => setVista({ tipo: 'categorias' })}
          >
            ← Volver a categorías
          </button>
          <TituloCategoria nombre={vista.nombre} className="categoria-titulo-completo" />
          {grupoAbierto && grupoAbierto.productos.length > 0 ? (
            <div className="catalog-grid">{tarjetas(grupoAbierto.productos)}</div>
          ) : (
            <p className="info-msg">Ya no hay productos disponibles en esta categoría.</p>
          )}
        </>
      )}

      {/* ---- Vista del catálogo completo, todas las categorías mezcladas ---- */}
      {!buscando && vista.tipo === 'todo' && (
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

      {/* Oculto mientras se está registrando un pedido (2026-09-30): el
          carrito modal ya se cerró en ese momento, así que no hay nada que
          "reabrir" — y evita que alguien le dé doble clic por accidente
          mientras espera. */}
      {totalProductosEnCarrito > 0 && !registrandoPedido && (
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
