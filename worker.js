const SESSION_COOKIE = "sweet_admin_session";
const SESSION_SECONDS = 60 * 60 * 12;

async function createSession(password) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;

  const data = String(expires);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );

  const bytes = new Uint8Array(signature);
  const hex = [...bytes]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return `${data}.${hex}`;
}

async function verifySession(request, env) {
  const cookie = request.headers.get("Cookie") || "";

  const match = cookie.match(
    new RegExp(`${SESSION_COOKIE}=([^;]+)`)
  );

  if (!match) return false;

  const parts = match[1].split(".");
  if (parts.length !== 2) return false;

  const expires = Number(parts[0]);

  if (!expires || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_PASSWORD),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signature = new Uint8Array(
    parts[1].match(/.{1,2}/g).map(byte => parseInt(byte, 16))
  );

  return await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(parts[0])
  );
}

function loginPage() {
  return new Response(`
<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sweet Production – Login</title>
<style>
body{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background:#111;
  color:#fff;
  font-family:Arial,sans-serif;
}
form{
  width:min(340px,calc(100% - 40px));
}
h1{
  font-size:28px;
  margin-bottom:30px;
}
input{
  width:100%;
  box-sizing:border-box;
  padding:14px;
  margin-bottom:12px;
  border:1px solid #444;
  background:#1d1d1d;
  color:#fff;
  border-radius:6px;
}
button{
  width:100%;
  padding:14px;
  border:0;
  border-radius:6px;
  cursor:pointer;
}
</style>
</head>
<body>
<form method="POST" action="/login">
<h1>Sweet Production</h1>
<input type="password" name="password" placeholder="Lösenord" required autofocus>
<button type="submit">Logga in</button>
</form>
</body>
</html>
`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
const OWNER = "6hmztw44sf-cpu";
const REPO = "SweetProduction";
const BRANCH = "main";
const FILE_PATH = "site/content.json";

function corsHeaders(origin) {
  const allowed = [
    "https://sweetproduction.se",
    "https://www.sweetproduction.se",
    "https://sweetproduction-admin.frycts5yrr.workers.dev"
  ];

  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : "https://sweetproduction.se",

    "Access-Control-Allow-Methods":
      "GET, PUT, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Content-Type":
      "application/json"
  };
}


// =========================
// GITHUB
// =========================

async function githubRequest(path, options = {}, env) {

  const token =
    String(env.GITHUB_TOKEN || "").trim();

  if (!token) {
    throw new Error("GITHUB_TOKEN is missing");
  }

  const response = await fetch(
    `https://api.github.com${path}`,
    {
      ...options,

      headers: {
        "Accept":
          "application/vnd.github+json",

        "Authorization":
          `Bearer ${token}`,

        "X-GitHub-Api-Version":
          "2022-11-28",

        "Content-Type":
          "application/json",

        "User-Agent":
          "SweetProduction-Admin",

        ...(options.headers || {})
      }
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      message: text
    };
  }

  if (!response.ok) {

    throw new Error(
      `GitHub API ${response.status}: ${
        data.message || "Unknown error"
      }`
    );
  }

  return data;
}


function decodeBase64(base64) {

  const binary =
    atob(base64.replace(/\n/g, ""));

  const bytes =
    Uint8Array.from(
      binary,
      char => char.charCodeAt(0)
    );

  return new TextDecoder()
    .decode(bytes);
}


function encodeBase64(text) {

  const bytes =
    new TextEncoder().encode(text);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}


async function getContent(env) {

  return githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    {},
    env
  );
}


// =========================
// MEDIA URL FIX
// =========================

function normalizeMediaUrls(value) {

  if (Array.isArray(value)) {
    return value.map(normalizeMediaUrls);
  }

  if (value && typeof value === "object") {

    const out = {};

    for (const [key, val] of Object.entries(value)) {

      if (
        (key === "image" ||
         key === "src" ||
         key === "poster") &&
        typeof val === "string"
      ) {

        out[key] = val.replace(
          "https://sweetproduction-admin.frycts5yrr.workers.dev/media/",
          "https://sweetproduction.se/media/"
        );

      } else {

        out[key] =
          normalizeMediaUrls(val);
      }
    }

    return out;
  }

  return value;
}


// =========================
// SAVE CONTENT
// =========================

