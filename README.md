# Eaalim Audible Mushaf

This web application turns the Eaalim Mushaf into an audible experience.

## Running locally

```
npm install
PORT=3000 node index.js
```

## Deploying to Vercel

1. Create a project in [Vercel](https://vercel.com/) and import this
   repository.
2. Add the required environment variables (`DB_URL`, `SESSION_SECRET`,
   `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, etc.) in the Vercel
   dashboard.
3. Deploy. All requests are routed to `api/index.js` which loads the Express
   app exported from `index.js`.

When running locally or on another platform, the app listens on `PORT` as
usual. On Vercel the function handler is used instead, so the server is
serverless.
