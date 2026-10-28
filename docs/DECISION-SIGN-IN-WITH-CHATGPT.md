# Decision: Sign in with ChatGPT — shelved

_Researched and decided October 28, 2026. The app is Rubato Coach (https://rubato.coach); the repo keeps its original Track Train Live name._

## Question

Could Rubato Coach add "Login with OpenAI", letting users sign in with ChatGPT and pay for AI with their ChatGPT plan instead of an OpenRouter key?

## Decision

Not now. We are shelving it, and OpenAI models will be offered through OpenRouter in the updatable model picker instead. Users pay through their existing OpenRouter key, with no new login.

Revisit if OpenAI opens plan usage to hosted apps from hobby or individual developers without the commercial-partner process.

## What OpenAI offers

OpenAI's product is called Sign in with ChatGPT. It has two separate parts with different rules.

**Identity-only sign-in.** This gives an app the user's name, email, picture and a stable account ID. It does not give access to models.
- It is a limited trial for selected commercial partners. A client ID (`oaiapp_…`) comes through a waitlist or interest form.
- It needs an exact registered callback URL for each environment.
- OpenAI's website guide has a backend exchange the code, verify the ID token against OpenAI's JWKS, and create the app's own session. Public clients (no secret) exist, so a browser-only flow is not strictly ruled out for identity.
- Rubato Coach has no accounts, so identity alone would add nothing.

**ChatGPT plan usage.** This is the part that would replace OpenRouter: eligible Plus and Pro users run the app's AI requests on their own plan.
- It is self-serve only for open-source apps that run on the user's own machine. The client registers dynamically, and the sign-in redirect must be an HTTP loopback address on `127.0.0.1`, which a Netlify-hosted web app cannot use.
- The docs say: "If you're interested in offering it in a paid or remotely hosted app, complete the interest form."
- Tokens: access tokens last about an hour (`expires_in: 3600` in the example), and refresh tokens rotate on every refresh. The docs say to keep tokens "out of browser storage, source control, logs, analytics, and support transcripts", so the current design of keeping the credential in IndexedDB would not fit.
- Inference uses the Responses API, with restrictions: `store: false`, `stream: true`, full history sent in `input`, no `temperature` or `max_output_tokens`, function tools grouped in namespaces, and no hosted tools. That is a different request shape from the OpenRouter chat-completions client in `src/lib/api.ts`, so it would be a second provider, not a swap.
- Plus users' five-hour usage limit is shared across every app that uses their plan.

## What we checked ourselves

On October 28, CORS preflights from both `https://track-train-live.netlify.app` and `https://rubato.coach` origins to `https://auth.openai.com/api/accounts/oauth/token` and `https://api.openai.com/v1/responses` both returned `access-control-allow-origin: *`. A browser-only implementation is therefore technically possible. The blockers are policy (eligibility and token-storage guidance), not browser networking.

## Why we shelved it

- The hosted path goes through a commercial-partner process, which is not an available or established route for this individual/hobby hosted app. OpenAI's own docs point hobby developers to the self-serve documentation instead.
- The self-serve path requires a loopback redirect and local credential storage, so it doesn't fit a hosted PWA. Working around that would mean breaking OpenAI's stated rules.
- If we got approval later, the smallest compliant design would be a token service (for example, a couple of Netlify Functions holding the refresh token in an HttpOnly cookie), with inference still going from the browser to OpenAI. That would end the app's "no backend" property, which the README highlights, and add a component to secure.
- OpenRouter already carries OpenAI models. The planned model-picker change gets users those models with far less work.

## Sources

- Quickstart: https://developers.openai.com/siwc/quickstart
- Plan usage overview: https://developers.openai.com/siwc/token-sharing-open-source
- Registration and sign-in (loopback rule, scopes): https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- Accounts and sessions (token storage, shared limits): https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- Preview limitations (Responses API rules): https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- Website sign-in (backend flow): https://developers.openai.com/siwc/website
- Request a client ID: https://developers.openai.com/siwc/request-client-id
- Developer DevKit: https://github.com/openai/sign-in-with-chatgpt-devkit
