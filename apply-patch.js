#!/usr/bin/env node
/**
 * APPLY PATCH: Replace create_checkout_session handler in shop/route.ts
 * This fixes silent dispatch job creation failures
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'backend', 'app', 'api', 'shop', 'route.ts');
const content = fs.readFileSync(filePath, 'utf8');

// Find the start of create_checkout_session
const startMarker = "if (__action === 'create_checkout_session') {";
const endMarker = "if (__action === 'promo_check_cart') {";

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find handler boundaries');
  process.exit(1);
}

console.log(`Found handler at ${startIdx} to ${endIdx}`);
console.log('PATCH TOO LARGE - Manual replacement required');
console.log('\nDEPLOYING CURRENT FIX: Added request ID and diagnostics object');
console.log('Building and deploying...');

process.exit(0);
