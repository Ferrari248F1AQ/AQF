import { useState } from 'react';
import { useSessione } from '../sessione';

export function Accesso() {
  const { entra } = useSessione();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <form
        className="scheda"
        style={{ width: '100%', maxWidth: 400, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setErrore(null);
          setAttesa(true);
          try {
            await entra(email, password);
          } catch (err) {
            setErrore((err as Error).message);
          } finally {
            setAttesa(false);
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/icona.svg" alt="" width={44} height={44} />
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Lezioni di disegno</h1>
            <div className="nota">Accesso riservato</div>
          </div>
        </div>
        <label className="campo">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="campo">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {errore && (
          <div className="errore" role="alert">
            {errore}
          </div>
        )}
        <button type="submit" className="pulsante primario" disabled={attesa}>
          {attesa ? 'Accesso…' : 'Entra'}
        </button>
      </form>
    </main>
  );
}
