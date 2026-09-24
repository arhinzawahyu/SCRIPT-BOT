import { NextRequest, NextResponse } from "next/server";
import { verifySessionEdge, verifyPreSessionEdge } from "./lib/session-edge";

const BOT_PATHS = ["/api/ingest", "/api/login/code"];
const PRE_PATHS = ["/login", "/api/login", "/api/login/verify"];
const OPEN_PATHS = ["/api/health"];

export async function middleware(req: NextRequest) {
  const secret = process.env.SESSION_SECRET || "";
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }
  if (BOT_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (await verifySessionEdge(req.cookies.get("wa_sess")?.value, secret)) {
    return NextResponse.next();
  }
  if (PRE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (pathname.startsWith("/api/") && pathname !== "/api/login" && pathname !== "/api/login/verify") {
      if (!(await verifyPreSessionEdge(req.cookies.get("wa_pre")?.value, secret))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
