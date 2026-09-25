import { useEffect, useRef, useState } from 'react';
import ImageLightbox from './ImageLightbox.jsx';

// Un producto puede tener varias fotos guardadas en una sola celda de
// Sheets, separadas por "|". Aquí las separamos para armar el carrusel.
function obtenerFotos(fotoUrl) {
  return String(fotoUrl || '')
    .split('|')
    .map((url) => url.trim())
    .filter(Boolean);
}

// Bug 10 (Ofertas, 2026-09): un producto entra a la zona de "Ofertas" del
// catálogo público de CUALQUIERA de estas dos formas (Claudia eligió "las
// dos formas juntas"):
//   1) Tiene un "Precio de oferta" puesto, y ese precio es MENOR al precio
//      normal → se muestra el precio tachado + el precio con descuento.
//   2) Tiene el interruptor manual "En oferta" activado, aunque no tenga
//      Precio de oferta → se muestra solo el sello/badge, sin tachar nada
//      (porque el precio de venta no cambió).
// Se exporta para que Catalog.jsx pueda usarla y armar la sección de
// Ofertas con la MISMA regla, sin repetir esta lógica en dos lugares.
export function obtenerInfoOferta(producto) {
  const precio = Number(producto.Precio) || 0;
  const precioOferta = Number(producto.PrecioOferta) || 0;
  const tienePrecioOferta = precioOferta > 0 && precioOferta < precio;
  const enOferta = tienePrecioOferta || !!producto.EnOferta;
  return {
    enOferta,
    precioOferta: tienePrecioOferta ? precioOferta : null,
  };
}

