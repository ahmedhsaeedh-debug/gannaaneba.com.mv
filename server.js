"use strict";

const http = require("node:http");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const nodemailer = require("nodemailer");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const dataDirectory = path.join(root, "data");
const dataFile = path.join(dataDirectory, "marketplace.json");
const sessionCookie = "gannaaneba_session";
const sessionLifetime = 12 * 60 * 60 * 1000;
const passwordResetLifetime = 30 * 60 * 1000;
const passwordResetRateLimit = 5;
const passwordResetRateWindow = 15 * 60 * 1000;
const categories = ["Home & Living", "Fashion", "Art & Craft", "Food"];
const serviceCategories = ["Home Services", "Repairs & Maintenance", "Beauty & Wellness", "Lessons & Coaching", "Events", "Professional Services", "Other Services"];
const maxListingPhotos = 12;
const maxPhotoBytes = 2 * 1024 * 1024;
const maxTotalPhotoBytes = 16 * 1024 * 1024;
const maxPaymentSlipBytes = 5 * 1024 * 1024;
const usdToMvrRate = 15.42;
const temuServiceFeePercent = 20;
const bankAccountName = "Ahmed Saeed";
const bankAccountNumber = "7725530012101";
const sessions = new Map();
const passwordResetRequests = new Map();
let stateQueue = Promise.resolve();
let adminConfig;
let resetMailTransport;
let resetMailConfig;
const defaultAdminEmail = "ahmedhsaeedh@gmail.com";
const defaultProducts = [
  { id: "p1", name: "Handwoven Market Basket", store: "Little Loom Studio", category: "Home & Living", price: 34, oldPrice: 42, rating: "4.9", badge: "Bestseller", image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=700&q=80", description: "A durable, beautifully handwoven basket made for market mornings and everyday adventures." },
  { id: "p2", name: "The Everyday Ceramic Mug", store: "Clay & Kind", category: "Home & Living", price: 28, rating: "4.8", badge: "Made by hand", image: "https://images.unsplash.com/photo-1577937927133-66ef06acdf18?auto=format&fit=crop&w=700&q=80", description: "A handmade stoneware mug with a soft glaze and a shape that feels just right in your hands." },
  { id: "p3", name: "Sunday Linen Shirt", store: "Good Day Goods", category: "Fashion", price: 68, rating: "5.0", badge: "Small batch", image: "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=700&q=80", description: "Relaxed, breathable linen for slow mornings, sunny afternoons, and everything between." },
  { id: "p4", name: "Wildflower Art Print", store: "Paper Meadow", category: "Art & Craft", price: 24, oldPrice: 30, rating: "4.9", badge: "Customer favorite", image: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=700&q=80", description: "A cheerful fine-art print inspired by a wildflower meadow in bloom. Printed on archival paper." },
  { id: "p5", name: "Soft Knit Weekend Tote", store: "Thread & Timber", category: "Fashion", price: 46, rating: "4.7", badge: "New arrival", image: "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=700&q=80", description: "An easy carryall, thoughtfully made with a textured, soft knit and sturdy handles." },
  { id: "p6", name: "Small Batch Morning Honey", store: "Golden Field Apiary", category: "Food", price: 16, rating: "4.9", badge: "Locally made", image: "https://images.unsplash.com/photo-1587049352851-8d4e89133924?auto=format&fit=crop&w=700&q=80", description: "Golden, raw honey gathered in small batches from a family-run neighborhood apiary." },
  { id: "p7", name: "Sculptural Stoneware Vase", store: "Clay & Kind", category: "Home & Living", price: 52, rating: "4.8", badge: "Made by hand", image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=700&q=80", description: "A quietly striking, hand-finished vase that looks lovely with fresh blooms or all on its own." },
  { id: "p8", name: "Little Book of Slow Days", store: "Paper Meadow", category: "Art & Craft", price: 19, rating: "4.8", badge: "A good read", image: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=700&q=80", description: "A pocket-sized collection of prompts and gentle ideas for making more room in your day." }
];
const defaultProductPhotos = {
  p1: ["https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=1000&q=85"],
  p2: ["https://images.unsplash.com/photo-1577937927133-66ef06acdf18?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1000&q=85"],
  p3: ["https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=1000&q=85"],
  p4: ["https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?auto=format&fit=crop&w=1000&q=85"],
  p5: ["https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1000&q=85"],
  p6: ["https://images.unsplash.com/photo-1587049352851-8d4e89133924?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1471943311424-646960669fbc?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?auto=format&fit=crop&w=1000&q=85"],
  p7: ["https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=1000&q=85"],
  p8: ["https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=1000&q=85"]
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function publicUser(user, role = user.role) {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    address: user.address || "",
    role,
    storeName: role === "store" ? user.storeName || "" : "",
    status: user.status || "approved"
  };
}

function addBankDetails(order) {
  return order.paymentAmountMvr
    ? { ...order, bankAccountName, bankAccountNumber }
    : order;
}

async function readState() {
  try {
    const state = JSON.parse(await fs.readFile(dataFile, "utf8"));
    if (!Array.isArray(state.orders)) state.orders = [];
    if (!Array.isArray(state.passwordResets)) state.passwordResets = [];
    state.products = state.products.map(product => ({
      ...product,
      images: Array.isArray(product.images) && product.images.length
        ? product.images
        : defaultProductPhotos[product.id] || [product.image]
    }));
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { users: [], products: defaultProducts.map(product => ({ ...product, images: defaultProductPhotos[product.id] || [product.image] })) };
  }
}

async function writeState(state) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(temporaryFile, dataFile);
}

function updateState(update) {
  const operation = stateQueue.then(async () => {
    const state = await readState();
    const result = await update(state);
    await writeState(state);
    return result;
  });
  stateQueue = operation.catch(() => undefined);
  return operation;
}

async function readAdmin() {
  if (adminConfig) return adminConfig;
  const email = String(process.env.GANNAANEBA_ADMIN_EMAIL || defaultAdminEmail).trim().toLowerCase();
  const password = process.env.GANNAANEBA_ADMIN_PASSWORD;
  if (!password) throw new Error("Set GANNAANEBA_ADMIN_PASSWORD before starting the server.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("GANNAANEBA_ADMIN_EMAIL must be a valid email address.");
  if (password.length < 12) throw new Error("The administrator password must contain at least 12 characters.");
  const salt = crypto.randomBytes(16);
  const passwordHash = await scrypt(password, salt, 64);
  delete process.env.GANNAANEBA_ADMIN_PASSWORD;
  adminConfig = { email, passwordSalt: salt.toString("hex"), passwordHash: passwordHash.toString("hex") };
  return adminConfig;
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isTemuUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { return false; }
  return url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password &&
    (url.hostname === "temu.com" || url.hostname.endsWith(".temu.com") || url.hostname === "temu.to");
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function tagAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? decodeHtml(match[1] || match[2] || match[3] || "") : "";
}

function parsePrice(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 40) return null;
  const numeric = text.replace(/[^\d.,]/g, "");
  if (!numeric || !/\d/.test(numeric)) return null;
  let normalized = numeric;
  if (numeric.includes(",") && numeric.includes(".")) {
    normalized = numeric.lastIndexOf(",") > numeric.lastIndexOf(".")
      ? numeric.replace(/\./g, "").replace(",", ".")
      : numeric.replace(/,/g, "");
  } else if (numeric.includes(",")) {
    normalized = /,\d{3}$/.test(numeric) ? numeric.replace(/,/g, "") : numeric.replace(",", ".");
  }
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 && price <= 1000000 ? price : null;
}

function readProductPrice(html) {
  const metadata = new Map();
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const key = tagAttribute(tag, "property") || tagAttribute(tag, "name");
    const content = tagAttribute(tag, "content");
    if (key && content) metadata.set(key.toLowerCase(), content);
  }
  const productName = metadata.get("og:title") || metadata.get("twitter:title") || "";

  const priceKeys = ["product:price:amount", "og:price:amount", "price"];
  const currencyKeys = ["product:price:currency", "og:price:currency", "pricecurrency"];
  let rawPrice = null;
  let currency = null;
  for (const key of priceKeys) {
    rawPrice = metadata.get(key);
    if (rawPrice) break;
  }
  for (const key of currencyKeys) {
    currency = metadata.get(key);
    if (currency) break;
  }

  if (!rawPrice) {
    const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const script of scripts) {
      const start = script.indexOf(">") + 1;
      const end = script.toLowerCase().lastIndexOf("</script>");
      try {
        const parsed = JSON.parse(script.slice(start, end));
        const pending = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (pending.length && !rawPrice) {
          const item = pending.pop();
          if (!item || typeof item !== "object") continue;
          if (Array.isArray(item)) {
            pending.push(...item);
            continue;
          }
          if (item["@graph"]) pending.push(item["@graph"]);
          if (item.offers) pending.push(item.offers);
          if (Array.isArray(item)) pending.push(...item);
          if (item.price !== undefined) {
            rawPrice = String(item.price);
            currency = currency || item.priceCurrency || "";
          }
        }
      } catch {
        continue;
      }
    }
  }

  const amount = parsePrice(rawPrice);
  if (!amount) return null;
  currency = String(currency || "").trim().toUpperCase();
  if (!currency && /(?:US\$|\bUSD\b)/i.test(String(rawPrice))) currency = "USD";
  if (!currency && /(?:MVR|Rf\.?)/i.test(String(rawPrice))) currency = "MVR";
  if (!currency && /[$]/.test(String(rawPrice))) currency = "USD";
  if (!["USD", "MVR"].includes(currency)) return { currency: currency || null };

  const conversionRate = currency === "USD" ? usdToMvrRate : 1;
  const priceMvr = Math.round(amount * conversionRate * 100) / 100;
  return {
    sourcePrice: amount,
    sourceCurrency: currency,
    conversionRate,
    priceMvr,
    productName: decodeHtml(productName).slice(0, 160)
  };
}

async function readLimitedText(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "Temu did not return a readable product page.");
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new HttpError(502, "The Temu product page is too large to inspect.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchTemuPrice(value) {
  if (!isTemuUrl(value)) throw new HttpError(400, "Enter a secure product link from temu.com or temu.to.");
  let currentUrl = new URL(value);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
    let response;
    try {
      response = await fetch(currentUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        },
        redirect: "manual",
        signal: AbortSignal.timeout(12000)
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new HttpError(504, "Temu took too long to respond. Enter the price manually and try again.");
      }
      throw new HttpError(502, "Temu couldn't be reached. Enter the price manually and try again.");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new HttpError(502, "Temu redirected without a product page.");
      const nextUrl = new URL(location, currentUrl);
      if (!isTemuUrl(nextUrl.href)) throw new HttpError(400, "The Temu link redirects to a site we can't inspect.");
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new HttpError(502, "Temu blocked automatic price lookup. Enter the price shown on Temu manually.");
      }
      throw new HttpError(502, "Temu couldn't load that product page. Check the link or enter the price manually.");
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new HttpError(502, "That Temu link didn't return a product page. Enter the price manually.");
    }
    const html = await readLimitedText(response, 3 * 1024 * 1024);
    const price = readProductPrice(html);
    if (!price) throw new HttpError(422, "Temu didn't expose a readable price for that item. Enter the price shown on Temu manually.");
    if (!price.priceMvr) {
      throw new HttpError(422, `Temu showed a price in ${price.currency || "an unsupported currency"}. Enter its price in MVR manually.`);
    }
    return price;
  }
  throw new HttpError(502, "Temu redirected too many times. Enter the price manually.");
}

