import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from email.parser import BytesParser
from email.policy import default
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATABASE = Path(os.environ.get("DATABASE_PATH", ROOT / "gannaaneba.db"))
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", ROOT / "uploads"))
ADMIN_USER_ID = os.environ.get("ADMIN_USER_ID", "Ahumadhu")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
ACCOUNT_NUMBER = os.environ.get("PAYMENT_ACCOUNT_NUMBER", "7725530012101")
ACCOUNT_NAME = os.environ.get("PAYMENT_ACCOUNT_NAME", "Ahmed Saeed")
SESSION_TTL = 12 * 60 * 60
MAX_JSON_SIZE = 64 * 1024
MAX_SLIP_SIZE = 5 * 1024 * 1024
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"

SESSIONS = {}


@contextmanager
def database():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY,
                island TEXT NOT NULL,
                address TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                phone TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                temu_url TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'submitted',
                usd_price REAL,
                exchange_rate REAL,
                total_mvr REAL,
                slip_filename TEXT,
                admin_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password, encoded):
    try:
        salt_hex, digest_hex = encoded.split(":", 1)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 310_000
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def valid_temu_url(value):
    try:
        parsed = urlsplit(value)
        hostname = (parsed.hostname or "").lower()
        return (
            parsed.scheme == "https"
            and (hostname == "temu.com" or hostname.endswith(".temu.com"))
            and parsed.username is None
            and parsed.password is None
        )
    except (ValueError, AttributeError):
        return False


