import { Outlet, Link, useLocation } from 'react-router-dom';

// Arreglo (2026-10-01, pendiente P3 de Claudia: "a veces, sin darme cuenta,
// el área de admin se convierte en el catálogo público, hasta la URL").
// Causa real: este encabezado (con "🛍️ Mi Comercio" y "Catálogo") se dibuja
// ARRIBA DE TODAS las páginas, también del panel de administración, y los
// dos son enlaces a "/" (el catálogo). Un clic sin querer en el logo o en
// "Catálogo" cambiaba la pestaña del panel al catálogo — con todo y URL — y
// como es un cambio de página "interno" de React, ni siquiera salía el
// aviso de "tienes cambios sin guardar" (ese aviso solo cubre recargar o
// cerrar la pestaña), así que también se podía perder trabajo sin guardar.
//
// Ahora, cuando NO estás en el catálogo (o sea, estás en el panel), esos
// enlaces abren el catálogo en una PESTAÑA NUEVA: el panel nunca se
// reemplaza, no se pierde nada, y puedes revisar el catálogo al lado. En el
// catálogo mismo siguen funcionando igual que siempre.
export default function App() {
  const location = useLocation();
  const enCatalogo = location.pathname === '/';
  // Catálogos por sucursal (2026-10-02): si la clienta está viendo el
  // catálogo de una sucursal (`/?sucursal=...`), el logo y "Catálogo" la
  // dejan EN ESA MISMA sucursal — antes la mandaban a "/" a secas, o sea,
  // al catálogo Global.
  // (2026-10-08) Pero SOLO la sucursal: desde la página de un ticket
  // ("/?ticket=…&c=…") el logo y "Catálogo" llevan al catálogo, no otra vez
  // al mismo ticket.
  const sucursalDelLink = new URLSearchParams(location.search).get('sucursal');
  const destinoCatalogo = { pathname: '/', search: sucursalDelLink ? `?sucursal=${encodeURIComponent(sucursalDelLink)}` : '' };
  // En la página de un ticket los enlaces cargan la página de nuevo (un
  // enlace "interno" cambiaba la dirección pero dejaba el ticket en pantalla).
  const enTicket = new URLSearchParams(location.search).has('ticket');
  const hrefCatalogo = `/${destinoCatalogo.search}`;

  return (
    <div className="app-shell">
      <header className="app-header">
        {enCatalogo && enTicket ? (
          <a href={hrefCatalogo} className="brand">🛍️ Mi Comercio</a>
        ) : enCatalogo ? (
          <Link to={destinoCatalogo} className="brand">🛍️ Mi Comercio</Link>
        ) : (
          <a href="/" target="_blank" rel="noopener noreferrer" className="brand" title="Abre el catálogo público en otra pestaña">
            🛍️ Mi Comercio
          </a>
        )}
        <nav>
          {enCatalogo && enTicket ? (
            <a href={hrefCatalogo}>Catálogo</a>
          ) : enCatalogo ? (
            <Link to={destinoCatalogo} className="active">Catálogo</Link>
          ) : (
            <a href="/" target="_blank" rel="noopener noreferrer" title="Abre el catálogo público en otra pestaña">
              Ver catálogo ↗
            </a>
          )}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="app-footer">Aún no se procesan pagos en línea</footer>
    </div>
  );
}
