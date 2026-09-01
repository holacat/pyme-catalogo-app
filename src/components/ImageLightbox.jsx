import { useEffect } from 'react';

// Ventana emergente que muestra una foto ocupando casi toda la pantalla,
// para poder verla con más detalle. Se cierra con el botón ✕, haciéndole
// clic a cualquier parte oscura de alrededor, o con la tecla Escape.
export default function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!src) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button type="button" className="lightbox-cerrar" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <img src={src} alt={alt || ''} className="lightbox-img" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
