// core & security
import express from "express";
import path, { dirname } from "node:path";
import PGSessionStore from "./pgSessionStore.js";
import session from "express-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import AWS from "aws-sdk";
import csrf from "csurf";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();

// local modules
import { pool } from "./db.js";
import { verifyUser } from "./auth.js";

// helpers
const ROOT_PATH = process.cwd();
const app = express();
const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const updatePositions = async (
  client,
  table,
  idArr,
  extraWhere = "",
  ...extraParams
) => {
  for (let i = 0; i < idArr.length; i++) {
    await client.query(
      `UPDATE ${table} SET position=$2 WHERE id=$1 ${extraWhere}`,
      [idArr[i], i + 1, ...extraParams]
    );
  }
};

const renderWithCsrf = (res, view, data = {}) =>
  res.render(view, { ...data, csrfToken: res.req.csrfToken() });

// Cloudflare R2 config
const s3 = new AWS.S3({
  endpoint: "https://ee4331c19e2c5c46e14e8daea632cf68.r2.cloudflarestorage.com",
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
});

const upload = multer({ storage: multer.memoryStorage() });

// middleware
app.set("views", path.join(ROOT_PATH, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(ROOT_PATH, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));
app.set("trust proxy", 1);
app.use(
  session({
    store: new PGSessionStore(),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);
app.use(csrf());

// auth helper
const authRequired = (req, res, next) =>
  req.session.user ? next() : res.redirect("/factory/login");

// routes
app.get("/", (_, res) => renderWithCsrf(res, "home"));

// -----------------------------------------------------------------------------
// public endpoints
// -----------------------------------------------------------------------------
app.get(
  "/api/hokm",
  asyncH(async (_, res) =>
    res.json(
      (await pool.query("SELECT id,name FROM hokm ORDER BY position")).rows
    )
  )
);

app.get(
  "/api/ajza/:hokmId",
  asyncH(async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT id,number FROM ajzaa WHERE hokm_id=$1 ORDER BY number",
          [req.params.hokmId]
        )
      ).rows
    )
  )
);

app.get(
  "/api/pages/:juzaId",
  asyncH(async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT id,image_url,hotspots FROM juza_page WHERE juza_id=$1 ORDER BY position",
          [req.params.juzaId]
        )
      ).rows
    )
  )
);

// -----------------------------------------------------------------------------
// auth / session
// -----------------------------------------------------------------------------
app.get("/factory/login", (_, res) => renderWithCsrf(res, "login"));
app.post(
  "/login",
  asyncH(async (req, res) => {
    const { email, password } = req.body;
    const user = await verifyUser(email, password);
    if (!user) return res.redirect("/factory/login?err=1");
    req.session.user = { id: user.id, email };
    res.redirect("/factory");
  })
);
app.get("/logout", (req, res) =>
  req.session.destroy(() => res.redirect("/factory/login"))
);

// -----------------------------------------------------------------------------
// factory area (protected)
// -----------------------------------------------------------------------------
app.get(
  "/factory",
  authRequired,
  asyncH(async (req, res) => {
    const { rows: hokm } = await pool.query(
      "SELECT id,name FROM hokm ORDER BY position"
    );
    renderWithCsrf(res, "factory", { email: req.session.user.email, hokm });
  })
);

// CSRF token for client‑side requests
app.get("/csrf-token", (req, res) => res.json({ csrfToken: req.csrfToken() }));

