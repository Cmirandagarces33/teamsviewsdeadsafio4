# Teams Views Deadsafio — pasos para ponerlo en línea (gratis)

## 1. Credenciales de Kick (gratis)
1. Entra a kick.com con tu cuenta → Configuración → pestaña **Developer** (pide tener 2FA activado).
2. Crea una **App** y copia el `Client ID` y el `Client Secret`.

## 2. Subir la página a Cloudflare Pages (gratis)
1. Crea cuenta en cloudflare.com → Workers & Pages → Create → Pages.
2. Sube esta carpeta (Direct Upload) o conéctala a un repo de GitHub.
3. En Settings → Environment variables agrega (tipo Secret):
   - `KICK_CLIENT_ID`
   - `KICK_CLIENT_SECRET`
4. Vuelve a desplegar.

## 3. Dominio .xyz
En Pages → Custom domains → agrega tu dominio y sigue las instrucciones de DNS.

## Probar sin API
Abre `index.html?demo` para ver la página con datos falsos (necesita servirse por http, no doble clic).
