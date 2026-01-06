import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  // Host-based routing for /bundles path
  if (pathname === '/bundles') {
    if (hostname.includes('portal.home2smart.com')) {
      // Portal host -> serve portal.html
      return NextResponse.rewrite(new URL('/portal.html', request.url));
    } else if (hostname.includes('shop.home2smart.com') || hostname.includes('home2smart.com')) {
      // Shop host or root domain -> serve bundles.html
      return NextResponse.rewrite(new URL('/bundles.html', request.url));
    }
  }

  // Let other requests pass through
  return NextResponse.next();
}

export const config = {
  matcher: '/bundles',
};
