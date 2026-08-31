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
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

async function githubRequest(path, options = {}, env) {
  const token = String(env.GITHUB_TOKEN || "").trim();

  if (!token) {
    throw new Error("GITHUB_TOKEN is missing");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "SweetProduction-Admin",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}: ${data.message || "Unknown error"}`
    );
  }

  return data;
}

function decodeBase64(base64) {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function getContentFile(env) {
  return await githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&_=${Date.now()}`,
    {},
    env
  );
}

async function saveContent(body, env) {
  const encoded = encodeBase64(
    JSON.stringify(body, null, 2)
  );

  /*
    Försök upp till 3 gånger.
    Om GitHub svarar 409 hämtar vi den senaste SHA:n
    och försöker igen.
  */

  for (let attempt = 0; attempt < 3; attempt++) {

    const current = await getContentFile(env);

    try {

      return await githubRequest(
        `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
        {
          method: "PUT",
          body: JSON.stringify({
            message: "Update website content",
            content: encoded,
            sha: current.sha,
            branch: BRANCH
          })
        },
        env
      );

    } catch (error) {

      if (
        error.message.includes("GitHub API 409") &&
        attempt < 2
      ) {
        await new Promise(resolve =>
          setTimeout(resolve, 500)
        );

        continue;
      }

      throw error;
    }
  }

  throw new Error("Kunde inte spara efter flera försök");
}

async function serveSite(pathname) {

  const files = {
    "/": ["index.html", "text/html; charset=UTF-8"],
    "/index.html": ["index.html", "text/html; charset=UTF-8"],
    "/style.css": ["style.css", "text/css; charset=UTF-8"],
    "/content.json": ["content.json", "application/json; charset=UTF-8"],
    "/admin.html": ["admin.html", "text/html; charset=UTF-8"]
  };

  const file = files[pathname];

  if (!file) {
    return null;
  }

  const response = await fetch(
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/site/${file[0]}?v=${Date.now()}`
  );

  if (!response.ok) {
    return new Response("Site file not found", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=UTF-8"
      }
    });
  }

  return new Response(await response.text(), {
    status: 200,
    headers: {
      "Content-Type": file[1],
      "Cache-Control":
        pathname === "/content.json"
          ? "no-store"
          : "public, max-age=60"
    }
  });
}

export default {

  async fetch(request, env) {

    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers
      });

    }

    const url = new URL(request.url);

    const isContentRoute =
      url.pathname === "/content" ||
      url.pathname === "/api/content";

    try {

      /*
        Testa GitHub
      */

      if (
        request.method === "GET" &&
        url.pathname === "/github-test"
      ) {

        const repo = await githubRequest(
          `/repos/${OWNER}/${REPO}`,
          {},
          env
        );

        return new Response(
          JSON.stringify({
            success: true,
            github: "authenticated",
            repository: repo.full_name,
            permissions: repo.permissions || null
          }),
          {
            status: 200,
            headers
          }
        );

      }

      /*
        Hämta content
      */

      if (
        request.method === "GET" &&
        isContentRoute
      ) {

        const file = await getContentFile(env);

        const content = JSON.parse(
          decodeBase64(file.content)
        );

        return new Response(
          JSON.stringify(content),
          {
            status: 200,
            headers
          }
        );

      }

      /*
        Spara content
      */

      if (
        request.method === "PUT" &&
        isContentRoute
      ) {

        const body = await request.json();

        if (!body) {

          return new Response(
            JSON.stringify({
              error: "Content saknas"
            }),
            {
              status: 400,
              headers
            }
          );

        }

        const result = await saveContent(body, env);

        /*
          Kontrollera att GitHub verkligen skapade
          en commit.
        */

        if (!result.commit?.sha) {

          throw new Error(
            "GitHub sparade inte någon commit"
          );

        }

        return new Response(
          JSON.stringify({
            success: true,
            saved: true,
            commit: result.commit.sha
          }),
          {
            status: 200,
            headers
          }
        );

      }

      /*
        Vanliga hemsidefiler
      */

      if (request.method === "GET") {

        const site = await serveSite(
          url.pathname
        );

        if (site) {
          return site;
        }

      }

      return new Response(
        JSON.stringify({
          error: "Not found"
        }),
        {
          status: 404,
          headers
        }
      );

    } catch (error) {

      return new Response(
        JSON.stringify({
          error: error.message || "Unknown error"
        }),
        {
          status: 500,
          headers
        }
      );

    }

  }

};
