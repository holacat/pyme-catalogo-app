import { useEffect, useState } from 'react';
import ProductCard from '../components/ProductCard.jsx';
import { listarProductos, crearPedido } from '../api.js';

export default function Catalog() {
  const [productos, setProductos] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | listo | error
  const [error, setError] = useState('');

  useEffect(() => {
    listarProductos()
      .then((data) => {
        setProductos(data.productos);
        setEstado('listo');
      })
      .catch((err) => {
        setError(err.message);
        setEstado('error');
      });
  }, []);

  // Registra el pedido en la hoja "Pedidos" (best-effort: si falla, no bloquea
  // que el cliente siga hacia WhatsApp, ya que el mensaje ya se está enviando).
  function handleSolicitar(producto) {
    crearPedido({
      cliente: 'Cliente WhatsApp', // se puede pedir el nombre con un prompt si lo deseas
      telefono: '',
      producto: producto.Nombre,
      productoId: producto.ID,
      cantidad: 1,
      notas: 'Generado desde el catálogo web',
    }).catch((err) => console.warn('No se pudo registrar el pedido:', err.message));
  }

  if (estado === 'cargando') return <p className="info-msg">Cargando catálogo…</p>;
  if (estado === 'error') return <p className="info-msg error">No se pudo cargar el catálogo: {error}</p>;
  if (productos.length === 0) return <p className="info-msg">Aún no hay productos disponibles.</p>;

  return (
    <div className="catalog-grid">
      {productos.map((p) => (
        <ProductCard key={p.ID} producto={p} onSolicitar={handleSolicitar} />
      ))}
    </div>
  );
}
