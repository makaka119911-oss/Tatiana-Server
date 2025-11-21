// ultra-simple-server.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

// Simple health check
app.get('/api/health', (req, res) => {
  console.log('✅ Health check received');
  res.json({ 
    status: 'ok', 
    message: 'Server is running!',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  console.log('✅ Test endpoint called');
  res.json({ 
    message: 'Test successful!',
    data: { test: 'works' },
    timestamp: new Date().toISOString()
  });
});

// Registration endpoint
app.post('/api/register', (req, res) => {
  console.log('📝 Registration:', req.body);
  res.json({ 
    success: true, 
    message: 'Received registration data',
    registrationId: 'T' + Date.now()
  });
});

// Catch-all for debugging
app.all('*', (req, res) => {
  console.log('📨 Request received:', req.method, req.url);
  res.json({ 
    method: req.method,
    path: req.path,
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Ultra-simple server running on port ${PORT}`);
  console.log(`📍 Endpoints available:`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/test`);
  console.log(`   POST /api/register`);
});
