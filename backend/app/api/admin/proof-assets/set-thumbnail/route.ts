import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const assetId = formData.get('asset_id') as string;
    const timestamp = formData.get('timestamp') as string;

    if (!file || !assetId) {
      return NextResponse.json(
        { ok: false, error: 'Missing file or asset_id' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const client = getSupabase();
    if (!client) {
      return NextResponse.json(
        { ok: false, error: 'Database unavailable' },
        { status: 503, headers: corsHeaders() }
      );
    }

    // Upload thumbnail to Supabase Storage
    const fileName = `thumbnails/${assetId}_${Date.now()}.jpg`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data: uploadData, error: uploadError } = await client.storage
      .from('proof')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error('[Set Thumbnail] Upload error:', uploadError);
      return NextResponse.json(
        { ok: false, error: uploadError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    // Get public URL
    const { data: urlData } = client.storage
      .from('proof')
      .getPublicUrl(fileName);

    const thumbnailUrl = urlData?.publicUrl;

    if (!thumbnailUrl) {
      return NextResponse.json(
        { ok: false, error: 'Failed to get public URL' },
        { status: 500, headers: corsHeaders() }
      );
    }

    // Update asset with thumbnail info
    const updatePayload: any = {
      video_thumbnail_url: thumbnailUrl,
      updated_at: new Date().toISOString(),
    };

    if (timestamp) {
      updatePayload.video_thumbnail_timestamp = parseFloat(timestamp);
    }

    const { error: updateError } = await client
      .from('h2s_proof_assets')
      .update(updatePayload)
      .eq('asset_id', assetId);

    if (updateError) {
      console.error('[Set Thumbnail] Update error:', updateError);
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        thumbnail_url: thumbnailUrl,
        timestamp: timestamp ? parseFloat(timestamp) : undefined,
      },
      { headers: corsHeaders() }
    );
  } catch (error: any) {
    console.error('[Set Thumbnail] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
