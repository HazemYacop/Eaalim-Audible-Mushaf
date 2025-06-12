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

## Restoring deleted files

If page images or audio clips are removed from Cloudflare R2 but their
URLs are still present in the database you can restore them using the
`scripts/restoreJuz30.js` helper. This script expects the local folder
structure to be `<hokm>/<page number>/<files>` and uploads the files to
the exact paths stored in the database for Juz&nbsp;30. The R2 bucket uses
two top‑level folders, **images** and **audios**, and the restore helper
places each file back in its recorded location. Page folders can either
use the same page numbers stored in the database or start from **1**
(useful when they contain only the pages of Juz&nbsp;30). The script
detects any numbering offset automatically. If the stored URLs begin with
`uploads/`, the helper rewrites them to the appropriate folder and
updates the database with fully qualified URLs using the public R2 base.
Audio files are matched by name when possible but will be used in order if
no matching file is found. Existing objects are checked before upload so
running the script multiple times doesn’t reupload unchanged files.

Usage:

```bash
node scripts/restoreJuz30.js /path/to/local/folder
```

The script relies on the same environment variables used by the
application (`DB_URL`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and
`R2_SECRET_ACCESS_KEY`).
