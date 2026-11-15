import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import app


class GannaanebaFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        app.DATABASE = Path(cls.temp_dir.name) / "test.db"
        app.UPLOAD_DIR = Path(cls.temp_dir.name) / "uploads"
        app.ADMIN_USER_ID = "test-admin"
        app.ADMIN_PASSWORD = "test-admin-password-for-suite"
        app.ACCOUNT_NUMBER = "1234567890"
        app.ACCOUNT_NAME = "Test Account"
        app.initialize_database()
        app.SESSIONS.clear()
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.AppHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp_dir.cleanup()

    def request(self, path, method="GET", body=None, cookie=None, content_type=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}
        if cookie:
            headers["Cookie"] = cookie
        if content_type:
            headers["Content-Type"] = content_type
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read()
        set_cookie = response.getheader("Set-Cookie", "")
        connection.close()
        return response.status, payload, set_cookie

    def sign_in(self, path, body):
        status, _, set_cookie = self.request(path, "POST", body)
        self.assertEqual(status, 200)
        return set_cookie.split(";", 1)[0]

    def test_customer_quote_and_payment_approval_flow(self):
        customer_cookie = self.sign_in(
            "/api/register",
            {
                "island": "Malé",
                "address": "H. Test, Malé",
                "email": "customer@example.com",
                "phone": "1234567",
                "password": "customer-password",
            },
        )
        status, body, _ = self.request(
            "/api/orders", "POST", {"temu_url": "https://www.temu.com/item.html"}, customer_cookie
        )
        self.assertEqual(status, 201)
        order_id = json.loads(body)["id"]

        status, body, _ = self.request(
            f"/api/orders/{order_id}/approve", "POST", {}, customer_cookie
        )
        self.assertEqual(status, 409)

        admin_cookie = self.sign_in(
            "/api/admin/login",
            {"user_id": app.ADMIN_USER_ID, "password": app.ADMIN_PASSWORD},
        )
        status, _, _ = self.request(
            f"/api/orders/{order_id}/quote",
            "PATCH",
            {"usd_price": "10", "exchange_rate": "15.42"},
            admin_cookie,
        )
        self.assertEqual(status, 200)

        status, body, _ = self.request(
            f"/api/orders/{order_id}/approve", "POST", {}, customer_cookie
        )
        self.assertEqual(status, 200)
        status, body, _ = self.request("/api/orders", cookie=customer_cookie)
        self.assertEqual(status, 200)
        order = json.loads(body)["orders"][0]
        self.assertEqual(order["status"], "awaiting_payment")
        self.assertEqual(order["total_mvr"], 185.04)

        boundary = "test-boundary"
        slip = b"%PDF-1.4\npayment receipt\n"
        multipart = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="slip"; filename="receipt.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode() + slip + f"\r\n--{boundary}--\r\n".encode()
        status, _, _ = self.request(
            f"/api/orders/{order_id}/slip",
            "POST",
            multipart,
            customer_cookie,
            f"multipart/form-data; boundary={boundary}",
        )
        self.assertEqual(status, 200)

        status, body, _ = self.request("/api/admin/orders", cookie=admin_cookie)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["orders"][0]["status"], "slip_submitted")
        status, body, _ = self.request(
            f"/api/orders/{order_id}/slip", cookie=admin_cookie
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, slip)

        status, _, _ = self.request(
            f"/api/orders/{order_id}/payment",
            "PATCH",
            {"action": "approve"},
            admin_cookie,
        )
        self.assertEqual(status, 200)
        status, body, _ = self.request("/api/orders", cookie=customer_cookie)
        self.assertEqual(json.loads(body)["orders"][0]["status"], "payment_approved")

    def test_only_temu_https_links_are_accepted(self):
        customer_cookie = self.sign_in(
            "/api/register",
            {
                "island": "Addu",
                "address": "Test address",
                "email": "second@example.com",
                "phone": "7654321",
                "password": "customer-password",
            },
        )
        for link in ("http://temu.com/item", "https://temu.com.evil.example/item"):
            status, _, _ = self.request(
                "/api/orders", "POST", {"temu_url": link}, customer_cookie
            )
            self.assertEqual(status, 400)

    def test_payment_account_configuration_is_public(self):
        status, body, _ = self.request("/api/config")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {
            "account_number": "1234567890",
            "account_name": "Test Account",
        })

    def test_homepage_is_served(self):
        status, body, _ = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Gannaaneba", body)



if __name__ == "__main__":
    unittest.main()
