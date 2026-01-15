import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Validate environment variables
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('FATAL: STRIPE_SECRET_KEY not set');
  process.exit(1);
}

if (!process.env.RELAY_SECRET) {
  console.error('FATAL: RELAY_SECRET not set');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  timeout: 25000,
  maxNetworkRetries: 3
});

// CORS configuration - only allow Vercel backend
const allowedOrigins = [
  'https://h2s-backend.vercel.app',
  'http://localhost:3000' // For local testing
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json({ limit: '10mb' }));

// Authentication middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.RELAY_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'h2s-stripe-relay', timestamp: new Date().toISOString() });
});

// Stripe checkout session creation endpoint
app.post('/stripe/checkout', authenticate, async (req, res) => {
  const { sessionParams, idempotencyKey } = req.body;

  if (!sessionParams) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Missing sessionParams in request body' 
    });
  }

  if (!idempotencyKey) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Missing idempotencyKey - required to prevent duplicate charges' 
    });
  }

  try {
    console.log(`[Relay] Creating checkout session with idempotency key: ${idempotencyKey}`);
    console.log(`[Relay] Line items count: ${sessionParams.line_items?.length || 0}`);
    console.log(`[Relay] Promo code: ${sessionParams.discounts?.[0]?.promotion_code || 'none'}`);

    const session = await stripe.checkout.sessions.create(
      sessionParams,
      { idempotencyKey } // Stripe idempotency key prevents duplicate charges
    );

    console.log(`[Relay] ✓ Session created: ${session.id}, URL: ${session.url}`);

    return res.json({
      ok: true,
      session: {
        id: session.id,
        url: session.url
      }
    });

  } catch (error) {
    console.error('[Relay] Stripe checkout session creation failed:', error.message);
    console.error('[Relay] Error type:', error.type);
    console.error('[Relay] Error code:', error.code);

    return res.status(500).json({
      ok: false,
      error: error.message,
      type: error.type,
      code: error.code
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Relay] Unhandled error:', err);
  res.status(500).json({ ok: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`[Relay] Stripe relay service running on port ${PORT}`);
  console.log(`[Relay] Health check: http://localhost:${PORT}/health`);
  console.log(`[Relay] Stripe endpoint: POST /stripe/checkout`);
});