async function saveContent(body, env) {

  const normalized =
    normalizeMediaUrls(body);

  const encoded =
    encodeBase64(
      JSON.stringify(
        normalized,
        null,
        2
      )
    );

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {

    const current =
      await getContent(env);

    try {

      return await githubRequest(
        `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
        {
          method: "PUT",

          body: JSON.stringify({

            message:
              "Update website content",

            content:
              encoded,

            sha:
              current.sha,

            branch:
              BRANCH
          })
        },
        env
      );

    } catch (error) {

      if (
        error.message.includes(
          "GitHub API 409"
        ) &&
        attempt < 4
      ) {

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1000
            )
        );

        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "GitHub kunde inte spara efter 5 försök"
  );
}


// =========================
// R2 UPLOAD
// =========================

async function uploadMedia(
  request,
  env
) {

  if (!env.MEDIA) {

    throw new Error(
      "R2 binding MEDIA saknas"
    );
  }

  const form =
    await request.formData();

  const file =
    form.get("file");

  if (
    !file ||
    typeof file === "string"
  ) {

    return new Response(
      JSON.stringify({
        error:
          "Ingen fil skickades"
      }),
      {
        status: 400,
        headers:
          corsHeaders(
            request.headers.get("Origin") || ""
          )
      }
    );
  }


  // Tillåt bilder och videos
  if (
    !file.type.startsWith("image/") &&
    !file.type.startsWith("video/")
  ) {

    return new Response(
      JSON.stringify({
        error:
          "Endast bilder och videofiler är tillåtna"
      }),
      {
        status: 400,
        headers:
          corsHeaders(
            request.headers.get("Origin") || ""
          )
      }
    );
  }


  const originalName =
    file.name || "media";


  // Rensa filnamnet
  const safeName =
    originalName
      .replace(
        /[^a-zA-Z0-9._-]/g,
        "-"
      )
      .replace(
        /-+/g,
        "-"
      );


  const extension =
    safeName.includes(".")
      ? safeName.substring(
          safeName.lastIndexOf(".")
        )
      : "";


  const baseName =
    safeName
      .replace(
        extension,
        ""
      )
      .slice(
        0,
        80
      );


  const id =
    crypto.randomUUID();


  const key =
    `media/${id}-${baseName}${extension}`;


  await env.MEDIA.put(
    key,
    file.stream(),
    {
      httpMetadata: {
        contentType:
          file.type ||
          "application/octet-stream"
      }
    }
  );


  // ALLA nya mediafiler använder huvuddomänen
  const url =
    `https://sweetproduction.se/media/${encodeURIComponent(key)}`;


  return new Response(
    JSON.stringify({

      success:
        true,

      url,

      key,

      filename:
        originalName,

      type:
        file.type,

      size:
        file.size

    }),
    {
      status: 200,

      headers:
        corsHeaders(
          request.headers.get("Origin") || ""
        )
    }
  );
}


// =========================
// R2 MEDIA
// =========================

async function serveMedia(
  request,
  env,
  pathname
) {

  if (!env.MEDIA) {

    return new Response(
      "R2 binding MEDIA saknas",
      {
        status: 500
      }
    );
  }


  const key =
    decodeURIComponent(
      pathname.replace(
        /^\/media\//,
        ""
      )
    );


  if (!key) {

    return new Response(
      "Media saknas",
      {
        status: 404
      }
    );
  }


  const object =
    await env.MEDIA.get(key);


  if (!object) {

    return new Response(
      "Filen hittades inte",
      {
        status: 404
      }
    );
  }


  const headers =
    new Headers();

  object.writeHttpMetadata(
    headers
  );

  headers.set(
    "etag",
    object.httpEtag
  );

  headers.set(
    "cache-control",
    "public, max-age=31536000, immutable"
  );


  return new Response(
    object.body,
    {
      status: 200,
      headers
    }
  );
}


// =========================
// SITE FILES
// =========================

async function serveSite(
  pathname
) {

  const files = {

    "/":
      [
        "index.html",
        "text/html; charset=UTF-8"
      ],

    "/index.html":
      [
        "index.html",
        "text/html; charset=UTF-8"
      ],

    "/style.css":
      [
        "style.css",
        "text/css; charset=UTF-8"
      ],

    "/content.json":
      [
        "content.json",
        "application/json; charset=UTF-8"
      ],

    "/admin.html":
      [
        "admin.html",
        "text/html; charset=UTF-8"
      ]
  };


  const file =
    files[pathname];


  if (!file) {
    return null;
  }


  const response =
    await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/site/${file[0]}?v=${Date.now()}`
    );


  if (!response.ok) {

    return new Response(
      "Site file not found",
      {
        status: 500
      }
    );
  }


  return new Response(
    await response.text(),
    {
      status: 200,

      headers: {

        "Content-Type":
          file[1],

        "Cache-Control":
          pathname === "/content.json"
            ? "no-store"
            : "public, max-age=60"
      }
    }
  );
}


// =========================
// MAIN WORKER
// =========================

export default {

  async fetch(
    request,
    env
  ) {

    const origin =
      request.headers.get(
        "Origin"
      ) || "";


    const headers =
      corsHeaders(origin);


    // CORS
    if (
      request.method === "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers
        }
      );
    }


    const url =
      new URL(request.url);
    // =========================
// ADMIN LOGIN
// =========================

if (
  request.method === "POST" &&
  url.pathname === "/login"
) {
  const form = await request.formData();
  const password = String(form.get("password") || "");

  if (password !== "SweetTest123!") {
    return new Response("Fel lösenord", {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=UTF-8"
      }
    });
  }

  const session = await createSession(
    env.ADMIN_PASSWORD
  );

  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/admin.html",
      "Set-Cookie":
        `${SESSION_COOKIE}=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`
    }
  });
}


// LOGOUT

if (
  request.method === "GET" &&
  url.pathname === "/logout"
) {
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/admin.html",
      "Set-Cookie":
        `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    }
  });
}


