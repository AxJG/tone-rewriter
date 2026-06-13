// netlify/functions/credits.js
//
// Returns the caller's current balance so the front-end can show "N rewrites
// left" and decide whether to nudge them to buy.
//
//   GET  /.netlify/functions/credits
//   headers: { "x-device-token": "<wallet id>" }   (or ?token=<id>)
//   200  { "freeRemaining": <int>, "paidCredits": <int>, "remaining": <int> }

const { getAccount, totalRemaining } = require("./_credits");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-device-token",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const token =
    event.headers["x-device-token"] ||
    event.headers["X-Device-Token"] ||
    (event.queryStringParameters && event.queryStringParameters.token) ||
    "";

  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing device token" }) };
  }

  try {
    const account = await getAccount(token);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        freeRemaining: account.freeRemaining,
        paidCredits: account.paidCredits,
        remaining: totalRemaining(account),
      }),
    };
  } catch (err) {
    console.error("Wallet read failed", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Wallet unavailable" }) };
  }
};
