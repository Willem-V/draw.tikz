import { sampleFormula } from "./expression"
import {
	cleanNumber,
	formatTick,
	linearMinorTicks,
	linearTicks,
	logMinorTicks,
	logTicks,
	niceStep,
	parseCustomTicks,
	parseTable,
	Tick,
} from "./ticks"

/** pure data of an axis with its plots (see AxisComponent) */

export type AxisStyle = "box" | "cross" | "origin"
export type TickDirection = "out" | "in" | "through"
export type GridMode = "none" | "major" | "both"
export type LegendPosition = "ne" | "nw" | "se" | "sw"

export type AxisSettings = {
	xMin: number
	xMax: number
	yMin: number
	yMax: number
	xLog: boolean
	yLog: boolean
	style: AxisStyle
	arrows: boolean
	tickDirection: TickDirection
	tickLength: number // pt
	xStep: number // 0: automatic
	yStep: number
	xMinor: number
	yMinor: number
	xTicks: string // custom ticks, empty: automatic
	yTicks: string
	tickLabels: boolean
	fontSize: string
	grid: GridMode
	xLabel: string
	xUnit: string
	yLabel: string
	yUnit: string
	title: string
	legend: boolean
	legendPosition: LegendPosition
}

export const defaultAxisSettings: AxisSettings = {
	xMin: 0,
	xMax: 10,
	yMin: 0,
	yMax: 10,
	xLog: false,
	yLog: false,
	style: "cross",
	arrows: false,
	tickDirection: "out",
	tickLength: 4,
	xStep: 0,
	yStep: 0,
	xMinor: 0,
	yMinor: 0,
	xTicks: "",
	yTicks: "",
	tickLabels: true,
	fontSize: "small",
	grid: "none",
	xLabel: "",
	xUnit: "",
	yLabel: "",
	yUnit: "",
	title: "",
	legend: true,
	legendPosition: "ne",
}

export type SeriesKind = "formula" | "table"
export type MarkerKey = "none" | "dot" | "circle" | "cross" | "plus" | "square" | "triangle"

export type Series = {
	kind: SeriesKind
	/** formula of x (see expression.ts) */
	expr: string
	/** empty: the range of the axis */
	from: string
	to: string
	samples: number
	/** pasted/drawn data: x and y columns separated by comma, tab or space */
	table: string
	xColumn: number
	yColumn: number
	label: string
	color?: string
	palette?: string
	width: number // pt
	dash: string // key of strokeStyleChoices
	marker: MarkerKey
	markerSize: number // pt
	smooth: boolean
}

export function newSeries(kind: SeriesKind = "formula"): Series {
	return {
		kind: kind,
		expr: kind == "formula" ? "sin(x)" : "",
		from: "",
		to: "",
		samples: 100,
		table: kind == "table" ? "0 0\n1 1\n2 4\n3 9" : "",
		xColumn: 1,
		yColumn: 2,
		label: "",
		width: 1.2,
		dash: "solid",
		marker: "none",
		markerSize: 2,
		smooth: false,
	}
}

/**
 * the axis settings with usable limits: a logarithmic axis needs positive limits and every axis needs maximum > minimum. Unusable
 * limits would give no picture or thousands of ticks.
 */
export function normalizeAxis(a: AxisSettings): AxisSettings {
	const fix = (min: number, max: number, log: boolean): [number, number] => {
		if (!Number.isFinite(min)) min = log ? 1 : 0
		if (!Number.isFinite(max)) max = log ? 10 : 1
		if (log) {
			if (min <= 0 && max <= 0) {
				min = 1
				max = 1000
			} else if (min <= 0) {
				min = max / 1000
			} else if (max <= 0) {
				max = min * 1000
			}
			if (max <= min) max = min * 10
		} else if (max <= min) {
			max = min + 1
		}
		return [min, max]
	}
	const [xMin, xMax] = fix(a.xMin, a.xMax, a.xLog)
	const [yMin, yMax] = fix(a.yMin, a.yMax, a.yLog)
	return { ...a, xMin, xMax, yMin, yMax }
}

