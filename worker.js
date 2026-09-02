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
function normalizeMediaUrls(value){
  if(Array.isArray(value)){
    return value.map(normalizeMediaUrls);
  }

  if(value && typeof value === "object"){
    const out = {};

    for(const [key, val] of Object.entries(value)){
      if(
        (key === "image" || key === "src" || key === "poster") &&
        typeof val === "string"
      ){
        out[key] = val.replace(
          "https://sweetproduction-admin.frycts5yrr.workers.dev/media/",
          "https://sweetproduction.se/media/"
        );
      } else {
        out[key] = normalizeMediaUrls(val);
      }
    }

    return out;
  }

  return value;
}

async function saveContent(body, env) {

  const normalized = normalizeMediaUrls(body);
const encoded = encodeBase64(JSON.stringify(normalized,null,2));

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
            setTimeout(resolve, 1000)
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
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-");


  const extension =
    safeName.includes(".")
      ? safeName.substring(
          safeName.lastIndexOf(".")
        )
      : "";


  const baseName =
    safeName
      .replace(extension, "")
      .slice(0, 80);


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


  const url =
    const url =
  `https://sweetproduction.se/media/${encodeURIComponent(key)}`;


  return new Response(
    JSON.stringify({
      success: true,
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
    "ETag",
    object.httpEtag
  );


  headers.set(
    "Cache-Control",
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


  if (!file) return null;


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


    const isContentRoute =
      url.pathname === "/content" ||
      url.pathname === "/api/content";


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


        const content =
          JSON.parse(
            decodeBase64(
              file.content
            )
          );


        return new Response(
          JSON.stringify(content),
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


        if (site)
          return site;
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
