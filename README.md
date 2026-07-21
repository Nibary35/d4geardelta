# D4 Gear Delta

D4 Gear Delta is a browser-based Diablo IV helper for comparing gear, seals,
and charms. Screenshots are processed locally in the browser with OCR, and the
damage estimate uses the selected class/build profile plus scanned character
gear where available.

## Features

- Build import support for public Diablo IV planner links
- Character profile kit with scanned gear slots
- Two-screenshot gear comparison
- Seal and charm comparison
- Manual stat overrides for edge cases
- Local browser storage for saved profile data

## Privacy

Tooltip screenshots stay on the user's device. The OCR runs in the browser and
the app stores profile data only in local browser storage unless the user clears
or resets it.

## Local Development

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm test
```

## Deployment

The app is a static-friendly web project and can be hosted on Vercel, Netlify,
Cloudflare Pages, or similar free hosting providers.

For Vercel, import the GitHub repository, keep the root directory as `./`, and
use the default project URL or add a custom domain later.
