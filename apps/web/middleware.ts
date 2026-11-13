import { NextResponse, type NextRequest } from 'next/server';

/** Pages that need a session. Without the cookie the app is not even downloaded. */
export const config = {
  matcher: ['/timeline/:path*', '/ordenar/:path*', '/portadas/:path*', '/ajustes/:path*'],
};

export function middleware(request: NextRequest) {
  // The API validates the signed cookie; here only its absence is enough to skip the shell.
  if (request.cookies.has('lv_session')) return NextResponse.next();
  return NextResponse.redirect(new URL('/', request.url));
}
