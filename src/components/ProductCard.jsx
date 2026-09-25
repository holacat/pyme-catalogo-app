import { useState } from 'react';
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

  // Bajado de 40 a 26 (2026-09-24, pedido por Claudia: un nombre largo
  // seguía "rompiéndose" en la tarjeta angosta del carrusel — se veía en
  // 3 líneas desparejas en vez de quedar compacto con "Ver más"). 26
  // caracteres es aproximadamente un renglón completo en una tarjeta de
  // 220px de ancho.
  const nombreCompleto = producto.Nombre || '';
  const nombreEsLargo = nombreCompleto.length > 26;
  const nombreMostrado =
    !nombreEsLargo || detalleAbierto ? nombreCompleto : nombreCompleto.slice(0, 26) + '…';

  // Arreglo (2026-09-25, reportado por Claudia): una Categoría larga no
  // tenía NINGÚN recorte, así que en la tarjeta angosta del carrusel el
  // texto se partía en varias líneas dentro del "pastillazo" verde — y una
  // pastilla (border-radius redondeado) con texto en varias líneas se ve
  // rota, no como una cajita que encierra el texto. Con el mismo patrón de
  // Nombre/Color/Talla, la Categoría se recorta a un renglón y "Ver más"
  // la muestra completa — así la pastilla vuelve a verse como una cajita
  // chiquita en vez de una barra rota en dos líneas.
  const categoriaCompleta = producto.Categoria || '';
  const categoriaEsLarga = categoriaCompleta.length > 24;
  const categoriaMostrada =
    !categoriaEsLarga || detalleAbierto ? categoriaCompleta : categoriaCompleta.slice(0, 24) + '…';

  const descripcionCompleta = producto.Descripcion || '';
  const descripcionEsLarga = descripcionCompleta.length > 120;
  const descripcionMostrada =
    !descripcionEsLarga || detalleAbierto
      ? descripcionCompleta
      : descripcionCompleta.slice(0, 120) + '…';

  const colorCompleto = producto.Color || '';
  const colorEsLargo = colorCompleto.length > 30;
  const colorMostrado =
    !colorEsLargo || detalleAbierto ? colorCompleto : colorCompleto.slice(0, 30) + '…';

  // Bug (2026-09-24, reportado por Claudia): la Talla se guarda bien en la
  // hoja pero nunca se dibujaba en la tarjeta del catálogo — faltaba por
  // completo, no era un problema de recorte. Se agrega aquí con el mismo
  // manejo de texto largo que ya tiene Color.
  const tallaCompleta = producto.Talla || '';
  const tallaEsLarga = tallaCompleta.length > 30;
  const tallaMostrada =
    !tallaEsLarga || detalleAbierto ? tallaCompleta : tallaCompleta.slice(0, 30) + '…';

  const hayAlgoQueExpandir = nombreEsLargo || descripcionEsLarga || colorEsLargo || tallaEsLarga || categoriaEsLarga;

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
    <article className="product-card">
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
        {producto.Categoria && <span className="badge">{categoriaMostrada}</span>}
        {precioOferta ? (
          <p className="price price-oferta">
            <span className="price-original">${Number(producto.Precio).toLocaleString('es-MX')}</span>
            <span className="price-descuento">${precioOferta.toLocaleString('es-MX')}</span>
          </p>
        ) : (
          <p className="price">${Number(producto.Precio).toLocaleString('es-MX')}</p>
        )}
        <p className={`stock ${sinStock ? 'out' : ''}`}>
          {sinStock ? 'Agotado' : `Disponible: ${producto.Stock}`}
        </p>
        {/* Bug reportado por Claudia (2026-09): antes este párrafo solo se
            mostraba SI el producto tenía Descripción, así que en un producto
            sin descripción todo lo de abajo (el selector de Cantidad) subía
            un renglón y quedaba desalineado respecto a los productos vecinos
            que sí tienen descripción. Ahora siempre se dibuja el espacio
            (vacío si no hay texto) para que la altura sea la misma en todas
            las tarjetas de la fila — ver el `min-height` de ".description"
            en global.css. */}
             <p className="description">{descripcionMostrada}</p>

        {producto.Talla && <p className="product-talla">Talla: {tallaMostrada}</p>}
        {producto.Color && <p className="product-color">Color: {colorMostrado}</p>}

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
