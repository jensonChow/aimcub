/**
 * Session middleware (live mode only): refreshes the Supabase auth cookie on every
 * request and gates the app behind /login. In mock mode (no NEXT_PUBLIC_SUPABASE_*)
 * it is a pass-through, so the zero-backend demo keeps working.
 *
 * It also fires the H1 activity ping (one row per user per day, see 0009_metrics.sql)
 * after successful auth — fire-and-forget via waitUntil, so it never blocks rendering.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: getUser() (not getSession()) — it revalidates the JWT against the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && path !== "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }
  if (user && path === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (user) {
    // H1 instrumentation: today's activity ping, user-scoped (RLS own_insert).
    // The (owner_id, day) primary key + ignoreDuplicates makes replays no-ops;
    // errors are swallowed — metrics must never break the app.
    const day = new Date().toISOString().slice(0, 10);
    event.waitUntil(
      Promise.resolve(
        supabase
          .from("activity_pings")
          .upsert({ owner_id: user.id, day }, { onConflict: "owner_id,day", ignoreDuplicates: true }),
      ).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
