const OWNER = "6hmztw44sf-cpu";
const REPO = "SweetProduction";
const BRANCH = "main";
const FILE_PATH = "site/content.json";

function corsHeaders(origin) {
  const allowed = [
    "https://sweetproduction.se",
    "https://www.sweetproduction.se"
  ];

  return {
    "Access-Control-Allow-Origin":
      allowed.includes(origin) ? origin : "https://sweetproduction.se",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

async function githubRequest(path, options = {}, env) {
  const response = await fetch(
    `https://api.github.com${path}`,
    {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      `GitHub API error ${response.status}`
    );
  }

  return data;
}

function decodeBase64(base64) {
  const binary = atob(
    base64.replace(/\n/g, "")
  );

  const bytes = Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
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

export default {
  async fetch(request, env) {

    const origin =
      request.headers.get("Origin") || "";

    const headers =
      corsHeaders(origin);

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers
      });

    }

    const url =
      new URL(request.url);

    try {

      /*
       GET /content
       */

      if (
        request.method === "GET" &&
        url.pathname === "/content"
      ) {

        const file =
          await githubRequest(
            `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
            {},
            env
          );

        const content =
          JSON.parse(
            decodeBase64(file.content)
          );

        return new Response(
          JSON.stringify({
            content,
            sha: file.sha
          }),
          {
            status: 200,
            headers
          }
        );

      }


      /*
       PUT /content
       */

      if (
        request.method === "PUT" &&
        url.pathname === "/content"
      ) {

        const body =
          await request.json();

        if (!body.content) {

          return new Response(
            JSON.stringify({
              error:
                "content saknas"
            }),
            {
              status:400,
              headers
            }
          );

        }

        const current =
          await githubRequest(
            `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
            {},
            env
          );

        const json =
          JSON.stringify(
            body.content,
            null,
            2
          );

        const encoded =
          encodeBase64(json);

        const result =
          await githubRequest(
            `/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
            {
              method:"PUT",

              body:JSON.stringify({

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

        return new Response(
          JSON.stringify({
            success:true,
            commit:
              result.commit?.sha || null
          }),
          {
            status:200,
            headers
          }
        );

      }


      return new Response(
        JSON.stringify({
          error:"Not found"
        }),
        {
          status:404,
          headers
        }
      );

    }

    catch(error) {

      return new Response(
        JSON.stringify({
          error:error.message
        }),
        {
          status:500,
          headers
        }
      );

    }

  }
};
