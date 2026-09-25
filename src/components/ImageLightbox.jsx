import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Ventana emergente que muestra una foto ocupando casi toda la pantalla,
// para poder verla con más detalle. Se cierra con el botón ✕, haciéndole
// clic a cualquier parte oscura de alrededor, o con la tecla Escape.
export default function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);

    // Arreglo (2026-09-25, reportado por Claudia: al hacer zoom a una foto
    // desde el celular, "permite scrollear con lo de abajo y se encima todo
    // lo de atrás (el lienzo y el catálogo) con la imagen zoomeada"). Se
    // bloquea el scroll del fondo mientras esta ventana está abierta, para
    // que el dedo ya no mueva el catálogo por debajo. Se restaura tal cual
    // estaba al cerrar.
    const overflowOriginal = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflowOriginal;
    };
  }, [onClose]);

  if (!src) return null;

  // Arreglo (2026-09-25): la otra mitad de "se encima todo lo de atrás con
  // la imagen zoomeada". Esta ventana ya usaba "position: fixed" con un
  // z-index alto, pero vivía DENTRO del árbol del catálogo — dentro de
  // ".categoria-carrusel-envoltura", que tiene "isolation: isolate" (puesto
  // para que las flechitas ‹ › del carrusel siempre queden encima de las
  // fotos de los productos). Eso crea su propio "contexto de apilado": el
  // z-index de la foto ampliada solo se compara DENTRO de esa cajita
  // aislada, nunca contra el resto de la página — así que otras secciones
  // del catálogo (que vienen después en el orden de la página) sí podían
  // dibujarse POR ENCIMA de la foto ampliada, en vez de quedar debajo.
  // Con "createPortal" esta ventana se dibuja directo en el <body> de la
  // página, completamente fuera del árbol del catálogo, así escapa de
  // cualquier contexto de apilado de sus ancestros y siempre queda encima
  // de todo, sin importar en qué tarjeta/categoría se abrió.
  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <button type="button" className="lightbox-cerrar" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <img src={src} alt={alt || ''} className="lightbox-img" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body
  );
}
