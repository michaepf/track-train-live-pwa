# Track Train Live

An AI-powered personal training PWA. Chat with your AI trainer to set goals and build a workout plan, then log your sessions as you go.

- **Chat** — onboard, set goals, and adjust your plan through conversation
- **Today** — record your workout as you go through it at the gym
- **Workouts** — view your upcoming planned sessions
- **Log** — review past sessions

All data is stored locally on your device using IndexedDB. Nothing leaves your device except the messages sent to the AI. Requires a free [OpenRouter](https://openrouter.ai) account — you pay for AI usage directly at roughly $2–5/month for heavy use.

## Tech notes

- React + TypeScript, built with Vite
- Progressive Web App — installable on Android and iOS
- **No backend.** All state lives in the browser via IndexedDB. Auth is handled through OpenRouter's OAuth flow; the API key is stored locally.
- AI requests go directly from the browser to the OpenRouter API

## Deploy your own

1. Fork this repo
2. Connect it to [Netlify](https://netlify.com) (import from GitHub)
3. Netlify will auto-detect the build settings from `netlify.toml`

That's it — no environment variables, no database, no server, no infrastructure to manage. The OpenRouter auth flow uses PKCE and doesn't require pre-registering a redirect URL.

## License

MIT — see [LICENSE](./LICENSE).
