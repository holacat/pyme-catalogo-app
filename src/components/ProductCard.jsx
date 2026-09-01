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

// onSolicitar: pide ESTE producto de inmediato (abre WhatsApp ya).
// onAgregarCarrito: lo agrega al "pedido" (carrito) para juntarlo con
// otros productos y mandar un solo WhatsApp al final. Los dos reciben
// la cantidad que el cliente eligió con el selector +/-.
export default function ProductCard({ producto, onSolicitar, onAgregarCarrito }) {
  const stockDisponible = Number(producto.Stock) || 0;
  const sinStock = stockDisponible <= 0;
  const fotos = obtenerFotos(producto.FotoURL);
  const [indice, setIndice] = useState(0);
  const [zoomAbierto, setZoomAbierto] = useState(false);
  const [cantidad, setCantidad] = useState(1);

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
        <h3>{producto.Nombre}</h3>
        {producto.Categoria && <span className="badge">{producto.Categoria}</span>}
        <p className="price">${Number(producto.Precio).toLocaleString('es-MX')}</p>
        <p className={`stock ${sinStock ? 'out' : ''}`}>
          {sinStock ? 'Agotado' : `Disponible: ${producto.Stock}`}
        </p>
        {producto.Descripcion && <p className="description">{producto.Descripcion}</p>}

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
