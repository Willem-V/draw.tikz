import * as SVG from "@svgdotjs/svg.js"

/**
 * Geometry of the circuitikz muxdemux shape (the mux and the block with pins) and the sizes at which all its pins are on
 * the grid.
 */

export const pinSides = ["left", "right", "top", "bottom"] as const
export type PinSide = (typeof pinSides)[number]

/** the outward direction (y upwards) of each side */
export const pinSideDirections: Record<PinSide, SVG.Point> = {
	left: new SVG.Point(-1, 0),
	right: new SVG.Point(1, 0),
	top: new SVG.Point(0, 1),
	bottom: new SVG.Point(0, -1),
}

/** the shape in circuitikz coordinates (origin in the center, y upwards), in any length unit */
export type MuxShape = {
	halfWidth: number
	/** half the height of the left side */
	leftHalfHeight: number
	/** half the height of the right side */
	rightHalfHeight: number
	counts: Record<PinSide, number>
	squarePins: boolean
	/** length of the leads of the pins */
	lead: number
}

/**
 * the lead of a pin, see the muxdemux shape in pgfcircmultipoles.tex
 * @param index the pin number, starting at 1 (top to bottom on the left and right side, left to right on the top and bottom side)
 * @returns the start of the lead on the box and its end (the anchor)
 */
export function muxLead(shape: MuxShape, side: PinSide, index: number): [SVG.Point, SVG.Point] {
	const direction = pinSideDirections[side]
	const count = shape.counts[side]
	if (direction.x) {
		const sideHalfHeight = direction.x < 0 ? shape.leftHalfHeight : shape.rightHalfHeight
		const start = new SVG.Point(
			direction.x * shape.halfWidth,
			sideHalfHeight - ((index - 0.5) * 2 * sideHalfHeight) / count
		)
		return [start, start.add(direction.mul(shape.lead))]
	}
	const x = -shape.halfWidth + ((index - 0.5) * 2 * shape.halfWidth) / count
	const topAt =
		shape.leftHalfHeight +
		((x + shape.halfWidth) / (2 * shape.halfWidth)) * (shape.rightHalfHeight - shape.leftHalfHeight)
	const start = new SVG.Point(x, direction.y * topAt)
	if (shape.squarePins) {
		const outer = Math.max(shape.leftHalfHeight, shape.rightHalfHeight) + shape.lead
		return [start, new SVG.Point(x, direction.y * outer)]
	}
	return [start, start.add(direction.mul(shape.lead))]
}

/** how far (in grid steps) a pin may be from the lattice of the other pins */
const tolerance = 0.02
/** sizes are searched in half grid steps, up to this size */
const searchStep = 0.5
const maxSize = 60

/** a size of the shape in grid steps */
export type MuxGridSize = { width: number; leftHeight: number; rightHeight: number }

const cache = new Map<string, MuxGridSize[]>()

/**
 * all sizes (in grid steps, half steps) at which all pins have the same position modulo the grid, i.e. the pins are on
 * the grid if one of them is
 * @param equalHeights the right height is the same as the left one (block with pins)
 * @returns sorted by size, empty if there are no pins or no such size exists
 */
export function muxGridSizes(
	counts: Record<PinSide, number>,
	squarePins: boolean,
	equalHeights: boolean
): MuxGridSize[] {
	const key = [...pinSides.map((side) => counts[side]), squarePins, equalHeights].join()
	let sizes = cache.get(key)
	if (!sizes) {
		sizes = searchSizes(counts, squarePins, equalHeights)
		cache.set(key, sizes)
	}
	return sizes
}

/**
 * the grid size closest to the given size
 * @param weights how important it is to stay close to the width, left and right height, e.g. the one the user just changed
 */
export function closestMuxGridSize(
	sizes: MuxGridSize[],
	wanted: MuxGridSize,
	weights = { width: 1, leftHeight: 1, rightHeight: 1 }
): MuxGridSize | undefined {
	let best: MuxGridSize | undefined
	let bestDistance = Infinity
	for (const size of sizes) {
		const distance =
			weights.width * (size.width - wanted.width) ** 2 +
			weights.leftHeight * (size.leftHeight - wanted.leftHeight) ** 2 +
			weights.rightHeight * (size.rightHeight - wanted.rightHeight) ** 2
		if (distance < bestDistance) {
			best = size
			bestDistance = distance
		}
	}
	return best
}

function searchSizes(counts: Record<PinSide, number>, squarePins: boolean, equalHeights: boolean): MuxGridSize[] {
	if (pinSides.every((side) => counts[side] == 0)) {
		return []
	}
	const candidates: number[] = []
	for (let value = searchStep; value <= maxSize; value += searchStep) {
		candidates.push(value)
	}
	// the sizes of the pins are one-dimensional until the pins of different sides are compared: prefilter each dimension
	const shape = (width: number, left: number, right: number): MuxShape => ({
		halfWidth: width / 2,
		leftHalfHeight: left / 2,
		rightHalfHeight: right / 2,
		counts: counts,
		squarePins: squarePins,
		lead: 1,
	})
	const leftOnly = (left: number) => consistent(sidePins(shape(2, left, left), ["left"]), "y")
	const rightOnly = (right: number) => consistent(sidePins(shape(2, right, right), ["right"]), "y")
	const widths = candidates.filter((width) => consistent(sidePins(shape(width, 2, 2), pinSides.slice()), "x"))
	const lefts = candidates.filter(leftOnly)
	const rights = equalHeights ? [] : candidates.filter(rightOnly)

	const sizes: MuxGridSize[] = []
	for (const width of widths) {
		for (const left of lefts) {
			for (const right of equalHeights ? [left] : rights) {
				if (consistent(sidePins(shape(width, left, right), pinSides.slice()), "y")) {
					sizes.push({ width: width, leftHeight: left, rightHeight: right })
				}
			}
		}
	}
	return sizes.sort((a, b) => a.width * (a.leftHeight + a.rightHeight) - b.width * (b.leftHeight + b.rightHeight))
}

/** the ends of the leads of the pins of some sides */
function sidePins(shape: MuxShape, sides: PinSide[]): SVG.Point[] {
	const points: SVG.Point[] = []
	for (const side of sides) {
		for (let index = 1; index <= shape.counts[side]; index++) {
			points.push(muxLead(shape, side, index)[1])
		}
	}
	return points
}

/** all coordinates are the same modulo one grid step */
function consistent(points: SVG.Point[], axis: "x" | "y"): boolean {
	return points.every((point) => {
		const offset = point[axis] - points[0][axis]
		return Math.abs(offset - Math.round(offset)) <= tolerance
	})
}
