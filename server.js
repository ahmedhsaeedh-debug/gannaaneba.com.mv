import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import connectPgSimple from "connect-pg-simple";
import "dotenv/config";
import express from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import nodemailer from "nodemailer";
import pg from "pg";
import { calculateQuote, isTemuUrl, parseImageDataUrl } from "./marketplace.js";

const { Pool } = pg;
const directory = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET;
const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
const usdToMvrRate = Number(process.env.USD_TO_MVR_RATE || "15.42");
const serviceFeePercent = Number(process.env.SERVICE_FEE_PERCENT || "0");
const sessionCookieName = "gannaaneba.sid";
const maxPaymentSlipBytes = 5 * 1024 * 1024;
const categories = ["Home & Living", "Fashion", "Art & Craft", "Food"];
const serviceCategories = [
  "Home Services",
  "Repairs & Maintenance",
  "Beauty & Wellness",
  "Lessons & Coaching",
  "Events",
  "Professional Services",
  "Other Services"
];
const dummyPasswordHash = await bcrypt.hash("invalid-login-timing-value", 12);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!sessionSecret || sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
if (!adminEmail || adminPassword.length < 12) throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.");
if (!Number.isFinite(usdToMvrRate) || usdToMvrRate <= 0) throw new Error("USD_TO_MVR_RATE must be a positive number.");
if (!Number.isFinite(serviceFeePercent) || serviceFeePercent < 0 || serviceFeePercent > 100) {
  throw new Error("SERVICE_FEE_PERCENT must be a number from 0 to 100.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
});

app.disable("x-powered-by");
if (production) app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "25mb" }));

const PgSession = connectPgSimple(session);
app.use(session({
  name: sessionCookieName,
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false
});

function apiError(res, status, message) {
  return res.status(status).json({ error: message });
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    phone: account.phone || "",
    address: account.address || "",
    storeName: account.store_name || "",
    about: account.about || ""
  };
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toProduct(row) {
  const images = Array.isArray(row.images) ? row.images : [];
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    price: Number(row.price),
    category: row.category,
    images,
    image: images[0] || "",
    description: row.description,
    store: row.store_name,
    ownerEmail: row.owner_email,
    rating: "New"
  };
}

