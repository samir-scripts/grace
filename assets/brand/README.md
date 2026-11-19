# Grace icon family

[`grace-mark.svg`](grace-mark.svg) is the hand-authored vector master. It adapts the Grace landing-page ring to a 36-by-25 view box, preserving its displayed 1.44 width-to-height ratio and stepped silhouette. The centered 6-by-6 coral square distinguishes the app mark from the website's hollow ring.

From the repository root, with locked npm dependencies installed:

```sh
npm run generate:brand-icons -- --output /tmp/grace-icon-review
node --test scripts/generate-brand-icons.test.mjs
```

Open the generated `review.html` to inspect desktop and companion candidates at actual sizes. The generator stages exports; it does not change the packaged art or sign anything. Desktop assets live in `src-tauri/icons/`; Chrome and Firefox use the overlay in `extensions/companion/`. Safari does not use the overlay. Any change to the effective Firefox payload requires a matching AMO-signed package and provenance; see the [companion development guide](../../extensions/README.md).
