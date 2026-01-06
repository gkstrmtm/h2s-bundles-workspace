// === BUNDLES CORE.JS - Critical Functions (~60KB) ===
// Loads immediately: utilities, tracking, cart, routing, shop rendering
'use strict';

// Production-safe logger
const isDev = window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1') || window.location.hostname.includes('vercel.app');
const logger = {
  log: isDev ? console.log.bind(console) : () => {},
  warn: isDev ? console.warn.bind(console) : () => {},
  error: console.error.bind(console)
};

logger.log('[Bundles Core] Loaded');

function byId(id){ return document.getElementById(id); }

// Utility Functions
function money(cents) {
  if(typeof cents === 'number') return '$' + cents.toFixed(2);
  return '$0.00';
}

function escapeHtml(text) {
  if(!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// API Config
const BUNDLES_DATA_API = 'https://h2s-backend.vercel.app/api/bundles-data';
const API = 'https://h2s-backend.vercel.app/api/shop';
const APIV1 = 'https://h2s-backend.vercel.app/api/schedule-appointment';
const DASH_URL = 'https://h2s-backend.vercel.app/api/track';
const PIXEL_ID = '2384221445259822';
const TEST_EVENT_CODE = null;
const IS_LOCAL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost');

window.H2S_TRACKING_ENDPOINT = DASH_URL;
window.H2S_META_ENDPOINT = DASH_URL;

// Start data fetch immediately
const bundlesFetchPromise = IS_LOCAL
  ? Promise.resolve(null)
  : fetch(BUNDLES_DATA_API, { 
      cache: 'default',
      headers: { 'Accept': 'application/json' },
      priority: 'high',
      credentials: 'omit'
    }).then(res => res.ok ? res.json() : null)
    .catch(() => null);

// Session ID
let SESSION_ID = localStorage.getItem('h2s_session_id');
if(!SESSION_ID){
  SESSION_ID = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  localStorage.setItem('h2s_session_id', SESSION_ID);
}

// State
let catalog = { services:[], serviceOptions:[], priceTiers:[], bundles:[], bundleItems:[], recommendations:[], memberships:[], membershipPrices:[] };
let allReviews = [];
let heroReviews = [];
let reviewsLoadedFromAPI = false;
let cart = loadCart();
let user = loadUser();
let lastSearch = '';
let lastCat = '';
let heroReviewInterval;
let currentHeroReviewIndex = 0;
let reviewIndex = 0;
let reviewInterval;

// Deferred loading helpers
let _bundlesDeferredLoaded = false;
function loadBundlesDeferred(){
  if(_bundlesDeferredLoaded) return Promise.resolve();
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'bundles-deferred.js';
    s.onload = () => { _bundlesDeferredLoaded = true; resolve(); };
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

let _bundlesLazyLoaded = false;
function loadBundlesLazy(){
  if(_bundlesLazyLoaded) return Promise.resolve();
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'bundles-lazy.js';
    s.onload = () => { _bundlesLazyLoaded = true; resolve(); };
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

// Loader functions
function buildLoader(){
  const slices = byId('h2sLoaderSlices');
  if(!slices) return;
  const colors = ['#1493ff', '#0a2a5a', '#6b778c', '#1493ff', '#0a2a5a', '#6b778c', '#1493ff', '#0a2a5a'];
  slices.innerHTML = colors.map((col, i)=>`<div class="h2s-loader-slice" style="background:${col};animation-delay:${i*0.05}s"></div>`).join('');
}

function showLoader(){ 
  const el=byId('h2s-loader'); 
  if(el){ el.classList.remove('hidden'); el.style.display=''; } 
}

function hideLoader(){ 
  const el=byId('h2s-loader'); 
  if(el){ 
    el.classList.add('hidden');
    setTimeout(() => { if(el.classList.contains('hidden')) el.style.display='none'; }, 400);
  } 
}

function showSkeleton(){
  byId('outlet').innerHTML = `
    <div class="skeleton skeleton-hero"></div>
    <div class="skeleton skeleton-trust"></div>
    <div class="skeleton-grid">
      ${Array(6).fill('<div class="skeleton skeleton-card"></div>').join('')}
    </div>
  `;
}

// Tracking
function h2sTrack(event, data={}){
  (function sendPixel(){
    if (typeof fbq === 'function' && window.__H2S_FB_INIT__) {
      try {
        const params = buildAdvancedParams();
        fbq('track', event, {...data}, params);
      } catch (e) {}
    } else {
      let tries = 0;
      const timer = setInterval(()=>{
        if (typeof fbq === 'function' && window.__H2S_FB_INIT__) {
          clearInterval(timer);
          try {
            const params = buildAdvancedParams();
            fbq('track', event, {...data}, params);
          } catch(e){}
        } else if (++tries >= 20) {
          clearInterval(timer);
        }
      }, 150);
    }
  })();
  
  function sendToBackend(attempt = 1) {
    if (window.h2sSendBackend && typeof window.h2sSendBackend === 'function') {
      const event_type = event.toLowerCase().replace(/([A-Z])/g, '_$1').replace(/^_/, '');
      const trackingData = {
        ...data,
        user_email: user?.email || '',
        timestamp: new Date().toISOString()
      };
      try {
        const result = window.h2sSendBackend(event_type, trackingData);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch(err) {}
    } else if (attempt <= 5) {
      setTimeout(() => sendToBackend(attempt + 1), attempt * 100);
    }
  }
  sendToBackend();
}

async function sha256(text){
  if(!crypto || !crypto.subtle) return '';
  try{
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }catch(_){ return ''; }
}

function buildAdvancedParams(){
  const params = {};
  if(user && user.email){
    sha256(user.email.trim().toLowerCase()).then(h => { if(h) params.em = h; });
    if(user.phone){
      sha256(user.phone.replace(/\D/g,'')).then(h => { if(h) params.ph = h; });
    }
    if(user.name){
      const parts = user.name.trim().toLowerCase().split(' ');
      if(parts[0]) sha256(parts[0]).then(h => { if(h) params.fn = h; });
      if(parts[parts.length-1]) sha256(parts[parts.length-1]).then(h => { if(h) params.ln = h; });
    }
  }
  return params;
}

// Cart functions
function saveCart(){
  logger.log('[Cart] Saving', cart.length, 'items');
  try {
    localStorage.setItem('h2s_cart', JSON.stringify(cart));
  } catch(err) {}
  updateCartBadge();
  paintCart();
}

function loadCart(){
  try{ 
    const raw = localStorage.getItem('h2s_cart');
    if(!raw) return [];
    const loaded = JSON.parse(raw);
    if(!Array.isArray(loaded)) return [];
    return loaded.filter(item => Number(item.qty || 0) > 0 && !!(item.id || item.service_id || item.bundle_id));
  }catch(_){ return []; }
}

function updateQuantity(idx, delta){
  if(!cart[idx]) return;
  const newQty = (Number(cart[idx].qty)||1) + delta;
  if(newQty <= 0) cart.splice(idx, 1);
  else cart[idx].qty = newQty;
  saveCart();
}

function removeFromCart(idx){
  cart.splice(idx, 1);
  saveCart();
  h2sTrack('RemoveFromCart', { item_index: idx });
}

function updateCartBadge(){
  const count = cart.reduce((n,l)=> n + Number(l.qty||0), 0);
  byId('cartCount').textContent = count;
}

function cartSubtotal(lines=cart){
  return lines.reduce((sum, ln)=>{
    if(ln.type === 'package') return sum + (Number(ln.price||0) * Number(ln.qty||1));
    return sum;
  }, 0);
}

function saveUser(){
  try { localStorage.setItem('h2s_user', JSON.stringify(user||{})); } catch(err) {}
  renderSigninState();
}

function loadUser(){
  try{ return JSON.parse(localStorage.getItem('h2s_user')||'{}'); }catch(_){ return {}; }
}

// Cart painting
function paintCart(){
  const items = byId('cartItems');
  const emptyState = byId('cartEmpty');
  const totals = byId('cartTotals');
  const promoSection = byId('promoSection');
  
  if(!items) return;
  
  if(cart.length === 0){
    items.innerHTML = '';
    if(emptyState) emptyState.style.display = 'block';
    if(totals) totals.style.display = 'none';
    if(promoSection) promoSection.style.display = 'none';
    return;
  }
  
  if(emptyState) emptyState.style.display = 'none';
  if(totals) totals.style.display = 'block';
  if(promoSection) promoSection.style.display = 'block';
  
  items.innerHTML = cart.map((item, idx)=>{
    const name = item.name || item.id;
    const price = Number(item.price || 0);
    const qty = Number(item.qty || 1);
    const total = price * qty;
    
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(name)}</div>
          <div class="cart-item-price">${money(price)} each</div>
          <div class="cart-qty-controls">
            <button class="cart-qty-btn" onclick="updateQuantity(${idx}, -1)" aria-label="Decrease quantity">&minus;</button>
            <span class="cart-qty-value">${qty}</span>
            <button class="cart-qty-btn" onclick="updateQuantity(${idx}, 1)" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div class="cart-item-right">
          <div class="cart-item-total">${money(total)}</div>
          <button class="cart-remove-btn" onclick="removeFromCart(${idx})">Remove</button>
        </div>
      </div>
    `;
  }).join('');
  
  const subtotal = cartSubtotal();
  byId('subtotalAmount').textContent = money(subtotal);
  byId('totalAmount').textContent = money(subtotal);
  updateCartBadge();
}

// Routing & Navigation
function route(){
  const path = location.hash.slice(1) || 'shop';
  logger.log('[Route]', path);
  
  if(path === 'shop' || path === '') renderShop();
  else if(path.startsWith('schedule')) loadBundlesDeferred().then(() => window.showSchedule && window.showSchedule()).catch(() => {});
  else if(path.startsWith('success')) loadBundlesDeferred().then(() => window.renderShopSuccess && window.renderShopSuccess()).catch(() => {});
  else if(path.startsWith('orders')) loadBundlesLazy().then(() => window.renderOrders && window.renderOrders()).catch(() => {});
  else renderShop();
  
  closeAll();
  window.scrollTo({top: 0, behavior: 'instant'});
}

function navSet(params){
  const url = new URL(location.href);
  Object.entries(params).forEach(([k,v])=> v ? url.searchParams.set(k,v) : url.searchParams.delete(k));
  history.replaceState({}, '', url.toString());
}

function getParam(k){
  return new URL(location.href).searchParams.get(k);
}

function scrollToSection(id){
  const el = byId(id);
  if(!el) return;
  const headerOffset = 70;
  const elementPosition = el.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
  window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
}

// UI controls
function toggleMenu(){
  const drawer = byId('menuDrawer');
  const backdrop = byId('backdrop');
  if(drawer.classList.contains('open')){
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
  }else{
    closeCart();
    drawer.classList.add('open');
    backdrop.classList.add('show');
  }
}

function toggleCart(){
  const drawer = byId('cartDrawer');
  const backdrop = byId('backdrop');
  if(drawer.classList.contains('open')){
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
  }else{
    closeMenu();
    drawer.classList.add('open');
    backdrop.classList.add('show');
    h2sTrack('ViewCart', {cart_items: cart.length});
  }
}

function closeMenu(){
  byId('menuDrawer')?.classList.remove('open');
}

function closeCart(){
  byId('cartDrawer')?.classList.remove('open');
}

function closeAll(){
  closeMenu();
  closeCart();
  byId('backdrop')?.classList.remove('show');
}

function wireCart(){
  byId('cartBtn')?.addEventListener('click', toggleCart);
  byId('menuBtn')?.addEventListener('click', toggleMenu);
  byId('closeMenu')?.addEventListener('click', closeMenu);
  byId('closeCart')?.addEventListener('click', closeCart);
  byId('backdrop')?.addEventListener('click', closeAll);
  byId('checkoutBtn')?.addEventListener('click', ()=> loadBundlesDeferred().then(()=> window.showCheckoutModal && window.showCheckoutModal()));
}

function renderSigninState(){
  const btn = byId('accountBtn');
  if(!btn) return;
  if(user?.email){
    btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`;
    btn.onclick = ()=> location.hash = 'orders';
  }else{
    btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M15 3h6v18h-6M10 17l5-5-5-5M3 12h12"/></svg>`;
    btn.onclick = ()=> loadBundlesLazy().then(()=> window.showSignin && window.showSignin());
  }
}

// Shop rendering
async function fetchCatalogFromAPI(){
  try {
    const apiData = await bundlesFetchPromise;
    if(apiData?.ok){
      catalog = {
        services: apiData.services || [],
        serviceOptions: apiData.serviceOptions || [],
        priceTiers: apiData.priceTiers || [],
        bundles: apiData.bundles || [],
        bundleItems: apiData.bundleItems || [],
        recommendations: apiData.recommendations || [],
        memberships: apiData.memberships || [],
        membershipPrices: apiData.membershipPrices || []
      };
      allReviews = apiData.reviews || [];
      reviewsLoadedFromAPI = true;
      return true;
    }
  }catch(err){ logger.warn('[Catalog] Fetch failed:', err); }
  return false;
}

function renderShop(){
  const outlet = byId('outlet');
  if(!outlet) return;
  
  const bundles = catalog.bundles || [];
  if(bundles.length === 0){
    outlet.innerHTML = '<p style="text-align:center;padding:40px;">Loading packages...</p>';
    return;
  }
  
  outlet.innerHTML = `
    <section id="packages" class="section">
      <div class="section-header">
        <h2>Smart Home Packages</h2>
        <p>Professional installation included. Choose your package below.</p>
      </div>
      <div class="package-grid">
        ${bundles.map(pkg => {
          const featured = pkg.featured || pkg.bundle_id === 'pkg-002';
          return `
            <div class="package ${featured ? 'featured' : ''}" data-id="${pkg.bundle_id}">
              <div class="package-header">
                <div class="package-name">${escapeHtml(pkg.name || '')}</div>
                <div class="package-price">${money(Number(pkg.bundle_price || 0))}</div>
              </div>
              <div class="package-promise">${escapeHtml(pkg.promise || '')}</div>
              <div class="package-includes">
                <strong>Includes:</strong>
                <ul>${(pkg.items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
              </div>
              <button class="btn btn-primary" onclick="addPackageDirectToCart('${pkg.bundle_id}', '${escapeHtml(pkg.name || '')}', ${Number(pkg.bundle_price || 0)})">
                Add to Cart
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
  
  // Load reviews in background
  if(allReviews.length > 0) loadBundlesLazy().then(() => window.renderReviews && window.renderReviews());
}

function addPackageDirectToCart(id, name, price, metadata = {}){
  const existing = cart.findIndex(item => item.type === 'package' && item.id === id);
  if(existing >= 0){
    cart[existing].qty = Number(cart[existing].qty || 1) + 1;
  }else{
    cart.push({ type: 'package', id, name, price: Number(price), qty: 1, ...metadata });
  }
  saveCart();
  toggleCart();
  h2sTrack('AddToCart', { package_id: id, package_name: name, value: price });
}

// Init
async function init(){
  logger.log('[Init] Starting...');
  buildLoader();
  showLoader();
  
  wireCart();
  renderSigninState();
  updateCartBadge();
  
  const catalogLoaded = await fetchCatalogFromAPI();
  if(!catalogLoaded){
    logger.warn('[Init] Using fallback catalog');
  }
  
  hideLoader();
  route();
  
  window.addEventListener('hashchange', route);
  
  // Initialize hero reviews
  heroReviews = [
    { text: "Professional, on-time, and clean installation.", author: "Recent Customer", stars: 5 },
    { text: "Had 4 cameras installed. The app setup was seamless.", author: "Mike T.", stars: 5 },
    { text: "Quick, clean, professional. They hid all the wires perfectly.", author: "Jennifer L.", stars: 5 }
  ];
  
  if('requestIdleCallback' in window){
    requestIdleCallback(() => loadBundlesLazy().then(() => window.initHeroReviews && window.initHeroReviews()), {timeout: 3000});
  }else{
    setTimeout(() => loadBundlesLazy().then(() => window.initHeroReviews && window.initHeroReviews()), 2000);
  }
  
  h2sTrack('PageView', { page: 'bundles' });
  logger.log('[Init] Complete');
}

// Start
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
}else{
  init();
}
