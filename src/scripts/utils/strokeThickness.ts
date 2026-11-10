/**
 * CircuiTikZ draws the shapes of its components wider than the lines of a path: bipoles, tripoles, quadpoles and multipoles
 * 2 times the line width, the T ground 3 times. Wires, which are plain lines, have the line width itself, so a capacitor next to its wire looks
 * odd. With "uniform strokes" the shapes are drawn as wide as the wires (the export sets the thicknesses of CircuiTikZ to 1).
 */

/** the stroke width in the symbol database for a line width of 0.4pt, the circuitikz default */
const thinStroke = 0.53134

let uniform = false

/**
 * choose whether the symbols are drawn as wide as the wires. The canvas follows through css custom properties, which the
 * strokes of the symbols multiply (see {@link strokeCss})
 */
export function setUniformStrokes(on: boolean) {
	uniform = on
	const style = document.documentElement.style
	style.setProperty("--thick2", on ? "0.5" : "1")
	style.setProperty("--thick3", on ? (1 / 3).toString() : "1")
}

export function isUniformStrokes(): boolean {
	return uniform
}

/**
 * the factor by which a stroke width of a symbol is changed in uniform mode: strokes 2 or 3 times as wide as the thin ones
 * of the circuitikz default become as wide as the thin ones, everything else stays
 */
export function thickCorrection(width: number): number {
	if (!uniform) {
		return 1
	}
	const ratio = width / thinStroke
	if (Math.abs(ratio - 2) < 0.01) {
		return 0.5
	}
	if (Math.abs(ratio - 3) < 0.01) {
		return 1 / 3
	}
	return 1
}

/**
 * the css stroke width of a symbol stroke: the width of the database scaled by the line width of the component (--line-scale)
 * and made as wide as the thin strokes in uniform mode (--thick2, --thick3)
 */
export function strokeCss(width: number): string {
	const ratio = width / thinStroke
	const thick =
		Math.abs(ratio - 2) < 0.01 ? " * var(--thick2, 1)"
		: Math.abs(ratio - 3) < 0.01 ? " * var(--thick3, 1)"
		: ""
	return `calc(var(--line-scale, 1)${thick} * ${width}px)`
}