async function verifyPassword(password, salt, hash) {
  const actual = await scrypt(password, Buffer.from(salt, "hex"), 64);
  return safeEqual(actual.toString("hex"), hash);
}

async function readBody(request, maxBytes = 32 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new HttpError(413, "Request is too large.");
    chunks.push(chunk);
  }
  if (!bytes) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}

async function saveListingPhotos(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maxListingPhotos) {
    throw new HttpError(400, `Add between 1 and ${maxListingPhotos} photos.`);
  }
  const uploadsDirectory = path.join(dataDirectory, "uploads");
  await fs.mkdir(uploadsDirectory, { recursive: true });
  const saved = [];
  let totalBytes = 0;
  try {
    for (const value of values) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value));
      if (!match) throw new HttpError(400, "Upload JPG, PNG, or WebP photos from your device.");
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > maxPhotoBytes) throw new HttpError(413, "Each photo must be 2 MB or smaller.");
      totalBytes += bytes.length;
      if (totalBytes > maxTotalPhotoBytes) throw new HttpError(413, "The combined photo size must be 16 MB or smaller.");
      const isJpeg = match[1] === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isPng = match[1] === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isWebp = match[1] === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      if (!isJpeg && !isPng && !isWebp) throw new HttpError(400, "A photo's file type doesn't match its image data.");
      const extension = match[1] === "image/jpeg" ? "jpg" : match[1] === "image/png" ? "png" : "webp";
      const filename = `${crypto.randomUUID()}.${extension}`;
      await fs.writeFile(path.join(uploadsDirectory, filename), bytes, { flag: "wx", mode: 0o600 });
      saved.push(`/uploads/${filename}`);
    }
    return saved;
  } catch (error) {
    await Promise.all(saved.map(image => fs.unlink(path.join(uploadsDirectory, path.basename(image))).catch(() => undefined)));
    throw error;
  }
}

