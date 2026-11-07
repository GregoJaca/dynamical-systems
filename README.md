# Nonlinear Systems Analyzer

A static, in-browser phase-portrait tool for autonomous and second-order scalar systems. Portraits, equilibria, and manifolds are computed locally. Exact symbolic formulas are filled in afterwards by a Pyodide + SymPy worker when the network can reach jsDelivr.

Nothing is stored in `localStorage`. The address hash is the whole saved state.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/). The first paint is the numeric portrait. Symbolic LaTeX arrives a few seconds later on a normal connection, and the portrait stays usable if that download fails.

## Check the math

```bash
npm test
```

## Production build

```bash
npm run build
npm run preview
```

The production base path is `/dynamical-systems/`, so the preview is at [http://localhost:4173/dynamical-systems/](http://localhost:4173/dynamical-systems/). Override it with `VITE_BASE_PATH` when the app is hosted under a different folder.

## See it online

This checkout does not publish itself. After `main` is pushed, enable GitHub Pages with the **GitHub Actions** source. The workflow in `.github/workflows/deploy.yml` then serves the site at:

[https://gregojaca.github.io/dynamical-systems/](https://gregojaca.github.io/dynamical-systems/)
