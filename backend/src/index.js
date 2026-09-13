require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
// The chat endpoint receives the whole PipelineResult back from the UI so it can
// answer against exactly what the recruiter is looking at. That payload is ~145 KB
// with 18 candidates, which silently exceeds express's 100 KB default and fails
// the request with 413 before the handler ever runs.
app.use(express.json({ limit: '10mb' }));

// Simple GET route
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from the backend!' });
});

// Simple POST route
app.post('/api/echo', (req, res) => {
  const { text } = req.body;
  res.json({ received: text || 'nothing sent' });
});

// Matching engine routes (owner D, shipped by B to unblock UI work).
app.use('/api', require('./routes/rank'));

const { getSupabase, isConfigured } = require('./supabaseClient');

// Test Supabase connection - write
app.post('/api/test-db', async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('test_items')
      .insert([{ name: 'Test item from backend' }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Test Supabase connection - read
app.get('/api/test-db', async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('test_items')
      .select('*');

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!isConfigured()) {
    console.log('Supabase not configured (no backend/.env) - /api/test-db disabled, everything else works.');
  }
});