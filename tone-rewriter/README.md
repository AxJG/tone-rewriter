# Tone Rewriter

A small, monetisable web app: paste a message, pick a tone, get it rewritten by
Claude — **without changing a single fact**. Front-end + serverless functions,
deployed on Netlify. Your API key never touches the browser.

It earns through **prepaid credit packs**: every new visitor gets a handful of
free rewrites; after that they buy credits via Stripe. Credits are checked and
spent *before* any paid API call, so you never pay for a rewrite a user hasn't.

```
┌──────────┐   text+tone    ┌─────────────────────┐   prompt    ┌────────┐
│ index.html│ ─────────────▶│ tone-rewriter (fn)   │ ──────────▶│ Claude │
│ (browser)│ ◀───────────── │  gate→rewrite→charge │ ◀────────── │ (Haiku)│
└────┬─────┘   rewrite       └──────────┬──────────┘             └────────┘
     │                                   │ balance
     │ buy pack         ┌────────────────▼─────┐
     ├─────────────────▶│ create-checkout (fn) │──▶ Stripe Checkout
     │                  └──────────────────────┘        │
     │  ?paid=1                                          │ webhook
     │◀────────────────  ┌─────────────────────┐◀───────┘
                         │ stripe-webhook (fn)  │──▶ credit the wallet
                         └─────────────────────┘    (Netlify Blobs)
```

## What's in the box

```
tone-rewriter/
├── index.html                       front-end (no framework, no build step)
├── netlify/functions/
│   ├── tone-rewriter.js             the rewrite endpoint + billing gate
│   ├── credits.js                   GET the caller's balance
│   ├── create-checkout.js           start a Stripe Checkout for a credit pack
│   ├── stripe-webhook.js            credit the wallet once Stripe confirms payment
│   └── _credits.js                  shared wallet logic (Netlify Blobs; not an endpoint)
├── netlify.toml
└── package.json                     deps: stripe, @netlify/blobs
```

## The wallet model

Each browser generates a random **device token** (stored in `localStorage`) and
sends it on every request. The token maps to one account in Netlify Blobs:

```
{ freeRemaining, paidCredits }
```

- New device → `FREE_ALLOWANCE` free rewrites (default **5**, set in `_credits.js`).
- Free credits are spent first, then paid credits.
- A rewrite is charged *before* the Claude call; if our call fails, the credit
  is refunded to the same bucket.
- Only `stripe-webhook.js` ever **adds** paid credits, and only after Stripe
  verifies a real payment — the browser is never trusted to grant itself credit.

Pack prices and sizes live in `create-checkout.js` (`PACKS`) — the **server** is
the source of truth; the front-end only sends a pack key, never a price.
Defaults: 50 / £2.99, 200 / £8.99, 500 / £17.99 (GBP).

## Setup

### 1. Environment variables (Netlify → Site settings → Environment variables)

| Variable                | What it is                                                        |
| ----------------------- | ----------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | Your key from <https://console.anthropic.com>.                    |
| `STRIPE_SECRET_KEY`     | Stripe secret key (`sk_test_…` to start) from the Stripe dashboard.|
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint (see step 3, `whsec_…`).  |

Never commit any of these.

### 2. Install & run locally

```bash
npm install
npx netlify dev      # serves the site + functions, with Netlify Blobs wired up
```

`netlify dev` provides the Blobs store automatically. To exercise Stripe
locally, forward webhooks: `stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook`.

### 3. Wire the Stripe webhook (once deployed)

In the Stripe dashboard → **Developers → Webhooks → Add endpoint**:

- URL: `https://YOUR-SITE.netlify.app/.netlify/functions/stripe-webhook`
- Event: **`checkout.session.completed`**

Copy the endpoint's **signing secret** into `STRIPE_WEBHOOK_SECRET` and redeploy.

### 4. Deploy

Connect the repo to Netlify (or drag the folder in). Functions in
`netlify/functions/` are auto-discovered and served at
`/.netlify/functions/<name>`.

## The "never make anything up" guarantee

The `GUARDRAIL` constant in `tone-rewriter.js` is prepended to every request. It
forbids adding facts, names, or claims not in the original, and tells the model
to treat the user's text as material to rewrite — never as instructions. That's
what stops the rewriter inventing content or being hijacked by a message that
contains something like "ignore the above". Unknown tone keys are rejected, so
user input can never inject an arbitrary instruction either.

## Model & cost

Rewrites use Claude **Haiku** (`claude-haiku-4-5-20251001`) — fast and cheap,
which suits short rewrites. Per call costs a fraction of a penny. Your real cost
floor is Stripe's per-transaction fee, which is exactly why credit packs beat
charging per click. Swap `MODEL` in `tone-rewriter.js` for a larger model if you
want richer output.

## Limitations & hardening (when you're ready to scale)

This is a deliberately lightweight v1. Known trade-offs and the upgrade path:

- **Anonymous wallet.** The device token lives in `localStorage`; clearing it
  resets the free allowance *but also forfeits any paid credits*, so paying
  users won't. To make balances portable across devices, add email sign-in (or
  magic links) and key the wallet on the user instead of the device.
- **Blob writes aren't transactional.** Concurrent rewrites from the same device
  do a read-modify-write that could, rarely, miscount. Fine at small scale; move
  to a datastore with atomic decrement (e.g. Upstash Redis `DECR`) if it matters.
- **Free-tier abuse.** A determined user can mint fresh tokens for more free
  rewrites. Keep `FREE_ALLOWANCE` modest, and add per-IP rate limiting or
  sign-in if abuse shows up.
- **CORS is `*`.** Tighten `Access-Control-Allow-Origin` to your own domain once
  the front-end is on a fixed host.
