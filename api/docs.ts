// ─── GET /api/docs ───────────────────────────────────────────────────────────
// Renders Swagger UI from the unpkg CDN, pointed at /api/openapi.json.
// Bare-bones HTML — no build step, no JS framework. The Swagger UI bundle
// loads at runtime in the browser.
//
// We deliberately use res.setHeader + res.end (not res.json) since the body is
// HTML. The response is cacheable for 5 minutes; the inline HTML never changes
// across deploys.

import type { VercelRequest, VercelResponse } from '@vercel/node'

const SWAGGER_VERSION = '5.17.14'

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sahay API · Reference</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      #swagger-ui { max-width: 1400px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'StandaloneLayout',
          defaultModelsExpandDepth: 1,
          docExpansion: 'list',
          tryItOutEnabled: true,
          persistAuthorization: true,
        })
      })
    </script>
  </body>
</html>
`

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).end('Method not allowed')
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
  // Swagger UI uses inline scripts; loosen X-Frame-Options for embedding.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.status(200).end(HTML)
}
