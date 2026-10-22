# Browser tests

A real browser (Chromium, via Playwright) signs in as a test user, opens every
page at desktop and phone sizes, scrolls through it, and uses the main features.
A test fails if a page crashes, the app's API returns a server error, the page
grows wider than the screen, or a feature doesn't do what it should.

## Running them

They need a throwaway Postgres. They **wipe and reseed** it on every run, and
refuse to start unless it's on `localhost`, so they can't touch development or
production data.

```bash
# once: a disposable database in Docker
docker run -d --name kolab-e2e-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=kolab_e2e -p 5544:5432 postgres:16-alpine

# once: the browser
npx playwright install chromium

# every time, from apps/web
E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/kolab_e2e npm run test:e2e
```

The run starts its own copy of the app on port 3100, so it doesn't matter
whether `npm run dev` is running. On a machine with little memory add
`-- --workers=1`.

Useful extras:

```bash
npm run test:e2e -- --ui                 # watch the browser, step through tests
npm run test:e2e -- --project=desktop    # desktop only
npm run test:e2e -- -g "design board"    # tests whose name matches
npx playwright show-trace test-results/<folder>/trace.zip   # replay a failure
```

## What's here

| File | What it checks |
| --- | --- |
| `pages.spec.ts` | Every page loads and scrolls cleanly, signed in and signed out; the API refuses anonymous requests |
| `journeys.spec.ts` | Using features: group chat, members, notifications, profile, the UI/UX design board |
| `tour.spec.ts` | The first-visit guided tour appears, closes, and stays closed |
| `helpers.ts` | Watching a page for crashes and errors, scrolling, overflow checks |
| `global-setup.ts` | Migrates and seeds the database, signs the test user in |
| `seed.ts` | The test user, their friend and their group |

## How sign-in works

Real sign-in goes through GitHub or Google, which a test can't do. Sessions are
signed cookies, so the setup signs one for the seeded user using a test-only
secret, and starts the app with the same secret.

## What isn't covered

These need services the test run doesn't start, so pages that use them are
tested without them:

- **Live chat and presence** (the WebSocket server): messages are read from the
  database, but sending one live isn't tested.
- **The code editor and terminal** (the git service and a GitHub repo).
- **Calls** (LiveKit) and **the AI assistant's replies** (the AI provider).
