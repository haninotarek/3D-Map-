#!/usr/bin/env node
// Makes the ADMIN_PASSWORD_HASH value for the midterm admin page (viewer/api/_lib/auth.js).
// Usage: node pipeline/hash_admin_password.mjs "the password"
// Put the printed line in Vercel → Project → Settings → Environment Variables (and in viewer/.env.local
// for the local dev server). The password itself is never stored anywhere.
import crypto from 'node:crypto';

const pw = process.argv[2];
if (!pw) { console.error('usage: node pipeline/hash_admin_password.mjs "<password>"'); process.exit(1); }
const salt = crypto.randomBytes(16);
console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`);
