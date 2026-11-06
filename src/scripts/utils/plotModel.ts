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
	ticksIn: boolean
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
	ticksIn: false,
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
	const stepSetting = which == "x" ? axis.xStep : axis.yStep
	const minorCount = which == "x" ? axis.xMinor : axis.yMinor
	if (!(max > min)) return { major: [], minor: [] }

	if (custom.trim()) {
		return { major: parseCustomTicks(custom).filter((t) => t.value >= min && t.value <= max), minor: [] }
	}
	if (log) {
		return {
			major: logTicks(min, max).map((value) => ({ value })),
			minor: minorCount > 0 ? logMinorTicks(min, max) : [],
		}
	}
	const step = stepSetting > 0 ? stepSetting : niceStep(max - min)
	return {
		major: linearTicks(min, max, step).map((value) => ({ value })),
		minor: linearMinorTicks(min, max, step, minorCount),
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
