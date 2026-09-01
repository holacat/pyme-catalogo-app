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

export default function ProductCard({ producto, onSolicitar }) {
  const sinStock = Number(producto.Stock) <= 0;
  const fotos = obtenerFotos(producto.FotoURL);
  const [indice, setIndice] = useState(0);
  const [zoomAbierto, setZoomAbierto] = useState(false);

  function fotoAnterior(e) {
    e.stopPropagation();
    setIndice((i) => (i === 0 ? fotos.length - 1 : i - 1));
  }

  function fotoSiguiente(e) {
    e.stopPropagation();
    setIndice((i) => (i === fotos.length - 1 ? 0 : i + 1));
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

        <div className="product-actions">
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={sinStock}
            onClick={() => onSolicitar?.(producto)}
          >
            📲 Solicitar por WhatsApp
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
