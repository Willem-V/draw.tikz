/**
 * Layout helpers of the table component, without anything DOM related (so they can be tested in Node).
 */

/**
 * the lines of a table cell: `\\` breaks the line (like in LaTeX), but not inside math (`$\substack{a \\ b}$`)
 */
export function splitCellLines(cell: string): string[] {
	const lines: string[] = []
	let current = ""
	let inMath = false
	for (let index = 0; index < cell.length; index++) {
		const char = cell[index]
		if (char == "\\" && cell[index + 1] == "$") {
			// escaped dollar
			current += char + cell[index + 1]
			index++
		} else if (char == "$") {
			inMath = !inMath
			current += char
		} else if (!inMath && char == "\\" && cell[index + 1] == "\\") {
			lines.push(current.trim())
			current = ""
			index++
		} else {
			current += char
		}
	}
	lines.push(current.trim())
	return lines
}

/**
 * divide `total` over the entries in proportion to their weights (equally if there is nothing to weigh)
 */
export function proportionalSizes(weights: number[], total: number): number[] {
	const sum = weights.reduce((a, b) => a + b, 0)
	if (!(sum > 0)) {
		return weights.map(() => total / Math.max(1, weights.length))
	}
	return weights.map((weight) => (total * weight) / sum)
}

/** the positions where the entries start, and the end as last entry */
export function cumulative(sizes: number[]): number[] {
	const result = [0]
	for (const size of sizes) {
		result.push(result[result.length - 1] + size)
	}
	return result
}
