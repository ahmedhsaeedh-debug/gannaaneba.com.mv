import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, isTemuUrl, parseImageDataUrl } from "./marketplace.js";

test("accepts HTTPS Temu links and rejects lookalike or insecure hosts", () => {
  assert.equal(isTemuUrl("https://www.temu.com/product.html"), true);
  assert.equal(isTemuUrl("https://item.temu.to/item"), true);
  assert.equal(isTemuUrl("http://temu.com/product.html"), false);
  assert.equal(isTemuUrl("https://temu.com.attacker.example/product"), false);
});

test("accepts only supported image data URLs within the per-photo size limit", () => {
  assert.equal(parseImageDataUrl("data:image/png;base64,YQ=="), "data:image/png;base64,YQ==");
  assert.equal(parseImageDataUrl("data:image/svg+xml;base64,YQ=="), null);
  assert.equal(parseImageDataUrl("data:image/jpeg;base64,not base64"), null);
});

test("calculates Temu quote totals using integer cents", () => {
  assert.deepEqual(calculateQuote(1.99, 3, 15.42, 10), {
    temuAmountUsd: 5.97,
    baseAmountMvr: 92.06,
    serviceFeeMvr: 9.21,
    paymentAmountMvr: 101.27
  });
  assert.throws(() => calculateQuote(1, 21, 15.42, 0), RangeError);
});
