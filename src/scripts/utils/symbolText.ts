import * as SVG from "@svgdotjs/svg.js"

/**
 * LaTeX draws the text inside a node (the labels of a flip-flop, the + and - of an op amp, the symbols of logic ports)
 * differently from the rest of the shape when the node is transformed: the shape is rotated and mirrored, the text stays
 * upright, only the text of a mirrored node is flipped vertically (at the transformed position of the text).
 * The symbols of the symbol database draw the text as part of the shape, so it would be rotated or mirrored with it.
 * This creates variants of a symbol in which the text is counter-transformed, so the preview looks like the export.
 *
 */

/** the text of the symbols is a glyph group/use with this scale (see scripts/generateSymbols) */
const textSelector = 'g[transform*="scale(1.33333)"], use[transform*="scale(1.33333)"]'
const svgNS = "http://www.w3.org/2000/svg"

type TextPiece = { cx: number; cy: number }

const piecesCache = new Map<string, TextPiece[]>()
const variantCache = new Map<string, SVG.Symbol>()

/**
 * the symbol to show for a node with the given transformation matrix (symbol coordinates -> canvas): the symbol itself or a
 * variant with counter-transformed text
 */
export function orientedSymbol(symbol: SVG.Symbol, matrix: SVG.Matrix): SVG.Symbol {
	const linear = counterTransform(matrix)
	if (!linear) {
		return symbol
	}
	const [a, b, c, d] = linear
	if (a == 1 && b == 0 && c == 0 && d == 1) {
		return symbol
	}
	const id = symbol.node.id
	const key = `${id}_t${a}_${b}_${c}_${d}`.replace(/-/g, "m").replace(/\./g, "p")
	let variant = variantCache.get(key)
	if (variant) {
		return variant
	}
	const pieces = textPieces(symbol.node)
	if (pieces.length == 0) {
		return symbol
	}
	const clone = symbol.node.cloneNode(true) as Element
	clone.id = key
	// the glyph definitions are referenced by id from the original symbol
	clone.querySelectorAll("defs").forEach((defs) => defs.remove())
	const clonePieces = findText(clone)
	clonePieces.forEach((element, index) => {
		const { cx, cy } = pieces[index]
		const old = element.getAttribute("transform") ?? ""
		// matrix(a b c d e f) maps x' = a x + c y + e, y' = b x + d y + f
		element.setAttribute(
			"transform",
			`translate(${cx} ${cy}) matrix(${a} ${b} ${c} ${d} 0 0) translate(${-cx} ${-cy}) ${old}`
		)
	})
	symbol.node.parentNode?.appendChild(clone)
	variant = new SVG.Symbol(clone as SVGSymbolElement)
	variantCache.set(key, variant)
	return variant
}

/**
 * The transformation (in the local coordinates of the symbol, around the center of each text) which makes the text upright
 * and mirrored vertically if the node is mirrored: M⁻¹·S, with S the scale of M and a vertical mirror if M mirrors.
 * @returns a, b, c, d of the matrix (x' = a x + c y, y' = b x + d y), undefined if the matrix can't be inverted
 */
function counterTransform(m: SVG.Matrix): [number, number, number, number] | undefined {
	const det = m.a * m.d - m.b * m.c
	if (Math.abs(det) < 1e-9) {
		return undefined
	}
	const s = Math.sqrt(Math.abs(det))
	const sy = det < 0 ? -s : s
	// M⁻¹ = 1/det [[d, -c], [-b, a]], S = diag(s, sy)
	// (a, b, c, d) of M⁻¹·S = [[d s, -c sy], [-b s, a sy]] / det
	const result = [(m.d * s) / det, (-m.b * s) / det, (-m.c * sy) / det, (m.a * sy) / det]
	return result.map((value) => Math.round(value * 10000) / 10000 + 0) as [number, number, number, number]
}

/** the text elements of a symbol which are not part of another text element */
function findText(root: Element): Element[] {
	return Array.from(root.querySelectorAll(textSelector)).filter((element) => {
		for (let parent = element.parentElement; parent && parent != root; parent = parent.parentElement) {
			if (parent.matches(textSelector)) {
				return false
			}
		}
		return true
	})
}

/** the centers of the text of a symbol in symbol coordinates, empty if the symbol has no text or can't be handled */
function textPieces(symbol: Element): TextPiece[] {
	const cached = piecesCache.get(symbol.id)
	if (cached) {
		return cached
	}
	let pieces: TextPiece[] = []
	const elements = findText(symbol)
	// the centers are only correct if no parent of the text is transformed
	const plain = elements.every((element) => {
		for (let parent = element.parentElement; parent && parent != symbol; parent = parent.parentElement) {
			if (parent.hasAttribute("transform")) {
				return false
			}
		}
		return true
	})
	if (plain) {
		pieces = elements.map((element) => {
			const svg = document.createElementNS(svgNS, "svg")
			svg.style.cssText = "position:absolute;visibility:hidden;width:0;height:0"
			const group = document.createElementNS(svgNS, "g")
			group.appendChild(element.cloneNode(true))
			svg.appendChild(group)
			document.body.appendChild(svg)
			const box = group.getBBox()
			svg.remove()
			return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
		})
	}
	piecesCache.set(symbol.id, pieces)
	return pieces
}
