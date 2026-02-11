const baseUrl = process.env.API_BASE_URL;
const cronSecret = process.env.CRON_DISPATCH_SECRET;

if (!baseUrl) {
  console.error("API_BASE_URL is required");
  process.exit(1);
}

if (!cronSecret) {
  console.error("CRON_DISPATCH_SECRET is required");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/internal/outbox/dispatch`;

const response = await fetch(url, {
  method: "POST",
  headers: {
    "x-cron-secret": cronSecret,
  },
});

const text = await response.text();

if (!response.ok) {
  console.error(`Dispatch failed: ${response.status} ${text}`);
  process.exit(1);
}

console.log(`Dispatch OK: ${text}`);
