# Mechanic Tracker

Discord bot za evidenciju popravaka i isplata, MySQL pohrana te Electron desktop aplikacija za administraciju.

## Što radi

- Gumb **Dodaj popravku** otvara modal za broj značke i broj popravki; evidencijske poruke se automatski ažuriraju.
- Gumb **Resetiraj popravku** otvara reset ovlaštenim ulogama. Reset postavlja popravke tekućeg obračunskog razdoblja na 0; povijest popravki i starih isplata ostaje u bazi.
- Gumb **Isplati** prikazuje izbor igrača s neisplaćenim saldom. Isplata čuva zapis, umanjuje saldo i osvježava panel.
- Desktop alat omogućuje unos popravke za drugog člana servera, pregled evidencije i isplatu/reset s provjerom ovlaštenog role ID-ja.
- Cijena je podesiva kroz `REPAIR_RATE` (po zadanim postavkama 1.650 $ po popravci).

## Preduvjeti

- Node.js 22 ili noviji, npm i MySQL 8+
- Discord aplikacija/bot s uključenim **Server Members Intent** u Developer Portalu; botu trebaju `applications.commands`, `bot`, te server permissioni **View Channels**, **Send Messages**, **Embed Links** i **Read Message History**. Pozovi bota na server.
- MySQL baza dostupna botu; Northflank MySQL dodatak ili zasebna MySQL instanca.

## Lokalna priprema

1. Kopiraj `.env.example` u `.env`.
2. U Discord Developer Portal napravi aplikaciju i bot te popuni `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` i `DISCORD_GUILD_ID`.
3. Dodaj MySQL connection string u `DATABASE_URL`, na primjer `mysql://korisnik:lozinka@host:3306/mechanic_tracker`.
4. Uključi Developer Mode u Discordu i kopiraj ID-jeve uloga u `REPAIR_ROLE_IDS`, `RESET_ROLE_IDS`, `PAYOUT_ROLE_IDS`. Više uloga odvoji zarezom. Za desktop OAuth postavi `DISCORD_CLIENT_SECRET` te `DESKTOP_REDIRECT_URI` identičan adresi registriranoj u Discord Developer Portalu.
5. Po želji postavi `REPAIR_CHANNEL_ID`, `PAYOUT_CHANNEL_ID` i `REPAIR_RATE`.
6. Pokreni:

   ```powershell
   npm install
   npm run register-commands
   npm run build
   npm start
   ```

7. U Discordu pokreni `/post-panels` (možeš odabrati kanale). Zapamćene poruke bot ažurira nakon svake promjene.

Desktop aplikacija se pokreće lokalno s `npm run desktop` nakon builda. Unesi HTTPS API adresu i prijavi se Discord računom. API je dostupan na portu `3210`; izloži ga kroz HTTPS reverse proxy na Northflanku. OAuth redirect URL unesi i u Discord Developer Portalu.

## Northflank

1. Napravi Northflank project/service iz ovog repozitorija i koristi `Dockerfile` kao build konfiguraciju.
2. Dodaj MySQL addon ili spoji vanjski MySQL te postavi sve varijable iz `.env.example` u service secrets/environment. `DATABASE_URL` mora koristiti host koji je dostupan iz servicea. Registriraj `DESKTOP_REDIRECT_URI` kao OAuth2 redirect u Discord aplikaciji.
3. Deployaj. Bot automatski kreira tablice pri pokretanju. Slash naredbu registriraj jednom lokalno (`npm run register-commands`) s istim Discord tokenom i ID-jevima.
4. Za desktop API koristi javni HTTPS hostname i izloži `PORT` servisa. `DESKTOP_REDIRECT_URI` mora biti `https://<hostname>/auth/callback`, a ovaj URL registriraj i u Discord Developer Portalu. Desktop OAuth prozor po uspješnoj prijavi vraća jednokratnu sesiju aplikaciji.

Northflank sučelje dodjeljuje HTTPS hostname i `PORT`; postavi taj port kao HTTP port servisa. Environment secrets dodaj kroz postavke servisa.

## Desktop paket za Windows

Na Windows računalu s kloniranim projektom:

```powershell
npm install
npm run build
npx electron-packager . "Mechanic Tracker" --platform=win32 --arch=x64 --out=release --ignore="src|\.env|node_modules"
```

Desktop se može pokretati iz projekta naredbom `npm run desktop` nakon `npm run build`. Za lokalni Windows instalacijski paket pokreni `npm run desktop:pack`; `.exe` će biti u `release/`. Push taga oblika `v1.0.0` automatski izgradi Windows `.exe` i objavi ga u GitHub Releases. Instalacijski paket nije unaprijed potpisan.

## Sigurnosne napomene

- Desktop API koristi Discord OAuth2 prijavu i provjerava člana te njegove role na serveru prije svake privilegirane radnje. Drži `DISCORD_CLIENT_SECRET` u Northflank secrets.
- Koristi TLS prema MySQL-u kad ga provider podržava i redovno radi backup baze.

## Baza

Bot automatski stvara `repair_events`, `payouts` i `guild_state`. Reset je logički (povećanje `reset_batch`), pa se stara evidencija ne briše. `payouts` prati broj isplaćenih popravki u istom obračunskom razdoblju, tako da reset novog razdoblja ne oduzima novo zarađene popravke starim isplatama.
