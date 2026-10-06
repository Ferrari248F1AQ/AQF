import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';

let istanza: Database.Database | null = null;

export function ora(): string {
  return new Date().toISOString();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS utente (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  password TEXT NOT NULL,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('admin','utente')),
  attivo INTEGER NOT NULL DEFAULT 1,
  impostazioni TEXT NOT NULL DEFAULT '{}',
  creato_il TEXT NOT NULL,
  ultimo_accesso TEXT
);

CREATE TABLE IF NOT EXISTS sessione (
  id TEXT PRIMARY KEY,
  utente_id TEXT NOT NULL REFERENCES utente(id) ON DELETE CASCADE,
  creata_il TEXT NOT NULL,
  scade_il TEXT NOT NULL,
  agente TEXT
);

CREATE TABLE IF NOT EXISTS volume (
  id TEXT PRIMARY KEY,
  etichetta TEXT NOT NULL,
  percorso TEXT NOT NULL UNIQUE,
  attivo INTEGER NOT NULL DEFAULT 0,
  registrato_il TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cartella (
  id TEXT PRIMARY KEY,
  proprietario_id TEXT NOT NULL REFERENCES utente(id) ON DELETE CASCADE,
  genitore_id TEXT REFERENCES cartella(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  creata_il TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documento (
  id TEXT PRIMARY KEY,
  proprietario_id TEXT NOT NULL REFERENCES utente(id) ON DELETE CASCADE,
  cartella_id TEXT REFERENCES cartella(id) ON DELETE SET NULL,
  titolo TEXT NOT NULL,
  nome_originale TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pdf','pptx','ppt','odp','key')),
  volume_id TEXT NOT NULL REFERENCES volume(id),
  dimensione INTEGER NOT NULL,
  pagine INTEGER,
  stato TEXT NOT NULL CHECK (stato IN ('in_conversione','pronto','errore')),
  errore TEXT,
  anteprima INTEGER NOT NULL DEFAULT 0,
  ultima_pagina INTEGER NOT NULL DEFAULT 1,
  creato_il TEXT NOT NULL,
  aperto_il TEXT
);

CREATE TABLE IF NOT EXISTS annotazione (
  documento_id TEXT NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  pagina INTEGER NOT NULL,
  tratti TEXT NOT NULL,
  aggiornata_il TEXT NOT NULL,
  PRIMARY KEY (documento_id, pagina)
);

CREATE TABLE IF NOT EXISTS registrazione (
  id TEXT PRIMARY KEY,
  proprietario_id TEXT NOT NULL REFERENCES utente(id) ON DELETE CASCADE,
  documento_id TEXT REFERENCES documento(id) ON DELETE SET NULL,
  titolo TEXT NOT NULL,
  mime TEXT NOT NULL,
  estensione TEXT NOT NULL,
  volume_id TEXT NOT NULL REFERENCES volume(id),
  dimensione INTEGER NOT NULL DEFAULT 0,
  durata_s REAL,
  pezzi INTEGER NOT NULL DEFAULT 0,
  pagine TEXT NOT NULL DEFAULT '[]',
  stato TEXT NOT NULL CHECK (stato IN ('in_corso','conclusa')),
  iniziata_il TEXT NOT NULL,
  aggiornata_il TEXT NOT NULL,
  conclusa_il TEXT
);

CREATE INDEX IF NOT EXISTS documento_cartella ON documento(proprietario_id, cartella_id);
CREATE INDEX IF NOT EXISTS registrazione_doc ON registrazione(documento_id);
`;

export function db(): Database.Database {
  if (istanza) return istanza;
  mkdirSync(config.dataDir, { recursive: true });
  istanza = new Database(config.dbPath);
  istanza.pragma('journal_mode = WAL');
  istanza.pragma('foreign_keys = ON');
  istanza.pragma('busy_timeout = 5000');
  istanza.exec(SCHEMA);
  return istanza;
}

export function chiudiDb(): void {
  istanza?.close();
  istanza = null;
}