// audio & image upload to R2
const uploadToR2 = async (file, folder = "") => {
  const key = `${folder}${uuidv4()}_${file.originalname}`;
  await s3
    .putObject({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
    .promise();
  return `https://pub-41075be619d1468aaff5ef8e1e715ae4.r2.dev/${key}`;
};

app.post(
  "/factory/upload-audio",
  authRequired,
  upload.single("file"),
  asyncH(async (req, res) => {
    const url = await uploadToR2(req.file, "audios/");
    res.json({ url });
  })
);

app.post(
  "/factory/:juzaId/add-page",
  authRequired,
  upload.single("file"),
  asyncH(async (req, res) => {
    const imageUrl = await uploadToR2(req.file, "images/");
    const { rows } = await pool.query(
      `INSERT INTO juza_page (juza_id,image_url,page_number,position)
     VALUES ($1,$2,
       COALESCE($3,(SELECT COALESCE(MAX(page_number),0)+1 FROM juza_page WHERE juza_id=$1)),
       (SELECT COALESCE(MAX(position),0)+1 FROM juza_page WHERE juza_id=$1))
     RETURNING id,page_number,image_url,position`,
      [req.params.juzaId, imageUrl, req.body.page_number]
    );
    res.status(201).json(rows[0]);
  })
);

// ---------- hokm -------------------------------------------------------------
app.post(
  "/factory/add-hokm",
  authRequired,
  asyncH(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name required" });
    if (name.length > 50) return res.status(400).json({ error: "Too long" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO hokm (name, position)
              VALUES ($1,
                    COALESCE( (SELECT MAX(position) + 1 FROM hokm), 1 ))
              RETURNING id, name, position`,
        [name]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === "23505")
        return res.status(409).json({ error: "Hokm already exists" });
      throw e;
    }
  })
);

app.post(
  "/factory/:hokmId/rename-hokm",
  authRequired,
  asyncH(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name required" });
    try {
      await pool.query("UPDATE hokm SET name=$1 WHERE id=$2", [
        name,
        req.params.hokmId,
      ]);
      res.sendStatus(204);
    } catch (e) {
      if (e.code === "23505")
        return res.status(409).json({ error: "Name exists" });
      throw e;
    }
  })
);

app.post(
  "/factory/reorder-hokm",
  authRequired,
  asyncH(async (req, res) => {
    const ids = req.body.ids || [];
    if (!ids.length) return res.status(400).json({ error: "ids required" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await updatePositions(c, "hokm", ids);
      await c.query("COMMIT");
      res.sendStatus(204);
    } finally {
      c.release();
    }
  })
);

app.delete(
  "/factory/:hokmId",
  authRequired,
  asyncH(async (req, res) => {
    await pool.query("DELETE FROM hokm WHERE id=$1", [req.params.hokmId]);
    res.sendStatus(204);
  })
);

// ---------- ajzaa / juz -------------------------------------------------------
app.post(
  "/factory/:hokmId/add-juza",
  authRequired,
  asyncH(async (req, res) => {
    const num = +req.body.number;
    if (!Number.isInteger(num) || num < 1 || num > 30)
      return res.status(400).json({ error: "Number 1‑30 required" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO ajzaa(hokm_id,number,position)
       VALUES($1,$2,(SELECT COALESCE(MAX(position),0)+1 FROM ajzaa WHERE hokm_id=$1))
       RETURNING id,number`,
        [req.params.hokmId, num]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === "23505")
        return res.status(409).json({ error: "Juz already exists" });
      throw e;
    }
  })
);

app.post(
  "/factory/:hokmId/reorder-juza",
  authRequired,
  asyncH(async (req, res) => {
    const ids = req.body.ids || [];
    if (!ids.length) return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await updatePositions(
        c,
        "ajzaa",
        ids,
        "AND hokm_id=$3",
        req.params.hokmId
      );
      await c.query("COMMIT");
      res.sendStatus(204);
    } finally {
      c.release();
    }
  })
);

app.post(
  "/factory/:hokmId/:juzaId/rename-juza",
  authRequired,
  asyncH(async (req, res) => {
    const num = +req.body.number;
    if (!Number.isInteger(num) || num < 1 || num > 30)
      return res.status(400).json({ error: "Number 1‑30" });
    try {
      await pool.query(
        "UPDATE ajzaa SET number=$1 WHERE id=$2 AND hokm_id=$3",
        [num, req.params.juzaId, req.params.hokmId]
      );
      res.sendStatus(204);
    } catch (e) {
      if (e.code === "23505")
        return res.status(409).json({ error: "Juz already exists" });
      throw e;
    }
  })
);


