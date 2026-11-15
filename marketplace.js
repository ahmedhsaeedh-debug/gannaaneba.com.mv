export function isTemuUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "temu.com" || url.hostname.endsWith(".temu.com") ||
       url.hostname === "temu.to" || url.hostname.endsWith(".temu.to"));
  } catch {
    return false;
  }
}

export function parseImageDataUrl(value) {
  const match = typeof value === "string" && value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > 2 * 1024 * 1024) return null;
  return value;
}

export function calculateQuote(unitPrice, quantity, exchangeRate, feePercent) {
  const unitCents = Math.round(Number(unitPrice) * 100);
  if (!Number.isInteger(unitCents) || unitCents < 1 || unitCents > 100000000) {
    throw new RangeError("Temu unit price must be between USD 0.01 and USD 1,000,000.");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new RangeError("Quantity must be between 1 and 20.");
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 ||
      !Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
    throw new RangeError("Quote rate and service fee are invalid.");
  }
  const baseCents = Math.round(unitCents * quantity * exchangeRate);
  const feeCents = Math.round(baseCents * feePercent / 100);
  return {
    temuAmountUsd: unitCents * quantity / 100,
    baseAmountMvr: baseCents / 100,
    serviceFeeMvr: feeCents / 100,
    paymentAmountMvr: (baseCents + feeCents) / 100
  };
}
