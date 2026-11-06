import * as SVG from "@svgdotjs/svg.js"

/**
 * The control points of a smooth curve through the anchors (Catmull-Rom converted to cubic Bezier curves).
 * @param smoothness 0: straight lines, 1: the usual smooth curve
 * @returns the points of the path: anchor, control, control, anchor, ... (and two controls more for a closed curve)
 */
export function smoothPath(anchors: SVG.Point[], closed: boolean, smoothness: number): SVG.Point[] {
	const n = anchors.length
	if (n < 2) {
		return anchors.map((p) => p.clone())
	}
	const at = (i: number) => anchors[closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))]
	const tangent = (i: number) => {
		if (!closed && i == 0) return at(1).sub(at(0))
		if (!closed && i == n - 1) return at(n - 1).sub(at(n - 2))
		return at(i + 1)
			.sub(at(i - 1))
			.div(2)
	}
	const points: SVG.Point[] = [anchors[0].clone()]
	const segments = closed ? n : n - 1
	for (let i = 0; i < segments; i++) {
		const a = at(i)
		const b = at(i + 1)
		const straight = b.sub(a).div(3)
		const c1 = a.add(straight.mul(1 - smoothness)).add(tangent(i).div(3).mul(smoothness))
		const c2 = b.sub(straight.mul(1 - smoothness)).sub(
			tangent(i + 1)
				.div(3)
				.mul(smoothness)
		)
		points.push(c1, c2)
		if (i < n - 1) points.push(b.clone())
	}
	return points
}

/** the path data of the curve (see smoothPath for the points) */
export function bezierPathData(points: SVG.Point[], closed: boolean): string {
	if (points.length < 2) {
		return points.length == 1 ? `M ${points[0].x} ${points[0].y}` : "M 0 0"
	}
	const f = (p: SVG.Point) => `${p.x} ${p.y}`
	let d = `M ${f(points[0])}`
	const last = closed ? points.length : points.length - 1
	for (let i = 1; i + 2 <= last + (closed ? 0 : 0); i += 3) {
		const end = i + 2 < points.length ? points[i + 2] : points[0]
		d += ` C ${f(points[i])} ${f(points[i + 1])} ${f(end)}`
	}
	return d + (closed ? " Z" : "")
}

/** points on the curve for hit tests */
export function sampleBezier(points: SVG.Point[], closed: boolean, perSegment = 12): SVG.Point[] {
	const result: SVG.Point[] = [points[0]]
	for (let i = 0; i + 3 <= points.length - (closed ? 0 : 1); i += 3) {
		const p0 = points[i]
		const p1 = points[i + 1]
		const p2 = points[i + 2]
		const p3 = i + 3 < points.length ? points[i + 3] : points[0]
		for (let s = 1; s <= perSegment; s++) {
			const t = s / perSegment
			const u = 1 - t
			result.push(
				p0
					.mul(u * u * u)
					.add(p1.mul(3 * u * u * t))
					.add(p2.mul(3 * u * t * t))
					.add(p3.mul(t * t * t))
			)
		}
	}
	return result
}

/** Ramer-Douglas-Peucker: removes points which are closer than epsilon to the line through the remaining points */
export function simplifyPolyline(points: SVG.Point[], epsilon: number): SVG.Point[] {
	if (points.length < 3) {
		return points
	}
	const first = points[0]
	const last = points[points.length - 1]
	const direction = last.sub(first)
	const length = Math.hypot(direction.x, direction.y)
	let maxDistance = 0
	let index = 0
	for (let i = 1; i < points.length - 1; i++) {
		const rel = points[i].sub(first)
		const distance =
			length == 0 ? Math.hypot(rel.x, rel.y) : Math.abs(rel.x * direction.y - rel.y * direction.x) / length
		if (distance > maxDistance) {
			maxDistance = distance
			index = i
		}
	}
	if (maxDistance <= epsilon) {
		return [first, last]
	}
	const left = simplifyPolyline(points.slice(0, index + 1), epsilon)
	const right = simplifyPolyline(points.slice(index), epsilon)
	return [...left.slice(0, -1), ...right]
}
