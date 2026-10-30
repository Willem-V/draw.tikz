import * as SVG from "@svgdotjs/svg.js"
import { CanvasController } from "../internal"

/**
 * Grid-first sizing: the CircuiTikZ dimensions of most symbols do not put their pins on the grid. Slightly different x and
 * y scales do, e.g. 1.02 × 0.98 for a transistor on a 0.25cm grid.
 */

/** how far (in grid steps) a pin may be from a grid point and still count as on the grid */
const tolerance = 0.02
const minScale = 0.25
const maxScale = 4
/** how much the x and y scale may differ, so the symbol does not look stretched */
const maxDistortion = 0.1
/** a new symbol only starts at a grid size this close to its normal size (as log of the scale, about 15%) */
export const maxDefaultSizeChange = 0.15
/**
 * symbols which always start at a grid size, however far it is from their normal size: their terminals are far off the grid
 * at the normal size
 */
export const alwaysOnGrid = ["en amp", "inst amp ra"]

/**
 * pins which do not count for the grid: helper anchors and supply pins. They are too close to the main terminals for both
 * to be on the grid, e.g. "up" of an op amp is 0.2 grid steps away from the height of "-".
 */
const secondaryPin = /^(up|down|bin|bout|kink|center|zero|ra[+-]|refv (up|down)|inner dot|hlines)/

/**
 * the pins which have to be on the grid: the main terminals of the symbol
 * @returns all pins if the symbol has less than two main terminals
 */
export function mainPins<T extends { name?: string }>(pins: T[]): T[] {
	const main = pins.filter((pin) => !secondaryPin.test(pin.name ?? ""))
	return main.length >= 2 ? main : pins
}

/** the distance between two grid points in px */
export function gridSpacingPx(): number {
	const canvas = CanvasController.instance
	return new SVG.Number(canvas.majorGridSizecm / canvas.majorGridSubdivisions, "cm").convertToUnit("px").value
}

/**
 * all scales (x, y) between 0.25 and 4 at which every pin is on the grid when one of them is, sorted from small to large
 * @param pins the pin positions of the unscaled symbol
 * @returns an empty list if the symbol has less than two pins or no such scale exists
 */
export function gridScales(pins: SVG.Point[], grid = gridSpacingPx()): SVG.Point[] {
	if (pins.length < 2) {
		return []
	}
	const offsets = (axis: "x" | "y") =>
		pins.map((pin) => Math.abs(pin[axis] - pins[0][axis])).filter((offset) => offset > 1e-6)
	const xScales = axisScales(offsets("x"), grid)
	const yScales = axisScales(offsets("y"), grid)

	let scales: SVG.Point[]
	if (!xScales && !yScales) {
		return []
	} else if (!xScales || !yScales) {
		// all pins on one line: keep the aspect ratio
		scales = (xScales ?? yScales).map((scale) => new SVG.Point(scale, scale))
	} else {
		scales = []
		for (const y of yScales) {
			const x = closest(xScales, y)
			if (x !== undefined && Math.abs(x / y - 1) <= maxDistortion) {
				scales.push(new SVG.Point(x, y))
			}
		}
	}
	return scales.sort((a, b) => a.x * a.y - b.x * b.y)
}

/**
 * the scales at which all offsets are multiples of the grid
 * @returns null if there are no offsets (any scale works)
 */
function axisScales(offsets: number[], grid: number): number[] | null {
	if (offsets.length == 0) {
		return null
	}
	const largest = Math.max(...offsets)
	const scales: number[] = []
	// the largest offset has to be k grid steps
	for (let k = Math.ceil((minScale * largest) / grid); k <= Math.floor((maxScale * largest) / grid); k++) {
		const scale = (k * grid) / largest
		const onGrid = offsets.every((offset) => {
			const steps = (offset * scale) / grid
			return Math.abs(steps - Math.round(steps)) < tolerance
		})
		if (onGrid) {
			scales.push(scale)
		}
	}
	return scales
}

function closest(values: number[], target: number): number | undefined {
	let best: number
	for (const value of values) {
		if (best === undefined || Math.abs(value - target) < Math.abs(best - target)) {
			best = value
		}
	}
	return best
}

/** a scale rounded for display and saving (the save files and TikZ use 3 digits) */
export function roundScale(scale: number): number {
	return Math.round(scale * 1000) / 1000
}
