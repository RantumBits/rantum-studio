# Rantum Studio

The source code for the Rantum Studio landing page, hosted at [rantum.xyz](https://rantum.xyz).

A senior data science & ML studio that turns messy, fragmented, and adversarial data into models, APIs, and products that ship. Built with plain HTML and Tailwind CSS.

## Development

Styles are built from `src/input.css` with Tailwind CSS into `assets/app.css` (committed, so deploys need no build step). To regenerate after changing markup or styles:

```bash
npm install        # first time only
npm run build:css  # one-off build (minified)
npm run watch:css  # rebuild on change while developing
```

The pages are static HTML — open `index.html` directly or serve the folder. The built `assets/app.css` is what the site loads; the Tailwind Play CDN is intentionally not used.
