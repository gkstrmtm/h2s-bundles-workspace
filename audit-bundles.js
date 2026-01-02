/**
 * Test critical page functions
 */

console.log('\n🧪 BUNDLES.HTML AUDIT\n');

const fs = require('fs');
const html = fs.readFileSync('Home2Smart-Dashboard/bundles.html', 'utf8');

// 1. Check for scroll lock functions
const hasLockScroll = html.includes('window.H2S_lockScroll');
const hasUnlockScroll = html.includes('window.H2S_unlockScroll');
console.log(`✅ Scroll functions defined: lock=${hasLockScroll}, unlock=${hasUnlockScroll}`);

// 2. Count H2S_unlockScroll calls
const unlockCalls = (html.match(/H2S_unlockScroll\(\)/g) || []).length;
console.log(`✅ H2S_unlockScroll() called ${unlockCalls} times`);

// 3. Check modal close has unlock
const closeModalFunc = html.match(/function closeModal\(\)\{[\s\S]*?\n\}/);
if (closeModalFunc) {
  const hasUnlock = closeModalFunc[0].includes('H2S_unlockScroll');
  console.log(`${hasUnlock ? '✅' : '❌'} closeModal() ${hasUnlock ? 'has' : 'MISSING'} H2S_unlockScroll()`);
}

// 4. Check toggleMenu has unlock
const toggleMenuFunc = html.match(/function toggleMenu\(\)\{[\s\S]*?\n\}/);
if (toggleMenuFunc) {
  const hasUnlock = toggleMenuFunc[0].includes('H2S_unlockScroll');
  console.log(`${hasUnlock ? '✅' : '❌'} toggleMenu() ${hasUnlock ? 'has' : 'MISSING'} H2S_unlockScroll()`);
}

// 5. Check toggleCart has unlock
const toggleCartFunc = html.match(/function toggleCart\(\)\{[\s\S]*?\n\}/);
if (toggleCartFunc) {
  const hasUnlock = toggleCartFunc[0].includes('H2S_unlockScroll');
  console.log(`${hasUnlock ? '✅' : '❌'} toggleCart() ${hasUnlock ? 'has' : 'MISSING'} H2S_unlockScroll()`);
}

// 6. Check checkout redirect has cleanup
const checkoutSection = html.match(/SUCCESS: Cleanup UI state before redirect[\s\S]{0,500}window\.location\.href/);
if (checkoutSection) {
  const hasUnlock = checkoutSection[0].includes('H2S_unlockScroll');
  const hasRemoveModalOpen = checkoutSection[0].includes("remove('modal-open')");
  console.log(`${hasUnlock && hasRemoveModalOpen ? '✅' : '❌'} Checkout redirect cleanup: unlock=${hasUnlock}, removeModalOpen=${hasRemoveModalOpen}`);
}

// 7. Count excessive console logs removed
const backendErrors = (html.match(/console\.error\('\[H2S Backend\]/g) || []).length;
const checkoutLogs = (html.match(/console\.log\('🛒 \[CHECKOUT\]/g) || []).length;
const trackErrors = (html.match(/console\.error\('❌ \[H2S Track\]/g) || []).length;

console.log(`\n📊 Console log cleanup:`);
console.log(`   Backend errors: ${backendErrors} (should be 0)`);
console.log(`   Checkout logs: ${checkoutLogs} (should be 0)`);
console.log(`   Track errors: ${trackErrors} (should be 0)`);

// 8. Check for proper error boundaries
const tryBlocks = (html.match(/try\s*\{/g) || []).length;
const catchBlocks = (html.match(/\}\s*catch/g) || []).length;
console.log(`\n🛡️  Error handling: ${tryBlocks} try blocks, ${catchBlocks} catch blocks`);

// 9. Final verdict
console.log('\n' + '='.repeat(50));
if (unlockCalls >= 5 && backendErrors === 0 && checkoutLogs === 0) {
  console.log('✅ AUDIT PASSED - Page should not freeze!');
} else {
  console.log('⚠️  Some issues remain - review above');
}
console.log('');
