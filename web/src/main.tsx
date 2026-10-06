import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { FornitoreSessione } from './sessione';
import './stile.css';

createRoot(document.getElementById('radice')!).render(
  <StrictMode>
    <BrowserRouter>
      <FornitoreSessione>
        <App />
      </FornitoreSessione>
    </BrowserRouter>
  </StrictMode>,
);