def order_data(row):
    return {
        "id": row["id"],
        "island": row["island"],
        "address": row["address"],
        "email": row["email"],
        "phone": row["phone"],
        "temu_url": row["temu_url"],
        "status": row["status"],
        "usd_price": row["usd_price"],
        "exchange_rate": row["exchange_rate"],
        "total_mvr": row["total_mvr"],
        "has_slip": bool(row["slip_filename"]),
        "admin_note": row["admin_note"],
        "created_at": row["created_at"],
    }


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class AppHandler(BaseHTTPRequestHandler):
    server_version = "Gannaaneba/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            raise RequestError(415, "Send the request as JSON.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise RequestError(400, "Invalid request size.")
        if length < 1 or length > MAX_JSON_SIZE:
            raise RequestError(413, "Request must be smaller than 64 KB.")
        try:
            value = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RequestError(400, "Invalid JSON.")
        if not isinstance(value, dict):
            raise RequestError(400, "Invalid request.")
        return value

    def session(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("gannaaneba_session")
        if not morsel:
            return None
        token = morsel.value
        session = SESSIONS.get(token)
        if not session:
            return None
        if session["expires"] < time.time():
            SESSIONS.pop(token, None)
            return None
        session["expires"] = time.time() + SESSION_TTL
        return session

    def require_role(self, role):
        session = self.session()
        if not session or session["role"] != role:
            raise RequestError(401, "Please sign in to continue.")
        return session

    def set_session_cookie(self, token):
        cookie = f"gannaaneba_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}"
        if COOKIE_SECURE:
            cookie += "; Secure"
        self.send_header("Set-Cookie", cookie)

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path == "/api/me":
                session = self.session()
                if not session:
                    return self.send_json(200, {"user": None})
                if session["role"] == "admin":
                    return self.send_json(
                        200, {"user": {"role": "admin", "name": ADMIN_USER_ID}}
                    )
                with database() as connection:
                    customer = connection.execute(
                        "SELECT island, address, email, phone FROM customers WHERE id = ?",
                        (session["id"],),
                    ).fetchone()
                if not customer:
                    return self.send_json(200, {"user": None})
                return self.send_json(
                    200,
                    {
                        "user": {
                            "role": "customer",
                            "island": customer["island"],
                            "address": customer["address"],
                            "email": customer["email"],
                            "phone": customer["phone"],
                        }
                    },
                )
            if path == "/api/config":
                return self.send_json(
                    200,
                    {
                        "account_number": ACCOUNT_NUMBER,
                        "account_name": ACCOUNT_NAME,
                    },
                )
            if path == "/api/orders":
                session = self.require_role("customer")
                with database() as connection:
                    rows = connection.execute(
                        "SELECT orders.*, customers.island, customers.address, customers.email, customers.phone "
                        "FROM orders JOIN customers ON customers.id = orders.customer_id "
                        "WHERE customer_id = ? ORDER BY orders.id DESC",
                        (session["id"],),
                    ).fetchall()
                return self.send_json(200, {"orders": [order_data(row) for row in rows]})
            if path == "/api/admin/orders":
                self.require_role("admin")
                with database() as connection:
                    rows = connection.execute(
                        "SELECT orders.*, customers.island, customers.address, customers.email, customers.phone "
                        "FROM orders JOIN customers ON customers.id = orders.customer_id "
                        "ORDER BY orders.id DESC"
                    ).fetchall()
                return self.send_json(200, {"orders": [order_data(row) for row in rows]})
            if path.startswith("/api/orders/") and path.endswith("/slip"):
                return self.get_slip(path)
            if path == "/" or path == "/index.html":
                return self.serve_static("index.html")
            if path.startswith("/static/"):
                return self.serve_static(path.removeprefix("/static/"))
            raise RequestError(404, "Page not found.")
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})
        except (OSError, sqlite3.Error) as error:
            print(f"Request failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def serve_static(self, filename):
        target = (STATIC_DIR / filename).resolve()
        if not target.is_relative_to(STATIC_DIR.resolve()) or not target.is_file():
            raise RequestError(404, "File not found.")
        content_type = "text/html; charset=utf-8" if target.suffix == ".html" else (
            "text/css; charset=utf-8" if target.suffix == ".css" else
            "text/javascript; charset=utf-8" if target.suffix == ".js" else
            "application/octet-stream"
        )
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            if path == "/api/register":
                return self.register()
            if path == "/api/login":
                return self.login()
            if path == "/api/admin/login":
                return self.admin_login()
            if path == "/api/logout":
                self.session()
                cookie = "gannaaneba_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
                if COOKIE_SECURE:
                    cookie += "; Secure"
                self.send_response(200)
                self.send_header("Set-Cookie", cookie)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if path == "/api/orders":
                return self.create_order()
            if path.startswith("/api/orders/") and path.endswith("/approve"):
                return self.approve_quote(path)
            if path.startswith("/api/orders/") and path.endswith("/slip"):
                return self.upload_slip(path)
            raise RequestError(404, "Page not found.")
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "An account with that email already exists."})
        except (OSError, sqlite3.Error) as error:
            print(f"Request failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def register(self):
        data = self.read_json()
        island = str(data.get("island", "")).strip()
        address = str(data.get("address", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        phone = str(data.get("phone", "")).strip()
        password = str(data.get("password", ""))
        if not all((island, address, email, phone)):
            raise RequestError(400, "Please complete all registration fields.")
        if len(island) > 100 or len(address) > 300 or len(phone) > 40:
            raise RequestError(400, "Please check the length of your details.")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 254:
            raise RequestError(400, "Enter a valid email address.")
        if len(password) < 8 or len(password) > 128:
            raise RequestError(400, "Your password must be 8–128 characters.")
        with database() as connection:
            cursor = connection.execute(
                "INSERT INTO customers (island, address, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)",
                (island, address, email, phone, hash_password(password)),
            )
            customer_id = cursor.lastrowid
        return self.start_session({"id": customer_id, "role": "customer"})

    def login(self):
        data = self.read_json()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        with database() as connection:
            customer = connection.execute(
                "SELECT id, password_hash FROM customers WHERE email = ?", (email,)
            ).fetchone()
        if not customer or not verify_password(password, customer["password_hash"]):
            raise RequestError(401, "Email or password is incorrect.")
        return self.start_session({"id": customer["id"], "role": "customer"})

    def admin_login(self):
        data = self.read_json()
        user_id = str(data.get("user_id", ""))
        password = str(data.get("password", ""))
        valid_user = hmac.compare_digest(
            user_id.encode("utf-8"), ADMIN_USER_ID.encode("utf-8")
        )
        valid_password = hmac.compare_digest(
            password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")
        )
        if not valid_user or not valid_password:
            raise RequestError(401, "Admin ID or password is incorrect.")
        return self.start_session({"id": ADMIN_USER_ID, "role": "admin"})

    def start_session(self, session):
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = {**session, "expires": time.time() + SESSION_TTL}
        self.send_response(200)
        self.set_session_cookie(token)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        body = json.dumps({"ok": True}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def create_order(self):
        session = self.require_role("customer")
        data = self.read_json()
        temu_url = str(data.get("temu_url", "")).strip()
        if len(temu_url) > 2048 or not valid_temu_url(temu_url):
            raise RequestError(400, "Enter a valid HTTPS link from temu.com.")
        with database() as connection:
            cursor = connection.execute(
                "INSERT INTO orders (customer_id, temu_url) VALUES (?, ?)",
                (session["id"], temu_url),
            )
            order_id = cursor.lastrowid
        return self.send_json(201, {"id": order_id})

    def order_id_from_path(self, path, action):
        match = re.fullmatch(rf"/api/orders/(\d+)/(?:{action})", path)
        if not match:
            raise RequestError(404, "Order not found.")
        return int(match.group(1))

    def approve_quote(self, path):
        session = self.require_role("customer")
        order_id = self.order_id_from_path(path, "approve")
        with database() as connection:
            cursor = connection.execute(
                "UPDATE orders SET status = 'awaiting_payment', updated_at = CURRENT_TIMESTAMP "
                "WHERE id = ? AND customer_id = ? AND status = 'quoted'",
                (order_id, session["id"]),
            )
            if cursor.rowcount != 1:
                raise RequestError(409, "This price is no longer awaiting your approval.")
        return self.send_json(200, {"ok": True})

    def upload_slip(self, path):
        session = self.require_role("customer")
        order_id = self.order_id_from_path(path, "slip")
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            raise RequestError(415, "Upload a PNG, JPEG, or PDF payment slip.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise RequestError(400, "Invalid upload size.")
        if length < 1 or length > MAX_SLIP_SIZE + 16_384:
            raise RequestError(413, "Payment slips must be smaller than 5 MB.")
        message = BytesParser(policy=default).parsebytes(
            b"Content-Type: " + content_type.encode("ascii", "ignore") + b"\r\n"
            b"MIME-Version: 1.0\r\n\r\n" + self.rfile.read(length)
        )
        upload = next(
            (
                part
                for part in message.iter_parts()
                if part.get_param("name", header="content-disposition") == "slip"
            ),
            None,
        )
        if not upload or not upload.get_filename():
            raise RequestError(400, "Choose a payment slip to upload.")
        body = upload.get_payload(decode=True) or b""
        kind = upload.get_content_type()
        signatures = {
            "image/png": body.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/jpeg": body.startswith(b"\xff\xd8\xff"),
            "application/pdf": body.startswith(b"%PDF-"),
        }
        if len(body) > MAX_SLIP_SIZE or not signatures.get(kind, False):
            raise RequestError(400, "Use a valid PNG, JPEG, or PDF payment slip (up to 5 MB).")
        filename = f"{uuid.uuid4().hex}.{ {'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf'}[kind] }"
        with database() as connection:
            order = connection.execute(
                "SELECT status FROM orders WHERE id = ? AND customer_id = ?",
                (order_id, session["id"]),
            ).fetchone()
            if not order:
                raise RequestError(404, "Order not found.")
            if order["status"] not in ("awaiting_payment", "slip_rejected"):
                raise RequestError(409, "Approve the price before uploading your slip.")
            (UPLOAD_DIR / filename).write_bytes(body)
            connection.execute(
                "UPDATE orders SET slip_filename = ?, status = 'slip_submitted', "
                "admin_note = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (filename, order_id),
            )
        return self.send_json(200, {"ok": True})

    def get_slip(self, path):
        match = re.fullmatch(r"/api/orders/(\d+)/slip", path)
        if not match:
            raise RequestError(404, "Payment slip not found.")
        order_id = int(match.group(1))
        session = self.session()
        if not session:
            raise RequestError(401, "Please sign in to continue.")
        with database() as connection:
            row = connection.execute(
                "SELECT slip_filename, customer_id FROM orders WHERE id = ?", (order_id,)
            ).fetchone()
        if not row or (
            session["role"] != "admin" and row["customer_id"] != session["id"]
        ):
            raise RequestError(404, "Payment slip not found.")
        if not row["slip_filename"]:
            raise RequestError(404, "No payment slip has been uploaded.")
        target = UPLOAD_DIR / row["slip_filename"]
        if not target.is_file():
            raise RequestError(404, "Payment slip not found.")
        content_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".pdf": "application/pdf",
        }[target.suffix]
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", f'inline; filename="payment-slip{target.suffix}"')
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "private, no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_PATCH(self):
        path = urlsplit(self.path).path
        try:
            session = self.require_role("admin")
            order_id = self.order_id_from_path(path, r"quote|payment")
            data = self.read_json()
            if path.endswith("/quote"):
                try:
                    usd_price = float(data.get("usd_price"))
                    exchange_rate = float(data.get("exchange_rate"))
                except (TypeError, ValueError):
                    raise RequestError(400, "Enter a valid USD price and exchange rate.")
                if (
                    not 0 < usd_price <= 100_000
                    or not 1 <= exchange_rate <= 100
                ):
                    raise RequestError(400, "Check the USD price and MVR exchange rate.")
                total_mvr = round(usd_price * exchange_rate * 1.2, 2)
                with database() as connection:
                    cursor = connection.execute(
                        "UPDATE orders SET usd_price = ?, exchange_rate = ?, total_mvr = ?, "
                        "status = 'quoted', admin_note = '', updated_at = CURRENT_TIMESTAMP "
                        "WHERE id = ? AND status IN ('submitted', 'quoted')",
                        (usd_price, exchange_rate, total_mvr, order_id),
                    )
                    if cursor.rowcount != 1:
                        raise RequestError(409, "This order cannot be priced in its current state.")
                return self.send_json(200, {"total_mvr": total_mvr})
            action = str(data.get("action", ""))
            note = str(data.get("note", "")).strip()[:500]
            if action not in ("approve", "reject"):
                raise RequestError(400, "Choose whether to approve or reject the payment slip.")
            with database() as connection:
                status = "payment_approved" if action == "approve" else "slip_rejected"
                cursor = connection.execute(
                    "UPDATE orders SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP "
                    "WHERE id = ? AND status = 'slip_submitted' AND slip_filename IS NOT NULL",
                    (status, note, order_id),
                )
                if cursor.rowcount != 1:
                    raise RequestError(409, "This payment slip is no longer awaiting review.")
            return self.send_json(200, {"ok": True})
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})
        except (OSError, sqlite3.Error) as error:
            print(f"Request failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})


def run():
    if not ADMIN_PASSWORD:
        raise SystemExit(
            "Set ADMIN_PASSWORD in the server environment before starting Gannaaneba."
        )
    if len(ADMIN_PASSWORD) < 12:
        raise SystemExit("ADMIN_PASSWORD must be at least 12 characters.")
    initialize_database()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Gannaaneba is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Gannaaneba.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
