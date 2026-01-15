#!/usr/bin/env node
/**
 * ACCOUNT TAB - IMAGE UPLOAD TEST MATRIX
 * 
 * Tests customer photo upload functionality with 6 scenarios:
 * 1. Upload 1 image (jpg) → PASS
 * 2. Upload 5 images (mixed jpg/png) → PASS
 * 3. Upload invalid file type → FAIL cleanly
 * 4. Upload oversized file (>10MB) → FAIL cleanly
 * 5. Upload with missing linkage → FAIL cleanly
 * 6. Persistence test → Images persist after refresh
 * 
 * Usage:
 *   node scripts/test_account_image_upload.mjs
 * 
 * Requirements:
 *   - Backend deployed with ENABLE_CUSTOMER_PHOTOS=true
 *   - Valid test order with job_id
 */

import https from 'https';
import http from 'http';

const BACKEND_URL = process.env.BACKEND_URL || 'https://h2s-backend.vercel.app';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@home2smart.com';
const TEST_JOB_ID = process.env.TEST_JOB_ID || 'job_test_photos_123';
const TEST_ORDER_ID = process.env.TEST_ORDER_ID || '';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const results = {
  passed: 0,
  failed: 0,
  total: 6,
  startTime: Date.now(),
};

/**
 * HTTP POST helper
 */
