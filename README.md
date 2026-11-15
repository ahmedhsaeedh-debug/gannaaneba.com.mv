# Gannaaneba

Gannaaneba is a small marketplace app with a Node.js server. Accounts and products are shared through the server; passwords are stored as salted scrypt hashes, and sign-in uses an HTTP-only session cookie. Customers submit a Temu product link and quantity without entering a price. The administrator enters the Temu unit price in USD; the app converts the requested quantity to MVR at the configured fixed rate, adds a 20% service fee, and shows the quote in the customer's account for approval. Quotes include the configured bank account name and number along with the administrator's payment instructions. When SMTP is configured, the app also emails the customer about the quote. After approving the quote, customers can upload a payment slip for the administrator to review. Payment can only be recorded after the customer approves, and an order can only be marked as purchased after the administrator records payment as received.

## Run locally

1. Install Node.js 18 or newer.
2. In PowerShell, run `.\start-local.ps1`. It prompts for the administrator password without displaying it. Keep this PowerShell window open while you use the portal.
3. Open `http://127.0.0.1:3000` (do not open `index.html` directly). Use the administrator email `ahmedhsaeedh@gmail.com`.

The launcher supplies the password through a process environment variable. The server hashes it in memory at startup and does not write it to source files or disk. The administrator reviews store-owner registration requests, changes approved users between customer and store owner, assigns store names, and revokes access. Store owners can publish product or service listings with up to 12 device-uploaded JPG, PNG, or WebP photos (2 MB each; 16 MB total). Shoppers can browse product and service tabs, open listing details and photo galleries, view store contact details, and see all listings from a selected store. Marketplace data, uploaded photos, customer password hashes, and Temu purchase requests are stored under `data/`, which is excluded from Git.

## Configure password reset email

Customer and store-owner accounts can request a password-reset link from the sign-in dialog. Email delivery uses SMTP; configure these environment variables in the same PowerShell window before running `.\start-local.ps1`:

```powershell
$env:GANNAANEBA_SMTP_HOST = "smtp.example.com"
$env:GANNAANEBA_SMTP_PORT = "587"
$env:GANNAANEBA_SMTP_USER = "your-smtp-username"
$env:GANNAANEBA_SMTP_PASSWORD = "your-smtp-password"
$env:GANNAANEBA_SMTP_FROM = "Gannaaneba <no-reply@example.com>"
$env:GANNAANEBA_BASE_URL = "http://127.0.0.1:3000"
.\start-local.ps1
```

Use the SMTP credentials and sender address supplied by your email provider. Keep credentials out of source control; for a hosted deployment, store them in the hosting provider's secret manager and set `GANNAANEBA_BASE_URL` to the public HTTPS origin. The local `127.0.0.1` reset link works only on the computer running the server. Reset links expire after 30 minutes and can be used once. Requests are limited per client IP. If SMTP is not configured, password-reset requests report that email delivery is unavailable. The administrator password is configured locally at server startup and is not reset through email.

Customer registrations are active immediately; store-owner access still requires administrator approval. Temu prices and availability may vary by option, region, and time, so the administrator reviews each link and enters the current USD unit price. Quotes use a fixed rate of 1 USD = MVR 15.42 plus a 20% service fee; the customer can approve or decline the total in their account before any payment is requested. After approval, customers can upload one payment slip (PDF, JPG, PNG, or WebP; up to 5 MB) and replace it while the request is awaiting payment. Payment slips are stored privately and can only be downloaded by the customer who uploaded them or the administrator. The administrator can remove Temu requests. Quote emails and password recovery emails use the configured SMTP server; if SMTP is unavailable, quotes remain in the customer's account and the administrator is notified. The app does not send other order-status emails, process payments, or place orders on Temu automatically. A payment slip is not proof that funds cleared; the administrator should verify payment before marking it received, and only then purchase the goods.

This is a local starter app, not a production deployment. Before exposing it to the internet, deploy behind HTTPS and add a production database, backups, rate limiting, and operational monitoring.