async function savePaymentSlip(value) {
  const match = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!match) throw new HttpError(400, "Upload a PDF, JPG, PNG, or WebP payment slip.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxPaymentSlipBytes) {
    throw new HttpError(413, "The payment slip must be 5 MB or smaller.");
  }
  if (bytes.toString("base64") !== match[2]) throw new HttpError(400, "The payment slip data is invalid.");
  const contentType = match[1];
  const isPdf = contentType === "application/pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const isJpeg = contentType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = contentType === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = contentType === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!isPdf && !isJpeg && !isPng && !isWebp) {
    throw new HttpError(400, "The payment slip file type doesn't match its data.");
  }
  const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
  const filename = `${crypto.randomUUID()}.${extension}`;
  const uploadsDirectory = path.join(dataDirectory, "payment-slips");
  await fs.mkdir(uploadsDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadsDirectory, filename), bytes, { flag: "wx", mode: 0o600 });
  return { filename, contentType, sizeBytes: bytes.length, uploadedAt: new Date().toISOString() };
}

async function removePaymentSlip(paymentSlip) {
  if (!paymentSlip || !/^[\da-f-]{36}\.(?:pdf|jpg|png|webp)$/i.test(paymentSlip.filename || "")) return;
  try {
    await fs.unlink(path.join(dataDirectory, "payment-slips", paymentSlip.filename));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function send(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function getSession(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(sessionCookie + "="));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice(sessionCookie.length + 1));
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

async function requireUser(request) {
  const session = getSession(request);
  if (!session) throw new HttpError(401, "Please sign in to continue.");
  if (session.isAdmin) return { ...session, role: "admin", name: "Administrator" };
  const state = await readState();
  const user = state.users.find(item => item.email === session.email);
  if (!user || user.status !== "approved") throw new HttpError(401, "This account no longer has access.");
  return { ...publicUser(user), token: session.token };
}

function requireAdmin(user) {
  if (user.role !== "admin") throw new HttpError(403, "Administrator access is required.");
}

function validateRegistration(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  const role = body.role;
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  const storeName = String(body.storeName || "").trim();
  const about = String(body.about || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (name.length < 2 || name.length > 120) throw new HttpError(400, "Enter your full name.");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "Password must be at least 8 characters.");
  if (!["customer", "store"].includes(role)) throw new HttpError(400, "Choose a customer or store owner account.");
  if (!phone || phone.length > 40 || !address || address.length > 500) throw new HttpError(400, "Phone number and address are required.");
  if (role === "store" && (!storeName || storeName.length > 120)) throw new HttpError(400, "Enter a valid store name.");
  if (about.length > 500) throw new HttpError(400, "Store description must be 500 characters or less.");
  return { email, name, password, role, phone, address, storeName, about };
}

function enforcePasswordResetRateLimit(request) {
  const now = Date.now();
  for (const [ip, entry] of passwordResetRequests) {
    if (entry.resetAt <= now) passwordResetRequests.delete(ip);
  }
  const ip = request.socket.remoteAddress || "unknown";
  const entry = passwordResetRequests.get(ip);
  if (entry && entry.count >= passwordResetRateLimit) {
    throw new HttpError(429, "Too many reset requests. Please try again later.");
  }
  passwordResetRequests.set(ip, entry
    ? { count: entry.count + 1, resetAt: entry.resetAt }
    : { count: 1, resetAt: now + passwordResetRateWindow });
}

function getPasswordResetMailer() {
  const host = String(process.env.GANNAANEBA_SMTP_HOST || "").trim();
  const user = String(process.env.GANNAANEBA_SMTP_USER || "").trim();
  const password = String(process.env.GANNAANEBA_SMTP_PASSWORD || "");
  if (!host && !user && !password) return null;
  if (!host || !user || !password) {
    throw new HttpError(503, "Password reset email is not fully configured. Please contact the administrator.");
  }
  const port = Number(process.env.GANNAANEBA_SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(503, "Password reset email has an invalid SMTP port. Please contact the administrator.");
  }
  const baseUrl = String(process.env.GANNAANEBA_BASE_URL || `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3000}`);
  let parsedBaseUrl;
  try { parsedBaseUrl = new URL(baseUrl); }
  catch { throw new HttpError(503, "Password reset email has an invalid website URL. Please contact the administrator."); }
  const localHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (!["https:", "http:"].includes(parsedBaseUrl.protocol) ||
      parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash ||
      parsedBaseUrl.pathname !== "/" ||
      (parsedBaseUrl.protocol !== "https:" && !localHosts.includes(parsedBaseUrl.hostname))) {
    throw new HttpError(503, "Password reset links require a valid HTTPS website URL. Please contact the administrator.");
  }
  if (!resetMailTransport) {
    resetMailTransport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass: password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      tls: { minVersion: "TLSv1.2" }
    });
    resetMailConfig = { from: String(process.env.GANNAANEBA_SMTP_FROM || user).trim(), baseUrl: parsedBaseUrl.origin };
  }
  return { transport: resetMailTransport, ...resetMailConfig };
}

