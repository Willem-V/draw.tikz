# draw.tikz for VS Code

Visual editor for CircuiTi*k*Z/Ti*k*Z drawings. Files ending in `.drawtikz.json` open in the draw.tikz editor, and drawings export to Ti*k*Z code or SVG straight into your LaTeX project.

## Usage

- Right-click a folder in the Explorer > **New drawing**, or run `draw.tikz: New drawing`
- Open any `*.drawtikz.json` file to edit it visually. Use **Reopen Editor With... > Text Editor** to see the JSON
- Save and undo/redo work like for any other file
- Export to Ti*k*Z or SVG from the editor. The first export of a drawing asks where to write the file; later exports overwrite the same file

All controls of the editor are explained in its help menu (circled question mark in the top right corner).

## Settings

| Setting                        | Default | Description                                                                         |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------- |
| `drawtikz.defaultExportFolder` | `fig`   | Folder (relative to the workspace folder) suggested the first time a drawing is exported |

## More

Source, issues and the online version: <https://github.com/Willem-V/draw.tikz>

draw.tikz is a fork of [CircuiTikZ-Designer](https://github.com/Circuit2TikZ/CircuiTikZ-Designer), licensed under GPL-3.0.
