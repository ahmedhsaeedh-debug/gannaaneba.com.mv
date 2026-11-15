const panel = document.querySelector("#app-panel");
const toast = document.querySelector("#toast");
const statusNames = {
  submitted: "Link received",
  quoted: "Price ready",
  awaiting_payment: "Awaiting deposit",
  slip_submitted: "Slip under review",
  slip_rejected: "Please resend slip",
  payment_approved: "Payment approved",
};
let toastTimer;
let currentUser = null;
let adminView = false;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const money = (value) => `MVR ${Number(value).toLocaleString("en-MV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
};
const jsonOptions = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3400);
}

function setMessage(form, message, success = false) {
  const target = form.querySelector(".form-message");
  target.textContent = message;
  target.classList.toggle("success", success);
}

function renderSignedOut(mode = "login") {
  adminView = false;
  const registration = mode === "register";
  panel.innerHTML = `
    <div class="auth-layout">
      <div class="auth-intro">
        <div class="eyebrow">${registration ? "Welcome to your little corner" : "Nice to have you back"}</div>
        <h3>${registration ? "Let’s get you set up." : "Your next favourite thing awaits."}</h3>
        <p>${registration ? "Add your island and delivery address once. Then share your Temu links and follow every order here." : "Sign in to share a Temu link, approve a price, or check on an order."}</p>
      </div>
      <form class="auth-form" id="customer-form">
        ${registration ? `
          <div class="form-grid">
            <div class="form-field"><label for="island">Island / atoll</label><input id="island" name="island" autocomplete="address-level1" placeholder="e.g. Malé" required maxlength="100"></div>
            <div class="form-field"><label for="phone">Phone number</label><input id="phone" name="phone" autocomplete="tel" placeholder="Your contact number" required maxlength="40"></div>
          </div>
          <div class="form-field"><label for="address">Current address</label><input id="address" name="address" autocomplete="street-address" placeholder="Street, building and area" required maxlength="300"></div>
        ` : ""}
        <div class="form-field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
        <div class="form-field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${registration ? "new-password" : "current-password"}" minlength="8" maxlength="128" placeholder="${registration ? "At least 8 characters" : "Your password"}" required></div>
        <p class="form-message" aria-live="polite"></p>
        <div class="form-actions"><button class="button button-primary" type="submit">${registration ? "Create account" : "Sign in"}</button><button class="text-button" id="toggle-auth" type="button">${registration ? "Already have an account? Sign in" : "New here? Create an account"}</button>${registration ? "" : '<button class="text-button" id="forgot-password" type="button">Forgot password?</button>'}</div>
        ${registration ? "" : '<p class="form-message info" id="reset-help" aria-live="polite"></p>'}
      </form>
    </div>`;
  panel.querySelector("#toggle-auth").addEventListener("click", () => renderSignedOut(registration ? "login" : "register"));
  if (!registration) {
    panel.querySelector("#forgot-password").addEventListener("click", () => {
      panel.querySelector("#reset-help").textContent =
        "Please contact the Gannaaneba team to reset your password.";
    });
  }
  panel.querySelector("#customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api(registration ? "/api/register" : "/api/login", jsonOptions(body));
      await loadDashboard();
      showToast(registration ? "Welcome to Gannaaneba! Your account is ready." : "Welcome back.");
    } catch (error) {
      setMessage(form, error.message);
    } finally {
      if (form.isConnected) button.disabled = false;
    }
  });
}

function renderAdminLogin() {
  adminView = true;
  panel.innerHTML = `
    <div class="auth-layout">
      <div class="auth-intro"><div class="eyebrow">Just for the Gannaaneba team</div><h3>Welcome back, admin.</h3><p>Sign in to review new links, provide a transparent price, and check payment slips.</p></div>
      <form class="auth-form" id="admin-form">
        <div class="form-field"><label for="admin-id">Admin user ID</label><input id="admin-id" name="user_id" autocomplete="username" required></div>
        <div class="form-field"><label for="admin-password">Password</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required></div>
        <p class="form-message" aria-live="polite"></p>
        <div class="form-actions"><button class="button button-primary" type="submit">Sign in as admin</button><button class="text-button" id="back-to-customer" type="button">Back to customer sign in</button></div>
      </form>
    </div>`;
  panel.querySelector("#back-to-customer").addEventListener("click", () => renderSignedOut("login"));
  panel.querySelector("#admin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api("/api/admin/login", jsonOptions(Object.fromEntries(new FormData(form).entries())));
      await loadDashboard();
      showToast("Signed in to the Gannaaneba admin desk.");
    } catch (error) {
      setMessage(form, error.message);
    } finally {
      if (form.isConnected) button.disabled = false;
    }
  });
}

function orderCard(order, isAdmin) {
  const status = statusNames[order.status] || "Order update";
  const price = order.total_mvr ? `<strong>${money(order.total_mvr)}</strong><br><span class="usd">$${Number(order.usd_price).toFixed(2)} USD · ${Number(order.exchange_rate).toFixed(2)} MVR / USD</span>` : "Price coming soon";
  let tools = "";
  let details = "";
  if (isAdmin && order.status === "submitted") {
    tools = `<form class="admin-price-form" data-id="${order.id}">
      <div class="form-field"><label for="usd-${order.id}">Temu price (USD)</label><input id="usd-${order.id}" name="usd_price" type="number" step="0.01" min="0.01" max="100000" placeholder="e.g. 12.50" required></div>
      <div class="form-field"><label for="rate-${order.id}">MVR per USD</label><input id="rate-${order.id}" name="exchange_rate" type="number" step="0.01" min="1" max="100" value="15.42" required></div>
      <button class="button button-primary" type="submit">Send price · +20%</button>
    </form>`;
  } else if (isAdmin && order.status === "quoted") {
    tools = `<p class="small-note">Price sent to customer for approval.</p>`;
  } else if (isAdmin && order.status === "slip_submitted") {
    tools = `<div class="admin-order-actions"><a class="slip-link" href="/api/orders/${order.id}/slip" target="_blank" rel="noopener">View payment slip ↗</a><button class="button button-primary" data-payment="approve" data-id="${order.id}">Approve payment</button><button class="button button-outline" data-payment="reject" data-id="${order.id}">Request new slip</button></div>`;
  } else if (!isAdmin && order.status === "quoted") {
    details = `<div class="quote-receipt"><p>Your total includes a 20% service fee.<br><strong>${money(order.total_mvr)}</strong> to approve</p><button class="button button-primary" data-approve="${order.id}">Approve this price</button><p class="account-details">After approval, deposit to <strong>${escapeHtml(window.paymentAccountNumber)}</strong> · ${escapeHtml(window.paymentAccountName)}. Upload your slip here for confirmation.</p></div>`;
  } else if (!isAdmin && ["awaiting_payment", "slip_rejected"].includes(order.status)) {
    details = `<div class="quote-receipt"><p>${order.status === "slip_rejected" ? `Please check and upload a new slip. ${escapeHtml(order.admin_note)}` : "Please deposit your approved total to the account below."}<br><strong>${money(order.total_mvr)}</strong></p><p class="account-details"><strong>Account number:</strong> ${escapeHtml(window.paymentAccountNumber)} &nbsp;·&nbsp; <strong>Account name:</strong> ${escapeHtml(window.paymentAccountName)}</p></div>
      <form class="slip-form" data-id="${order.id}"><input type="file" name="slip" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" required><button class="button button-primary" type="submit">Upload payment slip</button><span class="small-note">PNG, JPEG or PDF · up to 5 MB</span></form>`;
  } else if (!isAdmin && order.status === "slip_submitted") {
    details = `<a class="slip-link" href="/api/orders/${order.id}/slip" target="_blank" rel="noopener">View your submitted slip ↗</a>`;
  } else if (!isAdmin && order.status === "payment_approved") {
    details = `<p class="small-note">Your payment is confirmed. Thank you for ordering with us!</p>`;
  }
  return `<article class="order-card">
    <div><div class="order-id">Order #${order.id} · ${escapeHtml(order.created_at || "")}</div><a class="order-link" href="${escapeHtml(order.temu_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(order.temu_url)}</a>
    ${isAdmin ? `<p class="order-person">${escapeHtml(order.island)} · ${escapeHtml(order.address)}<br>${escapeHtml(order.phone)} · <a class="customer-contact" href="mailto:${escapeHtml(order.email)}">${escapeHtml(order.email)}</a></p>` : ""}</div>
    <div class="order-price">${price}</div>
    <div class="order-tools"><span class="order-status status-${escapeHtml(order.status)}"><span class="status-dot"></span>${escapeHtml(status)}</span>
    ${isAdmin && order.status === "slip_rejected" ? `<span class="small-note">Waiting for customer to resend their slip.</span>` : ""}</div>
    ${details}${tools}
  </article>`;
}

