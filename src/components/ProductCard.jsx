import { useEffect, useRef, useState } from 'react';
import ImageLightbox from './ImageLightbox.jsx';
import BotonMantener from './BotonMantener.jsx';

// Un producto puede tener varias fotos guardadas en una sola celda de
// Sheets, separadas por "|". Aquí las separamos para armar el carrusel.
function obtenerFotos(fotoUrl) {
  return String(fotoUrl || '')
    .split('|')
    .map((url) => url.trim())
    .filter(Boolean);
}

// Bug 10 (Ofertas, 2026-09): un producto entra a la zona de "Ofertas" del
// catálogo público de CUALQUIERA de estas dos formas (Claudia eligió "las
// dos formas juntas"):
//   1) Tiene un "Precio de oferta" puesto, y ese precio es MENOR al precio
//      normal → se muestra el precio tachado + el precio con descuento.
//   2) Tiene el interruptor manual "En oferta" activado, aunque no tenga
//      Precio de oferta → se muestra solo el sello/badge, sin tachar nada
//      (porque el precio de venta no cambió).
// Se exporta para que Catalog.jsx pueda usarla y armar la sección de
// Ofertas con la MISMA regla, sin repetir esta lógica en dos lugares.
export function obtenerInfoOferta(producto) {
  const precio = Number(producto.Precio) || 0;
  const precioOferta = Number(producto.PrecioOferta) || 0;
  const tienePrecioOferta = precioOferta > 0 && precioOferta < precio;
  const enOferta = tienePrecioOferta || !!producto.EnOferta;
  return {
    enOferta,
    precioOferta: tienePrecioOferta ? precioOferta : null,
  };
}