function toOrder(row) {
  return {
    id: row.id,
    name: row.name,
    temuUrl: row.temu_url,
    quantity: row.quantity,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    temuUnitPriceUsd: row.temu_unit_price_usd == null ? null : Number(row.temu_unit_price_usd),
    temuAmountUsd: row.temu_amount_usd == null ? null : Number(row.temu_amount_usd),
    exchangeRateMvrPerUsd: row.exchange_rate_mvr_per_usd == null ? null : Number(row.exchange_rate_mvr_per_usd),
    baseAmountMvr: row.base_amount_mvr == null ? null : Number(row.base_amount_mvr),
    serviceFeePercent: row.service_fee_percent == null ? null : Number(row.service_fee_percent),
    serviceFeeMvr: row.service_fee_mvr == null ? null : Number(row.service_fee_mvr),
    paymentAmountMvr: row.payment_amount_mvr == null ? null : Number(row.payment_amount_mvr),
    paymentInstructions: row.payment_instructions || "",
    paymentSlip: row.payment_slip_uploaded_at
      ? { uploadedAt: new Date(row.payment_slip_uploaded_at).toISOString() }
      : null,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    phone: row.phone || "",
    address: row.address || ""
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

async function requireAccount(req, res, next) {
  try {
    if (!req.session.userId) return apiError(res, 401, "Please sign in to continue.");
    const result = await pool.query(
      "SELECT * FROM accounts WHERE id = $1 AND status = 'approved'",
      [req.session.userId]
    );
    if (!result.rowCount) {
      await new Promise((resolve, reject) => {
        req.session.destroy(error => error ? reject(error) : resolve());
      });
      return apiError(res, 401, "Your account is no longer active. Please contact the administrator.");
    }
    req.account = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.account?.role !== role) return apiError(res, 403, "You don't have permission to do that.");
    next();
  };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'store', 'admin')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      store_name TEXT NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('product', 'service')),
      name TEXT NOT NULL,
      price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
      category TEXT NOT NULL,
      images JSONB NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS temu_orders (
      id UUID PRIMARY KEY,
      customer_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      temu_url TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
      status TEXT NOT NULL CHECK (status IN (
        'awaiting_review', 'awaiting_customer_approval', 'awaiting_payment',
        'payment_received', 'purchased', 'quote_declined'
      )),
      temu_unit_price_usd NUMERIC(12, 2),
      temu_amount_usd NUMERIC(12, 2),
      exchange_rate_mvr_per_usd NUMERIC(12, 4),
      base_amount_mvr NUMERIC(12, 2),
      service_fee_percent NUMERIC(5, 2),
      service_fee_mvr NUMERIC(12, 2),
      payment_amount_mvr NUMERIC(12, 2),
      payment_instructions TEXT NOT NULL DEFAULT '',
      payment_slip_data BYTEA,
      payment_slip_mime TEXT,
      payment_slip_uploaded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS products_owner_idx ON products(owner_id);
    CREATE INDEX IF NOT EXISTS temu_orders_customer_idx ON temu_orders(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status, created_at DESC);
  `);

  const existingAdmin = await pool.query("SELECT role FROM accounts WHERE email = $1", [adminEmail]);
  if (!existingAdmin.rowCount) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      `INSERT INTO accounts (id, name, email, password_hash, role, status)
       VALUES ($1, 'Administrator', $2, $3, 'admin', 'approved')
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), adminEmail, passwordHash]
    );
  }
  const verifiedAdmin = await pool.query("SELECT role FROM accounts WHERE email = $1", [adminEmail]);
  if (verifiedAdmin.rows[0]?.role !== "admin") {
    throw new Error("ADMIN_EMAIL belongs to a non-admin account. Choose a separate administrator email.");
  }
  await pool.query("UPDATE accounts SET status = 'approved' WHERE email = $1 AND role = 'admin'", [adminEmail]);
}

app.get("/", async (_req, res, next) => {
  try {
    res.type("html").send(await readFile(path.join(directory, "index.html")));
  } catch (error) {
    next(error);
  }
});
app.get("/Style.css", async (_req, res, next) => {
  try {
    res.type("css").send(await readFile(path.join(directory, "Style.css")));
  } catch (error) {
    next(error);
  }
});

