# Publish Ginny Kong on GitHub Pages

Use **this `ginny-kong` folder as the repository root**. The other games, reference photos, and archived artwork in the parent `ginny-game` folder are not needed.

## Recommended: automatic publishing

1. Create a GitHub repository named `ginny-kong`. A public repository supports GitHub Pages on GitHub Free.
2. Upload or push the contents of this folder to its `main` branch. At the repository's top level, you should see `index.html`, `game.js`, `style.css`, `images/`, `scripts/`, `tests/`, and `.github/workflows/pages.yml`. Do not nest everything inside another `ginny-kong` folder. Include the `.github` directory even though Windows may hide dot-prefixed directories in some tools.
3. Open the repository's **Settings → Pages**. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open **Actions → Publish Ginny Kong → Run workflow**. After the workflow succeeds, Settings → Pages shows the live HTTPS link. Future pushes to `main` publish updates automatically.

The usual address is `https://YOUR-USERNAME.github.io/ginny-kong/`. A repository named `YOUR-USERNAME.github.io` instead publishes at `https://YOUR-USERNAME.github.io/`. All game asset paths are relative, so either address works.

The workflow checks the controls, verifies asset filename capitalization, and builds a `dist/` artifact containing only the three game files, `.nojekyll`, and seven images. It does not publish tests, logs, development tools, reference photos, or archived images. GitHub supplies HTTPS, which the camera needs. Each visitor grants camera permission in their own browser. Hand and mouth tracking still need initial access to the external MediaPipe assets; camera frames are processed locally.

## Alternative: upload the ready-made static site

If you prefer using GitHub's web uploader without a workflow, upload **the contents of `dist/`** to the root of your repository on `main`. In **Settings → Pages**, select **Deploy from a branch**, then **main** and **/(root)**, and save. Keep the `images` folder intact. Do not upload the `dist` folder itself as a nested folder. This route requires uploading updated files manually whenever the game changes.

Regenerate `dist/` after changing the game by running `node scripts/build-pages.cjs` from this folder. `dist/` is ignored by Git because the automated workflow regenerates it.

## Local files

- `images/`: the seven images actually used by the game.
- `../artwork/ginny-kong-archive/`: preserved unused portraits, reference artwork, previews, and the art prompt. These are outside the game repository.
- `serve.cjs`: local preview server; run `node serve.cjs`, then visit `http://localhost:4175/`.
- `.github/workflows/pages.yml`: automatic GitHub Pages deployment.

## If the published site has a problem

- A 404 at the site root usually means `index.html` is nested in another folder or the workflow has not deployed successfully. Check Settings → Pages and the latest Actions run.
- Missing images usually mean the `images/` directory was not uploaded. The automated build checks exact filename capitalization for GitHub's case-sensitive hosting.
- The camera requires the HTTPS site URL. Opening a downloaded `index.html` directly is not equivalent to opening the hosted website.
- If an old copy appears, refresh the page. Check that the latest Actions run has succeeded.

GitHub's instructions: [configure a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [use custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
