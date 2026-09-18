# Potion

A folder for your apps. Login optional. Sync only if you want it.

## Use it

- **Web** — open the Vercel URL
- **PC** — Chrome or Edge → Install app. Potion sits next to your other apps.
- **Phone** — open the same URL → Add to Home Screen. That is the Android install.

No store APK from this repo. The PWA *is* the phone app.

## Self-host

```
npm install
npm run dev
```

Production:

```
npm run build
```

Needs Node 22. Optional `DATABASE_URL` for the signed-in locker. Without it, files stay on the device.

## GitHub

https://github.com/eect13/potion
