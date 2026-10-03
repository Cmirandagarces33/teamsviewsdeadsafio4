// Cloudflare Worker: sirve la pagina (carpeta public) y responde /api/viewers
let tokenCache = { value: null, exp: 0 };
let dataCache = { body: null, exp: 0 };

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

async function viewers(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" };
  if (dataCache.body && Date.now() < dataCache.exp) return new Response(dataCache.body, { headers });
  try {
    const teams = await (await env.ASSETS.fetch(new URL("/teams.json", request.url))).json();
    const slugs = [...new Set(teams.map((t) => t.slug))];
    const token = await getToken(env);
    const out = {};
    for (let i = 0; i < slugs.length; i += 50) {
      const qs = slugs.slice(i, i + 50).map((s) => "slug=" + encodeURIComponent(s)).join("&");
      const r = await fetch("https://api.kick.com/public/v1/channels?" + qs, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!r.ok) throw new Error("Kick channels: " + r.status);
      for (const c of (await r.json()).data || []) {
        out[c.slug.toLowerCase()] = c.stream && c.stream.is_live ? c.stream.viewer_count || 0 : 0;
      }
    }
    const body = JSON.stringify({ updated: Date.now(), viewers: out });
    dataCache = { body, exp: Date.now() + 15000 };
    return new Response(body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/viewers") return viewers(request, env);
    return env.ASSETS.fetch(request);
  },
};
