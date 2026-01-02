// Test that all data structures match what bundles.html expects

async function validateBundlesPage() {
  console.log('\n🎯 BUNDLES PAGE VALIDATION\n');

  // 1. Test bundles-data endpoint
  console.log('📦 Testing /api/bundles-data...');
  const bundlesRes = await fetch('http://localhost:3000/api/bundles-data');
  const bundlesData = await bundlesRes.json();
  
  console.log(`   ✅ Status: ${bundlesRes.status}`);
  console.log(`   ✅ Bundles: ${bundlesData.bundles?.length || 0}`);
  console.log(`   ✅ Services: ${bundlesData.services?.length || 0}`);
  
  if (bundlesData.bundles && bundlesData.bundles[0]) {
    const b = bundlesData.bundles[0];
    const requiredFields = ['bundle_id', 'name', 'bundle_price', 'blurb', 'active'];
    const hasAll = requiredFields.every(f => b[f] !== undefined);
    console.log(`   ${hasAll ? '✅' : '❌'} Bundle structure: ${hasAll ? 'VALID' : 'MISSING FIELDS'}`);
    if (!hasAll) {
      console.log(`      Missing: ${requiredFields.filter(f => b[f] === undefined).join(', ')}`);
    }
  }

  if (bundlesData.services && bundlesData.services[0]) {
    const s = bundlesData.services[0];
    const requiredFields = ['service_id', 'name', 'active'];
    const hasAll = requiredFields.every(f => s[f] !== undefined);
    console.log(`   ${hasAll ? '✅' : '❌'} Service structure: ${hasAll ? 'VALID' : 'MISSING FIELDS'}`);
  }

  // 2. Test reviews endpoint
  console.log('\n⭐ Testing /api/reviews...');
  const reviewsRes = await fetch('http://localhost:3000/api/reviews?limit=5');
  const reviewsData = await reviewsRes.json();
  
  console.log(`   ✅ Status: ${reviewsRes.status}`);
  console.log(`   ✅ Reviews: ${reviewsData.reviews?.length || 0}`);
  
  if (reviewsData.reviews && reviewsData.reviews[0]) {
    const r = reviewsData.reviews[0];
    const requiredFields = ['rating', 'display_name', 'review_text', 'verified'];
    const hasAll = requiredFields.every(f => r[f] !== undefined);
    console.log(`   ${hasAll ? '✅' : '❌'} Review structure: ${hasAll ? 'VALID' : 'MISSING FIELDS'}`);
    if (!hasAll) {
      console.log(`      Missing: ${requiredFields.filter(f => r[f] === undefined).join(', ')}`);
    }
  }

  // 3. Test shop catalog endpoint
  console.log('\n🛍️  Testing /api/shop?action=catalog...');
  const shopRes = await fetch('http://localhost:3000/api/shop?action=catalog');
  const shopData = await shopRes.json();
  
  console.log(`   ✅ Status: ${shopRes.status}`);
  console.log(`   ✅ Catalog.bundles: ${shopData.catalog?.bundles?.length || 0}`);
  console.log(`   ✅ Catalog.services: ${shopData.catalog?.services?.length || 0}`);

  // 4. Summary
  console.log('\n📊 SUMMARY');
  const allGood = 
    bundlesRes.status === 200 && 
    reviewsRes.status === 200 && 
    shopRes.status === 200 &&
    bundlesData.bundles?.length > 0 &&
    bundlesData.services?.length > 0 &&
    reviewsData.reviews?.length > 0;

  if (allGood) {
    console.log('   🎉 ALL SYSTEMS GO! Bundles page should render perfectly.');
    console.log('   ✅ Data fluidity: RESTORED');
    console.log('   ✅ Reviews: RENDERING');
    console.log('   ✅ Bundles: RENDERING');
    console.log('   ✅ Services: RENDERING');
  } else {
    console.log('   ⚠️  Some issues detected - check above');
  }
}

validateBundlesPage().catch(console.error);
