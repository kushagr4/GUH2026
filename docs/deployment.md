# Optional: deploying to Vercel

You don't need this to demo from a laptop. Nothing here has been deployed yet, and this workflow hasn't been run end to end.

Vercel's Hobby plan is free for personal, non-commercial projects, and needs no card. Never enable a paid resource for this event.

## Steps

1. Sign in at [vercel.com](https://vercel.com) with GitHub, and import `kushagr4/GUH2026`. The framework is detected automatically.
2. Add these under **Settings > Environment Variables**, for Production and Preview:

| Name | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Shared project URL | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key | Public |
| `ANTHROPIC_API_KEY` | Your key | Optional and **secret**. Only if the demo uses AI |
| `AI_PROVIDER` | `mock` | Optional. Offline AI |

Do not set `SUPABASE_SECRET_KEY` unless a server feature truly needs it, and do not set `ENABLE_DEV_TOOLS`, so `/dev` stays hidden.

3. Deploy.
4. In Supabase, go to **Authentication > URL Configuration**. Set **Site URL** to the deployment URL, and add `https://<your-app>.vercel.app/**` to **Redirect URLs**.
5. Open the deployed site, sign up, and confirm it works. `/dev` should return 404, and `/api/health` should report `supabaseConfigured: true`.

## Notes

- `vercel.json` runs server code in London (`lhr1`), next to the recommended Supabase region. This assumes the shared project is in `eu-west-2`. If it isn't, change or remove it.
- `NEXT_PUBLIC_*` values are built into the app. Redeploy after changing them.
- Every push to `main` deploys, and pull requests get preview URLs. All of them share the same database.
- Add preview URLs to Supabase's Redirect URLs only if you need email links or OAuth on them. Password sign-in doesn't use redirects.