// SKYDDA ADMIN.HTML

if (
  request.method === "GET" &&
  url.pathname === "/admin.html"
) {
  const loggedIn =
    await verifySession(request, env);

  if (!loggedIn) {
    return loginPage();
  }
}


    const isContentRoute =
      url.pathname === "/content" ||
      url.pathname === "/api/content";
    // SKYDDA ADMIN-API
const protectedRoute =
  isContentRoute ||
  url.pathname === "/upload" ||
  url.pathname === "/api/upload" ||
  url.pathname === "/github-test";

if (
  protectedRoute &&
  !(await verifySession(request, env))
) {
  return new Response(
    JSON.stringify({
      error: "Unauthorized"
    }),
    {
      status: 401,
      headers
    }
  );
}


    try {

      // ---------------------
      // UPLOAD
      // ---------------------

      if (
        request.method === "POST" &&
        (
          url.pathname === "/upload" ||
          url.pathname === "/api/upload"
        )
      ) {

        return await uploadMedia(
          request,
          env
        );
      }


      // ---------------------
      // MEDIA
      // ---------------------

      if (
        request.method === "GET" &&
        url.pathname.startsWith(
          "/media/"
        )
      ) {

        return await serveMedia(
          request,
          env,
          url.pathname
        );
      }


      // ---------------------
      // GITHUB TEST
      // ---------------------

      if (
        request.method === "GET" &&
        url.pathname === "/github-test"
      ) {

        const repo =
          await githubRequest(
            `/repos/${OWNER}/${REPO}`,
            {},
            env
          );


        return new Response(
          JSON.stringify({

            success:
              true,

            github:
              "authenticated",

            repository:
              repo.full_name,

            permissions:
              repo.permissions ||
              null

          }),
          {
            status: 200,
            headers
          }
        );
      }


      // ---------------------
      // GET CONTENT
      // ---------------------

      if (
        request.method === "GET" &&
        isContentRoute
      ) {

        const file =
          await getContent(env);


        let content =
          JSON.parse(
            decodeBase64(
              file.content
            )
          );


        // Fixar gamla media-URL:er automatiskt
        content =
          normalizeMediaUrls(
            content
          );


        return new Response(
          JSON.stringify(
            content
          ),
          {
            status: 200,
            headers
          }
        );
      }


      // ---------------------
      // SAVE CONTENT
      // ---------------------

      if (
        request.method === "PUT" &&
        isContentRoute
      ) {

        const body =
          await request.json();


        if (!body) {

          return new Response(
            JSON.stringify({
              error:
                "Content saknas"
            }),
            {
              status: 400,
              headers
            }
          );
        }


        const result =
          await saveContent(
            body,
            env
          );


        return new Response(
          JSON.stringify({

            success:
              true,

            saved:
              true,

            commit:
              result.commit?.sha ||
              null

          }),
          {
            status: 200,
            headers
          }
        );
      }


      // ---------------------
      // SITE
      // ---------------------

      if (
        request.method === "GET"
      ) {

        const site =
          await serveSite(
            url.pathname
          );


        if (site) {
          return site;
        }
      }


      return new Response(
        JSON.stringify({
          error:
            "Not found"
        }),
        {
          status: 404,
          headers
        }
      );


    } catch (error) {

      console.error(error);


      return new Response(
        JSON.stringify({

          error:
            error.message ||
            "Unknown error"

        }),
        {
          status: 500,
          headers
        }
      );
    }
  }
};
