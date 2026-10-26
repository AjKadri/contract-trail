# GitHub Pages setup

The static viewer is committed under `docs/viewer/` and is ready to publish
without a build service. This repository does not enable Pages or change its
visibility.

When the repository is public, enable Pages in the repository settings:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Choose the `main` branch and the `/docs` folder, then save.
4. Open the project Pages URL followed by `/viewer/`.

For this repository, the viewer URL will be:

```text
https://ajkadri.github.io/contract-trail/viewer/
```

Before publishing a new curated trace, rebuild the committed static output:

```sh
npm run build:viewer
git add docs/viewer runs/README.md
git commit -m "chore(viewer): refresh recorded runs"
```

The old Pages Actions workflow was removed because GitHub returned “Pages not
found” while the repository was private. The branch-based setup above keeps
publication manual and avoids a failing check before Pages is enabled.
