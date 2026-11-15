# Gannaaneba

Gannaaneba is a Node.js and PostgreSQL web app. GitHub stores the source code; GitHub Pages cannot run the login or marketplace API. Deploy the app as a Render Web Service so the page and API share one origin.

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render, create a PostgreSQL database and a Web Service connected to that repository.
3. Use `npm install` as the build command and `npm start` as the start command.
4. Add these environment variables to the Web Service:
   - `DATABASE_URL`: the database's internal connection string from Render.
   - `NODE_ENV`: `production`.
   - `SESSION_SECRET`: a randomly generated secret with at least 32 characters.
   - `ADMIN_EMAIL`: the initial administrator's email address.
   - `ADMIN_PASSWORD`: a unique password with at least 12 characters.
   - `USD_TO_MVR_RATE`: conversion rate used when quoting Temu requests (defaults to `15.42`).
   - `SERVICE_FEE_PERCENT`: service fee used when quoting (defaults to `0`; set the intended fee before accepting orders).
5. Deploy and open the Render URL. Use that URL, not the GitHub Pages URL, to sign in.

The database tables and initial administrator account are created on the first server start. Store-owner registrations wait for administrator approval; customer registrations are enabled immediately. The administrator credentials are never included in the repository.

## Local development

1. Install Node.js 20 or newer and PostgreSQL.
2. Copy `.env.example` to `.env`, then set the database URL, session secret, administrator email, and administrator password.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000`.

The app also supports a read-only sample preview by opening `index.html` directly or adding `?preview=1` to its URL. Preview accounts and orders are not saved.

## Password reset emails

Password reset is disabled until SMTP is configured. Set `APP_BASE_URL` to the deployed Render URL and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and optionally `SMTP_FROM`. Add these values in Render's environment settings; do not put real credentials in GitHub.
