import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Dialoghi } from './dialoghi';
import { NOME, SOTTOTITOLO } from './marchio';
import { Accesso } from './schermate/Accesso';
import { Impostazioni } from './schermate/Impostazioni';
import { Libreria } from './schermate/Libreria';
import { Registrazioni } from './schermate/Registrazioni';
import { Utenti } from './schermate/Utenti';
import { useSessione } from './sessione';

// pdf.js pesa: si scarica solo quando si apre davvero un documento.
const Presentazione = lazy(() => import('./presentazione/Presentazione'));

export function App() {
  const { utente, caricata } = useSessione();
  const dove = useLocation();
  if (!caricata) return null;
  if (!utente) {
    return (
      <>
        <Accesso />
        <Dialoghi />
      </>
    );
  }
  return (
    <>
      <Routes>
        <Route
          path="/presenta/:id"
          element={
            <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#111' }} />}>
              <Presentazione />
            </Suspense>
          }
        />
        <Route
          path="/specchio"
          element={
            <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#111' }} />}>
              <Presentazione specchio />
            </Suspense>
          }
        />
        <Route path="/" element={<Telaio><Libreria /></Telaio>} />
        <Route path="/cartella/:id" element={<Telaio><Libreria /></Telaio>} />
        <Route path="/registrazioni" element={<Telaio><Registrazioni /></Telaio>} />
        <Route path="/impostazioni" element={<Telaio><Impostazioni /></Telaio>} />
        <Route
          path="/utenti"
          element={utente.ruolo === 'admin' ? <Telaio><Utenti /></Telaio> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace state={{ da: dove.pathname }} />} />
      </Routes>
      <Dialoghi />
    </>
  );
}

function Telaio({ children }: { children: ReactNode }) {
  const { utente } = useSessione();
  return (
    <div className="telaio">
      <header className="testata">
        <NavLink to="/" className="marchio">
          <img src="/icona.svg" alt="" />
          <span className="nome-marchio">
            <strong>{NOME}</strong>
            <small>{SOTTOTITOLO}</small>
          </span>
        </NavLink>
        <nav className="navigazione" aria-label="Sezioni">
          <NavLink to="/" end>
            📚 <span className="etichetta">Libreria</span>
          </NavLink>
          <NavLink to="/registrazioni">
            🎙️ <span className="etichetta">Registrazioni</span>
          </NavLink>
          {utente?.ruolo === 'admin' && (
            <NavLink to="/utenti">
              👥 <span className="etichetta">Utenti</span>
            </NavLink>
          )}
          <NavLink to="/impostazioni">
            ⚙️ <span className="etichetta">Impostazioni</span>
          </NavLink>
        </nav>
      </header>
      <main className="contenuto">{children}</main>
    </div>
  );
}
