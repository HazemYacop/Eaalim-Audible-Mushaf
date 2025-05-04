import argon2 from 'argon2';
import { pool } from './db.js';

export async function verifyUser(email, password) {
  const { rows } = await pool.query(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email]
  );
  if (rows.length === 0) return null;
  const match = await argon2.verify(rows[0].password_hash, password);
  return match ? rows[0] : null;
}
