# Sahay — सहाय

AI customer support platform for Indian D2C brands. WhatsApp + Instagram + Web, with Hindi/Hinglish AI replies built for Shopify sellers.

## Stack

Turborepo monorepo:

- `apps/api` — backend service
- `apps/web` — dashboard
- `packages/config`, `packages/db`, `packages/shared` — shared workspace packages

## Development

```bash
npm install
npm run dev      # turbo run dev across all apps
npm run build
npm run test
npm run lint
```

Database (via `packages/db`):

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

Local infra:

```bash
npm run infra:up
npm run infra:down
```

## License

MIT
