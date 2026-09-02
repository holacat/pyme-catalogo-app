import { useState } from 'react';

// Deja solo dígitos y corta a un máximo de caracteres, para que no se pueda
// escribir un "teléfono" con decenas de ceros (eso rompía la tabla de
// Pedidos en el Dashboard).
function limitarTelefono(valorTexto) {
  return String(valorTexto).replace(/[^0-9]/g, '').slice(0, 13);
}

// Modal que pide nombre y teléfono ANTES de mandar al cliente a WhatsApp.
// Así el pedido queda registrado con datos reales en el Sheet, y no como
// "Cliente WhatsApp" genérico — te permite identificar quién solicita qué,
// y detectar si la misma persona repite una solicitud.
//
// Este modal sirve para DOS casos:
//   1) Pedido de UN solo producto al instante -> se le pasan las props
//      "producto" y "cantidad".
//   2) Pedido de VARIOS productos juntos (carrito) -> se le pasa la prop
//      "items", una lista de { producto, cantidad }.
// No hace falta usar los dos a la vez: con pasarle uno de los dos ya
// funciona. Internamente arma un textito de resumen para mostrarlo en el
// mensaje ("3 x Bolsa de mano" o "3 productos") sin que el resto del
// código tenga que preocuparse por eso.
//
// Flujo: 1) el cliente llena el formulario, 2) ve un mensaje de
// confirmación aquí mismo por un momento, 3) recién ahí lo mandamos a
// WhatsApp. Así siempre alcanza a ver la confirmación antes de que el
// navegador cambie de pestaña.
export default function SolicitudModal({ producto, items, cantidad = 1, onClose, onConfirm }) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [confirmado, setConfirmado] = useState(false);

  // Si nos pasaron "items" (carrito) lo usamos tal cual; si no, armamos
  // una lista de un solo elemento a partir de "producto" + "cantidad"
  // (el caso de pedir un solo producto al instante).
  const listaItems = items && items.length > 0 ? items : producto ? [{ producto, cantidad }] : [];
  const esVarios = listaItems.length > 1;

  const resumenTexto = esVarios
    ? `${listaItems.length} productos`
    : listaItems[0]
      ? `${listaItems[0].cantidad > 1 ? `${listaItems[0].cantidad} x ` : ''}${listaItems[0].producto.Nombre}`
      : '';

  function handleSubmit(e) {
    e.preventDefault();
    if (!nombre.trim() || !telefono.trim()) return;
    setConfirmado(true);
    // Pequeña pausa para que la persona alcance a leer el mensaje de
    // confirmación antes de que se abra la pestaña de WhatsApp.
    setTimeout(() => {
      onConfirm({ nombre: nombre.trim(), telefono: telefono.trim() });
    }, 1100);
  }

  if (confirmado) {
    return (
      <div className="modal-overlay">
        <div className="modal-box modal-confirmacion">
          <p className="modal-check">✅</p>
          <h3>¡Listo, {nombre.trim()}!</h3>
          <p className="muted">
            Registramos tu solicitud de <strong>{resumenTexto}</strong>.
            Te estamos redirigiendo a WhatsApp…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Antes de continuar</h3>
        <p className="muted">
          Déjanos tu nombre y teléfono para registrar tu solicitud de{' '}
          <strong>{resumenTexto}</strong>. Te vamos a redirigir a WhatsApp enseguida.
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
              inputMode="numeric"
              maxLength={13}
              value={telefono}
              onChange={(e) => setTelefono(limitarTelefono(e.target.value))}
              placeholder="Ej. 2271234567"
              required
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-whatsapp">
              📲 Continuar a WhatsApp
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
