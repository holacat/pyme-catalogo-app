import { obtenerInfoOferta } from './ProductCard.jsx';
import BotonMantener from './BotonMantener.jsx';

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
//
// Cambios 2026-10-01 (lista de pendientes de Claudia + bug encontrado):
//   1. Precio de OFERTA: antes el carrito sumaba siempre el precio normal
//      aunque la tarjeta del producto enseñara el de oferta. Ahora usa el
//      precio de oferta cuando es válido (misma regla "obtenerInfoOferta"
//      de ProductCard.jsx, y la misma que usa el servidor al registrar el
//      pedido), y enseña el precio normal tachado como referencia.
//   2. Subtotal por producto ("$3,500") que cambia en vivo al darle + o −.
//   3. Total de piezas de todo el pedido (ej. 7 chamarras + 8 pantuflas +
//      6 relojes = 21 piezas), además del total en dinero.

function precioQueSeCobra(producto) {
  const { precioOferta } = obtenerInfoOferta(producto);
  return precioOferta !== null ? precioOferta : Number(producto.Precio) || 0;
}

function dinero(numero) {
  return `$${numero.toLocaleString('es-MX')}`;
}

export default function CarritoModal({ items, onQuitar, onCambiarCantidad, onClose, onContinuar }) {
  const total = items.reduce((acc, { producto, cantidad }) => acc + precioQueSeCobra(producto) * cantidad, 0);
  const totalPiezas = items.reduce((acc, { cantidad }) => acc + cantidad, 0);

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
              const unitario = precioQueSeCobra(producto);
              const normal = Number(producto.Precio) || 0;
              const conOferta = unitario < normal;
              return (
                <div key={producto.ID} className="carrito-item">
                  <div className="carrito-item-info">
                    <strong>{producto.Nombre}</strong>
                    <span className="muted">
                      {conOferta && <s className="carrito-precio-antes">{dinero(normal)}</s>} {dinero(unitario)} c/u
                      {conOferta && <span className="carrito-etiqueta-oferta">Oferta</span>}
                    </span>
                  </div>
                  <div className="carrito-item-cantidad">
                    {/* 2026-10-01: se pueden mantener presionados para
                        avanzar rápido (ver BotonMantener.jsx). */}
                    <BotonMantener
                      onPaso={() => onCambiarCantidad(producto.ID, cantidad - 1)}
                      disabled={cantidad <= 1}
                      aria-label="Quitar uno"
                    >
                      −
                    </BotonMantener>
                    <span>{cantidad}</span>
                    <BotonMantener
                      onPaso={() => onCambiarCantidad(producto.ID, cantidad + 1)}
                      disabled={cantidad >= stockDisponible}
                      aria-label="Agregar uno"
                    >
                      +
                    </BotonMantener>
                  </div>
                  <div className="carrito-item-subtotal" aria-label={`Subtotal de ${producto.Nombre}`}>
                    {dinero(unitario * cantidad)}
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
          <div className="carrito-resumen">
            <p className="carrito-total-piezas">
              Total de piezas: <strong>{totalPiezas}</strong>
              <span className="muted">
                {' '}({items.length} producto{items.length === 1 ? '' : 's'} distinto{items.length === 1 ? '' : 's'})
              </span>
            </p>
            <p className="carrito-total">
              Total aproximado: <strong>{dinero(total)}</strong>
            </p>
          </div>
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
