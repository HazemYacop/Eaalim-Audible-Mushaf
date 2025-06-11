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

    const pages = await fs.readdir(hokmPath);
    for (const pFolder of pages) {
      const pagePath = path.join(hokmPath, pFolder);
      if (!(await fs.stat(pagePath)).isDirectory()) continue;
      const pageNum = parseInt(pFolder, 10);
      if (!Number.isInteger(pageNum) || pageNum < 1) continue;

      const { rows: prows } = await pool.query(
        'SELECT id, image_url, hotspots FROM juza_page WHERE juza_id=$1 AND page_number=$2',
        [juzaId, pageNum]
      );
      if (!prows.length) {
        console.warn(`Page ${pageNum} not found in DB for ${hokmName}`);
        continue;
      }
      const page = prows[0];
      const dirFiles = await fs.readdir(pagePath);
      const imageFile = dirFiles.find(f => !/\.(mp3|ogg|wav)$/i.test(f));
      if (imageFile) {
        const key = new URL(page.image_url).pathname.slice(1);
        await uploadFile(key, path.join(pagePath, imageFile), getContentType(imageFile));
      }

      let hotspots = [];
      try {
        hotspots = Array.isArray(page.hotspots) ? page.hotspots : JSON.parse(page.hotspots || '[]');
      } catch {}

      for (const h of hotspots) {
        if (!h.audio) continue;
        const key = new URL(h.audio).pathname.slice(1);
        const base = decodeURIComponent(key.split('_').slice(1).join('_'));
        const audioFile = dirFiles.find(f => f === base);
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
