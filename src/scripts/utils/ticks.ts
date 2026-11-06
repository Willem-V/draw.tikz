export type Tick = { value: number; label?: string }

/** a "nice" step (1, 2 or 5 times a power of ten) which gives about `count` intervals for the range */
export function niceStep(range: number, count = 5): number {
	if (!(range > 0) || !Number.isFinite(range)) return 1
	const raw = range / Math.max(1, count)
	const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
	const normalized = raw / magnitude
	const nice =
		normalized < 1.5 ? 1
		: normalized < 3.5 ? 2
		: normalized < 7.5 ? 5
		: 10
	return nice * magnitude
}

/** removes floating point noise like 0.30000000000000004 */
export function cleanNumber(value: number): number {
	return Number(value.toPrecision(12))
}

/** the multiples of step inside of [min, max] (with a small tolerance) */
export function linearTicks(min: number, max: number, step: number): number[] {
	const ticks: number[] = []
	if (!(step > 0) || !(max > min)) return ticks
	const first = Math.ceil(min / step - 1e-9)
	const last = Math.floor(max / step + 1e-9)
	for (let i = first; i <= last && ticks.length < 1000; i++) {
		ticks.push(cleanNumber(i * step))
	}
	return ticks
}

/** minor ticks between the major ticks (count per interval) */
export function linearMinorTicks(min: number, max: number, step: number, count: number): number[] {
	if (count < 1 || !(step > 0)) return []
	const sub = step / (count + 1)
	return linearTicks(min, max, sub).filter((v) => Math.abs(v / step - Math.round(v / step)) > 1e-6)
}

/** the decades of a logarithmic axis */
export function logTicks(min: number, max: number): number[] {
	if (!(min > 0) || !(max > min)) return []
	const ticks: number[] = []
	for (let e = Math.ceil(Math.log10(min) - 1e-9); e <= Math.floor(Math.log10(max) + 1e-9); e++) {
		ticks.push(Math.pow(10, e))
	}
	return ticks
}

export function logMinorTicks(min: number, max: number): number[] {
	if (!(min > 0) || !(max > min)) return []
	const ticks: number[] = []
	for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
		for (let m = 2; m <= 9; m++) {
			const v = m * Math.pow(10, e)
			if (v >= min && v <= max) ticks.push(v)
		}
	}
	return ticks
}

/**
 * the text of a tick as math (without the dollars): -1.5 or 10^{3}. Large and small numbers use the exponent form.
 */
export function formatTick(value: number, log = false): string {
	if (log) {
		const exponent = Math.round(Math.log10(value))
		if (Math.abs(Math.log10(value) - exponent) < 1e-9) {
			return (
				exponent == 0 ? "1"
				: exponent == 1 ? "10"
				: `10^{${exponent}}`
			)
		}
	}
	const v = cleanNumber(value)
	if (v === 0) return "0"
	const abs = Math.abs(v)
	if (abs >= 1e5 || abs < 1e-3) {
		const [mantissa, exponent] = v.toExponential(6).split("e")
		const m = String(Number(mantissa))
		return `${m == "1" ? "" : m + "\\cdot "}10^{${Number(exponent)}}`
	}
	return String(v)
}

/**
 * Ticks from a list typed by the user: `0, 0.5, 1` or with labels `0:low, 1:high` (the label is used as it is)
 */
export function parseCustomTicks(text: string): Tick[] {
	const ticks: Tick[] = []
	for (const part of text.split(/[;,]/)) {
		const trimmed = part.trim()
		if (!trimmed) continue
		const colon = trimmed.indexOf(":")
		const valueText = colon >= 0 ? trimmed.slice(0, colon) : trimmed
		const value = Number(valueText.trim())
		if (Number.isFinite(value)) {
			ticks.push({ value, label: colon >= 0 ? trimmed.slice(colon + 1).trim() : undefined })
		}
	}
	return ticks
}

/**
 * the points of a table: lines with numbers separated by comma, semicolon, tab or space. Lines which are not numbers (headers)
 * are skipped. xColumn and yColumn are 1 based.
 */
export function parseTable(text: string, xColumn = 1, yColumn = 2): [number, number][] {
	const points: [number, number][] = []
	for (const line of text.replace(/\r/g, "").split("\n")) {
		const cells = line
			.trim()
			.split(/[,;\t ]+/)
			.filter((cell) => cell !== "")
		if (cells.length == 0) continue
		const x = Number(cells[xColumn - 1])
		const y = Number(cells[yColumn - 1])
		if (cells.length >= Math.max(xColumn, yColumn) && Number.isFinite(x) && Number.isFinite(y)) {
			points.push([x, y])
		}
	}
	return points
}