// ---------- juza pages --------------------------------------------------------

app.get(
  "/factory/:juzaId/pages",
  authRequired,
  asyncH(async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT id,image_url,hotspots FROM juza_page WHERE juza_id=$1 ORDER BY position",
          [req.params.juzaId]
        )
      ).rows
    )
  )
);

app.post(
  "/factory/:juzaId/reorder-pages",
  authRequired,
  asyncH(async (req, res) => {
    const ids = req.body.ids || [];
    if (!ids.length) return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await updatePositions(
        c,
        "juza_page",
        ids,
        "AND juza_id=$3",
        req.params.juzaId
      );
      await c.query("COMMIT");
      res.sendStatus(204);
    } finally {
      c.release();
    }
  })
);

app.patch(
  "/factory/page/:pageId/hotspots",
  authRequired,
  asyncH(async (req, res) => {
    const hotspots = JSON.stringify(req.body.hotspots || []);
    const { rowCount } = await pool.query(
      "UPDATE juza_page SET hotspots=$1::jsonb WHERE id=$2",
      [hotspots, req.params.pageId]
    );
    rowCount ? res.sendStatus(204) : res.sendStatus(404);
  })
);

app.get(
  "/factory/page/:pageId",
  authRequired,
  asyncH(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id,image_url,hotspots FROM juza_page WHERE id=$1",
      [req.params.pageId]
    );
    rows.length ? res.json(rows[0]) : res.sendStatus(404);
  })
);
app.delete(
  "/factory/page/:pageId",
  authRequired,
  asyncH(async (req, res) => {
    await pool.query("DELETE FROM juza_page WHERE id=$1", [req.params.pageId]);
    res.sendStatus(204);
  })
);

app.delete(
  "/factory/:hokmId/:juzaId",
  authRequired,
  asyncH(async (req, res) => {
    await pool.query("DELETE FROM ajzaa WHERE id=$1 AND hokm_id=$2", [
      req.params.juzaId,
      req.params.hokmId,
    ]);
    res.sendStatus(204);
  })
);

// ---------- views ------------------------------------------------------------
app.get(
  "/factory/:hokmId",
  authRequired,
  asyncH(async (req, res) => {
    const { rows: h } = await pool.query(
      "SELECT id,name FROM hokm WHERE id=$1",
      [req.params.hokmId]
    );
    if (!h.length) return res.sendStatus(404);
    const { rows: ajzaa } = await pool.query(
      "SELECT id,number FROM ajzaa WHERE hokm_id=$1 ORDER BY position",
      [req.params.hokmId]
    );
    renderWithCsrf(res, "hokm", {
      email: req.session.user.email,
      hokm: h[0],
      ajzaa,
    });
  })
);

app.get(
  "/factory/:hokmId/:juzaId",
  authRequired,
  asyncH(async (req, res) => {
    const { rows: j } = await pool.query(
      `SELECT a.id,a.number,h.name AS hokm_name,h.id AS hokm_id
       FROM ajzaa a JOIN hokm h ON h.id=a.hokm_id
      WHERE a.id=$1 AND a.hokm_id=$2`,
      [req.params.juzaId, req.params.hokmId]
    );
    if (!j.length) return res.sendStatus(404);
    const { rows: pages } = await pool.query(
      "SELECT id,image_url,page_number,position FROM juza_page WHERE juza_id=$1 ORDER BY position",
      [req.params.juzaId]
    );
    renderWithCsrf(res, "juza", {
      email: req.session.user.email,
      hokm: { id: j[0].hokm_id, name: j[0].hokm_name },
      juza: { id: j[0].id, number: j[0].number },
      pages,
    });
  })
);

app.get("/view/:hokmId/:juzaId", (req, res) => {
  res.render("home");
});

// server
export default app;

// start local server when not running on Vercel
if (!process.env.VERCEL) {
  app.listen(process.env.PORT, () =>
    console.log(`Server running → http://localhost:${process.env.PORT}`)
  );
}
