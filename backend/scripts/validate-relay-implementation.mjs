#!/usr/bin/env node

/**
 * Pre-Deployment Validation Script
 * 
 * Checks that all required files exist and have correct structure
 * before deploying the Stripe relay service.
 * 
 * Run this BEFORE deploying to catch any missing pieces.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, '../..');

console.log('🔍 Validating Stripe Relay Implementation...\n');

let allPassed = true;
let errorCount = 0;
let warningCount = 0;

function check(description, test) {
  if (test) {
    console.log(`✓ ${description}`);
    return true;
  } else {
    console.log(`❌ ${description}`);
    allPassed = false;
    errorCount++;
    return false;
  }
}

function warn(description) {
  console.log(`⚠️  ${description}`);
  warningCount++;
}

// Check relay service files
console.log('1. Relay Service Files:');
check('relay/server.js exists', existsSync(resolve(workspaceRoot, 'relay/server.js')));
check('relay/package.json exists', existsSync(resolve(workspaceRoot, 'relay/package.json')));
check('relay/railway.json exists', existsSync(resolve(workspaceRoot, 'relay/railway.json')));
check('relay/.env.example exists', existsSync(resolve(workspaceRoot, 'relay/.env.example')));
check('relay/README.md exists', existsSync(resolve(workspaceRoot, 'relay/README.md')));

// Check backend changes
console.log('\n2. Backend Changes:');
const shopRoutePath = resolve(workspaceRoot, 'backend/app/api/shop/route.ts');
if (existsSync(shopRoutePath)) {
  const shopRouteContent = readFileSync(shopRoutePath, 'utf-8');
  
  check('shop/route.ts updated with relay call', shopRouteContent.includes('STRIPE_RELAY_URL'));
  check('shop/route.ts has idempotency key', shopRouteContent.includes('idempotencyKey'));
  check('shop/route.ts has relay error handling', shopRouteContent.includes('Unable to connect to payment system'));
  check('shop/route.ts generates orderId before Stripe', shopRouteContent.includes('Generate order ID BEFORE calling Stripe'));
  
  // Check for old direct Stripe call (should be replaced)
  if (shopRouteContent.includes('await stripe.checkout.sessions.create(sessionParams)') && 
      !shopRouteContent.includes('// OLD')) {
    warn('Found direct Stripe call - should be replaced with relay fetch');
  }
} else {
  check('backend/app/api/shop/route.ts exists', false);
}

// Check documentation
console.log('\n3. Documentation:');
check('STRIPE_RELAY_IMPLEMENTATION.md exists', existsSync(resolve(workspaceRoot, 'STRIPE_RELAY_IMPLEMENTATION.md')));
check('STRIPE_RELAY_DEPLOYMENT.md exists', existsSync(resolve(workspaceRoot, 'STRIPE_RELAY_DEPLOYMENT.md')));
check('backend/STRIPE_RELAY_SETUP.md exists', existsSync(resolve(workspaceRoot, 'backend/STRIPE_RELAY_SETUP.md')));

// Check test scripts
console.log('\n4. Test Scripts:');
check('backend/scripts/test-relay-mock.mjs exists', existsSync(resolve(workspaceRoot, 'backend/scripts/test-relay-mock.mjs')));
check('backend/scripts/simulateCheckoutPromo.mjs exists', existsSync(resolve(workspaceRoot, 'backend/scripts/simulateCheckoutPromo.mjs')));

// Check relay service structure
console.log('\n5. Relay Service Configuration:');
const relayPackagePath = resolve(workspaceRoot, 'relay/package.json');
if (existsSync(relayPackagePath)) {
  const relayPackage = JSON.parse(readFileSync(relayPackagePath, 'utf-8'));
  
  check('relay has express dependency', relayPackage.dependencies?.express);
  check('relay has stripe dependency', relayPackage.dependencies?.stripe);
  check('relay has cors dependency', relayPackage.dependencies?.cors);
  check('relay has start script', relayPackage.scripts?.start === 'node server.js');
  check('relay uses ES modules', relayPackage.type === 'module');
}

const relayServerPath = resolve(workspaceRoot, 'relay/server.js');
if (existsSync(relayServerPath)) {
  const relayServer = readFileSync(relayServerPath, 'utf-8');
  
  check('relay has /health endpoint', relayServer.includes('app.get(\'/health\''));
  check('relay has /stripe/checkout endpoint', relayServer.includes('app.post(\'/stripe/checkout\''));
  check('relay has authentication middleware', relayServer.includes('function authenticate'));
  check('relay validates idempotencyKey', relayServer.includes('if (!idempotencyKey)'));
  check('relay uses Stripe idempotency', relayServer.includes('{ idempotencyKey }'));
  check('relay has CORS configuration', relayServer.includes('allowedOrigins'));
}

// Environment variable checklist
console.log('\n6. Environment Variables Required:');
console.log('   Railway (relay service):');
console.log('   - STRIPE_SECRET_KEY (same as Vercel currently uses)');
console.log('   - RELAY_SECRET (generate with: openssl rand -hex 32)');
console.log('   - PORT (Railway sets automatically)');
console.log('\n   Vercel (backend):');
console.log('   - STRIPE_RELAY_URL (Railway service URL)');
console.log('   - STRIPE_RELAY_SECRET (same as Railway RELAY_SECRET)');

// Summary
console.log('\n' + '='.repeat(60));
if (allPassed && warningCount === 0) {
  console.log('✅ All checks passed! Ready for deployment.');
  console.log('\nNext steps:');
  console.log('1. cd relay/ && railway login && railway init');
  console.log('2. railway variables set STRIPE_SECRET_KEY=sk_live_...');
  console.log('3. railway variables set RELAY_SECRET=$(openssl rand -hex 32)');
  console.log('4. railway up');
  console.log('5. railway domain  # Get URL for Vercel');
  console.log('6. Add STRIPE_RELAY_URL and STRIPE_RELAY_SECRET to Vercel');
  console.log('7. Deploy backend: git push origin main');
  console.log('8. Test: node backend/scripts/simulateCheckoutPromo.mjs');
  console.log('\nSee STRIPE_RELAY_DEPLOYMENT.md for detailed instructions.');
} else {
  console.log(`❌ Validation failed with ${errorCount} errors and ${warningCount} warnings.`);
  console.log('\nFix the errors above before deploying.');
  process.exit(1);
}
console.log('='.repeat(60));