// onAgregarCarrito: agrega el producto al "pedido" (carrito) con la
// cantidad que el cliente eligió con el selector +/-, para juntarlo con
// otros productos y mandar un solo WhatsApp al final.
//
// Arreglo (2026-09-25, pedido por Claudia: "el botón de solicitar por
// WhatsApp ya está de más en el catálogo, tanto del tel como de la
// compu, es mejor quitarlo"). Antes había DOS formas de pedir: este botón
// (pedía ESE producto solo, de inmediato) y "Agregar al pedido" (lo
// sumaba al carrito para pedir varios juntos). Con las dos, el cliente
// podía confundirse sobre cuál usar, y en la tarjeta angosta del celular
// ocupaba espacio y aumentaba el riesgo de un toque accidental. Se quitó
// por completo — pedir un solo producto sigue siendo posible, solo se
// agrega ese uno al carrito y se seguirá con "Ver pedido". El prop
// "onSolicitar" y su botón ya no existen; Catalog.jsx también se limpió
// de la lógica que solo servía para este botón (handleSolicitar,
// registrarYAbrirWhatsApp, el estado "solicitudActual" y su modal).
// (2026-10-09) "Escoger sucursal" en el catálogo GENERAL. Claudia: "a lado
// de Disponible algo que diga escoger sucursal, que muestre en cuántas
// sucursales está dividido ese producto, cuánto tiene cada una y de qué
// zona es; una vez escogida podemos pedir, y solo la cantidad que tenga esa
// sucursal". El servidor manda "producto.Sucursales" (solo en el general):
// [{ id, nombre, zona, telefono, disponible }]. Con "escogerSucursal" en
// false (catálogo de una sucursal) la tarjeta queda como siempre.
export default function ProductCard({ producto, onAgregarCarrito, escogerSucursal = false }) {
  const sucursales = escogerSucursal && Array.isArray(producto.Sucursales) ? producto.Sucursales : null;
  const [sucursalElegidaId, setSucursalElegidaId] = useState('');
  const sucursalElegida = sucursales
    ? sucursales.find((x) => String(x.id) === String(sucursalElegidaId)) || (sucursales.length === 1 ? sucursales[0] : null)
    : null;
  const faltaSucursal = !!sucursales && sucursales.length > 0 && !sucursalElegida;
  const stockDisponible = sucursalElegida ? Number(sucursalElegida.disponible) || 0 : Number(producto.Stock) || 0;
  const sinStock = sucursales ? sucursales.length === 0 || (Number(producto.Stock) || 0) <= 0 : stockDisponible <= 0;
  const fotos = obtenerFotos(producto.FotoURL);
  const { enOferta, precioOferta } = obtenerInfoOferta(producto);
  const [indice, setIndice] = useState(0);
  const [zoomAbierto, setZoomAbierto] = useState(false);
  const [cantidad, setCantidad] = useState(1);
  // Funcionalidad (2026-09-22, pedido por Claudia; ampliada 2026-09-23):
  // un Nombre, Color o Descripción muy largos ya no rompen la tarjeta — cada
  // uno se corta a un tamaño razonable y UN solo botón "Ver más" (no uno por
  // campo) despliega los tres completos si el cliente quiere leerlos. Antes
  // solo la Descripción se cortaba; con el límite de caracteres nuevo en el
  // Dashboard (Nombre 80, Color sin límite propio salvo el de Descripción)
  // un Nombre o Color largo seguía pudiendo desbordar la tarjeta.
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const articleRef = useRef(null);

  // Arreglo (2026-09-28, pedido por Claudia con captura: "1ra imagen el
  // catalogo de compu no tenias que ocultarle los detalles como en el
  // telefono"). Ocultar Categoría/Descripción/Talla/Color detrás de "Ver
  // más" tenía sentido para compactar la tarjeta angosta del celular, pero
  // en computadora sobra espacio de sobra y esconder esos datos solo
  // obliga a un clic extra sin necesidad. Aquí detectamos si la pantalla es
  // de escritorio (mismo punto de quiebre de 700px que ya se usa en
  // global.css para todo lo demás) y, si lo es, esos campos se muestran
  // SIEMPRE completos — el botón "Ver más" ni siquiera aparece, porque ya
  // no hay nada que expandir. En celular el comportamiento queda idéntico
  // a como estaba (oculto por default, con "Ver más" para desplegarlo).
  const [esEscritorio, setEsEscritorio] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 701px)').matches : true
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 701px)');
    const actualizar = () => setEsEscritorio(mq.matches);
    actualizar();
    if (mq.addEventListener) {
      mq.addEventListener('change', actualizar);
      return () => mq.removeEventListener('change', actualizar);
    }
    // Respaldo para navegadores viejos que no soportan addEventListener en
    // MediaQueryList (Safari muy antiguo).
    mq.addListener(actualizar);
    return () => mq.removeListener(actualizar);
  }, []);

  // "¿Se dibujan estos campos EN ABSOLUTO?" — en escritorio siempre sí; en
  // celular solo si el cliente le dio clic a "Ver más". Ojo: esto NO decide
  // si el texto se ve completo o recortado (eso es "detalleAbierto" a
  // solas, ver más abajo) — son dos cosas distintas ahora.
  const mostrarCampos = esEscritorio || detalleAbierto;

  // Arreglo (2026-09-25, reportado por Claudia: "al darle click en Ver más
  // se agranda pero tengo que manualmente deslizar para ver todo el cuadro
  // agrandado, eso debe ser automático"). Al abrir "Ver más" dentro del
  // carrusel horizontal, la tarjeta se ensancha (ver ".product-card-
  // expandido" en global.css) y puede quedar parcialmente fuera de la
  // parte visible del carrusel — antes había que deslizar a mano para
  // verla completa. "scrollIntoView" hace ese ajuste solo, deslizando el
  // carrusel (o la página, si hiciera falta verticalmente) lo mínimo
  // necesario para que la tarjeta completa quede a la vista.
  useEffect(() => {
    if (detalleAbierto && articleRef.current) {
      articleRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [detalleAbierto]);

  // Bajado de 40 a 26 (2026-09-24, pedido por Claudia: un nombre largo
  // seguía "rompiéndose" en la tarjeta angosta del carrusel — se veía en
  // 3 líneas desparejas en vez de quedar compacto con "Ver más"). 26
  // caracteres es aproximadamente un renglón completo en una tarjeta de
  // 220px de ancho.
  const nombreCompleto = producto.Nombre || '';
  const nombreEsLargo = nombreCompleto.length > 26;
  const nombreMostrado =
    !nombreEsLargo || detalleAbierto ? nombreCompleto : nombreCompleto.slice(0, 26) + '…';

  // Rediseño de la tarjeta compacta (2026-09-25, pedido por Claudia con
  // capturas: "necesito que no se vean tan largos, se ve feo, solo que se
  // vea la imagen, el nombre del producto y el precio, y lo demás que esté
  // oculto y solo se vea si le damos Ver más... lo que debe de ocultarse es
  // la descripción, talla, color y lo demás"). En CELULAR, Categoría/
  // Descripción/Talla/Color NO se dibujan en absoluto mientras la tarjeta
  // está cerrada — aparecen completos únicamente al abrir "Ver más".
  //
  // Arreglo (2026-09-28, reportado por Claudia con captura: "en compu no
  // tenias que ocultarle los detalles... pero no debiste haber quitado la
  // opción de Ver más, esa es útil por si llegara a haber productos con
  // textos o descripciones largas... por default si pasan de lo normal se
  // debe recortar"). En ESCRITORIO estos campos ya se dibujan siempre (ver
  // "mostrarCampos" arriba) — pero eso no significa mostrarlos SIN límite:
  // si el texto es más largo de lo normal, se recorta con "…" igual que el
  // Nombre, y "Ver más" lo expande a completo. Antes de este arreglo no
  // había ningún límite para Descripción/Talla/Color, así que un texto
  // exageradamente largo (la prueba de Claudia con "rrrrr...") rompía la
  // tarjeta en vez de recortarse.
  const categoriaCompleta = producto.Categoria || '';
  const descripcionCompleta = producto.Descripcion || '';
  const colorCompleto = producto.Color || '';
  const tallaCompleta = producto.Talla || '';

  const LIMITE_DESCRIPCION = 100;
  const LIMITE_COLOR_TALLA = 30;
  const descripcionEsLarga = descripcionCompleta.length > LIMITE_DESCRIPCION;
  const colorEsLargo = colorCompleto.length > LIMITE_COLOR_TALLA;
  const tallaEsLarga = tallaCompleta.length > LIMITE_COLOR_TALLA;

  const descripcionMostrada =
    !descripcionEsLarga || detalleAbierto ? descripcionCompleta : descripcionCompleta.slice(0, LIMITE_DESCRIPCION) + '…';
  const colorMostrado =
    !colorEsLargo || detalleAbierto ? colorCompleto : colorCompleto.slice(0, LIMITE_COLOR_TALLA) + '…';
  const tallaMostrada =
    !tallaEsLarga || detalleAbierto ? tallaCompleta : tallaCompleta.slice(0, LIMITE_COLOR_TALLA) + '…';
  // Categoría no necesita este recorte por JS: la "pastilla" (.badge en
  // global.css) ya la recorta sola con "text-overflow: ellipsis" sin salirse
  // nunca de su forma, así que una categoría larga no puede romper la
  // tarjeta aunque no tenga su propio "Ver más".

  // El botón "Ver más" aparece por DOS razones distintas según la pantalla:
  // en celular, porque hay información extra oculta que revelar (sin
  // importar qué tan larga sea); en escritorio, porque algún texto de los
  // que ya se ven SÍ se recortó por ser más largo de lo normal.
  //
  // Arreglo (2026-10-05, reportado por Claudia con captura del producto
  // "P D" en celular: "quita info y no hay opción para ver su info, no está
  // el Ver más… no debería pasar que se quite info sin posibilidad de
  // verla"). "Disponible: N" también se esconde en celular, pero no contaba
  // como "información extra": un producto con piezas y SIN categoría,
  // descripción, talla ni color se quedaba sin botón "Ver más", y su
  // "Disponible" no se podía ver de ninguna forma. Ahora también cuenta.
  const hayInfoExtra = !!(categoriaCompleta || descripcionCompleta || colorCompleto || tallaCompleta || !sinStock);
  const hayTextoRecortado = nombreEsLargo || descripcionEsLarga || colorEsLargo || tallaEsLarga;
  const hayAlgoQueExpandir = esEscritorio ? hayTextoRecortado : (nombreEsLargo || hayInfoExtra);

  function fotoAnterior(e) {
    e.stopPropagation();
    setIndice((i) => (i === 0 ? fotos.length - 1 : i - 1));
  }

  function fotoSiguiente(e) {
    e.stopPropagation();
    setIndice((i) => (i === fotos.length - 1 ? 0 : i + 1));
  }

  function bajarCantidad() {
    setCantidad((c) => Math.max(1, c - 1));
  }

  function subirCantidad() {
    setCantidad((c) => Math.min(stockDisponible, c + 1));
  }

  function elegirSucursal(id) {
    setSucursalElegidaId(id);
    const nueva = sucursales ? sucursales.find((x) => String(x.id) === String(id)) : null;
    if (nueva) setCantidad((c) => Math.max(1, Math.min(c, Number(nueva.disponible) || 1)));
  }

  // Al agregar al carrito reiniciamos la cantidad a 1, para que si el
  // cliente quiere agregar el mismo producto otra vez empiece de cero.
  function handleAgregarCarrito() {
    if (faltaSucursal) return;
    onAgregarCarrito?.(producto, cantidad, sucursalElegida || null);
    setCantidad(1);
  }

  return (
    <article ref={articleRef} className={`product-card ${mostrarCampos ? 'product-card-expandido' : ''}`}>
      <div className="product-photo">
        {enOferta && <span className="oferta-badge">🔥 Oferta</span>}
        {fotos.length > 0 ? (
          <>
            <img
              src={fotos[indice]}
              alt={producto.Nombre}
              loading="lazy"
              onClick={() => setZoomAbierto(true)}
            />
            {fotos.length > 1 && (
              <>
                <button type="button" className="carousel-btn carousel-prev" onClick={fotoAnterior} aria-label="Foto anterior">
                  ‹
                </button>
                <button type="button" className="carousel-btn carousel-next" onClick={fotoSiguiente} aria-label="Foto siguiente">
                  ›
                </button>
                <div className="carousel-dots">
                  {fotos.map((_, i) => (
                    <span key={i} className={`carousel-dot ${i === indice ? 'activo' : ''}`} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="product-photo-placeholder">Sin foto</div>
        )}
      </div>
          <div className="product-body">
        <h3 className="product-nombre">{nombreMostrado}</h3>
        {mostrarCampos && producto.Categoria && <span className="badge">{categoriaCompleta}</span>}
        {precioOferta ? (
          <p className="price price-oferta">
            <span className="price-original">${Number(producto.Precio).toLocaleString('es-MX')}</span>
            <span className="price-descuento">${precioOferta.toLocaleString('es-MX')}</span>
          </p>
        ) : (
          <p className="price">${Number(producto.Precio).toLocaleString('es-MX')}</p>
        )}
        {/* "Agotado" se deja siempre visible (explica por qué los botones de
            abajo están deshabilitados); "Disponible: N" (la cantidad exacta)
            se oculta hasta abrir "Ver más", igual que el resto del detalle. */}
        {sinStock && <p className="stock out">Agotado</p>}
        {mostrarCampos && !sinStock && (
          <p className="stock">
            Disponible: {producto.Stock}
            {sucursales && sucursales.length > 1 && <span className="stock-en-sucursales"> en {sucursales.length} sucursales</span>}
          </p>
        )}
        {sucursales && !sinStock && (
          <div className="sucursal-escoger" data-escoger-sucursal>
            <label className="sucursal-escoger-label">
              <span>🏪 {sucursales.length === 1 ? 'Sucursal' : `Escoge sucursal (${sucursales.length})`}</span>
              <select
                value={sucursalElegida ? String(sucursalElegida.id) : ''}
                onChange={(e) => elegirSucursal(e.target.value)}
                aria-label={`Escoge de qué sucursal quieres ${producto.Nombre}`}
              >
                {sucursales.length > 1 && <option value="">— ¿De qué sucursal? —</option>}
                {sucursales.map((x) => (
                  <option key={x.id} value={String(x.id)}>
                    {x.nombre}{x.zona ? ` · ${x.zona}` : ''} — {x.disponible} disp.
                  </option>
                ))}
              </select>
            </label>
            {sucursalElegida && (
              <p className="sucursal-escoger-info" data-sucursal-elegida={sucursalElegida.id}>
                📍 {sucursalElegida.zona || 'Zona sin especificar'} · <strong>{sucursalElegida.disponible}</strong> disponible
                {Number(sucursalElegida.disponible) === 1 ? '' : 's'} aquí
              </p>
            )}
          </div>
        )}

        {mostrarCampos && descripcionCompleta && <p className="description">{descripcionMostrada}</p>}
        {mostrarCampos && producto.Talla && <p className="product-talla">Talla: {tallaMostrada}</p>}
        {mostrarCampos && producto.Color && <p className="product-color">Color: {colorMostrado}</p>}

        {hayAlgoQueExpandir && (
          <button
            type="button"
            className="link-button descripcion-ver-mas"
            onClick={() => setDetalleAbierto((v) => !v)}
          >
            {detalleAbierto ? 'Ver menos' : 'Ver más'}
          </button>
        )}

        {!sinStock && (
          <div className="cantidad-selector">
            <span className="cantidad-selector-label">Cantidad:</span>
            {/* 2026-10-01: se pueden mantener presionados para avanzar
                rápido (ver BotonMantener.jsx). */}
            <BotonMantener onPaso={bajarCantidad} disabled={cantidad <= 1} aria-label="Quitar uno">
              −
            </BotonMantener>
            <span className="cantidad-selector-valor">{cantidad}</span>
            <BotonMantener onPaso={subirCantidad} disabled={cantidad >= stockDisponible} aria-label="Agregar uno">
              +
            </BotonMantener>
          </div>
        )}

        <div className="product-actions">
          <button
            type="button"
            className="btn btn-carrito"
            disabled={sinStock || faltaSucursal}
            onClick={handleAgregarCarrito}
            title={faltaSucursal ? 'Primero escoge de qué sucursal lo quieres' : undefined}
          >
            {faltaSucursal ? '🏪 Escoge una sucursal' : '🛒 Agregar al pedido'}
          </button>
        </div>
      </div>

      {zoomAbierto && (
        <ImageLightbox
          src={fotos[indice]}
          alt={producto.Nombre}
          onClose={() => setZoomAbierto(false)}
        />
      )}
    </article>
  );
}
