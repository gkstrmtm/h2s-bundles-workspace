// Central API for sending management/internal notifications
// Handles SMS + Email to management team for critical events (job bookings, high-value orders, etc.)

import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';

// Management contacts configuration
const MANAGEMENT_CONTACTS = {
  phones: [
    "+18644502445",  // Management 1
    "+18643239776",  // Management 2
    "+19513318992",  // Management 3
    "+18643235087"   // Management 4
  ],
  
  // Alert thresholds
  highValueThreshold: 500, // Orders over $500 trigger high-value alert
  
  // Alert preferences
  notifications: {
    newBookings: true,
    highValueOrders: true,
    proAssignmentFailures: true,
    quoteRequests: true
  }
};

// SMS Templates
const SMS_TEMPLATES: Record<string, string> = {
  newBooking: "🔔 NEW BOOKING: {service} for {customerName} in {city}, {state}. Order #{orderNumber} - ${amount}. Phone: {phone}",
  highValueOrder: "💰 HIGH VALUE ORDER: {service} for {customerName} - ${amount}! Order #{orderNumber}. Phone: {phone}. Location: {city}, {state}",
  quoteRequest: "📋 QUOTE REQUEST: {service} in {city}, {state}. Customer: {customerName} ({phone}). Email: {email}",
  proAssignmentFailure: "⚠️ PRO ASSIGNMENT FAILED: Job #{jobId} for {service} in {city}, {state}. Needs manual assignment.",
  proDeclined: "❌ PRO DECLINED: {proName} declined job #{jobId} ({service}). Reason: {reason}. Reassigning..."
};

// Initialize Twilio client
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data } = body;

    if (!type || !data) {
      return NextResponse.json(
        { error: 'Missing required fields: type, data' },
        { status: 400 }
      );
    }

    // Check if this notification type is enabled
    const notificationEnabled = (MANAGEMENT_CONTACTS.notifications as any)[type] !== false;
    
    if (!notificationEnabled) {
      console.log(`[Notify Management] ${type} notifications disabled`);
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'notification_type_disabled'
      });
    }

    const results: any = {
      type,
      sms: []
    };

    // Send SMS to all management phones
    if (twilioClient && MANAGEMENT_CONTACTS.phones.length > 0) {
      // Get SMS template and populate with data
      let smsMessage = SMS_TEMPLATES[type] || `Alert: ${type} - ${JSON.stringify(data)}`;
      
      // Replace placeholders
      Object.keys(data).forEach(key => {
        const value = data[key] || '';
        smsMessage = smsMessage.replace(new RegExp(`{${key}}`, 'g'), String(value));
      });

      // Deduplicate phone numbers
      const uniquePhones = Array.from(new Set(MANAGEMENT_CONTACTS.phones));

      for (const phone of uniquePhones) {
        try {
          const message = await twilioClient.messages.create({
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
          });

          results.sms.push({
            phone,
            success: true,
            sid: message.sid
          });
          console.log(`[Notify Management] SMS sent to ${phone} (SID: ${message.sid})`);
        } catch (err: any) {
          console.error(`[Notify Management] SMS failed for ${phone}:`, err.message);
          results.sms.push({
            phone,
            success: false,
            error: err.message
          });
        }
      }
    } else {
      console.warn('[Notify Management] Twilio not configured or no management phones');
      results.warning = 'Twilio not configured or no management phones';
    }

    return NextResponse.json({
      ok: true,
      ...results,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[Notify Management] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Allow OPTIONS for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
