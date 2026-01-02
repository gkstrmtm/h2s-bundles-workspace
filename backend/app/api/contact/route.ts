import { NextResponse } from 'next/server';
import { getSupabaseMgmt } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, phone, message, subject } = body;

    if (!name || !email || !message) {
      return NextResponse.json({
        success: false,
        error: 'Name, email, and message are required'
      }, { status: 400, headers: corsHeaders() });
    }

    const client = getSupabaseMgmt();
    
    if (!client) {
      // If database not available, at least log it
      console.error('[Contact API] Database not available, contact form data:', {
        name, email, phone, subject, message
      });
      
      return NextResponse.json({
        success: true,
        message: 'Your message has been received. We will contact you soon.',
        note: 'Database temporarily unavailable'
      }, { headers: corsHeaders() });
    }

    // Insert contact form submission into database
    const { data, error } = await client
      .from('contact_submissions')
      .insert({
        name,
        email,
        phone,
        subject: subject || 'Contact Form',
        message,
        status: 'new',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[Contact API] Database error:', error);
      
      // Still return success to user even if DB fails
      return NextResponse.json({
        success: true,
        message: 'Your message has been received. We will contact you soon.',
        error: error.message
      }, { headers: corsHeaders() });
    }

    return NextResponse.json({
      success: true,
      message: 'Thank you for contacting us! We will get back to you soon.',
      submission: data
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Contact API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process contact form',
      details: error.message
    }, { status: 500, headers: corsHeaders() });
  }
}