function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    
    const req = lib.request(parsedUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * HTTP GET helper
 */
function get(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = lib.request(parsedUrl, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

/**
 * Generate test image data (base64)
 */
function generateTestImage(sizeKB = 100, format = 'jpeg') {
  // Generate random data to approximate image size
  const dataSize = sizeKB * 1024;
  const buffer = Buffer.alloc(dataSize);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  const base64 = buffer.toString('base64');
  
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 
                   format === 'png' ? 'image/png' : 
                   format === 'pdf' ? 'application/pdf' : 'image/jpeg';
  
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Test runner
 */
async function runTest(testNum, description, testFn, shouldPass = true) {
  const testLabel = `Test ${testNum}: ${description}`;
  console.log(`\n${CYAN}${BOLD}━━━ ${testLabel} ━━━${RESET}`);
  
  try {
    const result = await testFn();
    
    if (result.passed) {
      console.log(`${GREEN}✓ PASS${RESET}: ${result.message}`);
      if (result.details) {
        console.log(`${CYAN}Details:${RESET}`, JSON.stringify(result.details, null, 2));
      }
      results.passed++;
    } else {
      console.log(`${RED}✗ FAIL${RESET}: ${result.message}`);
      if (result.details) {
        console.log(`${YELLOW}Details:${RESET}`, JSON.stringify(result.details, null, 2));
      }
      results.failed++;
    }
  } catch (error) {
    console.log(`${RED}✗ ERROR${RESET}: ${error.message}`);
    console.error(error);
    results.failed++;
  }
}

/**
 * TEST 1: Upload 1 image (jpg)
 */
async function test1_uploadSingleImage() {
  const imageData = generateTestImage(500, 'jpeg'); // 500KB
  
  const payload = JSON.stringify({
    customer_email: TEST_EMAIL,
    job_id: TEST_JOB_ID,
    data: imageData,
    filename: 'test_single.jpg',
    mimetype: 'image/jpeg',
  });
  
  const res = await post(`${BACKEND_URL}/api/customer_photos`, payload);
  
  if (res.status === 201 && res.body.ok) {
    return {
      passed: true,
      message: 'Single image uploaded successfully',
      details: {
        upload_id: res.body.upload?.upload_id,
        file_size: res.body.upload?.file_size,
        file_url: res.body.upload?.file_url,
      },
    };
  } else {
    return {
      passed: false,
      message: `Upload failed with status ${res.status}`,
      details: res.body,
    };
  }
}

/**
 * TEST 2: Upload 5 images (mixed jpg/png)
 */
async function test2_uploadMultipleImages() {
  const uploadedIds = [];
  
  for (let i = 0; i < 5; i++) {
    const format = i % 2 === 0 ? 'jpeg' : 'png';
    const imageData = generateTestImage(300, format);
    
    const payload = JSON.stringify({
      customer_email: TEST_EMAIL,
      job_id: TEST_JOB_ID,
      data: imageData,
      filename: `test_multi_${i + 1}.${format}`,
      mimetype: `image/${format}`,
    });
    
    const res = await post(`${BACKEND_URL}/api/customer_photos`, payload);
    
    if (res.status !== 201 || !res.body.ok) {
      return {
        passed: false,
        message: `Failed to upload image ${i + 1}/5`,
        details: res.body,
      };
    }
    
    uploadedIds.push(res.body.upload.upload_id);
  }
  
  return {
    passed: true,
    message: 'All 5 images uploaded successfully',
    details: { uploaded_ids: uploadedIds },
  };
}

/**
 * TEST 3: Upload invalid file type (text/plain)
 */
async function test3_uploadInvalidType() {
  const invalidData = 'data:text/plain;base64,SGVsbG8gV29ybGQ='; // "Hello World"
  
  const payload = JSON.stringify({
    customer_email: TEST_EMAIL,
    job_id: TEST_JOB_ID,
    data: invalidData,
    filename: 'test_invalid.txt',
    mimetype: 'text/plain',
  });
  
  const res = await post(`${BACKEND_URL}/api/customer_photos`, payload);
  
  // Should fail with 400 and error about invalid file type
  if (res.status === 400 && res.body.error && res.body.error.includes('Invalid file type')) {
    return {
      passed: true,
      message: 'Invalid file type rejected correctly',
      details: { error: res.body.error },
    };
  } else {
    return {
      passed: false,
      message: 'Invalid file type was not rejected properly',
      details: res.body,
    };
  }
}

/**
 * TEST 4: Upload oversized file (>10MB)
 */
async function test4_uploadOversizedFile() {
  const oversizedData = generateTestImage(12 * 1024, 'jpeg'); // 12MB
  
  const payload = JSON.stringify({
    customer_email: TEST_EMAIL,
    job_id: TEST_JOB_ID,
    data: oversizedData,
    filename: 'test_oversized.jpg',
    mimetype: 'image/jpeg',
  });
  
  const res = await post(`${BACKEND_URL}/api/customer_photos`, payload);
  
  // Should fail with 400 and error_code: file_too_large
  if (res.status === 400 && res.body.error_code === 'file_too_large') {
    return {
      passed: true,
      message: 'Oversized file rejected correctly',
      details: { error: res.body.error },
    };
  } else {
    return {
      passed: false,
      message: 'Oversized file was not rejected properly',
      details: res.body,
    };
  }
}

/**
 * TEST 5: Upload with missing linkage (no job_id or order_id)
 */
async function test5_uploadMissingLinkage() {
  const imageData = generateTestImage(100, 'jpeg');
  
  const payload = JSON.stringify({
    customer_email: TEST_EMAIL,
    // Missing job_id and order_id
    data: imageData,
    filename: 'test_no_link.jpg',
    mimetype: 'image/jpeg',
  });
  
  const res = await post(`${BACKEND_URL}/api/customer_photos`, payload);
  
  // Should fail with 400 and error about missing fields
  if (res.status === 400 && res.body.error && res.body.error.includes('Missing required fields')) {
    return {
      passed: true,
      message: 'Missing linkage rejected correctly',
      details: { error: res.body.error },
    };
  } else {
    return {
      passed: false,
      message: 'Missing linkage was not rejected properly',
      details: res.body,
    };
  }
}

/**
 * TEST 6: Persistence test - Images persist after refresh
 */
async function test6_persistenceTest() {
  // First, upload an image
  const imageData = generateTestImage(200, 'jpeg');
  
  const uploadPayload = JSON.stringify({
    customer_email: TEST_EMAIL,
    job_id: TEST_JOB_ID,
    data: imageData,
    filename: 'test_persistence.jpg',
    mimetype: 'image/jpeg',
  });
  
  const uploadRes = await post(`${BACKEND_URL}/api/customer_photos`, uploadPayload);
  
  if (uploadRes.status !== 201 || !uploadRes.body.ok) {
    return {
      passed: false,
      message: 'Failed to upload image for persistence test',
      details: uploadRes.body,
    };
  }
  
  const uploadId = uploadRes.body.upload.upload_id;
  
  // Now fetch the list of uploads to verify persistence
  const listUrl = `${BACKEND_URL}/api/customer_photos?customer_email=${encodeURIComponent(TEST_EMAIL)}&job_id=${TEST_JOB_ID}`;
  const listRes = await get(listUrl);
  
  if (listRes.status !== 200 || !listRes.body.ok) {
    return {
      passed: false,
      message: 'Failed to fetch uploads list',
      details: listRes.body,
    };
  }
  
  const uploads = listRes.body.uploads || [];
  const foundUpload = uploads.find(u => u.upload_id === uploadId);
  
  if (foundUpload) {
    return {
      passed: true,
      message: 'Upload persisted successfully',
      details: {
        upload_id: foundUpload.upload_id,
        file_url: foundUpload.file_url,
        total_uploads: uploads.length,
      },
    };
  } else {
    return {
      passed: false,
      message: 'Upload not found in list (persistence failed)',
      details: { uploads },
    };
  }
}

/**
 * Main test suite
 */
async function runAllTests() {
  console.log(`${BOLD}${CYAN}╔═══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   ACCOUNT TAB - IMAGE UPLOAD TEST MATRIX             ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════════════════════╝${RESET}`);
  console.log(`\n${YELLOW}Backend:${RESET} ${BACKEND_URL}`);
  console.log(`${YELLOW}Test Email:${RESET} ${TEST_EMAIL}`);
  console.log(`${YELLOW}Test Job ID:${RESET} ${TEST_JOB_ID}`);
  
  await runTest(1, 'Upload 1 image (jpg)', test1_uploadSingleImage);
  await runTest(2, 'Upload 5 images (mixed jpg/png)', test2_uploadMultipleImages);
  await runTest(3, 'Upload invalid file type', test3_uploadInvalidType);
  await runTest(4, 'Upload oversized file (>10MB)', test4_uploadOversizedFile);
  await runTest(5, 'Upload with missing linkage', test5_uploadMissingLinkage);
  await runTest(6, 'Persistence test', test6_persistenceTest);
  
  // Summary
  const duration = Date.now() - results.startTime;
  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}RESULTS:${RESET}`);
  console.log(`  ${GREEN}Passed: ${results.passed}/${results.total}${RESET}`);
  console.log(`  ${RED}Failed: ${results.failed}/${results.total}${RESET}`);
  console.log(`  ${YELLOW}Duration: ${duration}ms${RESET}`);
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
  
  if (results.failed === 0) {
    console.log(`${BOLD}${GREEN}✓ ALL TESTS PASSED${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${BOLD}${RED}✗ SOME TESTS FAILED${RESET}\n`);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error(`${RED}Fatal error:${RESET}`, error);
  process.exit(1);
});