/** the data points of a series in runs, the curve is interrupted where a formula has no value */
export function seriesRuns(series: Series, axis: AxisSettings): [number, number][][] {
	let points: ([number, number] | null)[] = []
	try {
		if (series.kind == "formula") {
			const from = series.from.trim() === "" ? axis.xMin : Number(series.from)
			const to = series.to.trim() === "" ? axis.xMax : Number(series.to)
			if (series.expr.trim() && Number.isFinite(from) && Number.isFinite(to)) {
				points = sampleFormula(series.expr, from, to, series.samples, axis.xLog)
			}
		} else {
			points = parseTable(series.table, series.xColumn, series.yColumn)
		}
	} catch {
		points = []
	}
	const runs: [number, number][][] = []
	let current: [number, number][] = []
	for (const point of points) {
		const usable =
			point !== null &&
			(!axis.xLog || point[0] > 0) &&
			(!axis.yLog || point[1] > 0) &&
			Number.isFinite(point[0]) &&
			Number.isFinite(point[1])
		if (usable) {
			current.push(point)
		} else if (current.length > 0) {
			runs.push(current)
			current = []
		}
	}
	if (current.length > 0) runs.push(current)
	return runs
}

export type AxisTicks = { major: Tick[]; minor: number[] }

/** the ticks of the x or y axis */
export function axisTicks(axis: AxisSettings, which: "x" | "y"): AxisTicks {
	const min = which == "x" ? axis.xMin : axis.yMin
	const max = which == "x" ? axis.xMax : axis.yMax
	const log = which == "x" ? axis.xLog : axis.yLog
	const custom = which == "x" ? axis.xTicks : axis.yTicks
	// a negative step or count makes no sense (it is 0: automatic, or none)
	const stepSetting = Math.max(0, (which == "x" ? axis.xStep : axis.yStep) || 0)
	const minorCount = Math.max(0, (which == "x" ? axis.xMinor : axis.yMinor) || 0)
	if (!(max > min)) return { major: [], minor: [] }

	if (custom.trim()) {
		return { major: parseCustomTicks(custom).filter((t) => t.value >= min && t.value <= max), minor: [] }
	}
	if (log) {
		// many decades: only every n-th decade gets a tick
		const decades = Math.log10(max / min)
		const every = Math.max(1, Math.ceil(decades / 10))
		const major = logTicks(min, max).filter((v) => Math.round(Math.log10(v)) % every == 0)
		return {
			major: major.map((value) => ({ value })),
			minor: minorCount > 0 && decades <= 6 ? logMinorTicks(min, max) : [],
		}
	}
	// a step which would give hundreds of ticks is replaced by an automatic one
	const step = stepSetting > 0 && (max - min) / stepSetting <= 50 ? stepSetting : niceStep(max - min)
	const minorCapped = minorCount > 0 && ((max - min) / step) * (minorCount + 1) <= 200 ? minorCount : 0
	return {
		major: linearTicks(min, max, step).map((value) => ({ value })),
		minor: linearMinorTicks(min, max, step, minorCapped),
	}
}

/** the text (math) of a tick */
export function tickLabel(tick: Tick, log: boolean): string {
	return tick.label !== undefined ? tick.label : "$" + formatTick(tick.value, log) + "$"
}

/** the position of a value on the axis from 0 (min) to 1 (max) */
export function axisFraction(value: number, min: number, max: number, log: boolean): number {
	if (log) {
		return (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
	}
	return (value - min) / (max - min)
}

/** the axis text: the label with the unit in brackets */
export function axisLabelText(label: string, unit: string): string {
	const text = label.trim()
	const unitText = unit.trim()
	return (
		unitText ?
			text ? `${text} [${unitText}]`
			:	`[${unitText}]`
		:	text
	)
}

export { cleanNumber }
