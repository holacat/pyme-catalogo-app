import { Outlet, Link, useLocation } from 'react-router-dom';

export default function App() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">🛍️ Mi Comercio</Link>
        <nav>
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Catálogo</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="app-footer">Aún no se procesan pagos en línea</footer>
    </div>
  );
}