async function sendQuoteNotification(order) {
  let mailer;
  try { mailer = getPasswordResetMailer(); }
  catch (error) {
    console.error("Could not configure Temu quote email notification.", error.message);
    return false;
  }
  if (!mailer) return false;
  try {
    await mailer.transport.sendMail({
      from: mailer.from,
      to: order.customerEmail,
      subject: "Your Gannaaneba Temu quote is ready",
      text: `Hello ${order.customerName},\n\nThe administrator has prepared a quote for your Temu request: ${order.name}.\n\nTemu price: $${order.temuUnitPriceUsd.toFixed(2)} per item × ${order.quantity} = $${order.temuAmountUsd.toFixed(2)} USD\nExchange rate: 1 USD = MVR ${order.exchangeRateMvrPerUsd.toFixed(2)}\nConverted subtotal: MVR ${order.baseAmountMvr.toFixed(2)}\nService fee (${order.serviceFeePercent}%): MVR ${order.serviceFeeMvr.toFixed(2)}\nTotal for your approval: MVR ${order.paymentAmountMvr.toFixed(2)}\n\nPayment instructions:\n${order.paymentInstructions}\n\nBank account name: ${bankAccountName}\nBank account number: ${bankAccountNumber}\n\nSign in at ${mailer.baseUrl} and open your account to approve or decline this quote. Do not pay until you approve the total.`
    });
    return true;
  } catch (error) {
    console.error("Could not send Temu quote email notification.", error.code || "SMTP delivery failed");
    return false;
  }
}