app.get("/api/products", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, a.store_name, a.email AS owner_email
       FROM products p
       JOIN accounts a ON a.id = p.owner_id
       WHERE a.status = 'approved' AND a.role = 'store'
       ORDER BY p.created_at DESC`
    );
    res.json({ products: result.rows.map(toProduct) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stores", async (req, res, next) => {
  try {
    const name = String(req.query.name || "").trim();
    const result = await pool.query(
      `SELECT a.id, a.name, a.email, a.phone, a.address, a.store_name, a.about,
              COUNT(p.id)::INTEGER AS product_count,
              COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.category), NULL), '{}') AS categories
       FROM accounts a
       LEFT JOIN products p ON p.owner_id = a.id
       WHERE a.role = 'store' AND a.status = 'approved' AND LOWER(a.store_name) = LOWER($1)
       GROUP BY a.id`,
      [name]
    );
    if (!result.rowCount) return apiError(res, 404, "This store is no longer available.");
    const row = result.rows[0];
    const products = await pool.query(
      `SELECT p.*, a.store_name, a.email AS owner_email
       FROM products p JOIN accounts a ON a.id = p.owner_id
       WHERE p.owner_id = $1 ORDER BY p.created_at DESC`,
      [row.id]
    );
    res.json({
      store: {
        name: row.store_name,
        owner: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        about: row.about,
        productCount: row.product_count,
        categories: row.categories
      },
      products: products.rows.map(toProduct)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/register", registerLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
    const about = typeof body.about === "string" ? body.about.trim() : "";
    if (name.length < 2 || name.length > 120 || !validEmail(email)) {
      return apiError(res, 400, "Enter a valid name and email address.");
    }
    if (password.length < 8 || password.length > 200) return apiError(res, 400, "Password must be between 8 and 200 characters.");
    if (!["customer", "store"].includes(role)) return apiError(res, 400, "Choose a valid account type.");
    if (!phone || phone.length > 50 || !address || address.length > 500) {
      return apiError(res, 400, "Enter a phone number and address.");
    }
    if (role === "store" && (!storeName || storeName.length > 120)) {
      return apiError(res, 400, "Enter a valid store name.");
    }
    if (about.length > 500) return apiError(res, 400, "Store description must be 500 characters or fewer.");
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await pool.query(
      `INSERT INTO accounts
       (id, name, email, password_hash, role, status, phone, address, store_name, about)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [randomUUID(), name, email, passwordHash, role, role === "customer" ? "approved" : "pending", phone, address, storeName, about]
    );
    res.status(201).json({ accountId: account.rows[0].id });
  } catch (error) {
    if (error.code === "23505") return apiError(res, 409, "An account with this email already exists.");
    next(error);
  }
});

app.post("/api/login", loginLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const result = await pool.query("SELECT * FROM accounts WHERE email = $1", [email]);
    const account = result.rows[0];
    const validPassword = await bcrypt.compare(password, account?.password_hash || dummyPasswordHash);
    if (!account || !validPassword) return apiError(res, 401, "Email or password is incorrect.");
    if (account.status !== "approved") return apiError(res, 403, "Your account is awaiting administrator approval.");
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = account.id;
    await saveSession(req);
    res.json({ user: publicAccount(account) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", requireAccount, (req, res) => {
  res.json({ user: publicAccount(req.account) });
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie(sessionCookieName, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      path: "/"
    });
    res.json({ success: true });
  });
});

