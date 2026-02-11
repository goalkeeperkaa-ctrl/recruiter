# Deploy on Render

This project is ready for Render with:
- `recruitflow-api` web service
- managed Postgres (`recruitflow-db`)
- cron job (`recruitflow-outbox-dispatch`) to dispatch webhook outbox every minute

## 1) Create services from blueprint

1. Push repository to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Select repository root containing `render.yaml`.
4. Apply.

## 2) Set required environment values

After first provision, open service settings and set:

- `recruitflow-api`:
  - `WEBHOOK_TARGET_URL` (your webhook receiver URL)

- `recruitflow-outbox-dispatch`:
  - `API_BASE_URL` (your API URL, for example `https://recruitflow-api.onrender.com`)
  - `CRON_DISPATCH_SECRET` = exactly the same value as in `recruitflow-api` service

## 3) Verify deployment

- Open `GET /health`
- Open `GET /ready`
- Submit one application through flow runner
- Check `GET /internal/outbox/pending` (auth required)
- Trigger `POST /internal/outbox/dispatch` manually (JWT or `x-cron-secret`) and verify item leaves pending queue

## 4) Notes

- API is always-on style service (good fit for Fastify + internal queue dispatch).
- Frontend can be deployed separately (e.g., Vercel) and point to Render API.
- For production scale, consider separate worker service for dispatch/retries and use Redis queue.
