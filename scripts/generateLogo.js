// Generates the draw.tikz logo and icon as pure SVG paths (Latin Modern, kerned like the TeX and TikZ logos) into src/icons/
// Usage: node scripts/generateLogo.js   (needs the Latin Modern fonts from a TeX installation, see `lm` below)
// The bitmaps are rendered from the SVGs with ImageMagick, in src/icons:
//   magick -background none -density 48 logo-icon.svg logo-icon.png   (VS Code extension icon, 256px)
//   magick -background none -density 36 logo-icon.svg android-icon-192x192.png
//   magick -background none -density 96 logo-icon.svg android-icon-512x512.png
//   sed 's/rx="104"/rx="0"/' logo-icon.svg | magick -background none -density 34 svg:- -resize 180x180 apple-icon-180x180.png
//   magick -background none -density 200 favicon.svg -define icon:auto-resize=48,32,16 favicon.ico
const opentype = require("opentype.js")
const fs = require("fs")
const path = require("path")

const outDir = path.join(__dirname, "../src/icons")

const lm = "/usr/share/texmf/fonts/opentype/public/lm/"
const roman = opentype.loadSync(lm + "lmroman10-regular.otf")
const italic = opentype.loadSync(lm + "lmroman10-italic.otf")

// pieces: [font, text, dx before (em), dy (em, positive = down)]
function layout(pieces, size) {
	let x = 0
	const out = []
	for (const [font, text, dx, dy] of pieces) {
		x += dx * size
		const path = font.getPath(text, x, dy * size, size)
		out.push(path)
		x += font.getAdvanceWidth(text, size)
	}
	let box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
	for (const p of out) {
		const b = p.getBoundingBox()
		box = { x1: Math.min(box.x1, b.x1), y1: Math.min(box.y1, b.y1), x2: Math.max(box.x2, b.x2), y2: Math.max(box.y2, b.y2) }
	}
	return { paths: out, box, width: x }
}

const d = (paths) => paths.map((p) => p.toPathData(2)).join("")

// "draw" then the dot as a circuit node, then Ti*k*Z like the TikZ logo: lowered italic k, tight kerning
function wordmark(size, ink, accent) {
	const draw = layout([[roman, "draw", 0, 0]], size)
	const tikz = layout(
		[
			[roman, "Ti", 0.25, 0],
			[italic, "k", -0.02, 0.06],
			[roman, "Z", 0.01, 0],
		],
		size
	)
	const dotX = draw.width + 0.125 * size
	const dotR = 0.07 * size
	const dotY = -dotR
	const shift = draw.width
	return {
		svg:
			`<path fill="${ink}" d="${d(draw.paths)}"/>` +
			`<circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="${dotR.toFixed(2)}" fill="${accent}"/>` +
			`<g transform="translate(${shift.toFixed(2)} 0)"><path fill="${ink}" d="${d(tikz.paths.slice(0, 1))}"/>` +
			`<path fill="${accent}" d="${d(tikz.paths.slice(1, 2))}"/><path fill="${ink}" d="${d(tikz.paths.slice(2))}"/></g>`,
		width: shift + tikz.width,
		top: Math.min(draw.box.y1, tikz.box.y1),
		bottom: Math.max(draw.box.y2, tikz.box.y2 + 0),
	}
}

// brand blue ($primary in src/styles/styles.scss) as background, a 50% tint of it as accent on dark backgrounds
const brand = "#00417b"
const bg = brand
const ink = "#f4f1ea"
const accent = "#80a0bd"

// square icon: "draw" over ".TikZ"
{
	const S = 512
	const size = 190
	const draw = layout([[roman, "draw", 0, 0]], size)
	const tikz = layout(
		[
			[roman, "Ti", 0, 0],
			[italic, "k", -0.02, 0.06],
			[roman, "Z", 0.01, 0],
		],
		size
	)
	const dotR = 0.075 * size
	const gap = 0.06 * size
	const line2W = 2 * dotR + gap + tikz.width
	const x1 = (S - draw.width) / 2
	const x2 = (S - line2W) / 2
	const y1 = 236
	const y2 = 412
	const dotX = x2 + dotR
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<rect width="${S}" height="${S}" rx="104" fill="${bg}"/>
<g transform="translate(${x1.toFixed(2)} ${y1})"><path fill="${ink}" d="${d(draw.paths)}"/></g>
<circle cx="${dotX.toFixed(2)}" cy="${(y2 - dotR).toFixed(2)}" r="${dotR.toFixed(2)}" fill="${accent}"/>
<g transform="translate(${(x2 + 2 * dotR + gap).toFixed(2)} ${y2})"><path fill="${ink}" d="${d(tikz.paths.slice(0, 1))}"/><path fill="${accent}" d="${d(tikz.paths.slice(1, 2))}"/><path fill="${ink}" d="${d(tikz.paths.slice(2))}"/></g>
</svg>
`
	fs.writeFileSync(path.join(outDir, "logo-icon.svg"), svg)
}

// favicon: the text is unreadable at 16px, so only the node dot and the italic k; the alternate (inverted) one blinks in the tab title
for (const [name, background, fill, dotColor] of [
	["favicon.svg", brand, ink, accent],
	["favicon_alternate.svg", "#ffffff", brand, brand],
]) {
	const S = 512
	const size = 560
	const k = layout([[italic, "k", 0, 0]], size)
	const dotR = 0.085 * size
	const gap = 0.02 * size
	const width = 2 * dotR + gap + (k.box.x2 - k.box.x1)
	const x = (S - width) / 2
	const y = (S + (k.box.y2 - k.box.y1)) / 2 - k.box.y2
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<rect width="${S}" height="${S}" rx="104" fill="${background}"/>
<circle cx="${(x + dotR).toFixed(2)}" cy="${(y - dotR).toFixed(2)}" r="${dotR.toFixed(2)}" fill="${dotColor}"/>
<g transform="translate(${(x + 2 * dotR + gap - k.box.x1).toFixed(2)} ${y.toFixed(2)})"><path fill="${fill}" d="${d(k.paths)}"/></g>
</svg>
`
	fs.writeFileSync(path.join(outDir, name), svg)
}

// wide wordmark with transparent background, one per theme
for (const [name, color, dotColor] of [
	["logo-dark.svg", ink, accent],
	["logo-light.svg", "#212529", brand],
]) {
	const size = 100
	const w = wordmark(size, color, dotColor)
	const pad = 8
	const height = w.bottom - w.top + 2 * pad
	const width = w.width + 2 * pad
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">
<g transform="translate(${pad} ${(pad - w.top).toFixed(2)})">${w.svg}</g>
</svg>
`
	fs.writeFileSync(path.join(outDir, name), svg)
}
