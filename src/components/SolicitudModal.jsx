import { useState } from 'react';

// Modal que pide nombre y teléfono ANTES de mandar al cliente a WhatsApp.
// Así el pedido queda registrado con datos reales en el Sheet, y no como
// "Cliente WhatsApp" genérico — te permite identificar quién solicita qué,
// y detectar si la misma persona repite una solicitud.
export default function SolicitudModal({ producto, onClose, onConfirm }) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [enviando, setEnviando] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!nombre.trim() || !telefono.trim()) return;
    setEnviando(true);
    onConfirm({ nombre: nombre.trim(), telefono: telefono.trim() });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Antes de continuar</h3>
        <p className="muted">
          Déjanos tu nombre y teléfono para registrar tu solicitud de{' '}
          <strong>{producto.Nombre}</strong>. Te vamos a redirigir a WhatsApp enseguida.
        </p>
        <p className="modal-aviso">
          🔒 Esto solo se pide <strong>una vez</strong> en este celular o computadora. La próxima
          vez que pidas algo, ya no te lo volveremos a preguntar.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="modal-field">
            Tu nombre
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. María López"
              required
              autoFocus
            />
          </label>
          <label className="modal-field">
            Tu teléfono
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="Ej. 2271234567"
              required
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-whatsapp" disabled={enviando}>
              📲 Continuar a WhatsApp
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
