import crypto from "node:crypto";

export const ADMIN_COOKIE_NAME = "video_admin";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) {
          return [decodeURIComponent(part), ""];
        }
        return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function safeEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function adminToken(password, secret) {
  return crypto.createHmac("sha256", secret).update(`video-admin:${password}`).digest("hex");
}

export function isAdminRequest(request, { adminPassword, sessionSecret }) {
  const cookieValue = parseCookies(request.headers.cookie)[ADMIN_COOKIE_NAME];
  if (!cookieValue) {
    return false;
  }
  return safeEqual(cookieValue, adminToken(adminPassword, sessionSecret));
}

export function adminCookie(request, token) {
  const secure = request.secure || request.headers["x-forwarded-proto"] === "https";
  return [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}
