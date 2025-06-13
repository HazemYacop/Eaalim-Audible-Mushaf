# Eaalim Audible Mushaf

This project turns the Eaalim Mushaf into an audible and interactive experience using Node.js and Express. Page images and audio clips are stored in Cloudflare R2 while metadata lives in PostgreSQL.

## Requirements
- Node.js
- PostgreSQL database
- Cloudflare R2 bucket

## Setup
1. Copy `.env.example` to `.env` and fill in your configuration values.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node index.js
   ```
   The application will use the port defined in the `PORT` variable (defaults to `3000`).

## Environment variables
The application relies on the following variables:

- `DB_URL` – PostgreSQL connection string
- `SESSION_SECRET` – secret used to sign session cookies
- `R2_BUCKET` – name of your Cloudflare R2 bucket
- `R2_ACCESS_KEY_ID` – access key ID for R2
- `R2_SECRET_ACCESS_KEY` – secret access key for R2
- `PORT` – port to run the local server (e.g. `3000`)
- `NODE_ENV` – `development` or `production`

## Deploying to Vercel
1. Import this repository into [Vercel](https://vercel.com/).
2. Define the same environment variables in the Vercel dashboard.
3. Deploy. All requests are routed to `api/index.js`, which loads the Express app from `index.js`.

When running locally or on another platform the app listens on `PORT` as a normal Express server. On Vercel the function handler is used instead so the server becomes serverless.

## API
Public endpoints provide access to hokm, juz and page data:

- `GET /api/hokm` – list available hokm categories
- `GET /api/ajza/:hokmId` – list Juz for a hokm
- `GET /api/pages/:juzaId` – list pages for a Juz

The `/factory` area (behind login) lets administrators upload pages, audio clips and manage hotspots.

Restoration helpers were removed in the latest update – page images and audio clips must now be reuploaded manually if deleted.