// onSolicitar: pide ESTE producto de inmediato (abre WhatsApp ya).
// onAgregarCarrito: lo agrega al "pedido" (carrito) para juntarlo con
// otros productos y mandar un solo WhatsApp al final. Los dos reciben
// la cantidad que el cliente eligió con el selector +/-.
export default function ProductCard({ producto, onSolicitar, onAgregarCarrito }) {
  const stockDisponible = Number(producto.Stock) || 0;
  const sinStock = stockDisponible <= 0;
  const fotos = obtenerFotos(producto.FotoURL);
  const { enOferta, precioOferta } = obtenerInfoOferta(producto);
  const [indice, setIndice] = useState(0);
  const [zoomAbierto, setZoomAbierto] = useState(false);
  const [cantidad, setCantidad] = useState(1);
  // Funcionalidad (2026-09-22, pedido por Claudia; ampliada 2026-09-23):
  // un Nombre, Color o Descripción muy largos ya no rompen la tarjeta — cada
  // uno se corta a un tamaño razonable y UN solo botón "Ver más" (no uno por
  // campo) despliega los tres completos si el cliente quiere leerlos. Antes
  // solo la Descripción se cortaba; con el límite de caracteres nuevo en el
  // Dashboard (Nombre 80, Color sin límite propio salvo el de Descripción)
  // un Nombre o Color largo seguía pudiendo desbordar la tarjeta.
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const articleRef = useRef(null);

  // Arreglo (2026-09-25, reportado por Claudia: "al darle click en Ver más
  // se agranda pero tengo que manualmente deslizar para ver todo el cuadro
  // agrandado, eso debe ser automático"). Al abrir "Ver más" dentro del
  // carrusel horizontal, la tarjeta se ensancha (ver ".product-card-
  // expandido" en global.css) y puede quedar parcialmente fuera de la
  // parte visible del carrusel — antes había que deslizar a mano para
  // verla completa. "scrollIntoView" hace ese ajuste solo, deslizando el
  // carrusel (o la página, si hiciera falta verticalmente) lo mínimo
  // necesario para que la tarjeta completa quede a la vista.
  useEffect(() => {
    if (detalleAbierto && articleRef.current) {
      articleRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [detalleAbierto]);

  // Bajado de 40 a 26 (2026-09-24, pedido por Claudia: un nombre largo
  // seguía "rompiéndose" en la tarjeta angosta del carrusel — se veía en
  // 3 líneas desparejas en vez de quedar compacto con "Ver más"). 26
  // caracteres es aproximadamente un renglón completo en una tarjeta de
  // 220px de ancho.
  const nombreCompleto = producto.Nombre || '';
  const nombreEsLargo = nombreCompleto.length > 26;
  const nombreMostrado =
    !nombreEsLargo || detalleAbierto ? nombreCompleto : nombreCompleto.slice(0, 26) + '…';

  // Rediseño de la tarjeta compacta (2026-09-25, pedido por Claudia con
  // capturas: "necesito que no se vean tan largos, se ve feo, solo que se
  // vea la imagen, el nombre del producto y el precio, y lo demás que esté
  // oculto y solo se vea si le damos Ver más... lo que debe de ocultarse es
  // la descripción, talla, color y lo demás"). Antes, Categoría/
  // Descripción/Talla/Color se mostraban SIEMPRE (solo se les recortaba el
  // texto si eran muy largos). Ahora esos campos NO se dibujan en absoluto
  // mientras la tarjeta está cerrada — aparecen completos únicamente al
  // abrir "Ver más" — así que ya no hace falta la lógica de "cortar a N
  // caracteres": o se esconden por completo, o se muestran completos. La
  // única excepción es "Agotado": se deja visible siempre (aunque el resto
  // de la línea de existencias se oculte) porque explica por qué los
  // botones de abajo están deshabilitados; el detalle exacto de cuánto hay
  // en existencia ("Disponible: N") si se oculta hasta abrir "Ver más".
  const categoriaCompleta = producto.Categoria || '';
  const descripcionCompleta = producto.Descripcion || '';
  const colorCompleto = producto.Color || '';
  const tallaCompleta = producto.Talla || '';

  // El botón "Ver más" aparece si hay CUALQUIER información extra que
  // mostrar (sin importar qué tan larga sea) o si el nombre se recortó.
  const hayInfoExtra = !!(categoriaCompleta || descripcionCompleta || colorCompleto || tallaCompleta);
  const hayAlgoQueExpandir = nombreEsLargo || hayInfoExtra;

  function fotoAnterior(e) {
    e.stopPropagation();
    setIndice((i) => (i === 0 ? fotos.length - 1 : i - 1));
  }

  function fotoSiguiente(e) {
    e.stopPropagation();
    setIndice((i) => (i === fotos.length - 1 ? 0 : i + 1));
  }

  function bajarCantidad() {
    setCantidad((c) => Math.max(1, c - 1));
  }

  function subirCantidad() {
    setCantidad((c) => Math.min(stockDisponible, c + 1));
  }

  // Al agregar al carrito reiniciamos la cantidad a 1, para que si el
  // cliente quiere agregar el mismo producto otra vez empiece de cero.
  function handleAgregarCarrito() {
    onAgregarCarrito?.(producto, cantidad);
    setCantidad(1);
  }

  return (
    <article ref={articleRef} className={`product-card ${detalleAbierto ? 'product-card-expandido' : ''}`}>
      <div className="product-photo">
        {enOferta && <span className="oferta-badge">🔥 Oferta</span>}
        {fotos.length > 0 ? (
          <>
            <img
              src={fotos[indice]}
              alt={producto.Nombre}
              loading="lazy"
              onClick={() => setZoomAbierto(true)}
            />
            {fotos.length > 1 && (
              <>
                <button type="button" className="carousel-btn carousel-prev" onClick={fotoAnterior} aria-label="Foto anterior">
                  ‹
                </button>
                <button type="button" className="carousel-btn carousel-next" onClick={fotoSiguiente} aria-label="Foto siguiente">
                  ›
                </button>
                <div className="carousel-dots">
                  {fotos.map((_, i) => (
                    <span key={i} className={`carousel-dot ${i === indice ? 'activo' : ''}`} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="product-photo-placeholder">Sin foto</div>
        )}
      </div>
          <div className="product-body">
        <h3 className="product-nombre">{nombreMostrado}</h3>
        {detalleAbierto && producto.Categoria && <span className="badge">{categoriaCompleta}</span>}
        {precioOferta ? (
          <p className="price price-oferta">
            <span className="price-original">${Number(producto.Precio).toLocaleString('es-MX')}</span>
            <span className="price-descuento">${precioOferta.toLocaleString('es-MX')}</span>
          </p>
        ) : (
          <p className="price">${Number(producto.Precio).toLocaleString('es-MX')}</p>
        )}
        {/* "Agotado" se deja siempre visible (explica por qué los botones de
            abajo están deshabilitados); "Disponible: N" (la cantidad exacta)
            se oculta hasta abrir "Ver más", igual que el resto del detalle. */}
        {sinStock && <p className="stock out">Agotado</p>}
        {detalleAbierto && !sinStock && <p className="stock">Disponible: {producto.Stock}</p>}

        {detalleAbierto && descripcionCompleta && <p className="description">{descripcionCompleta}</p>}
        {detalleAbierto && producto.Talla && <p className="product-talla">Talla: {tallaCompleta}</p>}
        {detalleAbierto && producto.Color && <p className="product-color">Color: {colorCompleto}</p>}

        {hayAlgoQueExpandir && (
          <button
            type="button"
            className="link-button descripcion-ver-mas"
            onClick={() => setDetalleAbierto((v) => !v)}
          >
            {detalleAbierto ? 'Ver menos' : 'Ver más'}
          </button>
        )}

        {!sinStock && (
          <div className="cantidad-selector">
            <span className="cantidad-selector-label">Cantidad:</span>
            <button type="button" onClick={bajarCantidad} disabled={cantidad <= 1} aria-label="Quitar uno">
              −
            </button>
            <span className="cantidad-selector-valor">{cantidad}</span>
            <button type="button" onClick={subirCantidad} disabled={cantidad >= stockDisponible} aria-label="Agregar uno">
              +
            </button>
          </div>
        )}

        <div className="product-actions">
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={sinStock}
            onClick={() => onSolicitar?.(producto, cantidad)}
          >
            📲 Solicitar por WhatsApp
          </button>
          <button
            type="button"
            className="btn btn-carrito"
            disabled={sinStock}
            onClick={handleAgregarCarrito}
          >
            🛒 Agregar al pedido
          </button>
        </div>
      </div>

      {zoomAbierto && (
        <ImageLightbox
          src={fotos[indice]}
          alt={producto.Nombre}
          onClose={() => setZoomAbierto(false)}
        />
      )}
    </article>
  );
}
