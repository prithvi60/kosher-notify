<!--
Repository-specific Copilot instructions for AI coding agents.
Keep this short (20–50 lines). Focus on concrete, discoverable patterns.
-->

# Copilot instructions for the kosher-notify repository

Short, actionable notes to help an AI agent be productive in this Shopify React Router app.

- Big picture
  - This is a Shopify App built with the `@shopify/shopify-app-react-router` package using server-side rendering.
  - Server entry and SSR behavior are in `app/entry.server.jsx` and HTML shell in `app/root.jsx`.
  - Shopify integration lives in `app/shopify.server.js` (exports: `shopify`, `authenticate`, `registerWebhooks`, `sessionStorage`).
  - Sessions are stored using Prisma (`prisma/schema.prisma`) with `PrismaSessionStorage` via `app/db.server.js`.

- Key workflows & commands (local development)
  - Start development and tunnel with the Shopify CLI (recommended): `shopify app dev` (see `README.md`).
  - Build: `npm run build` or `yarn build` (standard scripts in `package.json`).
  - Deploy webhooks/app config: `npm run deploy` (updates `shopify.app.toml`).

- Project-specific patterns and conventions
  - Routes are file-system driven via `@react-router/fs-routes` and configured in `app/routes.js` (calls `flatRoutes()`).
  - Use `shopify.authenticate.admin(request)` in loader actions to access `admin` for GraphQL calls (see examples in `README.md`).
  - Prefer `Link` and `useSubmit` from `react-router` for navigation when app is embedded in an iframe. Avoid raw `<a>` tags.
  - App-specific webhooks should be declared in `shopify.app.toml` rather than in `afterAuth` to ensure CLI/Shopify syncs subscriptions.

- Files to inspect for common edits
  - `app/shopify.server.js` — auth, session storage, email config
  - `app/entry.server.jsx` — SSR stream behavior and headers via `addDocumentResponseHeaders`
  - `app/routes/` — app routes and webhook handlers (e.g., `webhooks.app.uninstalled.jsx`)
  - `prisma/schema.prisma` & `prisma/migrations/` — DB schema for sessions
  - `extensions/` — app extension (UI/blocks) and Liquid snippets

- Integration & external dependencies
  - Relies on Shopify CLI for local tunnels, app auth and webhook testing (CLI may use Cloudflare or ngrok tunnels).
  - Prisma (default SQLite) via `PrismaSessionStorage` stores sessions — consider provider changes for multi-instance deployments.
  - Email config is read from env vars (`SMTP_*`) in `app/shopify.server.js` (see `emailConfig`).

- Quick agent rules when editing
  - Preserve existing env var usage and `shopify.*` exports. Changes to `shopify.server.js` affect auth/session flows.
  - When adding routes, follow `app/routes/` naming conventions and let `flatRoutes()` pick them up.
  - When modifying webhooks prefer edits in `shopify.app.toml` for app-scoped subscriptions.

If anything here is unclear or you want the file expanded with examples (code snippets for common tasks), tell me which area to expand.
