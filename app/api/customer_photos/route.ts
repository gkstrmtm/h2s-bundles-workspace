import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501',
  ];

  // Always allow all origins for now (debugging)
  const allowOrigin = '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

/**
 * POST - Upload customer planning photo
 * Body: { customer_email, job_id, data (base64), filename, mimetype }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const customerEmail = String(body?.customer_email || '').trim().toLowerCase();
    let jobId = String(body?.job_id || '').trim();
    const orderId = String(body?.order_id || '').trim();
    const data = String(body?.data || '').trim();
    const filename = String(body?.filename || 'photo.jpg');
    const mimetype = String(body?.mimetype || 'image/jpeg');
    
    if (!customerEmail || (!jobId && !orderId) || !data) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields: customer_email, (job_id or order_id), data' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    // Check feature flag (case-insensitive to handle TRUE/true)
    const featureEnabled = String(process.env.ENABLE_CUSTOMER_PHOTOS || '').toLowerCase() === 'true';
    if (!featureEnabled) {
      return NextResponse.json(
        { ok: false, error: 'Customer photo uploads not enabled', error_code: 'feature_disabled' },
        { status: 403, headers: corsHeaders(request) }
      );
    }
    
    // Validate file type
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
    if (!allowedMimes.includes(mimetype.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: 'Invalid file type. Allowed: JPEG, PNG, WEBP, HEIC, PDF' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    // Get database client
    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      return NextResponse.json(
        { ok: false, error: 'Database not configured' },
        { status: 503, headers: corsHeaders(request) }
      );
    }
    
    // If order_id provided instead of job_id, look up the job_id
    if (!jobId && orderId) {
      const { data: jobLookup, error: lookupError } = await dispatchClient
        .from('h2s_dispatch_jobs')
        .select('job_id')
        .eq('order_id', orderId)
        .single();
      
      if (lookupError || !jobLookup) {
        return NextResponse.json(
          { ok: false, error: 'No job found for this order. Please schedule your appointment first.', error_code: 'job_not_found' },
          { status: 404, headers: corsHeaders(request) }
        );
      }
      
      jobId = jobLookup.job_id;
    }
    
    // Verify customer owns this job/order
    const { data: job, error: jobError } = await dispatchClient
      .from('h2s_dispatch_jobs')
      .select('job_id, customer_id, customer_email')
      .eq('job_id', jobId)
      .single();
    
    if (jobError || !job) {
      return NextResponse.json(
        { ok: false, error: 'Job not found', error_code: 'job_not_found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }
    
    if (job.customer_email?.toLowerCase() !== customerEmail) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: This job belongs to a different customer', error_code: 'forbidden' },
        { status: 403, headers: corsHeaders(request) }
      );
    }
    
    // Check existing upload count
    const maxPhotos = parseInt(process.env.MAX_PHOTOS_PER_JOB || '12');
    const { count: existingCount } = await dispatchClient
      .from('job_customer_uploads')
      .select('upload_id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .is('deleted_at', null);
    
    if (existingCount && existingCount >= maxPhotos) {
      return NextResponse.json(
        { ok: false, error: `Maximum ${maxPhotos} photos per job`, error_code: 'max_photos_exceeded' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    // Calculate file size (base64 decode approx)
    const base64Length = data.length - (data.indexOf(',') + 1);
    const fileSize = Math.floor((base64Length * 3) / 4);
    const maxSizeMB = parseInt(process.env.MAX_PHOTO_SIZE_MB || '10');
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    
    if (fileSize > maxSizeBytes) {
      return NextResponse.json(
        { ok: false, error: `File too large. Maximum ${maxSizeMB}MB`, error_code: 'file_too_large' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    // Upload to storage (reuse existing storage logic)
    const storagePath = `customer-uploads/${jobId}/${Date.now()}-${filename}`;
    const base64Data = data.split(',')[1] || data;
    const buffer = Buffer.from(base64Data, 'base64');
    
    const { data: uploadData, error: uploadError } = await dispatchClient.storage
      .from('h2s-job-artifacts')
      .upload(storagePath, buffer, {
        contentType: mimetype,
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      console.error('[customer_upload] Storage upload failed:', uploadError);
      return NextResponse.json(
        { ok: false, error: 'Upload failed: ' + uploadError.message },
        { status: 500, headers: corsHeaders(request) }
      );
    }
    
    // Get public URL
    const { data: publicUrlData } = dispatchClient.storage
      .from('h2s-job-artifacts')
      .getPublicUrl(storagePath);
    
    const fileUrl = publicUrlData?.publicUrl || '';
    
    // Insert upload record
    const { data: uploadRecord, error: insertError } = await dispatchClient
      .from('job_customer_uploads')
      .insert({
        job_id: jobId,
        customer_id: job.customer_id || job.customer_email || customerEmail, // Use email as fallback if customer_id is null
        source: 'customer',
        kind: 'planning',
        file_url: fileUrl,
        file_mime: mimetype,
        file_size: fileSize,
        storage_path: storagePath,
        analysis_status: 'NOT_RUN',
        visibility: 'tech_only',
        uploader_ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[customer_upload] Insert failed:', insertError);
      console.error('[customer_upload] Insert error details:', JSON.stringify(insertError, null, 2));
      // Clean up storage
      await dispatchClient.storage.from('h2s-job-artifacts').remove([storagePath]);
      return NextResponse.json(
        { ok: false, error: 'Failed to save upload record' },
        { status: 500, headers: corsHeaders(request) }
      );
    }
    
    // Enqueue AI analysis if enabled (Phase 3)
    const aiEnabled = process.env.ENABLE_AI_ANALYSIS === 'true';
    if (aiEnabled) {
      // TODO: Enqueue analysis job (implement in Phase 3)
      console.log('[customer_upload] AI analysis enqueued for upload_id:', uploadRecord.upload_id);
    }
    
    return NextResponse.json(
      {
        ok: true,
        upload: {
          upload_id: uploadRecord.upload_id,
          job_id: uploadRecord.job_id,
          file_url: uploadRecord.file_url,
          file_mime: uploadRecord.file_mime,
          file_size: uploadRecord.file_size,
          created_at: uploadRecord.created_at,
          analysis_status: uploadRecord.analysis_status
        }
      },
      { status: 201, headers: corsHeaders(request) }
    );
    
  } catch (e: any) {
    console.error('[customer_upload] Error:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

/**
 * GET - List customer photos for a job
 * Query: ?customer_email=...&job_id=... OR ?token=...(tech)&job_id=...
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const customerEmail = url.searchParams.get('customer_email')?.toLowerCase() || '';
    let jobId = url.searchParams.get('job_id') || '';
    const orderId = url.searchParams.get('order_id') || '';
    const token = url.searchParams.get('token') || '';
    
    if (!jobId && !orderId) {
      return NextResponse.json(
        { ok: false, error: 'Missing job_id or order_id' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      return NextResponse.json(
        { ok: false, error: 'Database not configured' },
        { status: 503, headers: corsHeaders(request) }
      );
    }
    
    // If order_id provided instead of job_id, look up the job_id
    if (!jobId && orderId) {
      const { data: jobLookup } = await dispatchClient
        .from('h2s_dispatch_jobs')
        .select('job_id')
        .eq('order_id', orderId)
        .single();
      
      if (jobLookup) {
        jobId = jobLookup.job_id;
      } else {
        // No job yet - return empty array (order not scheduled)
        return NextResponse.json(
          { ok: true, uploads: [] },
          { headers: corsHeaders(request) }
        );
      }
    }
    
    // Verify access (customer or tech)
    let authorized = false;
    
    if (customerEmail) {
      // Customer access
      const { data: job } = await dispatchClient
        .from('h2s_dispatch_jobs')
        .select('customer_email')
        .eq('job_id', jobId)
        .single();
      
      authorized = job?.customer_email?.toLowerCase() === customerEmail;
    } else if (token) {
      // Tech access (verify token - allow any authenticated pro or admin to view)
      try {
        const { verifyPortalToken } = await import('@/lib/portalTokens');
        const payload = verifyPortalToken(token);
        
        if (payload.role === 'pro' || payload.role === 'admin') {
          // Allow any authenticated tech to view photos (they need to see before accepting)
          console.log('[customer_photos] Tech access granted:', payload.role, payload.sub);
          authorized = true;
        }
      } catch (e) {
        console.error('[customer_photos] Token verification failed:', e);
        // Invalid token
      }
    }
    
    if (!authorized) {
      console.log('[customer_photos] Unauthorized access attempt for job:', jobId);
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', error_code: 'forbidden' },
        { status: 403, headers: corsHeaders(request) }
      );
    }
    
    console.log('[customer_photos] Fetching uploads for job_id:', jobId);
    
    // Fetch uploads
    const { data: uploads, error } = await dispatchClient
      .from('job_customer_uploads')
      .select('upload_id, file_url, file_mime, file_size, created_at, analysis_status, analysis_notes')
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('[customer_upload] Fetch error:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch uploads' },
        { status: 500, headers: corsHeaders(request) }
      );
    }
    
    console.log('[customer_photos] Found', uploads?.length || 0, 'uploads');
    
    return NextResponse.json(
      { ok: true, uploads: uploads || [] },
      { headers: corsHeaders(request) }
    );
    
  } catch (e: any) {
    console.error('[customer_upload] GET error:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

/**
 * DELETE - Remove customer photo (soft delete)
 * Body: { customer_email, upload_id }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    
    const customerEmail = String(body?.customer_email || '').trim().toLowerCase();
    const uploadId = String(body?.upload_id || '').trim();
    
    if (!customerEmail || !uploadId) {
      return NextResponse.json(
        { ok: false, error: 'Missing customer_email or upload_id' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      return NextResponse.json(
        { ok: false, error: 'Database not configured' },
        { status: 503, headers: corsHeaders(request) }
      );
    }
    
    // Verify ownership
    const { data: upload } = await dispatchClient
      .from('job_customer_uploads')
      .select('upload_id, job_id, customer_id')
      .eq('upload_id', uploadId)
      .is('deleted_at', null)
      .single();
    
    if (!upload) {
      return NextResponse.json(
        { ok: false, error: 'Upload not found', error_code: 'upload_not_found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }
    
    // Verify customer owns job
    const { data: job } = await dispatchClient
      .from('h2s_dispatch_jobs')
      .select('customer_email, status')
      .eq('job_id', upload.job_id)
      .single();
    
    if (!job || job.customer_email?.toLowerCase() !== customerEmail) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', error_code: 'forbidden' },
        { status: 403, headers: corsHeaders(request) }
      );
    }
    
    // Prevent deletion if job already started
    const allowedStatuses = ['pending_assign', 'offer_sent'];
    if (!allowedStatuses.includes(job.status)) {
      return NextResponse.json(
        { ok: false, error: 'Cannot delete photos after job has started', error_code: 'job_in_progress' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    
    // Soft delete
    const { error: deleteError } = await dispatchClient
      .from('job_customer_uploads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('upload_id', uploadId);
    
    if (deleteError) {
      console.error('[customer_upload] Delete error:', deleteError);
      return NextResponse.json(
        { ok: false, error: 'Failed to delete upload' },
        { status: 500, headers: corsHeaders(request) }
      );
    }
    
    return NextResponse.json(
      { ok: true, message: 'Upload deleted successfully' },
      { headers: corsHeaders(request) }
    );
    
  } catch (e: any) {
    console.error('[customer_upload] DELETE error:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
