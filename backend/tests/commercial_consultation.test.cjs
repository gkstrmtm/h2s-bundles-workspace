const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildApprovalLinks,
  buildSlotSuggestions,
  canTransitionConsultationStatus,
  computeAssessmentCompletion,
  computeLeadPriority,
  generateConsultationReference,
  generateResponseToken,
  normalizeCommercialLeadInput
} = require('../lib/commercial_consultation.js');

test('normalizeCommercialLeadInput sanitizes commercial lead payloads', () => {
  const result = normalizeCommercialLeadInput({
    name: '  Alex Morgan  ',
    companyName: '  First Church Campus  ',
    email: '  SALES@EXAMPLE.COM ',
    phone: '(555) 321-6789',
    contactPreference: 'CALL',
    serviceNeeds: [' Security Cameras ', 'security cameras', 'WiFi Upgrades'],
    projectPhotoUrls: ['http://bad.test/one', 'https://good.test/two.jpg'],
    assessmentAnswers: {
      decisionMaker: 'yes',
      notes: '  Need a walkthrough for sanctuary and offices. '
    }
  });

  assert.equal(result.fullName, 'Alex Morgan');
  assert.equal(result.companyName, 'First Church Campus');
  assert.equal(result.email, 'sales@example.com');
  assert.equal(result.phone, '+15553216789');
  assert.equal(result.contactPreference, 'call');
  assert.deepEqual(result.serviceNeeds, ['Security Cameras', 'WiFi Upgrades']);
  assert.deepEqual(result.projectPhotoUrls, ['https://good.test/two.jpg']);
  assert.equal(result.assessmentAnswers.decisionMaker, 'yes');
});

test('computeAssessmentCompletion distinguishes partial and qualified leads', () => {
  const partial = computeAssessmentCompletion({
    phone: '5553216789',
    serviceNeeds: ['Security Cameras']
  });
  assert.equal(partial.bucket, 'contact_only');

  const qualified = computeAssessmentCompletion({
    fullName: 'Alex Morgan',
    companyName: 'Northside Offices',
    email: 'ops@northside.test',
    projectCity: 'Atlanta',
    scopeSummary: 'Replace exterior cameras and add lobby display',
    timeline: '2_weeks',
    budgetBand: '10k_plus',
    serviceNeeds: ['Security Cameras', 'Commercial Displays'],
    siteCount: 2,
    assessmentAnswers: {
      buildingType: 'office',
      decisionMaker: true,
      existingSystem: 'legacy analog cameras'
    }
  });

  assert.equal(qualified.bucket, 'qualified');
  assert.ok(qualified.score >= 75);
});

test('computeLeadPriority escalates urgent commercial opportunities', () => {
  const priority = computeLeadPriority({
    companyName: 'Harbor Retail Group',
    phone: '5553216789',
    timeline: 'asap',
    budgetBand: '25k_plus',
    siteCount: 4,
    serviceNeeds: ['Security Cameras', 'Structured Cabling', 'Commercial Audio'],
    scopeSummary: 'Urgent camera outage after a break-in across multiple stores.',
    assessmentAnswers: {
      decisionMaker: true,
      securityIncident: true
    }
  });

  assert.equal(priority, 'urgent');
});

test('buildSlotSuggestions returns future weekday windows with consistent duration', () => {
  const now = new Date('2026-04-03T20:00:00.000Z');
  const slots = buildSlotSuggestions({ now, count: 3, durationMinutes: 45 });

  assert.equal(slots.length, 3);
  for (const slot of slots) {
    const start = new Date(slot.startIso);
    const end = new Date(slot.endIso);
    assert.ok(start.getTime() > now.getTime());
    assert.equal((end.getTime() - start.getTime()) / 60000, 45);
    assert.notEqual(start.getDay(), 0);
    assert.notEqual(start.getDay(), 6);
  }
});

test('consultation references and response tokens are non-empty and transitions stay constrained', () => {
  const reference = generateConsultationReference();
  const token = generateResponseToken();
  const links = buildApprovalLinks('https://shop.home2smart.com', token);

  assert.match(reference, /^COM-[0-9A-F]{6}$/);
  assert.ok(token.length >= 20);
  assert.match(links.approveUrl, /commercial-approval\?token=/);
  assert.equal(canTransitionConsultationStatus('pending', 'approved'), true);
  assert.equal(canTransitionConsultationStatus('approved', 'pending'), false);
  assert.equal(canTransitionConsultationStatus('declined', 'customer_confirmed'), false);
});