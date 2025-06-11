import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';
import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

const ROOT_DIR = process.argv[2];
if (!ROOT_DIR) {
  console.error('Usage: node scripts/restoreJuz30.js <folder>');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DB_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const s3 = new AWS.S3({
  endpoint: 'https://ee4331c19e2c5c46e14e8daea632cf68.r2.cloudflarestorage.com',
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: 'auto',
  signatureVersion: 'v4',
});

async function uploadFile(key, filePath, contentType) {
  const Body = await fs.readFile(filePath);
  await s3
    .putObject({ Bucket: process.env.R2_BUCKET, Key: key, Body, ContentType: contentType })
    .promise();
}

function getContentType(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

function getKeyFromUrl(url) {
  try {
    return new URL(url, 'https://dummy').pathname.slice(1);
  } catch {
    return null;
  }
}

async function main() {
  const hokmFolders = await fs.readdir(ROOT_DIR);

  for (const hokmName of hokmFolders) {
    const hokmPath = path.join(ROOT_DIR, hokmName);
    if (!(await fs.stat(hokmPath)).isDirectory()) continue;

    const { rows: hrows } = await pool.query('SELECT id FROM hokm WHERE name=$1', [hokmName]);
    if (!hrows.length) {
      console.warn(`Hokm not found: ${hokmName}`);
      continue;
    }
    const hokmId = hrows[0].id;

    const { rows: jrows } = await pool.query(
      'SELECT id FROM ajzaa WHERE hokm_id=$1 AND number=30',
      [hokmId]
    );
    if (!jrows.length) {
      console.warn(`Juz 30 not found for ${hokmName}`);
      continue;
    }
    const juzaId = jrows[0].id;

    const { rows: pageRows } = await pool.query(
      'SELECT id, page_number, image_url, hotspots FROM juza_page WHERE juza_id=$1 ORDER BY page_number',
      [juzaId]
    );
    if (!pageRows.length) {
      console.warn(`No pages found in DB for ${hokmName}`);
      continue;
    }
    const pageMap = new Map(pageRows.map((p) => [p.page_number, p]));
    const dbFirst = pageRows[0].page_number;
    const dbLast = pageRows[pageRows.length - 1].page_number;

    const entries = await fs.readdir(hokmPath, { withFileTypes: true });
    const pageFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const numericFolders = pageFolders
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isInteger(n));
    numericFolders.sort((a, b) => a - b);
    const folderFirst = numericFolders[0];
    const folderLast = numericFolders[numericFolders.length - 1];
    const offsetFirst = dbFirst - folderFirst;
    const offsetLast = dbLast - folderLast;

    for (const pFolder of pageFolders) {
      const pagePath = path.join(hokmPath, pFolder);
      const pageNum = parseInt(pFolder, 10);
      if (!Number.isInteger(pageNum)) continue;

      let page =
        pageMap.get(pageNum) ||
        pageMap.get(pageNum + offsetFirst) ||
        pageMap.get(pageNum + offsetLast);
      if (!page) {
        console.warn(`Page ${pageNum} not found in DB for ${hokmName}`);
        continue;
      }

      const dirFiles = await fs.readdir(pagePath);
      const imageFile = dirFiles.find((f) => !/\.(mp3|ogg|wav)$/i.test(f));
      if (imageFile) {
        const key = getKeyFromUrl(page.image_url);
        if (key) {
          await uploadFile(key, path.join(pagePath, imageFile), getContentType(imageFile));
        } else {
          console.warn(`Invalid image URL for page ${pageNum} in ${hokmName}`);
        }
      }

      let hotspots = [];
      try {
        hotspots = Array.isArray(page.hotspots) ? page.hotspots : JSON.parse(page.hotspots || '[]');
      } catch {}

      for (const h of hotspots) {
        if (!h.audio) continue;
        const key = getKeyFromUrl(h.audio);
        if (!key) {
          console.warn(`Invalid audio URL in DB for page ${pageNum} in ${hokmName}`);
          continue;
        }
        const base = decodeURIComponent(key.split('_').slice(1).join('_'));
        const audioFile = dirFiles.find((f) => f === base);
        if (!audioFile) {
          console.warn(`Audio ${base} not found for page ${pageNum} in ${hokmName}`);
          continue;
        }
        await uploadFile(key, path.join(pagePath, audioFile), getContentType(audioFile));
      }
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
