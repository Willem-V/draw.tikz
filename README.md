<h1>
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="src/icons/logo-dark.svg" />
		<img src="src/icons/logo-light.svg" alt="draw.tikz" height="64" />
	</picture>
</h1>

An interactive, visual editor for creating electrical circuit diagrams for LaTeX/CircuiTi*k*Z with ease.

draw.tikz is a fork of [CircuiTi*k*Z-Designer](https://github.com/Circuit2TikZ/CircuiTikZ-Designer) by Manuel Kirzinger, Philipp Wiedemann and Christof Pfannenmüller (FAU), licensed under [GPL-3.0](LICENSE). The goal is to extend it step by step towards a general GUI for Ti*k*Z drawings.

## Two ways to use it

### 1. Online

**<https://willem-v.github.io/draw.tikz/>**

Drawings are stored in the browser (per address). Save your drawing regularly as a JSON file (Ctrl/⌘ + S) to be safe.

### 2. VS Code extension

The extension opens `*.drawtikz.json` files in the draw.tikz editor inside VS Code, so a drawing is a normal file that lives (and is versioned) next to your LaTeX project.

1. Download `draw-tikz-<version>.vsix` from the latest [release](https://github.com/Willem-V/draw.tikz/releases)
2. In VS Code: Extensions view > `...` > **Install from VSIX...** (or `code --install-extension draw-tikz-<version>.vsix`)
3. Right-click a folder in the Explorer > **New drawing** (or the command `draw.tikz: New drawing`), or open any existing `*.drawtikz.json`

Saving and undo/redo go through VS Code like for any other file. Exporting to Ti*k*Z or SVG writes the file into the workspace: the first export of a drawing suggests the folder from the setting `drawtikz.defaultExportFolder` (default `fig`), later exports overwrite the same file.

All controls of the editor are explained in the help menu (circled question mark in the top right corner).

## Changes compared to CircuiTi*k*Z-Designer

- **VS Code extension:** edit `*.drawtikz.json` files in VS Code and export straight into the LaTeX project (see above)
- **Variable sources:** a "Variable" switch on all voltage and current sources draws a diagonal arrow over the symbol (also exported to Ti*k*Z)
- **Transistor arrow position:** environment setting for `\ctikzset{transistors/arrow pos=...}`, defaulting to the end of the terminal. The canvas symbols for this are generated with [scripts/generateArrowEndSymbols.py](scripts/generateArrowEndSymbols.py)
- **Enable axes:** the axes can be hidden like the grid; the grid setting is now also restored correctly
- **Rectangle arrays:** a "Draw as array" switch on rectangles draws extra offset outlines at the top and right (adjustable number of layers and offset), so a rectangle around a device shows an array of devices (also exported to Ti*k*Z)
- **Rectangles as frames:** unfilled rectangles without text can only be selected at their border, so components inside them can be clicked and the rectangle can be deselected
- **Straight lines and arrows** stay straight after undo, copy/paste and reloading, and diagonal segments stay straight when resizing
- **Flipping/rotating** a single component no longer moves it
- **Labels** are at the correct position directly after loading a JSON file
- **Line width for symbols:** every node and path symbol has a "Line width" setting that scales all its strokes like CircuiTi*k*Z's `line width` option (also exported to Ti*k*Z and SVG)
- **Resizable blocks:** the generic two port (split) blocks and the European blank (not) ports have width, height and "Lock aspect ratio" instead of a scale, adjustable with drag handles on the canvas and exported with the matching CircuiTi*k*Z keys. Two port blocks can also contain text (`t=`)
- **Block with pins and Mux** (Block diagram group): a rectangle, and a mux trapezoid with separate left and right height, with a configurable number of pins on each side (left, right, top, bottom; 0–16), resizable with handles. The mux can also have square pins. Both are exported as a CircuiTi*k*Z `muxdemux`, so the pins are available as `lpin 1`, `rpin 2`, `tpin 1`, `bpin 3`, …
- **Symbol picker:** the symbol panel pops up in the middle of the screen (Q or I) and can be used with the keyboard like a picker in vim: type to search (fuzzy or regex), Enter places the highlighted symbol, Ctrl+J/K moves while typing, Esc switches to normal mode with h/j/k/l, gg/G and / (Esc or q closes)
- **SVG export for Office:** text inside symbols (e.g. T, Q and Q̄ on flip-flops) and labels no longer disappear when the exported SVG is used in PowerPoint or Word
- **Grid switch** at startup now matches whether the grid is visible
- No Google Analytics, no Electron desktop app

## Features

- **Visual circuit design** with multi-tab support and component grouping
- **Component library** with most CircuiTi*k*Z elements plus Ti*k*Z shapes like rectangles, ellipses and arrows
- **Export** to clean CircuiTi*k*Z code and to SVG
- **Editing:** rotate, scale, align, distribute and snap components; switch component variants and adjust their properties in the properties window
- **MathJax** math in text components, rendered live

## Development

Requires [Node.js](https://nodejs.org/) v20.

**Web app:** run `npm ci`, then `npm start` serves the working tree on <http://localhost:1234> and reloads on every change.

**VS Code extension** (in [vscode/](vscode)): the extension bundles the built web app.

```sh
npm ci                      # in the project root, the extension build uses its parcel
cd vscode
npm ci
npm run package             # builds the app and extension, writes draw-tikz-<version>.vsix
code --install-extension draw-tikz-<version>.vsix
```

`npm run check` type-checks the extension code.

## Hosting and releases (GitHub Actions)

Two workflows in [.github/workflows](.github/workflows):

- **[pages.yml](.github/workflows/pages.yml):** every push to `main` builds the web app and publishes it with GitHub Pages (Settings > Pages > Source: GitHub Actions)
- **[release.yml](.github/workflows/release.yml):** a version tag `vX.Y.Z` builds the VS Code extension and creates a GitHub Release with the `.vsix` attached

To release a new extension version:

1. Bump `version` in [vscode/package.json](vscode/package.json) (the workflow fails if the tag does not match it) and commit
2. `git tag vX.Y.Z && git push origin main vX.Y.Z`

GitHub Actions is free for public repositories.

### Publishing publicly (later)

The release workflow already contains the publish steps as comments:

- **VS Code Marketplace:** create the publisher `willem-v` (the `publisher` in `vscode/package.json`) at <https://marketplace.visualstudio.com/manage>, create an Azure DevOps personal access token with scope Marketplace > Manage and organization "All accessible organizations" and add it as repository secret `VSCE_PAT`
- **Open VSX** (VSCodium, Cursor, ...): create a token at <https://open-vsx.org> and add it as repository secret `OVSX_PAT`

The Marketplace page shows `vscode/README.md`; images there must use `https` URLs (no SVG).

## Contributing

Report bugs and request features in the [GitHub issues](https://github.com/Willem-V/draw.tikz/issues). Please always provide steps on how to reproduce a bug.

Bugs that also occur in the original CircuiTi*k*Z-Designer can be reported [upstream](https://github.com/Circuit2TikZ/CircuiTikZ-Designer/issues).

## Todos

- Save groups of own components
- Import external Ti*k*Z files if possible
