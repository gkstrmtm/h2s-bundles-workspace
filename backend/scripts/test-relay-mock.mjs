/**
 * Test Stripe Relay Integration Locally
 * 
 * This script simulates the relay service locally to test the Vercel backend changes
 * without deploying to Railway first.
 * 
 * Run this BEFORE deploying to Railway to catch integration issues early.
 */

import express from 'express';
import { createServer } from 'http';

const MOCK_RELAY_PORT = 3001;
const MOCK_RELAY_SECRET = 'test-secret-12345';

// Create mock relay server
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'h2s-stripe-relay-mock', timestamp: new Date().toISOString() });
});

app.post('/stripe/checkout', (req, res) => {
  const authHeader = req.headers.authorization;
  
  // Simulate authentication
  if (!authHeader || authHeader !== `Bearer ${MOCK_RELAY_SECRET}`) {
    console.log('[Mock Relay] ❌ Unauthorized request');
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const { sessionParams, idempotencyKey } = req.body;

  if (!sessionParams) {
    console.log('[Mock Relay] ❌ Missing sessionParams');
    return res.status(400).json({ ok: false, error: 'Missing sessionParams in request body' });
  }

  if (!idempotencyKey) {
    console.log('[Mock Relay] ❌ Missing idempotencyKey');
    return res.status(400).json({ ok: false, error: 'Missing idempotencyKey' });
  }

  // Log what we received
  console.log(`\n[Mock Relay] ✓ Received checkout request`);
  console.log(`[Mock Relay]   Idempotency key: ${idempotencyKey}`);
  console.log(`[Mock Relay]   Line items: ${sessionParams.line_items?.length || 0}`);
  console.log(`[Mock Relay]   Promo code: ${sessionParams.discounts?.[0]?.promotion_code || 'none'}`);
  console.log(`[Mock Relay]   Customer email: ${sessionParams.customer_email || 'none'}`);

  // Simulate successful Stripe response
  const mockSessionId = `cs_test_mock_${Date.now()}`;
  const mockSessionUrl = `https://checkout.stripe.com/c/pay/${mockSessionId}`;

  console.log(`[Mock Relay] ✓ Returning mock session: ${mockSessionId}`);

  return res.json({
    ok: true,
    session: {
      id: mockSessionId,
      url: mockSessionUrl
    }
  });
});

const server = createServer(app);

server.listen(MOCK_RELAY_PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Mock Stripe Relay Server Running`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Port: ${MOCK_RELAY_PORT}`);
  console.log(`Secret: ${MOCK_RELAY_SECRET}`);
  console.log(`Health: http://localhost:${MOCK_RELAY_PORT}/health`);
  console.log(`Endpoint: POST http://localhost:${MOCK_RELAY_PORT}/stripe/checkout`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`To test with Vercel backend, set these environment variables:`);
  console.log(`  STRIPE_RELAY_URL=http://localhost:${MOCK_RELAY_PORT}`);
  console.log(`  STRIPE_RELAY_SECRET=${MOCK_RELAY_SECRET}`);
  console.log(`\nPress Ctrl+C to stop\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[Mock Relay] Shutting down...');
  server.close(() => {
    console.log('[Mock Relay] Server closed');
    process.exit(0);
  });
});
