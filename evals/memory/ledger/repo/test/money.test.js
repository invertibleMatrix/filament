import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, formatCents } from "../src/money.js";

test("parseAmount reads euros and cents into cents", () => {
  assert.equal(parseAmount("12.50"), 1250);
  assert.equal(parseAmount("12.5"), 1250);
  assert.equal(parseAmount("7"), 700);
  assert.equal(parseAmount("-0.99"), -99);
  assert.throws(() => parseAmount("abc"));
});

test("formatCents writes two decimals", () => {
  assert.equal(formatCents(1250), "12.50");
  assert.equal(formatCents(7), "0.07");
  assert.equal(formatCents(-99), "-0.99");
});
