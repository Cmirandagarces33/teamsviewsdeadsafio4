// Cloudflare Worker: sirve la pagina (carpeta public) y responde /api/viewers
const CHUNK = 25;            // canales por consulta a Kick (margen de seguridad)
let tokenCache = { value: null, exp: 0 };
let dataCache = { body: null, exp: 0 };
let last = {};               // ultimo valor conocido de cada canal
let avatarCache = { body: null, exp: 0 };

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

async function fetchChunk(slugs, token) {
  const qs = slugs.map((s) => "slug=" + encodeURIComponent(s)).join("&");
  const r = await fetch("https://api.kick.com/public/v1/channels?" + qs, {
    headers: { Authorization: "Bearer " + token },
  });
  if (r.status === 401) tokenCache = { value: null, exp: 0 };
  if (!r.ok) throw new Error("Kick channels: " + r.status);
  return (await r.json()).data || [];
}

function split(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function viewers(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" };
  if (dataCache.body && Date.now() < dataCache.exp) return new Response(dataCache.body, { headers });
  try {
    const teams = await (await env.ASSETS.fetch(new URL("/teams.json", request.url))).json();
    const slugs = [...new Set(teams.map((t) => t.slug).filter(Boolean))];
    const token = await getToken(env);
    const out = {};
    const errors = [];
    const run = async (group) => {
      try {
        for (const c of await fetchChunk(group, token)) {
          out[c.slug.toLowerCase()] = c.stream && c.stream.is_live ? c.stream.viewer_count || 0 : 0;
        }
      } catch (e) { errors.push(String(e)); }
    };
    // 1) todas las tandas a la vez
    await Promise.all(split(slugs, CHUNK).map(run));
    // 2) reintento de los que faltaron, en tandas mas chicas
    let missing = slugs.filter((s) => !(s in out));
    if (missing.length) await Promise.all(split(missing, 10).map(run));
    missing = slugs.filter((s) => !(s in out));
    // 3) los que sigan sin respuesta conservan su ultimo valor conocido
    for (const s of missing) out[s] = last[s] || 0;
    for (const s of slugs) if (!missing.includes(s)) last[s] = out[s];
    const meta = {
      requested: slugs.length,
      returned: slugs.length - missing.length,
      live: slugs.filter((s) => out[s] > 0).length,
      missing,
      errors: errors.slice(0, 3),
    };
    const body = JSON.stringify({ updated: Date.now(), viewers: out, meta });
    dataCache = { body, exp: Date.now() + 15000 };
    return new Response(body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}


// Fotos de perfil: /api/avatars  ->  { avatars: { slug: urlFoto }, meta }
async function avatars(request, env) {
  const mk = (body, ttl) => new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + ttl } });
  if (avatarCache.body && Date.now() < avatarCache.exp) return mk(avatarCache.body, 3600);
  try {
    const teams = await (await env.ASSETS.fetch(new URL("/teams.json", request.url))).json();
    const slugs = [...new Set(teams.map((t) => t.slug).filter(Boolean))];
    const token = await getToken(env);
    const errors = [];
    const idToSlug = {};
    // 1) slug -> id de usuario (viene en la consulta de canales)
    await Promise.all(split(slugs, CHUNK).map(async (g) => {
      try { for (const c of await fetchChunk(g, token)) idToSlug[c.broadcaster_user_id] = c.slug.toLowerCase(); }
      catch (e) { errors.push(String(e)); }
    }));
    // 2) id -> foto de perfil (consulta de usuarios)
    const out = {};
    await Promise.all(split(Object.keys(idToSlug), CHUNK).map(async (g) => {
      try {
        const r = await fetch("https://api.kick.com/public/v1/users?" + g.map((i) => "id=" + i).join("&"), { headers: { Authorization: "Bearer " + token } });
        if (!r.ok) throw new Error("Kick users: " + r.status);
        for (const u of (await r.json()).data || []) {
          if (u.profile_picture && idToSlug[u.user_id]) out[idToSlug[u.user_id]] = u.profile_picture;
        }
      } catch (e) { errors.push(String(e)); }
    }));
    const missing = slugs.filter((x) => !out[x]);
    const body = JSON.stringify({ updated: Date.now(), avatars: out, meta: { requested: slugs.length, found: slugs.length - missing.length, missing, errors: errors.slice(0, 3) } });
    // si salio bien se guarda 6 horas; si hubo fallos, solo 1 minuto
    const ok = !errors.length && missing.length < slugs.length * 0.1;
    avatarCache = { body, exp: Date.now() + (ok ? 6 * 3600e3 : 60e3) };
    return mk(body, ok ? 3600 : 30);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/viewers") return viewers(request, env);
    if (path === "/api/avatars") return avatars(request, env);
    return env.ASSETS.fetch(request);
  },
};