app.get("/api/orders", requireAccount, requireRole("customer"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT o.*, a.name AS customer_name, a.email AS customer_email, a.phone, a.address
       FROM temu_orders o JOIN accounts a ON a.id = o.customer_id
       WHERE o.customer_id = $1 ORDER BY o.created_at DESC`,
      [req.account.id]
    );
    res.json({ orders: result.rows.map(toOrder) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", requireAccount, requireRole("customer"), async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const temuUrl = typeof req.body?.temuUrl === "string" ? req.body.temuUrl.trim() : "";
    const quantity = Number(req.body?.quantity);
    if (name.length < 2 || name.length > 160) return apiError(res, 400, "Product name must be between 2 and 160 characters.");
    if (!isTemuUrl(temuUrl)) return apiError(res, 400, "Enter a secure temu.com or temu.to product link.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return apiError(res, 400, "Quantity must be between 1 and 20.");
    const result = await pool.query(
      `INSERT INTO temu_orders (id, customer_id, name, temu_url, quantity, status)
       VALUES ($1, $2, $3, $4, $5, 'awaiting_review')
       RETURNING *`,
      [randomUUID(), req.account.id, name, temuUrl, quantity]
    );
    res.status(201).json({ order: toOrder({
      ...result.rows[0],
      customer_name: req.account.name,
      customer_email: req.account.email,
      phone: req.account.phone,
      address: req.account.address
    }) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:id", requireAccount, requireRole("customer"), async (req, res, next) => {
  try {
    const action = req.body?.action;
    const status = action === "approve-quote" ? "awaiting_payment"
      : action === "decline-quote" ? "quote_declined"
        : null;
    if (!status) return apiError(res, 400, "Choose a valid quote action.");
    const result = await pool.query(
      `UPDATE temu_orders SET status = $1
       WHERE id = $2 AND customer_id = $3 AND status = 'awaiting_customer_approval'
       RETURNING id`,
      [status, req.params.id, req.account.id]
    );
    if (!result.rowCount) return apiError(res, 404, "This quote is no longer available.");
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:id/payment-slip", requireAccount, requireRole("customer"), async (req, res, next) => {
  try {
    const match = typeof req.body?.paymentSlip === "string" &&
      req.body.paymentSlip.match(/^data:(application\/pdf|image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return apiError(res, 400, "Upload a PDF, JPG, PNG, or WebP payment slip.");
    const data = Buffer.from(match[2], "base64");
    if (!data.length || data.length > maxPaymentSlipBytes) return apiError(res, 400, "The payment slip must be 5 MB or smaller.");
    const result = await pool.query(
      `UPDATE temu_orders
       SET payment_slip_data = $1, payment_slip_mime = $2, payment_slip_uploaded_at = NOW()
       WHERE id = $3 AND customer_id = $4 AND status = 'awaiting_payment'
       RETURNING id`,
      [data, match[1], req.params.id, req.account.id]
    );
    if (!result.rowCount) return apiError(res, 404, "This payment request is no longer available.");
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/:id/payment-slip", requireAccount, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT o.payment_slip_data, o.payment_slip_mime, o.id, o.customer_id, a.role
       FROM temu_orders o CROSS JOIN accounts a
       WHERE o.id = $1 AND a.id = $2 AND o.payment_slip_data IS NOT NULL`,
      [req.params.id, req.account.id]
    );
    if (!result.rowCount) return apiError(res, 404, "Payment slip not found.");
    const row = result.rows[0];
    if (req.account.role !== "admin" && row.customer_id !== req.account.id) {
      return apiError(res, 403, "You don't have permission to view this payment slip.");
    }
    res.type(row.payment_slip_mime).attachment(`payment-slip-${row.id}`).send(row.payment_slip_data);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/accounts", requireAccount, requireRole("admin"), async (req, res, next) => {
  try {
    const status = req.query.status === "pending" ? "pending" : "approved";
    const result = await pool.query(
      `SELECT * FROM accounts WHERE status = $1 AND role <> 'admin' ORDER BY created_at ASC`,
      [status]
    );
    res.json({ accounts: result.rows.map(account => ({ ...publicAccount(account), createdAt: account.created_at.toISOString() })) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/accounts/:email", requireAccount, requireRole("admin"), async (req, res, next) => {
  try {
    const email = String(req.params.email).toLowerCase();
    const action = req.body?.action;
    if (action === "deny") {
      const result = await pool.query(
        "DELETE FROM accounts WHERE email = $1 AND status = 'pending' AND role <> 'admin' RETURNING id",
        [email]
      );
      if (!result.rowCount) return apiError(res, 404, "Pending account not found.");
      return res.json({ success: true });
    }
    if (action === "approve") {
      const result = await pool.query(
        "UPDATE accounts SET status = 'approved' WHERE email = $1 AND status = 'pending' AND role <> 'admin' RETURNING id",
        [email]
      );
      if (!result.rowCount) return apiError(res, 404, "Pending account not found.");
      return res.json({ success: true });
    }
    if (action === "revoke") {
      const result = await pool.query(
        "UPDATE accounts SET status = 'pending' WHERE email = $1 AND role <> 'admin' RETURNING id",
        [email]
      );
      if (!result.rowCount) return apiError(res, 404, "Account not found.");
      return res.json({ success: true });
    }
    if (action === "set-role") {
      const role = req.body?.role;
      const storeName = typeof req.body?.storeName === "string" ? req.body.storeName.trim() : "";
      if (!["customer", "store"].includes(role)) return apiError(res, 400, "Choose a valid account role.");
      if (role === "store" && (!storeName || storeName.length > 120)) return apiError(res, 400, "Enter a valid store name.");
      const result = await pool.query(
        `UPDATE accounts SET role = $1, store_name = $2
         WHERE email = $3 AND status = 'approved' AND role <> 'admin'
         RETURNING id`,
        [role, role === "store" ? storeName : "", email]
      );
      if (!result.rowCount) return apiError(res, 404, "Approved account not found.");
      return res.json({ success: true });
    }
    return apiError(res, 400, "Choose a valid account action.");
  } catch (error) {
    next(error);
  }
});

app.post("/api/products", requireAccount, requireRole("store"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const type = body.type;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category = typeof body.category === "string" ? body.category : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const price = Number(body.price);
    const images = body.images;
    const allowedCategories = type === "service" ? serviceCategories : categories;
    if (!["product", "service"].includes(type)) return apiError(res, 400, "Choose a valid listing type.");
    if (name.length < 2 || name.length > 160) return apiError(res, 400, "Listing name must be between 2 and 160 characters.");
    if (!Number.isFinite(price) || price <= 0 || price > 100000000) return apiError(res, 400, "Enter a valid listing price.");
    if (!allowedCategories.includes(category)) return apiError(res, 400, "Choose a valid listing category.");
    if (!description || description.length > 2000) return apiError(res, 400, "Enter listing details of 2,000 characters or fewer.");
    if (!Array.isArray(images) || images.length < 1 || images.length > 12) return apiError(res, 400, "Choose between 1 and 12 listing photos.");
    const validImages = images.map(parseImageDataUrl);
    if (validImages.some(image => !image) || validImages.reduce((sum, image) => sum + Buffer.byteLength(image), 0) > 22 * 1024 * 1024) {
      return apiError(res, 400, "Each photo must be a JPG, PNG, or WebP up to 2 MB; total photo data must be under 22 MB.");
    }
    const result = await pool.query(
      `INSERT INTO products (id, owner_id, type, name, price, category, images, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [randomUUID(), req.account.id, type, name, price, category, JSON.stringify(validImages), description]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/orders", requireAccount, requireRole("admin"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT o.*, a.name AS customer_name, a.email AS customer_email, a.phone, a.address
       FROM temu_orders o JOIN accounts a ON a.id = o.customer_id
       ORDER BY o.created_at DESC`
    );
    res.json({
      orders: result.rows.map(toOrder),
      usdToMvrRate,
      serviceFeePercent
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/orders/:id", requireAccount, requireRole("admin"), async (req, res, next) => {
  try {
    const action = req.body?.action;
    if (action === "delete") {
      const result = await pool.query("DELETE FROM temu_orders WHERE id = $1 RETURNING id", [req.params.id]);
      if (!result.rowCount) return apiError(res, 404, "Temu request not found.");
      return res.json({ success: true });
    }
    if (action === "send-quote") {
      const unitCents = Math.round(Number(req.body?.temuUnitPriceUsd) * 100);
      const instructions = typeof req.body?.paymentInstructions === "string" ? req.body.paymentInstructions.trim() : "";
      if (!Number.isInteger(unitCents) || unitCents < 1 || unitCents > 100000000) {
        return apiError(res, 400, "Enter a valid Temu price in USD.");
      }
      if (!instructions || instructions.length > 1000) return apiError(res, 400, "Enter payment instructions of up to 1,000 characters.");
      const orderResult = await pool.query(
        "SELECT quantity FROM temu_orders WHERE id = $1 AND status IN ('awaiting_review', 'awaiting_customer_approval', 'quote_declined')",
        [req.params.id]
      );
      if (!orderResult.rowCount) return apiError(res, 404, "This request can no longer be quoted.");
      const quantity = orderResult.rows[0].quantity;
        const quote = calculateQuote(unitCents / 100, quantity, usdToMvrRate, serviceFeePercent);
      const result = await pool.query(
        `UPDATE temu_orders SET status = 'awaiting_customer_approval',
          temu_unit_price_usd = $1, temu_amount_usd = $2, exchange_rate_mvr_per_usd = $3,
          base_amount_mvr = $4, service_fee_percent = $5, service_fee_mvr = $6,
          payment_amount_mvr = $7, payment_instructions = $8
         WHERE id = $9 RETURNING id`,
        [
          unitCents / 100,
          quote.temuAmountUsd,
          usdToMvrRate,
          quote.baseAmountMvr,
          serviceFeePercent,
          quote.serviceFeeMvr,
          quote.paymentAmountMvr,
          instructions,
          req.params.id
        ]
      );
      if (!result.rowCount) return apiError(res, 404, "Temu request not found.");
      return res.json({ success: true, notificationSent: false });
    }
    if (action === "mark-payment-received" || action === "mark-purchased") {
      const oldStatus = action === "mark-payment-received" ? "awaiting_payment" : "payment_received";
      const newStatus = action === "mark-payment-received" ? "payment_received" : "purchased";
      const result = await pool.query(
        "UPDATE temu_orders SET status = $1 WHERE id = $2 AND status = $3 RETURNING id",
        [newStatus, req.params.id, oldStatus]
      );
      if (!result.rowCount) return apiError(res, 404, "This request cannot be updated in its current state.");
      return res.json({ success: true });
    }
    return apiError(res, 400, "Choose a valid Temu request action.");
  } catch (error) {
    next(error);
  }
});

app.post("/api/password-reset/request", loginLimiter, async (req, res, next) => {
  try {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const appBaseUrl = process.env.APP_BASE_URL;
    if (!smtpHost || !smtpUser || !smtpPassword || !appBaseUrl) {
      return apiError(res, 503, "Password reset email is not configured. Contact the administrator.");
    }
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!validEmail(email)) return apiError(res, 400, "Enter a valid email address.");
    const result = await pool.query("SELECT id FROM accounts WHERE email = $1 AND status = 'approved'", [email]);
    if (result.rowCount) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await pool.query("DELETE FROM password_resets WHERE account_id = $1", [result.rows[0].id]);
      await pool.query(
        "INSERT INTO password_resets (token_hash, account_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        [tokenHash, result.rows[0].id]
      );
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: smtpUser, pass: smtpPassword }
      });
      const resetUrl = new URL("/", appBaseUrl);
      resetUrl.searchParams.set("reset", token);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || smtpUser,
        to: email,
        subject: "Reset your Gannaaneba password",
        text: `Use this link within one hour to reset your password: ${resetUrl.toString()}`
      });
    }
    res.json({ message: "If an approved account matches that email, a password reset link will be sent." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/password-reset/confirm", loginLimiter, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length < 8 || password.length > 200) return apiError(res, 400, "Password must be between 8 and 200 characters.");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const reset = await pool.query(
      "SELECT account_id FROM password_resets WHERE token_hash = $1 AND expires_at > NOW()",
      [tokenHash]
    );
    if (!reset.rowCount) return apiError(res, 400, "This reset link is invalid or has expired.");
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE accounts SET password_hash = $1 WHERE id = $2", [passwordHash, reset.rows[0].account_id]);
    await pool.query("DELETE FROM password_resets WHERE account_id = $1", [reset.rows[0].account_id]);
    await pool.query(
      "DELETE FROM user_sessions WHERE sess->>'userId' = $1",
      [reset.rows[0].account_id]
    );
    res.json({ message: "Your password has been updated. You can now sign in." });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_req, res) => apiError(res, 404, "API endpoint not found."));
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") return apiError(res, 413, "Request is too large.");
  console.error("Request failed:", error);
  if (res.headersSent) return;
  apiError(res, 500, "The server couldn't complete the request.");
});

await initializeDatabase();
app.listen(port, "0.0.0.0", () => {
  console.log(`Gannaaneba server listening on port ${port}.`);
});
