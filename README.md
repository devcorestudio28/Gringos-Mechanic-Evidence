# Mechanic Tracker

Discord bot za evidenciju popravaka/isplata, MySQL pohrana i Electron desktop aplikacija za administraciju.

## Funkcije

- **Dodaj popravku** otvara Discord modal za broj značke i količinu. Poruke evidencije automatski se osvježavaju.
- **Resetiraj popravku** postavlja tekuće obračunsko razdoblje na nulu. Povijest ostaje spremljena.
- **Isplati** nudi izbor igrača s neisplaćenim saldom i sprema isplatu.
- Desktop aplikacija omogućuje unos popravke za drugog člana, pregled i administraciju. Prijava je preko Discord OAuth2 i ovlaštenja se provjeravaju prema rolama.

## Railway postavljanje

### 1. MySQL servis

U Railway projektu dodaj MySQL servis. Ostavi ga na privatnoj mreži. U njegovoj kartici **Variables** postoje `MYSQL_URL`, `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD` i `MYSQLDATABASE`.

Promijeni/regeneriraj MySQL lozinku ako je ikad bila objavljena na slici ili poslana javno. Ne stavljaj `MYSQL_ROOT_PASSWORD` u kod ili GitHub.

### 2. Bot servis

Dodaj GitHub repo `devcorestudio28/Gringos-Mechanic-Evidence` kao novi Railway service. Railway automatski prepoznaje `Dockerfile` u korijenu repozitorija.

U bot servisu dodaj variable reference:

| Variable bot servisa | Vrijednost |
| --- | --- |
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` |
| `DISCORD_TOKEN` | bot token iz Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Discord application ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret |
| `DISCORD_GUILD_ID` | Discord server ID |
| `REPAIR_ROLE_IDS` | Role ID-jevi koji mogu dodavati popravke, odvojeni zarezom |
| `RESET_ROLE_IDS` | Role ID-jevi koji mogu resetirati |
| `PAYOUT_ROLE_IDS` | Role ID-jevi koji mogu evidentirati isplate |
| `REPAIR_RATE` | iznos po popravci, npr. `1650` |
| `TIMEZONE` | `Europe/Zagreb` |
| `DESKTOP_REDIRECT_URI` | `https://TVOJ-BOT-DOMAIN/auth/callback` |
| `REPAIR_CHANNEL_ID` | opcionalni kanal za panel popravki |
| `PAYOUT_CHANNEL_ID` | opcionalni kanal za panel isplata |

`MySQL` u `${{MySQL.MYSQL_URL}}` mora točno odgovarati nazivu database servisa na Railwayju. Ako servis ima drugo ime, zamijeni ga, npr. `${{mysql.MYSQL_URL}}`. Koristi privatni `MYSQL_URL`; nemoj koristiti `MYSQL_PUBLIC_URL`/TCP proxy za bot koji je u istom Railway projektu.

Railway sam postavlja `PORT`; nemoj ga ručno zadavati. U **Settings → Networking** dodijeli bot servisu Railway domain. Stavi tu domenu u `DESKTOP_REDIRECT_URI`, a isti callback dodaj u Discord Developer Portal → OAuth2 → Redirects. Ako se domain automatski izlaže kao `RAILWAY_PUBLIC_DOMAIN`, aplikacija može sama izračunati callback, no registracija u Discordu i dalje mora biti identična. U Railway **Settings → Deploy → Healthcheck Path** možeš postaviti `/health`.

Dodaj bot na Discord server s `applications.commands` i `bot` scopeom. U Developer Portalu uključi **Server Members Intent**. Botu trebaju **View Channels**, **Send Messages**, **Embed Links** i **Read Message History** dozvole.

### 3. Objavi panele i slash naredbu

Lokalno kopiraj `.env.example` u `.env`, upiši Discord varijable i Railway MySQL vrijednost u `DATABASE_URL`, pa pokreni:

```powershell
npm ci
npm run register-commands
```

To registrira `/post-panels` na serveru. Nakon deploya u Railway logovima potvrdi da je bot online, zatim u Discordu pokreni `/post-panels` i odaberi kanale.

### 4. Desktop aplikacija

Preuzmi Windows installer sa [GitHub Releases](https://github.com/devcorestudio28/Gringos-Mechanic-Evidence/releases). U desktop aplikaciju upiši botov Railway HTTPS domain i odaberi **Prijava putem Discorda**. Discord račun mora imati odgovarajuću server ulogu.

Za promjenu koda deployaj novu verziju s GitHuba na Railwayju. Installer se može lokalno izgraditi na Windowsu naredbom `npm run desktop:pack`.

## Lokalni razvoj

1. `npm ci`
2. Kopiraj `.env.example` u `.env` i unesi Discord/MySQL konfiguraciju.
3. `npm run register-commands`
4. `npm run dev` za bot; `npm run build` pa `npm run desktop` za desktop klijent.

## Railway database varijable

Aplikacija prihvaća jedan od ovih oblika:

- `DATABASE_URL` ili `MYSQL_URL` kao MySQL connection URI (preporučeno `${{MySQL.MYSQL_URL}}` na Railwayju), ili
- `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD` i `MYSQLDATABASE` zasebno.

Bot pri prvom pokretanju stvara `repair_events`, `payouts` i `guild_state`. Reset radi povećanjem obračunskog `reset_batch`, pa povijest popravki i isplata nije obrisana. Railway servis treba imati pristup bazi preko iste privatne mreže.

## Sigurnost

- Rotiraj vjerodajnice koje su bile vidljive na slikama. Slike mogu ostati spremljene u razgovorima ili cloud povijesti.
- Tajne drži samo u Railway Variables/Secrets i lokalnom `.env`; `.env` se ne commit-a.
- Uključi redovne MySQL backup-e u Railwayju.
- Koristi samo HTTPS bot domain u desktop aplikaciji.
