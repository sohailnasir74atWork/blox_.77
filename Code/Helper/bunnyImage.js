// Bunny CDN image-transform helpers.
//
// STATUS: these query params are currently INERT. Bunny Optimizer is not
// enabled on either image pull zone — as of this writing
// `https://pull-blox.b-cdn.net/pic1.jpg?width=300` returns the same 233,968
// bytes as the bare URL. Enabling Optimizer in the Bunny dashboard (per pull
// zone) is what turns every call site below live.
//
// Adding the params ahead of that is safe: both image zones are configured to
// ignore query strings for cache keying (a never-before-requested
// `?width=401` still came back `cdn-cache: HIT`), so these URLs neither
// fragment the edge cache nor cost an extra origin pull today.
//
// ── Picking the right dimension ───────────────────────────────────────────
// Which parameter you pass is dictated by the consumer's resizeMode, NOT by
// how wide the box looks:
//
//   resizeMode="cover"    scales by max(boxW/srcW, boxH/srcH). Whichever
//                         ratio wins is the dimension you must constrain.
//                         Constraining the other one makes the CDN return an
//                         image the UI then UPSCALES — visibly blurry.
//   resizeMode="contain"  scales by min(...) — constrain the larger box side.
//
// Concretely: the wallpaper grid renders 1920x1080 (16:9) sources into 9:16
// portrait tiles with "cover", so the scale is height-driven and `height` is
// the only correct knob. Passing `width` there would return a 640x360 image
// that gets upscaled ~2.6x.
//
// A width+height crop (Bunny's `aspect_ratio`) would beat both, but its exact
// output can't be validated while Optimizer is off — verify against the live
// zone before reaching for it.

// Only our own Bunny zones. Avatars in particular can point at
// bloxfruitscalc.com or any arbitrary host, where these params do nothing.
const BUNNY_IMAGE_HOSTS = ['pull-gag.b-cdn.net', 'pull-blox.b-cdn.net'];

export function isBunnyImageUrl(url) {
  return (
    typeof url === 'string' &&
    BUNNY_IMAGE_HOSTS.some((host) => url.includes(host))
  );
}

/**
 * Append Bunny Optimizer transform params to a Bunny-hosted image URL.
 * Returns the URL untouched for non-Bunny hosts, empty input, or a URL that
 * already carries a query string.
 *
 * Pass whichever ONE of width/height actually constrains the render (see the
 * note above); passing neither returns the original URL.
 *
 * @param {string} url
 * @param {{ width?: number, height?: number, quality?: number }} opts
 * @returns {string}
 */
export function bunnyImageUrl(url, { width, height, quality = 80 } = {}) {
  if (!isBunnyImageUrl(url)) return url;
  if (url.includes('?')) return url; // already parameterised — don't stack
  if (!width && !height) return url;

  const params = [];
  if (width) params.push(`width=${Math.round(width)}`);
  if (height) params.push(`height=${Math.round(height)}`);
  params.push(`quality=${quality}`);

  return `${url}?${params.join('&')}`;
}
