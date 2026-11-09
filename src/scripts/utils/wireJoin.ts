/**
 * Pure geometry for joining two wires which touch end to end into one wire (no DOM, so it can be tested in Node).
 * One wire gets a proper line join at the corner, two separate wires would each end flat and leave the outer corner notched.
 */

export type JoinPoint = { x: number; y: number }

/** the wire directions as they are stored: "--" straight, "-|" horizontal then vertical, "|-" vertical then horizontal */
export type JoinPath<D extends string> = {
	points: JoinPoint[]
	directions: D[]
	/** the arrow at the first/last point is not the default (none) arrow */
	startArrow: boolean
	endArrow: boolean
}

function same(a: JoinPoint, b: JoinPoint): boolean {
	return a.x === b.x && a.y === b.y
}

/** the same line walked the other way round: a "horizontal then vertical" segment becomes "vertical then horizontal" */
function reversed<D extends string>(path: JoinPath<D>, opposite: (direction: D) => D): JoinPath<D> {
	return {
		points: path.points.slice().reverse(),
		directions: path.directions.map(opposite).reverse(),
		startArrow: path.endArrow,
		endArrow: path.startArrow,
	}
}

/**
 * Join two paths which share an end point.
 * @returns the joined path, or null when the paths do not touch end to end, or an arrow sits where they touch.
 * The joined path starts at the first path (or its reversal) and continues along the second.
 */
export function joinPaths<D extends string>(
	first: JoinPath<D>,
	second: JoinPath<D>,
	opposite: (direction: D) => D
): { path: JoinPath<D>; firstReversed: boolean; secondReversed: boolean } | null {
	if (first.points.length < 2 || second.points.length < 2) {
		return null
	}
	const a = first.points
	const b = second.points
	let firstReversed = false
	let secondReversed = false
	if (same(a.at(-1), b[0])) {
		// as is
	} else if (same(a.at(-1), b.at(-1))) {
		secondReversed = true
	} else if (same(a[0], b[0])) {
		firstReversed = true
	} else if (same(a[0], b.at(-1))) {
		firstReversed = true
		secondReversed = true
	} else {
		return null
	}
	const head = firstReversed ? reversed(first, opposite) : first
	const tail = secondReversed ? reversed(second, opposite) : second
	if (head.endArrow || tail.startArrow) {
		return null
	}
	return {
		path: {
			points: [...head.points, ...tail.points.slice(1)],
			directions: [...head.directions, ...tail.directions],
			startArrow: head.startArrow,
			endArrow: tail.endArrow,
		},
		firstReversed,
		secondReversed,
	}
}
