/**
 * Gestione degli accessi da riga di comando, sul Raspberry.
 *
 * Il primo amministratore si crea da qui e non da una pagina web: una pagina
 * «crea il primo utente» esposta sul tunnel sarebbe di chi la trova per primo.
 *
 *   node server/dist/cli.js crea --email io@univaq.it --nome "Nome Cognome" --admin
 *   node server/dist/cli.js password --email io@univaq.it
 *   node server/dist/cli.js elenco
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { hashPassword, validaPassword } from './auth.js';
import { chiudiDb, db, ora } from './db.js';

function argomento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function chiediPassword(): Promise<string> {
  if (process.env.AQF_PASSWORD) return process.env.AQF_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const chiedi = (domanda: string) =>
    new Promise<string>((ok) => {
      const out = process.stdout as NodeJS.WriteStream & { _scrivi?: typeof process.stdout.write };
      process.stdout.write(domanda);
      // Niente eco della password a terminale.
      const originale = out.write.bind(out);
      out.write = ((s: string) => (s.includes('\n') ? originale(s) : true)) as typeof out.write;
      rl.question('', (r) => {
        out.write = originale;
        process.stdout.write('\n');
        ok(r);
      });
    });
  const p1 = await chiedi('Password: ');
  const p2 = await chiedi('Ripeti la password: ');
  rl.close();
  if (p1 !== p2) throw new Error('Le due password non coincidono.');
  return p1;
}

async function main(): Promise<void> {
  const comando = process.argv[2];
  if (comando === 'crea') {
    const email = argomento('email')?.trim().toLowerCase();
    const nome = argomento('nome')?.trim();
    if (!email || !nome) throw new Error('Servono --email e --nome.');
    if (db().prepare('SELECT 1 FROM utente WHERE email = ?').get(email)) throw new Error('Esiste già un utente con questa email.');
    const password = await chiediPassword();
    const errore = validaPassword(password);
    if (errore) throw new Error(errore);
    db()
      .prepare('INSERT INTO utente (id, email, nome, password, ruolo, creato_il) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), email, nome, await hashPassword(password), process.argv.includes('--admin') ? 'admin' : 'utente', ora());
    console.log(`Utente ${email} creato.`);
  } else if (comando === 'password') {
    const email = argomento('email')?.trim().toLowerCase();
    if (!email) throw new Error('Serve --email.');
    const u = db().prepare('SELECT id FROM utente WHERE email = ?').get(email) as { id: string } | undefined;
    if (!u) throw new Error('Utente non trovato.');
    const password = await chiediPassword();
    const errore = validaPassword(password);
    if (errore) throw new Error(errore);
    db().prepare('UPDATE utente SET password = ?, attivo = 1 WHERE id = ?').run(await hashPassword(password), u.id);
    db().prepare('DELETE FROM sessione WHERE utente_id = ?').run(u.id);
    console.log(`Password di ${email} aggiornata; le sessioni aperte sono state chiuse.`);
  } else if (comando === 'elenco') {
    const righe = db().prepare('SELECT email, nome, ruolo, attivo, ultimo_accesso FROM utente ORDER BY creato_il').all();
    console.table(righe);
  } else {
    console.log('Uso: cli.js crea --email E --nome N [--admin] | password --email E | elenco');
    process.exitCode = 1;
  }
}

main()
  .catch((err: Error) => {
    console.error(`Errore: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => chiudiDb());
