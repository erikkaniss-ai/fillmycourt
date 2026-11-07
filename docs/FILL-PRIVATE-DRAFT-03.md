# FILL-PRIVATE-DRAFT-03 — deploy without Netlify Git linking

Existing site: fillmycourt-preview (Netlify ID d763b7a1-dccd-4638-8876-ac1670171698), protected for all deploys by Team Login. Public fillmycourt.com is a DIFFERENT Netlify project.

Manual Netlify draft deployments require no Git linking. A same-repo PR #8-only GitHub Actions workflow is installed at .github/workflows/fill-private-preview-deploy.yml. It is explicitly scoped to branch fill/operator-mvp-readonly and base platform/v0.4-staging. It NEVER uses --prod or --prod-if-unlocked, never creates a site, only targets the exact existing Fill preview site ID, and performs two anonymous HTTP 401 checks before and after the draft upload. Deployment alias is fill-pr8-<first seven commit characters>--fillmycourt-preview.netlify.app; it is recognized as private by the in-app demo gate.

One-time input: preferably a dedicated GitHub Actions repository secret named FILL_NETLIFY_AUTH_TOKEN, falling back to an already-configured standard NETLIFY_AUTH_TOKEN, with an authorized Netlify PAT with access only to the existing Fill preview where possible. If absent, workflow safely reports FILL PRIVATE DEPLOY SKIPPED. Never paste tokens into chat. The workflow uses pinned Netlify CLI 27.12.1 and publishes platform/public plus platform/netlify/functions. It stamps fill/preview-build.json with the actual reviewed PR HEAD SHA (not GitHub's synthetic pull_request merge SHA). This draft deploy does not use --context because Netlify CLI 27.12.1 rejects --context with --no-build; the site-wide Team Login applies to all deployments. No new site or paid infrastructure.

Fill Netlify gateway now enforces runtime context.site.id exactly equal to approved private site ID before forwarding any Bearer credentials. Optional Functions environment variable FILL_OPERATIONS_API_BASE is no longer mandatory: the ONLY default upstream is the exact verified https://fmc-operations-api-staging.up.railway.app. Any configured override still must match this exact HTTPS host; a mistaken deployment to fillmycourt.com fails closed with HTTP503. GET-only methods and tenant membership checks on Operations remain required.

CI browser/UI fixture tests remain independent of Netlify. An actual provider/real operator sign-in still requires legitimate Supabase staging account and organization_members record. No operator account, club data, booking, payment, CRM, deployment or provider rights can be claimed based solely on source CI.

Status until deploy workflow succeeds with credential: source-only, no hosted latest SHA. Owner gate remains Issue #9.
Credential fallback: reuse the standard NETLIFY_AUTH_TOKEN if already present; it is never printed or read back in the workflow and can access ONLY the hardcoded existing Fill private site target through these commands. When neither credential exists, the job explicitly skips without upload.

Fix validated from GitHub deployment run attempt #2: Netlify CLI explicitly failed at `--context flag is only available when using the --build flag`. The source workflow removes this incompatible option; no deployment was produced in that attempt. A new push to isolated PR #8 will retry.
