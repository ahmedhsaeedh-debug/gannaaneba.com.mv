# Gannaaneba

A lightweight Temu ordering site for customers in the Maldives. Customers register their island, current address, email, and phone number; submit Temu links; approve an MVR quote; and upload a deposit slip. The admin prices each item in USD, selects the USD-to-MVR rate, and the site automatically adds the 20% service fee. Payment slips are reviewed manually in the admin desk.

## Run locally

Requires Python 3.9 or newer. No packages need to be installed.

Set the admin password in the server environment before starting the app. Use a unique password of at least 12 characters; do not put it in source control.

```sh
export ADMIN_USER_ID=Ahumadhu
export ADMIN_PASSWORD='set-your-admin-password-here'
python3 app.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The default payment details shown to customers are account 7725530012101, Ahmed Saeed. Set `PAYMENT_ACCOUNT_NUMBER` and `PAYMENT_ACCOUNT_NAME` to change them.

## Hosting

Run behind a trusted HTTPS reverse proxy. The server listens on `0.0.0.0:8000` by default so container port forwarding can reach it; set `HOST` and `PORT` as needed, and set `COOKIE_SECURE=1` when the site is served over HTTPS. Store `ADMIN_PASSWORD` in the hosting provider's secret manager. Keep the SQLite database and `uploads/` directory on persistent, private storage; back them up securely. Do not expose the database or uploaded slips as public static files.

Orders and quote/payment status are visible in customers' accounts. This starter app does not send email or SMS notifications; customers can check for updates by signing in. The default quote exchange rate is 15.42 MVR per USD and can be changed for each item by the admin.

## Tests

```sh
python3 -m unittest discover -s tests
```
