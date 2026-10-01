import { useEffect, useRef } from 'react';

// Botón de "+" / "−" que se puede MANTENER PRESIONADO para avanzar rápido
// (2026-10-01, pedido por Claudia: "el + y − al subir cantidad en el
// catálogo solo me deja ir de uno en uno, también debería dejarnos
// mantenerlo presionado para avanzar más rápido").
//
// - Un clic normal (o un toque) sigue sumando/restando de uno en uno.
// - Si lo dejas presionado, después de un instante empieza a repetirse
//   solo, y entre más tiempo lo mantengas, más rápido va.
// - Se detiene al soltar, al sacar el dedo/mouse del botón, al hacer
//   scroll, o en cuanto llega al límite (el botón se deshabilita solo,
//   por ejemplo al llegar al stock disponible o a 1).
// - Con teclado (Tab + Enter/Espacio) también funciona, de uno en uno.
//
// onPaso: lo que hace cada "paso" (sumar o restar uno).
// Acepta los demás props de un <button> normal (className, aria-label…).

const ESPERA_ANTES_DE_REPETIR_MS = 400;

function intervaloSegunPasos(pasos) {
  if (pasos > 20) return 40;
  if (pasos > 8) return 70;
  return 120;
}

export default function BotonMantener({ onPaso, disabled, className, children, ...resto }) {
  // Siempre la versión más reciente de onPaso (cambia en cada render, con la
  // cantidad actual), para que la repetición nunca use un valor viejo.
  const onPasoRef = useRef(onPaso);
  onPasoRef.current = onPaso;
  const temporizadorRef = useRef(null);
  const pasosRef = useRef(0);

  function detener() {
    if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    temporizadorRef.current = null;
  }

  function programarSiguiente(ms) {
    temporizadorRef.current = setTimeout(() => {
      pasosRef.current += 1;
      onPasoRef.current?.();
      programarSiguiente(intervaloSegunPasos(pasosRef.current));
    }, ms);
  }

  function iniciar(e) {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // solo clic izquierdo
    detener();
    pasosRef.current = 0;
    onPasoRef.current?.();
    programarSiguiente(ESPERA_ANTES_DE_REPETIR_MS);
  }

  // Si se deshabilita mientras está presionado (llegó al límite), se para.
  useEffect(() => {
    if (disabled) detener();
  }, [disabled]);

  // Al desmontarse (ej. se cierra el carrito), se limpia el temporizador.
  useEffect(() => detener, []);

  return (
    <button
      type="button"
      {...resto}
      disabled={disabled}
      className={['boton-mantener', className].filter(Boolean).join(' ')}
      onPointerDown={iniciar}
      onPointerUp={detener}
      onPointerLeave={detener}
      onPointerCancel={detener}
      onContextMenu={(e) => e.preventDefault()}
      // Un clic con mouse o dedo ya se contó en onPointerDown; aquí solo se
      // cuenta el "clic" de teclado (Enter/Espacio), que llega con detail 0.
      onClick={(e) => {
        if (e.detail === 0) onPasoRef.current?.();
      }}
    >
      {children}
    </button>
  );
}
