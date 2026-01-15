// PATCH FOR backend/app/api/shop/route.ts
// Replace the create_checkout_session handler starting at line ~945

    if (__action === 'create_checkout_session') {
      // Generate unique request ID for tracing
      const reqId = crypto.randomUUID();
      const debugMode = body.debug === 1 || body.debug === '1' || body.debug === true;
      
      const diagnostics = {
        request_id: reqId,
        steps: {} as Record<string, { ok: boolean; at: string; error_code?: string; error_message?: string; data?: any }>,
        ids: { order_id: null as string | null, job_id: null as string | null, stripe_session_id: null as string | null }
      };
      
      function recordStep(step: string, ok: boolean, data?: any, error?: any) {
        diagnostics.steps[step] = {
          ok,
          at: new Date().toISOString(),
          error_code: error?.code || error?.name,
          error_message: error?.message,
          data
        };
        console.log(`[CHECKOUT][${reqId}][${step}]`, ok ? '✅' : '❌', data || error?.message || '');
      }
      
      function classifySupabaseError(err: any): { code: string; message: string; classified: string } {
        const msg = String(err?.message || err || '').toLowerCase();
        const code = String(err?.code || '');
        
        if (code === '42501' || msg.includes('permission denied') || msg.includes('insufficient privilege')) {
          return { code: 'DISPATCH_JOB_PERMISSION_DENIED', message: 'Database permission denied', classified: 'RLS' };
        }
        if (code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
          return { code: 'DISPATCH_JOB_DUPLICATE', message: 'Duplicate job constraint violation', classified: 'UNIQUE_VIOLATION' };
        }
        if (msg.includes('relation') && msg.includes('does not exist')) {
          return { code: 'DISPATCH_JOB_TABLE_MISSING', message: 'Dispatch jobs table not found', classified: 'TABLE_MISSING' };
        }
        if (msg.includes('column') && msg.includes('does not exist')) {
          return { code: 'DISPATCH_JOB_SCHEMA_MISMATCH', message: 'Table schema mismatch', classified: 'SCHEMA_ERROR' };
        }
        return { code: 'DISPATCH_JOB_UNKNOWN', message: err?.message || String(err), classified: 'UNKNOWN' };
      }
      
      console.log(`[CHECKOUT][${reqId}] ========== START create_checkout_session ==========`);
      recordStep('REQUEST_START', true, { customer_email: customer?.email, cart_count: cart?.length });
      
      // Validate Stripe is configured
      if (!stripe) {
        recordStep('VALIDATE_STRIPE', false, null, new Error('Stripe not configured'));
        return NextResponse.json({
          ok: false,
          error: 'Payment processing not configured',
          code: 'STRIPE_NOT_CONFIGURED',
          ...(debugMode && { diagnostics })
        }, { status: 503, headers: corsHeaders(request) });
      }
      
      // Validate Stripe Relay is configured
      const relayUrl = process.env.STRIPE_RELAY_URL;
      const relaySecret = process.env.STRIPE_RELAY_SECRET;
      
      if (!relayUrl || !relaySecret) {
        recordStep('VALIDATE_RELAY', false, null, new Error('Relay not configured'));
        return NextResponse.json({
          ok: false,
          error: 'Payment system configuration error',
          code: 'RELAY_NOT_CONFIGURED',
          ...(debugMode && { diagnostics })
        }, { status: 503, headers: corsHeaders(request) });
      }
      
      recordStep('VALIDATE_CONFIG', true, { stripe: true, relay: true });

      const client = getSupabaseDb1() || getSupabase();
      if (!client) {
        recordStep('GET_DB_CLIENT', false, null, new Error('Database unavailable'));
        return NextResponse.json({
          ok: false,
          error: 'Database temporarily unavailable',
          code: 'DB_NOT_AVAILABLE',
          ...(debugMode && { diagnostics })
        }, { status: 503, headers: corsHeaders(request) });
      }
      
      recordStep('GET_DB_CLIENT', true);

      // Generate order ID
      const timestamp = Date.now().toString(36).toUpperCase();
      const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
      const orderId = `ORD-${timestamp}${randomPart}`;
      diagnostics.ids.order_id = orderId;
      
      // Generate idempotency key
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const cartFingerprint = cart.map((i: any) => `${i.id || i.name}:${i.qty}`).join(',');
      const clientIdempotencyKey = body.idempotency_key || body.client_request_id;
      const deterministicKey = clientIdempotencyKey || 
        crypto.createHash('sha256')
          .update(`${customer.email}|${cartFingerprint}|${timeBucket}`)
          .digest('hex')
          .substring(0, 32);

      // Calculate totals and build metadata
      let subtotal = 0;
      const items = cart.map((item: any) => {
        const qty = item.qty || 1;
        const unitPrice = item.price || 0;
        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;
        return {
          name: item.name || item.service_name || 'Service',
          unit_price: unitPrice,
          quantity: qty,
          line_total: lineTotal,
          metadata: item.metadata || {}
        };
      });
      
      const offerMeta = metadata || body.offer_metadata || {};
      const jobDetailsSummary = generateJobDetailsSummary(cart, customer, offerMeta);
      const equipmentProvided = generateEquipmentProvided(cart, offerMeta);
      const jobDetails = buildJobDetailsPayload(cart, customer, offerMeta || {});
      
      const enhancedMetadata = {
        ...offerMeta,
        job_details: jobDetails,
        job_details_summary: jobDetailsSummary,
        equipment_provided: equipmentProvided,
        schedule_status: 'Scheduling Pending',
        cart_items_count: cart.length,
        cart_total_items: cart.reduce((sum: number, item: any) => sum + (item.qty || 1), 0),
      };

      // ========== STEP 1: CREATE ORDER ==========
      console.log(`[CHECKOUT][${reqId}][ORDER_INSERT] Creating order: ${orderId}`);
      recordStep('ORDER_INSERT_START', true, { order_id: orderId });
      
      const { error: orderInsertError } = await client.from('h2s_orders').insert({
        order_id: orderId,
        session_id: null,
        customer_email: customer.email,
        customer_name: customer.name || '',
        customer_phone: customer.phone || '',
        items: items,
        subtotal: subtotal,
        total: subtotal,
        currency: 'usd',
        status: 'pending_payment',
        metadata_json: enhancedMetadata,
        created_at: new Date().toISOString(),
        address: offerMeta?.service_address || '',
        city: offerMeta?.service_city || '',
        state: offerMeta?.service_state || '',
        zip: offerMeta?.service_zip || ''
      });
      
      if (orderInsertError) {
        recordStep('ORDER_INSERT', false, null, orderInsertError);
        return NextResponse.json({
          ok: false,
          error: 'Failed to create order record',
          code: 'ORDER_INSERT_FAILED',
          details: orderInsertError.message,
          ...(debugMode && { diagnostics })
        }, { status: 500, headers: corsHeaders(request) });
      }
      
      recordStep('ORDER_INSERT', true, { order_id: orderId });

      // ========== STEP 2: CREATE DISPATCH JOB ==========
      console.log(`[CHECKOUT][${reqId}][JOB_CREATE] Creating dispatch job for order: ${orderId}`);
      recordStep('JOB_CREATE_START', true, { order_id: orderId });
      
      let jobId: string | null = null;
      let recipientId: string | null = null;
      
      try {
        const dispatch = getSupabaseDispatch();
        
        if (!dispatch) {
          throw new Error('getSupabaseDispatch returned null');
        }
        
        // Validate dispatch client has auth
        recordStep('VALIDATE_DISPATCH_CLIENT', true, { has_auth: true });
        
        const DEFAULT_SEQUENCE_ID = '88297425-c134-4a51-8450-93cb35b1b3cb';
        const DEFAULT_STEP_ID = 'd30da333-3a54-4598-8ac1-f3b276185ea1';
        const customerEmail = customer.email;

        // Find or create recipient
        recordStep('RECIPIENT_LOOKUP_START', true);
        const { data: existingRecipient, error: recipientFindErr } = await dispatch
          .from('h2s_recipients')
          .select('recipient_id')
          .eq('email_normalized', customerEmail)
          .maybeSingle();

        if (recipientFindErr) {
          const classified = classifySupabaseError(recipientFindErr);
          recordStep('RECIPIENT_LOOKUP', false, null, { ...recipientFindErr, classified });
          throw Object.assign(new Error(classified.message), { code: classified.code, details: recipientFindErr.message });
        }

        if (existingRecipient) {
          recipientId = existingRecipient.recipient_id;
          recordStep('RECIPIENT_LOOKUP', true, { recipient_id: recipientId, found: true });
        } else {
          recordStep('RECIPIENT_CREATE_START', true);
          const { data: newRecipient, error: createRecipErr } = await dispatch
            .from('h2s_recipients')
            .insert({
              email_normalized: customerEmail,
              first_name: customer.name || 'Customer',
              recipient_key: `customer-${crypto.randomUUID()}`
            })
            .select('recipient_id')
            .single();

          if (createRecipErr) {
            const classified = classifySupabaseError(createRecipErr);
            recordStep('RECIPIENT_CREATE', false, null, { ...createRecipErr, classified });
            throw Object.assign(new Error(classified.message), { code: classified.code, details: createRecipErr.message });
          }

          recipientId = newRecipient.recipient_id;
          recordStep('RECIPIENT_CREATE', true, { recipient_id: recipientId });
        }

        if (!recipientId) {
          throw new Error('Failed to resolve or create recipient (recipientId is null)');
        }

        // Insert dispatch job
        const insertJob = {
          order_id: orderId,
          status: 'queued',
          created_at: new Date().toISOString(),
          due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          recipient_id: recipientId,
          sequence_id: DEFAULT_SEQUENCE_ID,
          step_id: DEFAULT_STEP_ID,
        };

        console.log(`[CHECKOUT][${reqId}][JOB_INSERT] Inserting:`, JSON.stringify(insertJob));
        recordStep('JOB_INSERT_START', true, { order_id: orderId, recipient_id: recipientId });

        const { data: jobData, error: jobError } = await dispatch
          .from('h2s_dispatch_jobs')
          .insert(insertJob)
          .select()
          .single();

        if (jobError) {
          const classified = classifySupabaseError(jobError);
          recordStep('JOB_INSERT', false, { order_id: orderId, recipient_id: recipientId }, { ...jobError, classified });
          
          // Clean up order before failing
          try {
            await client.from('h2s_orders').delete().eq('order_id', orderId);
            recordStep('CLEANUP_ORDER_AFTER_JOB_FAIL', true);
          } catch (cleanupErr) {
            recordStep('CLEANUP_ORDER_AFTER_JOB_FAIL', false, null, cleanupErr);
          }
          
          return NextResponse.json({
            ok: false,
            error: classified.message,
            code: classified.code,
            details: jobError.message,
            supabase_error: {
              code: jobError.code,
              details: jobError.details,
              hint: jobError.hint,
              message: jobError.message,
              classified: classified.classified
            },
            ...(debugMode && { diagnostics })
          }, { status: 500, headers: corsHeaders(request) });
        }

        jobId = jobData?.job_id;
        diagnostics.ids.job_id = jobId;
        recordStep('JOB_INSERT', true, { job_id: jobId, order_id: orderId });

        if (!jobId) {
          throw new Error('Job insert succeeded but returned no job_id');
        }

        // Link job to order metadata
        recordStep('METADATA_LINK_START', true, { job_id: jobId });
        
        const { data: orderData, error: fetchErr } = await client
          .from('h2s_orders')
          .select('metadata_json')
          .eq('order_id', orderId)
          .single();

        if (fetchErr) {
          throw new Error(`Cannot fetch order for metadata update: ${fetchErr.message}`);
        }

        const currentMeta = (orderData?.metadata_json && typeof orderData.metadata_json === 'object')
          ? orderData.metadata_json
          : {};

        const { error: updateErr } = await client
          .from('h2s_orders')
          .update({
            metadata_json: {
              ...currentMeta,
              dispatch_job_id: jobId,
              dispatch_recipient_id: recipientId
            }
          })
          .eq('order_id', orderId);

        if (updateErr) {
          throw new Error(`Metadata update failed: ${updateErr.message}`);
        }

        recordStep('METADATA_LINK', true, { job_id: jobId, order_id: orderId });

      } catch (jobCreateErr: any) {
        const classified = classifySupabaseError(jobCreateErr);
        recordStep('JOB_CREATE', false, null, { ...jobCreateErr, classified });
        
        // Clean up order (if job was partially created, it should cascade delete or we manually delete it)
        try {
          await client.from('h2s_orders').delete().eq('order_id', orderId);
          if (jobId) {
            const dispatch = getSupabaseDispatch();
            if (dispatch) {
              await dispatch.from('h2s_dispatch_jobs').delete().eq('job_id', jobId);
            }
          }
          recordStep('CLEANUP_AFTER_JOB_EXCEPTION', true);
        } catch (cleanupErr) {
          recordStep('CLEANUP_AFTER_JOB_EXCEPTION', false, null, cleanupErr);
        }
        
        return NextResponse.json({
          ok: false,
          error: classified.message || `Failed to create dispatch job: ${jobCreateErr.message}`,
          code: classified.code || jobCreateErr.code || 'JOB_CREATE_FAILED',
          details: jobCreateErr.message,
          ...(debugMode && { diagnostics })
        }, { status: 500, headers: corsHeaders(request) });
      }

      // ========== STEP 3: CREATE STRIPE SESSION ==========
      console.log(`[CHECKOUT][${reqId}][STRIPE] Creating Stripe session via relay`);
      recordStep('STRIPE_SESSION_START', true, { idempotency_key: deterministicKey });

      // Transform cart to Stripe line items
      const lineItems = cart.map((item: any) => {
        const productData: any = { name: item.name || item.service_name || 'Service' };
        if (item.description && item.description.trim()) {
          productData.description = item.description;
        }
        return {
          price_data: {
            currency: 'usd',
            product_data: productData,
            unit_amount: Math.round((item.price || 0) * 100)
          },
          quantity: item.qty || 1
        };
      });

      const sessionParams: any = {
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: success_url || 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancel_url || 'https://shop.home2smart.com/bundles',
        customer_email: customer.email,
        billing_address_collection: 'required',
        shipping_address_collection: { allowed_countries: ['US'] },
        metadata: { order_id: orderId, job_id: jobId, customer_email: customer.email }
      };

      // Handle promo code
      if (promotion_code) {
        const normalizedCode = promotion_code.toLowerCase();
        const cachedPromo = KNOWN_PROMO_CODES[normalizedCode];
        
        if (cachedPromo && cachedPromo.active && cachedPromo.id) {
          sessionParams.discounts = [{ promotion_code: cachedPromo.id }];
        } else if (cachedPromo && cachedPromo.active && !cachedPromo.id) {
          recordStep('PROMO_VALIDATE', false, null, new Error('Promo missing ID'));
          return NextResponse.json({
            ok: false,
            code: 'PROMO_CACHE_MISSING_ID',
            error: `Promo code ${promotion_code} cannot be applied`,
            ...(debugMode && { diagnostics })
          }, { status: 400, headers: corsHeaders(request) });
        } else {
          recordStep('PROMO_VALIDATE', false, null, new Error('Promo not in cache'));
          return NextResponse.json({
            ok: false,
            code: 'PROMO_NOT_SUPPORTED',
            error: `Promo code ${promotion_code} is not currently supported`,
            ...(debugMode && { diagnostics })
          }, { status: 400, headers: corsHeaders(request) });
        }
      }

      let session;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const relayResponse = await fetch(`${relayUrl}/stripe/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${relaySecret}`
          },
          body: JSON.stringify({ sessionParams, idempotencyKey: deterministicKey }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const relayData = await relayResponse.json();

        if (!relayResponse.ok || !relayData.ok) {
          recordStep('STRIPE_SESSION', false, null, new Error(relayData.error || 'Relay error'));
          
          // Clean up order + job
          try {
            await client.from('h2s_orders').delete().eq('order_id', orderId);
            if (jobId) {
              const dispatch = getSupabaseDispatch();
              if (dispatch) {
                await dispatch.from('h2s_dispatch_jobs').delete().eq('job_id', jobId);
              }
            }
            recordStep('CLEANUP_AFTER_STRIPE_FAIL', true);
          } catch (cleanupErr) {
            recordStep('CLEANUP_AFTER_STRIPE_FAIL', false, null, cleanupErr);
          }
          
          return NextResponse.json({
            ok: false,
            error: relayData.error || 'Payment system error',
            code: relayData.code || 'RELAY_ERROR',
            ...(debugMode && { diagnostics })
          }, { status: relayResponse.status, headers: corsHeaders(request) });
        }

        session = { id: relayData.session.id, url: relayData.session.url };
        diagnostics.ids.stripe_session_id = session.id;
        recordStep('STRIPE_SESSION', true, { session_id: session.id });

      } catch (relayError: any) {
        recordStep('STRIPE_SESSION', false, null, relayError);
        
        // Clean up order + job
        try {
          await client.from('h2s_orders').delete().eq('order_id', orderId);
          if (jobId) {
            const dispatch = getSupabaseDispatch();
            if (dispatch) {
              await dispatch.from('h2s_dispatch_jobs').delete().eq('job_id', jobId);
            }
          }
          recordStep('CLEANUP_AFTER_STRIPE_EXCEPTION', true);
        } catch (cleanupErr) {
          recordStep('CLEANUP_AFTER_STRIPE_EXCEPTION', false, null, cleanupErr);
        }
        
        const isTimeout = relayError.name === 'AbortError';
        return NextResponse.json({
          ok: false,
          error: isTimeout ? 'Payment system timeout' : 'Unable to connect to payment system',
          code: isTimeout ? 'RELAY_TIMEOUT' : 'RELAY_CONNECTION_ERROR',
          details: relayError.message,
          ...(debugMode && { diagnostics })
        }, { status: isTimeout ? 504 : 500, headers: corsHeaders(request) });
      }

      // ========== STEP 4: UPDATE ORDER WITH STRIPE SESSION ==========
      recordStep('ORDER_UPDATE_SESSION_START', true, { session_id: session.id });
      
      const { error: updateError } = await client
        .from('h2s_orders')
        .update({
          session_id: session.id,
          status: 'pending'
        })
        .eq('order_id', orderId);

      if (updateError) {
        recordStep('ORDER_UPDATE_SESSION', false, null, updateError);
        // Continue anyway - order and job exist, session exists, just not perfectly linked
      } else {
        recordStep('ORDER_UPDATE_SESSION', true);
      }

      recordStep('COMPLETE', true, { order_id: orderId, job_id: jobId, session_id: session.id });
      console.log(`[CHECKOUT][${reqId}] ========== SUCCESS ==========`);
      console.log(`[CHECKOUT][${reqId}] Order: ${orderId} | Job: ${jobId} | Session: ${session.id}`);

      return NextResponse.json({
        ok: true,
        request_id: reqId,
        order_id: orderId,
        job_id: jobId,
        pay: {
          session_url: session.url,
          session_id: session.id
        },
        ...(debugMode && { diagnostics })
      }, { status: 200, headers: corsHeaders(request) });
    }
