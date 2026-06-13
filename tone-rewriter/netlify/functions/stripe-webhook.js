// netlify/functions/stripe-webhook.js
//
// Stripe calls this endpoint after a payment. We verify the signature (so only
// genuine Stripe events are trusted), then credit the buyer's wallet. This is
// the ONLY place credits are added — the browser is never trusted to do it.
//
//   POST  /.netlify/functions/stripe-webhook   (called by Stripe, not the UI)
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Register the endpoint in the Stripe dashboard (Developers → Webhooks) for the
// event "checkout.session.completed", then paste its signing secret into
// STRIPE_WEBHOOK_SECRET. See README.

const Stripe = require("stripe");
const { addCredits } = require("./_credits");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe webhook not configured");
    return { statusCode: 500, body: "Not configured" };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];

  // Signature verification needs the EXACT raw bytes Stripe sent. Netlify hands
  // us the body as a string (or base64 for binary) — reconstruct it faithfully.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : event.body || "";

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const token = session.metadata && session.metadata.token;
    const credits = parseInt((session.metadata && session.metadata.credits) || "0", 10);

    if (token && credits > 0) {
      try {
        await addCredits(token, credits);
        console.log(`Credited ${credits} to ${token}`);
      } catch (err) {
        // Returning non-2xx tells Stripe to retry — so a transient blob write
        // failure doesn't lose a paid-for top-up.
        console.error("Failed to credit wallet", err);
        return { statusCode: 500, body: "Credit write failed" };
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