async function loadDashboard() {
  const { user } = await api("/api/me");
  currentUser = user;
  document.querySelector("#account-action").textContent = user ? "Sign out" : "Sign in";
  if (!user) {
    renderSignedOut();
    return;
  }
  adminView = user.role === "admin";
  const isAdmin = adminView;
  const data = await api(isAdmin ? "/api/admin/orders" : "/api/orders");
  panel.innerHTML = `
    <div class="dashboard-top">
      <div><div class="eyebrow">${isAdmin ? "Your little order desk" : "Your account"}</div><h3>${isAdmin ? "Orders at a glance." : `Hello, ${escapeHtml(user.island)}.`}</h3><p>${isAdmin ? "Review links, send prices, and confirm deposits." : `${escapeHtml(user.email)} · ${escapeHtml(user.phone)}`}</p></div>
      <div class="dashboard-actions">${!isAdmin ? `<button class="button button-outline" id="profile-button" type="button">My details</button>` : ""}<button class="button button-outline" id="signout-button" type="button">Sign out</button></div>
    </div>
    ${!isAdmin ? `<form class="order-form" id="order-form"><div class="form-field"><label for="temu-link">Your Temu item link</label><input id="temu-link" type="url" name="temu_url" placeholder="https://www.temu.com/..." required maxlength="2048"></div><button class="button button-primary" type="submit">Send for pricing ↗</button><p class="form-message" aria-live="polite"></p></form>` : ""}
    ${isAdmin ? `<div class="account-details-box"><strong>Payment account shown to customers:</strong> ${escapeHtml(window.paymentAccountNumber)} · ${escapeHtml(window.paymentAccountName)}<br><span class="small-note">USD prices are converted at your selected MVR / USD rate; the 20% service fee is added automatically.</span></div>` : ""}
    <div class="order-list">${data.orders.length ? data.orders.map((order) => orderCard(order, isAdmin)).join("") : `<div class="empty-orders">${isAdmin ? "No links just yet. New customer orders will appear here." : "No orders just yet. Paste a Temu link above to get started."}</div>`}</div>`;

  panel.querySelector("#signout-button").addEventListener("click", signOut);
  panel.querySelector("#profile-button")?.addEventListener("click", () => {
    showToast(`Delivery address: ${user.address} · ${user.island}`);
  });
  panel.querySelector("#order-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api("/api/orders", jsonOptions(Object.fromEntries(new FormData(form).entries())));
      await loadDashboard();
      showToast("Your Temu link is in. We’ll send your price here.");
    } catch (error) {
      setMessage(form, error.message);
    } finally {
      if (form.isConnected) button.disabled = false;
    }
  });
  panel.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`/api/orders/${button.dataset.approve}/approve`, jsonOptions({}));
      await loadDashboard();
      showToast("Price approved. You can now deposit and upload your slip.");
    } catch (error) {
      showToast(error.message);
    }
  }));
  panel.querySelectorAll(".slip-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch(`/api/orders/${form.dataset.id}/slip`, { method: "POST", body: new FormData(form), credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not upload the slip.");
      await loadDashboard();
      showToast("Your payment slip is in. We’ll review it shortly.");
    } catch (error) {
      showToast(error.message);
      if (form.isConnected) button.disabled = false;
    }
  }));
  panel.querySelectorAll(".admin-price-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      const response = await fetch(`/api/orders/${form.dataset.id}/quote`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send this price.");
      await loadDashboard();
      showToast(`MVR ${Number(data.total_mvr).toFixed(2)} is ready for customer approval.`);
    } catch (error) {
      showToast(error.message);
      if (form.isConnected) button.disabled = false;
    }
  }));
  panel.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`/api/orders/${button.dataset.id}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: button.dataset.payment }),
        credentials: "same-origin",
      });
      await loadDashboard();
      showToast(button.dataset.payment === "approve" ? "Payment approved. The customer can see the update in their account." : "Slip marked for re-upload.");
    } catch (error) {
      showToast(error.message);
      if (button.isConnected) button.disabled = false;
    }
  }));
}

async function signOut() {
  await api("/api/logout", { method: "POST" });
  currentUser = null;
  document.querySelector("#account-action").textContent = "Sign in";
  renderSignedOut();
  showToast("You’ve signed out safely.");
}

document.querySelector("#account-action").addEventListener("click", async () => {
  if (currentUser) {
    try { await signOut(); } catch (error) { showToast(error.message); }
    return;
  }
  renderSignedOut();
  document.querySelector("#start-order").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#admin-action").addEventListener("click", () => {
  renderAdminLogin();
  document.querySelector("#start-order").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#year").textContent = new Date().getFullYear();

api("/api/config")
  .then((config) => {
    window.paymentAccountNumber = config.account_number;
    window.paymentAccountName = config.account_name;
    return loadDashboard();
  })
  .catch((error) => {
    panel.innerHTML = `<p class="form-message">${escapeHtml(error.message)} Please refresh the page.</p>`;
  });
