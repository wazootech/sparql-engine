# Vendored fonts

The Wazoo design system (wazoo.dev/DESIGN.md) specifies **IBM Plex Mono** for
body copy, buttons, tooltips, and code, and **Inter** for headings. These are
vendored here (latin subset, woff2) so the playground renders the exact brand
typography on any machine — no runtime CDN, and `file://` keeps working.

| File                      | Family / weight            | Source                                                             |
| ------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `ibm-plex-mono-400.woff2` | IBM Plex Mono Regular 400  | [IBM/plex](https://github.com/IBM/plex) v6.4.0, via Google Fonts   |
| `ibm-plex-mono-600.woff2` | IBM Plex Mono SemiBold 600 | [IBM/plex](https://github.com/IBM/plex) v6.4.0, via Google Fonts   |
| `inter-600.woff2`         | Inter SemiBold 600         | [rsms/inter](https://github.com/rsms/inter) v4.1, via Google Fonts |
| `inter-700.woff2`         | Inter Bold 700             | [rsms/inter](https://github.com/rsms/inter) v4.1, via Google Fonts |

Both families are licensed under the **SIL Open Font License 1.1** — free to
bundle and redistribute. Licenses:

- IBM Plex: https://github.com/IBM/plex/blob/master/LICENSE.txt
- Inter: https://github.com/rsms/inter/blob/master/LICENSE.txt

Regenerate (Google Fonts CSS2 API, Chrome UA, `latin` subset only):

```bash
curl -s -A "Mozilla/5.0 ... Chrome/126.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@600;700&display=swap"
```

then extract each weight's `latin` `url(...)` and save it under the names above.
The page's `@font-face` rules resolve them relative to this folder.
