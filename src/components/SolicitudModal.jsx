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
// Flujo (2026-10-05): el cliente llena el formulario y, EN EL MISMO TOQUE
// de "Continuar a WhatsApp", se avisa al catálogo (onConfirm) para que
// abra WhatsApp y anote el pedido.
// Antes este modal enseñaba primero un "¡Listo! Te estamos redirigiendo a
// WhatsApp…" y esperaba 1.1 segundos antes de avisar. Esa pausa era el
// problema: un navegador solo deja abrir otra ventana (y un celular solo
// salta directo a la app) dentro del toque de la persona; pasada la pausa,
// algunos (sobre todo el iPhone) lo bloquean como ventana emergente. La
// confirmación ya no hace falta aquí: ahora el catálogo enseña su aviso
// central ("Enviando tu pedido a WhatsApp…" → "¡Tu pedido quedó anotado!").
// De paso, ese mensaje viejo decía "Registramos tu solicitud" cuando el
// pedido todavía ni se había mandado a anotar.
// "inicial" (2026-10-09): los datos que este celular ya recordaba. Claudia
// hizo un pedido y quedó con el nombre y teléfono de la vez anterior sin que
// lo notara; ahora, si ya hay datos guardados, se enseñan aquí YA LLENOS para
// que la clienta los revise (o los cambie) antes de mandar cada pedido.
export default function SolicitudModal({ producto, items, cantidad = 1, inicial = null, onClose, onConfirm }) {
  const [nombre, setNombre] = useState(() => (inicial && inicial.nombre) || '');
  const [telefono, setTelefono] = useState(() => limitarTelefono((inicial && inicial.telefono) || ''));

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
    // Sin pausas: tiene que pasar dentro de este mismo toque (ver arriba).
    onConfirm({ nombre: nombre.trim(), telefono: telefono.trim() });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{inicial ? '¿Tus datos están bien?' : 'Antes de continuar'}</h3>
        <p className="muted">
          {inicial ? 'Revisa tu nombre y teléfono para tu solicitud de' : 'Déjanos tu nombre y teléfono para registrar tu solicitud de'}{' '}
          <strong>{resumenTexto}</strong>. Te vamos a redirigir a WhatsApp enseguida.
        </p>
        <p className="modal-aviso">
          {inicial
            ? '✏️ Son los datos de tu pedido anterior en este celular o computadora. Si no son los tuyos, cámbialos aquí.'
            : '🔒 Se guardan en este celular o computadora para tu próximo pedido (te los volveremos a enseñar para que los revises).'}
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
              autoFocus={!inicial}
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
