function buildWhatsAppLink(producto) {
  const phone = import.meta.env.VITE_WHATSAPP_NUMBER;
  const mensaje =
    `Hola, me interesa este producto:\n` +
    `🛍️ ${producto.Nombre}\n` +
    `💲 $${producto.Precio}\n` +
    `¿Sigue disponible?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensaje)}`;
}

export default function ProductCard({ producto, onSolicitar }) {
  const sinStock = Number(producto.Stock) <= 0;

  return (
    <article className="product-card">
      <div className="product-photo">
        {producto.FotoURL ? (
          <img src={producto.FotoURL} alt={producto.Nombre} loading="lazy" />
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
          <a
            className="btn btn-whatsapp"
            href={buildWhatsAppLink(producto)}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={sinStock}
            onClick={(e) => {
              if (sinStock) e.preventDefault();
              else onSolicitar?.(producto);
            }}
          >
            📲 Solicitar por WhatsApp
          </a>
        </div>
      </div>
    </article>
  );
}
