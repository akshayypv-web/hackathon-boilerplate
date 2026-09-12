require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

/**
 * Lazy Supabase client.
 *
 * Created on first use rather than at import time, so the server still boots
 * for teammates who have no backend/.env (which is gitignored, and which the
 * shortlisting engine does not need). Only the /api/test-db routes touch this.
 */
let client = null;

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

function getSupabase() {
  if (client) return client;
  if (!isConfigured()) {
    throw new Error(
      'Supabase is not configured. Copy backend/.env.example to backend/.env and fill in ' +
      'SUPABASE_URL and SUPABASE_SECRET_KEY. Not required for the shortlisting engine.'
    );
  }
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  return client;
}

module.exports = { getSupabase, isConfigured };
