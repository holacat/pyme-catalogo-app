// Modal para revisar el "carrito" (el pedido con varios productos) antes
// de mandarlo. Aquí el cliente puede quitar productos, subir/bajar
// cantidades, ver el total aproximado, y darle "Continuar" para pasar al
// siguiente paso (que le va a pedir nombre y teléfono si no los tenemos
// guardados todavía, y de ahí lo manda a WhatsApp).
//
// items: lista de { producto, cantidad }.
// onQuitar(productoId): quita ese producto del carrito por completo.
// onCambiarCantidad(productoId, nuevaCantidad): sube o baja la cantidad
//   de ese producto (ya viene limitada a mínimo 1 y máximo el stock).
// onClose: cierra el modal sin hacer nada más (el carrito se conserva).
// onContinuar: sigue al siguiente paso.
export default function CarritoModal({ items, onQuitar, onCambiarCantidad, onClose, onContinuar }) {
  const total = items.reduce((acc, { producto, cantidad }) => acc + Number(producto.Precio) * cantidad, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Tu pedido</h3>

        {items.length === 0 ? (
          <p className="muted">Todavía no has agregado productos a tu pedido.</p>
        ) : (
          <div className="carrito-lista">
            {items.map(({ producto, cantidad }) => {
              const stockDisponible = Number(producto.Stock) || 0;
              return (
                <div key={producto.ID} className="carrito-item">
                  <div className="carrito-item-info">
                    <strong>{producto.Nombre}</strong>
                    <span className="muted">
                      ${Number(producto.Precio).toLocaleString('es-MX')} c/u
                    </span>
                  </div>
                  <div className="carrito-item-cantidad">
                    <button
                      type="button"
                      onClick={() => onCambiarCantidad(producto.ID, cantidad - 1)}
                      disabled={cantidad <= 1}
                      aria-label="Quitar uno"
                    >
                      −
                    </button>
                    <span>{cantidad}</span>
                    <button
                      type="button"
                      onClick={() => onCambiarCantidad(producto.ID, cantidad + 1)}
                      disabled={cantidad >= stockDisponible}
                      aria-label="Agregar uno"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="carrito-item-quitar"
                    onClick={() => onQuitar(producto.ID)}
                    title="Quitar del pedido"
                    aria-label="Quitar del pedido"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && (
          <p className="carrito-total">
            Total aproximado: <strong>${total.toLocaleString('es-MX')}</strong>
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Seguir viendo el catálogo
          </button>
          <button type="button" className="btn btn-whatsapp" disabled={items.length === 0} onClick={onContinuar}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
