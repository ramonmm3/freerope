# FreeRope accounts and leaderboards (Supabase)

The apps stay local-first. Signing in is optional; signed-in jumpers also upload a summary of each
workout so it counts on the daily, weekly and all-time leaderboards.

- `migrations/20261029000000_accounts_leaderboards.sql`: tables, security rules, cheat checks,
  leaderboard function, account deletion and username reports.
- `test.mjs`: runs the migration in an in-memory Postgres and checks every rule (38 checks).
  `npm i @electric-sql/pglite && node supabase/test.mjs`
- Client: `app/account.js` (sign-in, sync, leaderboards), `app/config.js` (project URL and key),
  `app/vendor/supabase.js` (supabase-js 2.118.0 bundled into one file, so the app keeps working
  with no build step and offline inside the iPhone app).
- iPhone: `ios/FreeRope/AuthBridge.swift` shows Google/Apple sign-in in Apple's secure sheet
  (Google blocks sign-in inside embedded web views).

While `config.js` is empty, the app behaves exactly as before: no Leaderboard tab, no account rows.

## The live project

- Project **freerope** (ref `ysjiwnvxilgjtwnmhxmi`, organization FreeRope, free plan):
  https://supabase.com/dashboard/project/ysjiwnvxilgjtwnmhxmi
- Both migrations are applied. `app/config.js` and `android/gradle.properties` point at it.
- **Feedback** from the apps (Profile → Send Feedback): Table Editor → `feedback`
  (https://supabase.com/dashboard/project/ysjiwnvxilgjtwnmhxmi/editor/17809). Nobody can read it
  through the API; one install can send 5 messages an hour.
- Redirect URLs are set (web app, `freerope://auth-callback`, `freeropepreview://auth-callback`, localhost).
- Still to do: custom SMTP (needed before the 6-digit email code works, because Supabase only lets you
  edit the email template with your own sender), then the Google and Apple providers (steps 3 and 4).

## Set up a project from scratch (about 30 minutes, once)

### 1. Create the project
1. Sign up at https://supabase.com (free plan) and create a project named **freerope**. Pick the
   region closest to most jumpers (US East is a good default). Save the database password somewhere private.
2. **SQL Editor → New query**: paste the whole migration file and click **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key** into
   `app/config.js`. Both are safe to publish; the database rules do the protecting.
   Never put the `service_role` / secret key in the app.

### 2. Sign-in settings
**Authentication → URL Configuration**
- Site URL: `https://ramonmm3.github.io/freerope/app/`
- Redirect URLs (add all three):
  - `https://ramonmm3.github.io/freerope/app/`
  - `freerope://auth-callback` (the iPhone app)
  - `http://localhost:8766/app/` (testing on the PC)

**Authentication → Emails → Magic Link** template: the app signs people in with a 6-digit code
(easier than a link on a phone). Replace the body with something like:

```html
<h2>Your FreeRope code</h2>
<p>Enter this code in FreeRope to sign in:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>It expires in an hour. If you didn't ask for it, you can ignore this email.</p>
```

**Authentication → Emails → SMTP**: Supabase's built-in email only sends a few messages an hour.
Before launch, connect a free sender such as Resend (3,000 emails/month) so codes always arrive.

### 3. Google
1. https://console.cloud.google.com → new project **FreeRope**.
2. **APIs & Services → OAuth consent screen**: External, app name FreeRope, support email, logo,
   privacy policy `https://ramonmm3.github.io/freerope/privacy.html`. Publish it.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`
4. Paste the client ID and secret into Supabase **Authentication → Providers → Google** and enable it.

### 4. Apple
In the Apple developer account (Jaime's team, 95FGU7T5Y8), **Certificates, Identifiers & Profiles**:
1. **Identifiers → + → Services IDs**: description `FreeRope Sign In`, identifier
   `com.ramon.freerope.signin`. Enable **Sign in with Apple** → Configure: primary App ID
   `com.ramon.freerope`, domain `<your-project>.supabase.co`, return URL
   `https://<your-project>.supabase.co/auth/v1/callback`.
2. **Keys → +**: name `FreeRope Sign In`, enable **Sign in with Apple** (primary App ID
   `com.ramon.freerope`), download the `.p8` (once only; keep it private).
3. Supabase **Authentication → Providers → Apple**: enable it, Client IDs
   `com.ramon.freerope.signin,com.ramon.freerope`, and generate the secret with the Team ID,
   Key ID and `.p8` (Supabase's page links to its generator). Apple makes this secret expire after
   6 months: put a reminder in the calendar to regenerate it.

### 5. Try it
Serve `web/` locally (any static server on port 8766), open `http://localhost:8766/app/`, and the
Leaderboard tab appears. Sign in with each method, pick a name, finish a workout.

## Before releasing it in the apps
- Update `privacy.html` (done on this branch) and the App Store privacy answers: with accounts,
  FreeRope collects **email address** (sign-in), **name** (leaderboard name), **fitness** (workout
  summaries) and a **user ID**, all linked to the account, none used for tracking.
- App Review needs a way in: create a reviewer account (email code sign-in works with any inbox
  you can read) and put the steps in the review notes.
- Sign in with Apple must stay next to Google (App Store guideline 4.8), and account deletion is in
  Profile → Delete Account (guideline 5.1.1(v)). Both are already in the app.
- Android (Kotlin app) still needs the same sign-in and sync; until then Android users can use the
  leaderboard through the web app.

## Rebuild the bundled client
```
npm i @supabase/supabase-js@2 esbuild
echo "export { createClient } from '@supabase/supabase-js';" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020,safari15 --outfile=app/vendor/supabase.js --legal-comments=none
```
