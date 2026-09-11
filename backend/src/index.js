require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple GET route
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from the backend!' });
});

// Simple POST route
app.post('/api/echo', (req, res) => {
  const { text } = req.body;
  res.json({ received: text || 'nothing sent' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});