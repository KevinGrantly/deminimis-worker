# deminimis-worker

Cloud Run worker voor geïsoleerde Playwright scraping.

## Env vars
- `WORKER_TOKEN` = bearer token die GRANTLY meestuurt naar `/jobs/deminimis`

## Endpoint
- `POST /jobs/deminimis`

## Vereiste payload
```json
{
  "job_id": 1,
  "customer_id": 10,
  "kvk": "12345678",
  "company_name": "ACME BV",
  "callback_url": "https://crm.example.com/deminimis/callback",
  "callback_token": "secret",
  "source_url": "https://aid-register.ec.europa.eu/de-minimis",
  "country": "Netherlands",
  "timeout_ms": 30000,
  "user_agent": "Mozilla/5.0 ..."
}
```
