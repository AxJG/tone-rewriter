// netlify/functions/create-checkout.js
//
// Creates a Stripe Checkout session for a credit pack and returns the hosted
// payment URL. The browser redirects there; Stripe handles all card data, so
// your PCI surface stays minimal. The actual crediting happens later, in
// stripe-webhook.js, only once Stripe confirms the payment.
//
//   POST { "token": "<wallet id>", "pack": "small" | "medium" | "large" }
//   200  { "url": "https://checkout.stripe.com/..." }
//
// Env: STRIPE_SECRET_KEY

const Stripe = require("stripe");

// Pack catalogue — the SERVER is the source of truth for price and credits.
// The front-end only sends a pack key; it can never set its own price.
// Prices are in the smallest currency unit (pence). Edit freely.
const PACKS = {
  small: { credits: 50, price: 299, label: "50 rewrites" },
  medium: { credits: 200, price: 899, label: "200 rewrites" },
  large: { credits: 500, price: 1799, label: "500 rewrites" },
};
const CURRENCY = "gbp";

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Payments are not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const token = typeof body.token === "string" ? body.token : "";
  const pack = PACKS[body.pack];

  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing device token" }) };
  }
  if (!pack) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Unknown pack", validPacks: Object.keys(PACKS) }),
    };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin =
    event.headers.origin ||
    (event.headers.host ? `https://${event.headers.host}` : "");

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: { name: `Tone Rewriter — ${pack.label}` },
            unit_amount: pack.price,
          },
          quantity: 1,
        },
      ],
      // The webhook reads these back to credit the right wallet. metadata is
      // returned verbatim by Stripe and never exposed to the buyer's browser.
      metadata: { token, credits: String(pack.credits) },
      success_url: `${origin}/?paid=1`,
      cancel_url: `${origin}/?canceled=1`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("Checkout creation failed", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not start checkout" }) };
  }
};
