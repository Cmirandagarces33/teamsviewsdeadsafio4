// Cloudflare Pages Function: /api/viewers
// Pide a la API oficial de Kick los espectadores de todos los canales (con cache de 20s).
let tokenCache = { value: null, exp: 0 };

async function getToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const r = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error("Token Kick: " + r.status);
  const j = await r.json();
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 };
  return tokenCache.value;
}

export async function onRequest({ env, request }) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + "/__viewers_cache");
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const teams = await (await env.ASSETS.fetch(new URL("/teams.json", request.url))).json();
    const slugs = [...new Set(teams.map((t) => t.slug))];
    const token = await getToken(env);
    const viewers = {};
    for (let i = 0; i < slugs.length; i += 50) {
      const qs = slugs.slice(i, i + 50).map((s) => "slug=" + encodeURIComponent(s)).join("&");
      const r = await fetch("https://api.kick.com/public/v1/channels?" + qs, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!r.ok) throw new Error("Kick channels: " + r.status);
      for (const c of (await r.json()).data || []) {
        viewers[c.slug.toLowerCase()] = c.stream && c.stream.is_live ? c.stream.viewer_count || 0 : 0;
      }
    }
    const res = new Response(JSON.stringify({ updated: Date.now(), viewers }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=20" },
    });
    await cache.put(key, res.clone());
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