async function route(request, response) {
  const url = new URL(request.url, "http://localhost");
  const method = request.method;

  if (method === "GET" && url.pathname === "/") {
    const html = await fs.readFile(path.join(root, "index.html"));
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY"
    });
    response.end(html);
    return;
  }
  if (method === "GET" && url.pathname.startsWith("/uploads/")) {
    const filename = url.pathname.slice("/uploads/".length);
    if (!/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(filename)) throw new HttpError(404, "Photo not found.");
    const imagePath = path.join(dataDirectory, "uploads", filename);
    let image;
    try { image = await fs.readFile(imagePath); }
    catch (error) { if (error.code === "ENOENT") throw new HttpError(404, "Photo not found."); throw error; }
    const contentType = filename.endsWith(".jpg") ? "image/jpeg" : filename.endsWith(".png") ? "image/png" : "image/webp";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(image);
    return;
  }
  const paymentSlipRoute = /^\/api\/orders\/([^/]+)\/payment-slip$/.exec(url.pathname);
  if (paymentSlipRoute && method === "GET") {
    const user = await requireUser(request);
    let orderId;
    try { orderId = decodeURIComponent(paymentSlipRoute[1]); }
    catch { throw new HttpError(400, "Temu request not found."); }
    const state = await readState();
    const order = (state.orders || []).find(item => item.id === orderId);
    if (!order || (user.role !== "admin" && order.customerEmail !== user.email)) {
      throw new HttpError(404, "Payment slip not found.");
    }
    if (!order.paymentSlip || !/^[\da-f-]{36}\.(?:pdf|jpg|png|webp)$/i.test(order.paymentSlip.filename || "")) {
      throw new HttpError(404, "Payment slip not found.");
    }
    let file;
    try { file = await fs.readFile(path.join(dataDirectory, "payment-slips", order.paymentSlip.filename)); }
    catch (error) { if (error.code === "ENOENT") throw new HttpError(404, "Payment slip not found."); throw error; }
    const extension = order.paymentSlip.filename.split(".").pop().toLowerCase();
    response.writeHead(200, {
      "Content-Type": order.paymentSlip.contentType,
      "Content-Length": file.length,
      "Content-Disposition": `attachment; filename="payment-slip.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    response.end(file);
    return;
  }
  if (paymentSlipRoute && method === "POST") {
    const user = await requireUser(request);
    if (user.role !== "customer") throw new HttpError(403, "A customer account is required to upload a payment slip.");
    let orderId;
    try { orderId = decodeURIComponent(paymentSlipRoute[1]); }
    catch { throw new HttpError(400, "Temu request not found."); }
    const state = await readState();
    const order = (state.orders || []).find(item => item.id === orderId && item.customerEmail === user.email);
    if (!order) throw new HttpError(404, "Temu request not found.");
    if (order.status !== "awaiting_payment") throw new HttpError(409, "Approve the quote before uploading a payment slip.");
    const body = await readBody(request, 7 * 1024 * 1024);
    const paymentSlip = await savePaymentSlip(body.paymentSlip);
    let previousPaymentSlip;
    let updatedOrder;
    try {
      updatedOrder = await updateState(currentState => {
        const current = (currentState.orders || []).find(item => item.id === orderId && item.customerEmail === user.email);
        if (!current) throw new HttpError(404, "Temu request not found.");
        if (current.status !== "awaiting_payment") throw new HttpError(409, "Approve the quote before uploading a payment slip.");
        previousPaymentSlip = current.paymentSlip;
        current.paymentSlip = paymentSlip;
        return current;
      });
    } catch (error) {
      try { await removePaymentSlip(paymentSlip); }
      catch (cleanupError) { console.error("Could not remove an unsaved payment slip.", cleanupError.message); }
      throw error;
    }
    if (previousPaymentSlip) {
      try { await removePaymentSlip(previousPaymentSlip); }
      catch (error) { console.error("Could not remove a replaced payment slip.", error.message); }
    }
    send(response, 200, { order: updatedOrder });
    return;
  }
  if (method === "GET" && url.pathname === "/api/products") {
    const state = await readState();
    const type = url.searchParams.get("type");
    if (type && !["product", "service"].includes(type)) throw new HttpError(400, "Choose products or services.");
    send(response, 200, { products: state.products.filter(item => !type || (item.type || "product") === type) });
    return;
  }
  if (method === "GET" && url.pathname === "/api/temu/price") {
    const productUrl = String(url.searchParams.get("url") || "").trim();
    const price = await fetchTemuPrice(productUrl);
    send(response, 200, price);
    return;
  }
  if (method === "GET" && url.pathname === "/api/stores") {
    const name = String(url.searchParams.get("name") || "").trim();
    if (!name || name.length > 120) throw new HttpError(400, "A valid store name is required.");
    const state = await readState();
    const storeOwner = state.users.find(user => user.status === "approved" && user.role === "store" && user.storeName.toLowerCase() === name.toLowerCase());
    const storeProducts = state.products.filter(product => storeOwner
      ? product.ownerEmail === storeOwner.email
      : product.store.toLowerCase() === name.toLowerCase());
    if (!storeProducts.length) throw new HttpError(404, "This store has no available products.");
    send(response, 200, {
      store: {
        name: storeOwner?.storeName || storeProducts[0].store,
        owner: storeOwner?.name || "",
        email: storeOwner?.email || "",
        phone: storeOwner?.phone || "",
        address: storeOwner?.address || "",
        about: storeOwner?.about || "An independent shop sharing thoughtfully selected finds on Gannaaneba.",
        productCount: storeProducts.length,
        categories: [...new Set(storeProducts.map(product => product.category))]
      },
      products: storeProducts
    });
    return;
  }
  if (method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(request);
    const input = validateRegistration(body);
    const admin = await readAdmin();
    if (input.email === admin.email) throw new HttpError(409, "That email is reserved for the administrator.");
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(input.password, salt, 64);
    await updateState(state => {
      if (state.users.some(user => user.email === input.email)) throw new HttpError(409, "An account with this email already exists.");
      state.users.push({
        name: input.name,
        email: input.email,
        passwordSalt: salt.toString("hex"),
        passwordHash: hash.toString("hex"),
        role: input.role,
        phone: input.phone,
        address: input.address,
        storeName: input.storeName,
        about: input.about,
        status: input.role === "customer" ? "approved" : "pending",
        createdAt: new Date().toISOString()
      });
    });
    send(response, 201, {
      message: input.role === "customer"
        ? "Customer account created."
        : "Registration request submitted. An administrator must approve your account."
    });
    return;
  }
  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const admin = await readAdmin();
    let principal;
    if (email === admin.email && await verifyPassword(password, admin.passwordSalt, admin.passwordHash)) {
      principal = { email, isAdmin: true };
    } else {
      const state = await readState();
      const user = state.users.find(item => item.email === email);
      if (!user || !await verifyPassword(password, user.passwordSalt, user.passwordHash)) throw new HttpError(401, "Email or password is incorrect.");
      if (user.status !== "approved") throw new HttpError(403, "Your account is awaiting administrator approval.");
      principal = { email, isAdmin: false };
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { ...principal, expiresAt: Date.now() + sessionLifetime });
    const cookieOptions = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime / 1000}`;
    response.setHeader("Set-Cookie", `${sessionCookie}=${token}; ${cookieOptions}`);
    const account = principal.isAdmin
      ? { name: "Administrator", email, role: "admin", status: "approved" }
      : publicUser((await readState()).users.find(item => item.email === email));
    send(response, 200, { user: account });
    return;
  }
  if (method === "POST" && url.pathname === "/api/password-reset/request") {
    enforcePasswordResetRateLimit(request);
    const body = await readBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new HttpError(400, "Enter a valid email address.");
    }
    const mailer = getPasswordResetMailer();
    if (!mailer) throw new HttpError(503, "Password reset email is not configured. Please contact the administrator.");
    const state = await readState();
    const account = state.users.find(user => user.email === email);
    if (account && email !== adminConfig.email) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const now = Date.now();
      await updateState(current => {
        if (!Array.isArray(current.passwordResets)) current.passwordResets = [];
        current.passwordResets = current.passwordResets.filter(reset => reset.email !== email && reset.expiresAt > now);
        current.passwordResets.push({ email, tokenHash, expiresAt: now + passwordResetLifetime });
      });
      const resetUrl = new URL(mailer.baseUrl);
      resetUrl.searchParams.set("reset", token);
      try {
        await mailer.transport.sendMail({
          from: mailer.from,
          to: email,
          subject: "Reset your Gannaaneba password",
          text: `We received a request to reset your Gannaaneba password. Use this link within 30 minutes:\n\n${resetUrl.href}\n\nIf you didn't request this, you can ignore this email.`,
          html: `<p>We received a request to reset your Gannaaneba password.</p><p><a href="${resetUrl.href}">Reset your password</a></p><p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`
        });
      } catch (error) {
        try {
          await updateState(current => {
            current.passwordResets = (current.passwordResets || []).filter(reset => reset.tokenHash !== tokenHash);
          });
        } catch (cleanupError) {
          console.error("Could not revoke an undelivered password-reset link.", cleanupError.message);
        }
        console.error("Could not send password-reset email.", error.code || "SMTP delivery failed");
        throw new HttpError(503, "We couldn't send a reset email right now. Please try again later.");
      }
    }
    send(response, 200, { message: "If an account with that email exists, a password reset link has been sent." });
    return;
  }
  if (method === "POST" && url.pathname === "/api/password-reset/confirm") {
    const body = await readBody(request);
    const token = String(body.token || "");
    const password = String(body.password || "");
    if (!/^[\da-f]{64}$/i.test(token)) throw new HttpError(400, "This password reset link is invalid or has expired.");
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "Password must be between 8 and 200 characters.");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const email = await updateState(async state => {
      const now = Date.now();
      const resetIndex = (state.passwordResets || []).findIndex(reset => reset.tokenHash === tokenHash && reset.expiresAt > now);
      if (resetIndex < 0) throw new HttpError(400, "This password reset link is invalid or has expired.");
      const reset = state.passwordResets[resetIndex];
      const account = state.users.find(user => user.email === reset.email);
      if (!account) throw new HttpError(400, "This password reset link is invalid or has expired.");
      const salt = crypto.randomBytes(16);
      const hash = await scrypt(password, salt, 64);
      account.passwordSalt = salt.toString("hex");
      account.passwordHash = hash.toString("hex");
      state.passwordResets = state.passwordResets.filter(item => item.tokenHash !== tokenHash && item.expiresAt > now);
      return account.email;
    });
    for (const [sessionToken, session] of sessions) {
      if (session.email === email) sessions.delete(sessionToken);
    }
    send(response, 200, { message: "Your password has been reset. Please sign in with your new password." });
    return;
  }
  if (method === "POST" && url.pathname === "/api/logout") {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    send(response, 200, { message: "Signed out." }, { "Set-Cookie": `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
    return;
  }
  if (method === "GET" && url.pathname === "/api/me") {
    const user = await requireUser(request);
    send(response, 200, { user: publicUser(user, user.role) });
    return;
  }
  if (url.pathname === "/api/orders" && method === "GET") {
    const user = await requireUser(request);
    if (user.role !== "customer") throw new HttpError(403, "A customer account is required to view purchase requests.");
    const state = await readState();
    const orders = (state.orders || []).filter(order => order.customerEmail === user.email).map(addBankDetails);
    send(response, 200, { orders: orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt)) });
    return;
  }
  if (url.pathname === "/api/orders" && method === "POST") {
    const user = await requireUser(request);
    if (user.role !== "customer") throw new HttpError(403, "A customer account is required to submit a purchase request.");
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    const temuUrl = String(body.temuUrl || "").trim();
    const quantity = Number(body.quantity);
    let parsedUrl;
    try { parsedUrl = new URL(temuUrl); }
    catch { throw new HttpError(400, "Enter a valid Temu product link."); }
    if (!isTemuUrl(temuUrl)) throw new HttpError(400, "Use a secure product link from temu.com or temu.to.");
    if (name.length < 2 || name.length > 160) throw new HttpError(400, "Enter a product name.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new HttpError(400, "Choose a quantity between 1 and 20.");
    const order = {
      id: crypto.randomUUID(),
      customerEmail: user.email,
      customerName: user.name,
      phone: user.phone,
      address: user.address,
      name,
      temuUrl,
      quantity,
      status: "awaiting_review",
      createdAt: new Date().toISOString()
    };
    await updateState(state => {
      if (!Array.isArray(state.orders)) state.orders = [];
      state.orders.push(order);
    });
    send(response, 201, { order });
    return;
  }
  if (url.pathname.startsWith("/api/orders/") && method === "POST") {
    const user = await requireUser(request);
    if (user.role !== "customer") throw new HttpError(403, "A customer account is required to approve a Temu quote.");
    const orderId = decodeURIComponent(url.pathname.slice("/api/orders/".length));
    const body = await readBody(request);
    const action = String(body.action || "");
    if (!["approve-quote", "decline-quote"].includes(action)) throw new HttpError(400, "Choose whether to approve or decline this quote.");
    const order = await updateState(state => {
      const current = (state.orders || []).find(item => item.id === orderId && item.customerEmail === user.email);
      if (!current) throw new HttpError(404, "Temu request not found.");
      if (current.status !== "awaiting_customer_approval") throw new HttpError(409, "This quote is no longer waiting for your decision.");
      if (action === "approve-quote") {
        current.status = "awaiting_payment";
        current.quoteApprovedAt = new Date().toISOString();
      } else {
        current.status = "quote_declined";
        current.quoteDeclinedAt = new Date().toISOString();
      }
      return current;
    });
    send(response, 200, { order });
    return;
  }
  if (url.pathname === "/api/admin/orders" && method === "GET") {
    const user = await requireUser(request);
    requireAdmin(user);
    const state = await readState();
    const orders = Array.isArray(state.orders) ? state.orders : [];
    send(response, 200, {
      orders: orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(addBankDetails),
      usdToMvrRate,
      serviceFeePercent: temuServiceFeePercent
    });
    return;
  }
  if (url.pathname.startsWith("/api/admin/orders/") && method === "POST") {
    const user = await requireUser(request);
    requireAdmin(user);
    const orderId = decodeURIComponent(url.pathname.slice("/api/admin/orders/".length));
    const body = await readBody(request);
    const action = String(body.action || "");
    if (action === "delete") {
      const order = await updateState(state => {
        const orderIndex = (state.orders || []).findIndex(item => item.id === orderId);
        if (orderIndex < 0) throw new HttpError(404, "Temu request not found.");
        return state.orders.splice(orderIndex, 1)[0];
      });
      if (order.paymentSlip) {
        try { await removePaymentSlip(order.paymentSlip); }
        catch (error) { console.error("Could not remove the payment slip for a deleted request.", error.message); }
      }
      send(response, 200, { order });
      return;
    }
    let temuUnitPriceUsd;
    let paymentInstructions;
    if (action === "send-quote") {
      temuUnitPriceUsd = Number(body.temuUnitPriceUsd);
      paymentInstructions = String(body.paymentInstructions || "").trim();
      if (!Number.isFinite(temuUnitPriceUsd) || temuUnitPriceUsd <= 0 || temuUnitPriceUsd > 1000000 ||
          Math.abs(Math.round(temuUnitPriceUsd * 100) - temuUnitPriceUsd * 100) > 1e-7) {
        throw new HttpError(400, "Enter a valid Temu unit price in USD with no more than two decimal places.");
      }
      if (paymentInstructions.length < 2 || paymentInstructions.length > 1000) {
        throw new HttpError(400, "Enter payment instructions between 2 and 1000 characters.");
      }
    }
    const order = await updateState(state => {
      const current = (state.orders || []).find(item => item.id === orderId);
      if (!current) throw new HttpError(404, "Temu request not found.");
      if (action === "send-quote" && ["awaiting_review", "awaiting_customer_approval", "quote_declined"].includes(current.status)) {
        const totalUsdCents = Math.round(temuUnitPriceUsd * 100) * current.quantity;
        const baseAmountMvrCents = Math.round(totalUsdCents * usdToMvrRate);
        const serviceFeeMvrCents = Math.round(baseAmountMvrCents * temuServiceFeePercent / 100);
        const paymentAmountMvrCents = baseAmountMvrCents + serviceFeeMvrCents;
        if (paymentAmountMvrCents <= 0 || paymentAmountMvrCents > 100000000) {
          throw new HttpError(400, "The converted quote must be no more than MVR 1,000,000.");
        }
        current.temuUnitPriceUsd = Math.round(temuUnitPriceUsd * 100) / 100;
        current.temuAmountUsd = totalUsdCents / 100;
        current.exchangeRateMvrPerUsd = usdToMvrRate;
        current.baseAmountMvr = baseAmountMvrCents / 100;
        current.serviceFeePercent = temuServiceFeePercent;
        current.serviceFeeMvr = serviceFeeMvrCents / 100;
        current.paymentAmountMvr = paymentAmountMvrCents / 100;
        current.paymentInstructions = paymentInstructions;
        current.paymentRequestedAt = new Date().toISOString();
        current.status = "awaiting_customer_approval";
      } else if (action === "mark-payment-received" && current.status === "awaiting_payment") {
        current.paymentReceivedAt = new Date().toISOString();
        current.status = "payment_received";
      } else if (action === "mark-purchased" && current.status === "payment_received") {
        current.purchasedAt = new Date().toISOString();
        current.status = "purchased";
      } else {
        throw new HttpError(409, "This request can't be moved to that status.");
      }
      return current;
    });
    const notificationSent = action === "send-quote" ? await sendQuoteNotification(order) : false;
    send(response, 200, { order, notificationSent });
    return;
  }
  if (url.pathname === "/api/admin/accounts" && method === "GET") {
    const user = await requireUser(request);
    requireAdmin(user);
    const status = url.searchParams.get("status");
    if (!["pending", "approved"].includes(status)) throw new HttpError(400, "Choose pending or approved accounts.");
    const state = await readState();
    send(response, 200, { accounts: state.users.filter(account => account.status === status).map(account => publicUser(account)) });
    return;
  }
  if (url.pathname.startsWith("/api/admin/accounts/") && method === "POST") {
    const user = await requireUser(request);
    requireAdmin(user);
    const email = decodeURIComponent(url.pathname.slice("/api/admin/accounts/".length)).toLowerCase();
    const body = await readBody(request);
    const updatedAccount = await updateState(state => {
      const accountIndex = state.users.findIndex(item => item.email === email);
      if (accountIndex < 0) throw new HttpError(404, "Account not found.");
      const account = state.users[accountIndex];
      if (body.action === "approve" && account.status === "pending") account.status = "approved";
      else if (body.action === "deny" && account.status === "pending") state.users.splice(accountIndex, 1);
      else if (body.action === "revoke" && account.status === "approved") account.status = "pending";
      else if (body.action === "set-role" && account.status === "approved") {
        if (!["customer", "store"].includes(body.role)) throw new HttpError(400, "Choose a customer or store owner role.");
        const storeName = String(body.storeName || "").trim();
        if (body.role === "store" && (!storeName || storeName.length > 120)) throw new HttpError(400, "Enter a valid store name for this store owner.");
        account.role = body.role;
        account.storeName = body.role === "store" ? storeName : "";
      } else throw new HttpError(409, "This account can't be changed in its current state.");
      return body.action === "deny" ? null : publicUser(state.users[accountIndex]);
    });
    send(response, 200, { account: updatedAccount });
    return;
  }
  if (method === "POST" && url.pathname === "/api/products") {
    const user = await requireUser(request);
    if (user.role !== "store") throw new HttpError(403, "An approved store owner account is required to list products.");
    const body = await readBody(request, 22 * 1024 * 1024);
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const rawImages = Array.isArray(body.images) ? body.images : [];
    const type = body.type || "product";
    const category = String(body.category || "");
    const price = Number(body.price);
    if (!["product", "service"].includes(type)) throw new HttpError(400, "Choose a product or service listing.");
    const allowedCategories = type === "service" ? serviceCategories : categories;
    if (!allowedCategories.includes(category)) throw new HttpError(400, "Choose a valid listing category.");
    if (name.length < 2 || name.length > 160 || description.length < 2 || description.length > 2000) throw new HttpError(400, "Enter a product name and description.");
    if (!Number.isFinite(price) || price <= 0 || price > 1000000000) throw new HttpError(400, "Enter a valid price.");
    const images = await saveListingPhotos(rawImages);
    const product = {
      id: crypto.randomUUID(),
      type,
      name,
      store: user.storeName,
      ownerEmail: user.email,
      category,
      price,
      rating: "New",
      badge: type === "service" ? "Service" : "New arrival",
      image: images[0],
      images,
      description
    };
    try {
      await updateState(state => { state.products.unshift(product); });
    } catch (error) {
      await Promise.all(images.map(image => fs.unlink(path.join(dataDirectory, "uploads", path.basename(image))).catch(() => undefined)));
      throw error;
    }
    send(response, 201, { product });
    return;
  }
  throw new HttpError(404, "Page not found.");
}

async function start() {
  await fs.mkdir(dataDirectory, { recursive: true });
  await readAdmin();
  const state = await readState();
  if (!Array.isArray(state.users) || !Array.isArray(state.products)) throw new Error("Marketplace data file has an invalid format.");
  try {
    await fs.access(dataFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeState(state);
  }
  const server = http.createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error(error);
      const message = status === 503 && error instanceof HttpError
        ? error.message
        : status >= 500 ? "The server couldn't complete the request." : error.message;
      send(response, status, { error: message });
    }
  });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => console.log(`Gannaaneba is running at http://${host}:${port}`));
}

start().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
