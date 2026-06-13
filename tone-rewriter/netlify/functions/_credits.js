// netlify/functions/_credits.js
//
// Shared wallet logic for the tone rewriter. Files prefixed with "_" are NOT
// deployed as endpoints by Netlify — they're importable helpers only.
//
// Storage is Netlify Blobs: a zero-config key/value store that works
// automatically inside the Netlify runtime (on deploy and under `netlify dev`),
// so there's no separate database account to set up. Each device token maps to
// one account record:
//
//   { freeRemaining: <int>, paidCredits: <int> }
//
// "free" credits are the one-time welcome allowance; "paid" credits are bought
// in packs via Stripe. We always spend free credits first.

const { getStore } = require("@netlify/blobs");

// One-time free rewrites granted to a new device. Tune to taste — higher gets
// more people to the "aha" before the paywall; lower protects your API spend.
const FREE_ALLOWANCE = 5;

const STORE_NAME = "tone-rewriter-credits";

function store() {
  return getStore(STORE_NAME);
}

async function getAccount(token) {
  const data = await store().get(token, { type: "json" });
  if (data && typeof data === "object") {
    // Backfill any missing fields so old records stay valid as the shape grows.
    return {
      freeRemaining: Number.isFinite(data.freeRemaining) ? data.freeRemaining : 0,
      paidCredits: Number.isFinite(data.paidCredits) ? data.paidCredits : 0,
    };
  }
  // First time we've seen this device → grant the welcome allowance.
  return { freeRemaining: FREE_ALLOWANCE, paidCredits: 0 };
}

async function saveAccount(token, account) {
  await store().setJSON(token, account);
}

function totalRemaining(account) {
  return account.freeRemaining + account.paidCredits;
}

// Spend one rewrite. Returns { account, kind } or null when the wallet is empty.
// `kind` ("free" | "paid") records which bucket we drew from, so a failed Claude
// call can be refunded to the exact same bucket.
async function consume(token) {
  const account = await getAccount(token);
  if (totalRemaining(account) <= 0) return null;

  let kind;
  if (account.freeRemaining > 0) {
    account.freeRemaining -= 1;
    kind = "free";
  } else {
    account.paidCredits -= 1;
    kind = "paid";
  }
  await saveAccount(token, account);
  return { account, kind };
}

// Put back a credit we charged but couldn't deliver (e.g. the API errored).
async function refund(token, kind) {
  const account = await getAccount(token);
  if (kind === "free") account.freeRemaining += 1;
  else account.paidCredits += 1;
  await saveAccount(token, account);
  return account;
}

// Add purchased credits (called from the Stripe webhook).
async function addCredits(token, n) {
  const account = await getAccount(token);
  account.paidCredits += n;
  await saveAccount(token, account);
  return account;
}

module.exports = {
  FREE_ALLOWANCE,
  getAccount,
  saveAccount,
  totalRemaining,
  consume,
  refund,
  addCredits,
};
