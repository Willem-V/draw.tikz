import * as SVG from "@svgdotjs/svg.js"
import {
	basicDirections,
	BooleanProperty,
	ButtonGridProperty,
	CanvasController,
	ChoiceProperty,
	CircuitComponent,
	ColorProperty,
	convertTextToNativeSVGText,
	defaultFontSize,
	defaultStroke,
	FontSize,
	fontSizes,
	PropertyCategories,
	SectionHeaderProperty,
	ShapeComponent,
	ShapeSaveObject,
	SliderProperty,
	SnapPoint,
	strokeStyleChoices,
	TableDataProperty,
	TextProperty,
	textToSVG,
	TikzNodeCommand,
	Undo,
} from "../internal"
import { cellToLatex } from "../utils/latexText"
import { Palette, paletteNameOf, resolveColor } from "../utils/palette"
import { compileExpression } from "../utils/expression"
import { bezierPathData, smoothPath } from "../utils/curves"
import {
	AxisSettings,
	axisFraction,
	axisLabelText,
	axisTicks,
	defaultAxisSettings,
	MarkerKey,
	newSeries,
	normalizeAxis,
	TickDirection,
	Series,
	seriesRuns,
	tickLabel,
} from "../utils/plotModel"
import { cleanNumber } from "../utils/ticks"
import { rectRectIntersection, roundTikz } from "../utils/selectionHelper"
import { removeTextSVG } from "../utils/svgText"

export type AxisSaveObject = ShapeSaveObject & {
	axis?: Partial<AxisSettings>
	series?: Series[]
}

const ptToPx = (pt: number) => new SVG.Number(pt, "pt").convertToUnit("px").value
const pxToCm = (px: number) => new SVG.Number(px, "px").convertToUnit("cm").value

type Anchor = { h: -1 | 0 | 1; v: -1 | 0 | 1 }
type TextPrim = { x: number; y: number; text: string; h: -1 | 0 | 1; v: -1 | 0 | 1; rotate?: number }
type LinePrim = { a: [number, number]; b: [number, number] }

/** everything of the axis in the local coordinates of the plot area (x to the right, y down, origin top left) */
type Layout = {
	axisLines: LinePrim[]
	arrowEnds: { at: [number, number]; direction: [number, number] }[]
	ticks: LinePrim[]
	minorTicks: LinePrim[]
	gridMajor: LinePrim[]
	gridMinor: LinePrim[]
	texts: TextPrim[]
	legend?: {
		box: { x: number; y: number; w: number; h: number }
		entries: { series: Series; y: number; sampleFrom: number; sampleTo: number; textX: number }[]
	}
}

const markerOptions: Record<MarkerKey, { tikz: string; library?: string }> = {
	none: { tikz: "" },
	dot: { tikz: "*" },
	circle: { tikz: "o" },
	cross: { tikz: "x" },
	plus: { tikz: "+" },
	square: { tikz: "square*", library: "plotmarks" },
	triangle: { tikz: "triangle*", library: "plotmarks" },
}

const styleChoices = [
	{ key: "cross", name: "L shape: left and bottom" },
	{ key: "box", name: "Box: frame around the plot" },
	{ key: "origin", name: "Cross: through zero" },
]
const gridChoices = [
	{ key: "none", name: "off" },
	{ key: "major", name: "major ticks" },
	{ key: "both", name: "major and minor ticks" },
]
const legendChoices = [
	{ key: "ne", name: "top right" },
	{ key: "nw", name: "top left" },
	{ key: "se", name: "bottom right" },
	{ key: "sw", name: "bottom left" },
]
const scaleChoices = [
	{ key: "linear", name: "linear" },
	{ key: "log", name: "logarithmic" },
]
const tickDirectionChoices = [
	{ key: "out", name: "outside" },
	{ key: "in", name: "inside" },
	{ key: "through", name: "through the axis" },
]
const seriesKindChoices = [
	{ key: "formula", name: "formula y = f(x)" },
	{ key: "table", name: "table of points" },
]
const markerChoices = [
	{ key: "none", name: "none" },
	{ key: "dot", name: "dot" },
	{ key: "circle", name: "circle" },
	{ key: "cross", name: "cross" },
	{ key: "plus", name: "plus" },
	{ key: "square", name: "square" },
	{ key: "triangle", name: "triangle" },
]

/** the first colors of the default palette which can be told apart well, used for new series */
const seriesPaletteOrder = [5, 6, 3, 1, 7, 2, 4, 0]

/**
 * An axis with plots, drawn like a figure from a paper: axes with ticks, grid, labels with units, title, legend and data
 * series (formula or pasted table). The size is the plot area; the numbers on the axes follow from the ranges.
 * Everything is drawn from the same layout in the preview and in the exported TikZ (plain lines, nodes and coordinates), so
 * pgfplots is not needed and the PDF looks like the preview.
 */
export class AxisComponent extends ShapeComponent {
	private static jsonID = "axis"
	static {
		CircuitComponent.jsonSaveMap.set(AxisComponent.jsonID, AxisComponent)
	}

	declare protected dragElement: SVG.Rect

	private axis: AxisSettings = { ...defaultAxisSettings }
	private series: Series[] = []
	private selectedSeries = 0

	/** puts the settings into the properties (after loading) */
	private loaders: (() => void)[] = []

	private content: SVG.G
	private textSVG: SVG.G
	private renderRequested = false
	private clipId = "axisclip" + Math.random().toString(36).slice(2)

	private seriesChoice: ChoiceProperty<{ key: string; name: string }>

	public constructor() {
		super()
		this.displayName = "Axes and plots"

		this.componentVisualization = CanvasController.instance.canvas.rect(0, 0)
		this.componentVisualization.hide()
		this.content = CanvasController.instance.canvas.group()
		this.dragElement = CanvasController.instance.canvas.rect(0, 0)
		this.dragElement.attr({ fill: "transparent", stroke: "none" })
		this.visualization.add(this.componentVisualization)
		this.visualization.add(this.content)
		this.visualization.add(this.dragElement)

		this.buildProperties()
		this.selectionElement = CanvasController.instance.canvas.rect(0, 0).hide()
	}

	// ------------------------------------------------------------------ properties

	private header(title: string, id: string, category = PropertyCategories.options) {
		this.properties.add(category, new SectionHeaderProperty(title, undefined, id))
	}

	private number<K extends keyof AxisSettings>(
		label: string,
		key: K,
		step: number,
		tooltip = "",
		unit?: string,
		category = PropertyCategories.options,
		range?: [number, number]
	) {
		const property = new SliderProperty(
			label,
			range ? range[0] : -1e9,
			range ? range[1] : 1e9,
			step,
			new SVG.Number(this.axis[key] as number, unit),
			range !== undefined,
			tooltip,
			"axis:" + key
		)
		// without a range the default step of the buttons would be huge
		property.buttonStep = step
		property.addChangeListener((ev) => {
			;(this.axis as any)[key] = ev.value.value
			this.update()
		})
		this.loaders.push(() => (property.value = new SVG.Number(this.axis[key] as number, unit)))
		this.properties.add(category, property)
	}

	private toggle<K extends keyof AxisSettings>(
		label: string,
		key: K,
		tooltip = "",
		category = PropertyCategories.options
	) {
		const property = new BooleanProperty(label, this.axis[key] as boolean, undefined, tooltip, "axis:" + key)
		property.addChangeListener((ev) => {
			;(this.axis as any)[key] = ev.value
			this.update()
		})
		this.loaders.push(() => (property.value = this.axis[key] as boolean))
		this.properties.add(category, property)
	}

	private text<K extends keyof AxisSettings>(
		label: string,
		key: K,
		tooltip = "",
		category = PropertyCategories.options
	) {
		const property = new TextProperty(label, this.axis[key] as string, tooltip, undefined, "axis:" + key)
		property.addChangeListener((ev) => {
			;(this.axis as any)[key] = ev.value
			this.update()
		})
		this.loaders.push(() => (property.value = this.axis[key] as string))
		this.properties.add(category, property)
	}

	private choice<K extends keyof AxisSettings>(
		label: string,
		key: K,
		options: { key: string; name: string }[],
		toValue: (key: string) => AxisSettings[K] = (key) => key as any,
		fromValue: (value: AxisSettings[K]) => string = (value) => String(value),
		category = PropertyCategories.options
	) {
		const find = (value: AxisSettings[K]) => options.find((o) => o.key == fromValue(value)) ?? options[0]
		const property = new ChoiceProperty(label, options, find(this.axis[key]), undefined, "axis:" + key)
		property.addChangeListener((ev) => {
			;(this.axis as any)[key] = toValue(ev.value.key)
			if (key == "xLog" || key == "yLog") {
				// a logarithmic axis needs positive limits, which are set to something usable
				const fixed = normalizeAxis(this.axis)
				Object.assign(this.axis, { xMin: fixed.xMin, xMax: fixed.xMax, yMin: fixed.yMin, yMax: fixed.yMax })
				this.loaders.forEach((load) => load())
			}
			this.update()
		})
		this.loaders.push(() => (property.value = find(this.axis[key])))
		this.properties.add(category, property)
	}

	private buildProperties() {
		this.header("Axes", "axis:header-axes")
		this.choice("Axis lines", "style", styleChoices)
		this.toggle("Arrow ends", "arrows", "Arrow tips at the end of the axes")
		this.choice("Ticks", "tickDirection", tickDirectionChoices)
		this.number(
			"Tick length",
			"tickLength",
			0.5,
			"Length of the major ticks",
			"pt",
			PropertyCategories.options,
			[0, 20]
		)
		this.toggle("Tick labels", "tickLabels")
		this.choice("Fontsize", "fontSize", fontSizes)

		this.header("X axis", "axis:header-x")
		this.number("Minimum", "xMin", 1)
		this.number("Maximum", "xMax", 1)
		this.choice(
			"Scale",
			"xLog",
			scaleChoices,
			(key) => (key == "log") as any,
			(value) => (value ? "log" : "linear")
		)
		this.number(
			"Major step",
			"xStep",
			1,
			"Distance of the numbers, 0 is automatic",
			undefined,
			PropertyCategories.options,
			[0, 1e9]
		)
		this.number(
			"Minor ticks",
			"xMinor",
			1,
			"Number of minor ticks between the major ticks",
			undefined,
			PropertyCategories.options,
			[0, 20]
		)
		this.text("Ticks", "xTicks", "Own ticks, e.g. 0, 0.5, 1 or 0:low, 1:high. Empty: automatic")
		this.text("Label", "xLabel", "Label of the axis, $math$ is possible")
		this.text("Unit", "xUnit", "Shown in brackets behind the label, e.g. ms or $\\mu$s")

		this.header("Y axis", "axis:header-y")
		this.number("Minimum", "yMin", 1)
		this.number("Maximum", "yMax", 1)
		this.choice(
			"Scale",
			"yLog",
			scaleChoices,
			(key) => (key == "log") as any,
			(value) => (value ? "log" : "linear")
		)
		this.number(
			"Major step",
			"yStep",
			1,
			"Distance of the numbers, 0 is automatic",
			undefined,
			PropertyCategories.options,
			[0, 1e9]
		)
		this.number(
			"Minor ticks",
			"yMinor",
			1,
			"Number of minor ticks between the major ticks",
			undefined,
			PropertyCategories.options,
			[0, 20]
		)
		this.text("Ticks", "yTicks", "Own ticks, e.g. 0, 0.5, 1 or 0:low, 1:high. Empty: automatic")
		this.text("Label", "yLabel", "Label of the axis, $math$ is possible")
		this.text("Unit", "yUnit", "Shown in brackets behind the label")

		this.header("Grid and title", "axis:header-grid")
		this.choice("Grid", "grid", gridChoices)
		this.text("Title", "title")
		this.toggle("Legend", "legend", "Shows the labels of the series")
		this.choice("Legend position", "legendPosition", legendChoices)

		this.buildSeriesProperties()
	}

	private get current(): Series | undefined {
		return this.series[this.selectedSeries]
	}

	private buildSeriesProperties() {
		const category = PropertyCategories.options
		this.header("Series", "axis:header-series")
		this.seriesChoice = new ChoiceProperty<{ key: string; name: string }>(
			"Plot",
			[{ key: "-1", name: "none yet" }],
			{ key: "-1", name: "none yet" },
			"The plot which the settings below belong to",
			"axis:series"
		)
		this.seriesChoice.addChangeListener((ev) => {
			this.selectedSeries = Math.max(0, Math.min(this.series.length - 1, Number(ev.value.key)))
			this.loadSeries()
		})
		this.properties.add(category, this.seriesChoice)

		this.properties.add(
			category,
			new ButtonGridProperty(
				3,
				[
					["Formula", "add"],
					["Table", "add"],
					["Remove", "delete"],
				],
				[
					() => this.addSeries(newSeries("formula")),
					() => this.addSeries(newSeries("table")),
					() => this.removeSeries(),
				],
				false,
				[
					"Add a plot of a formula of x",
					"Add a plot of a table of points (paste columns from a spreadsheet)",
					"Remove the selected plot",
				]
			)
		)

		const series = <T>(
			property: { addChangeListener: (l: (ev: { value: T }) => void) => void },
			apply: (s: Series, value: T) => void
		) =>
			property.addChangeListener((ev) => {
				const s = this.current
				if (s) {
					apply(s, ev.value)
					this.refreshSeriesChoice()
					this.update()
				}
			})

		const kind = new ChoiceProperty("Type", seriesKindChoices, seriesKindChoices[0], undefined, "series:kind")
		series(kind, (s, v: any) => {
			s.kind = v.key
			this.updateSeriesVisibility()
		})
		const expr = new TextProperty(
			"y =",
			"",
			"Formula of x: + - * / ^ ( ), pi, e, sin cos tan exp ln log sqrt abs ...",
			(value) => {
				try {
					if (value.trim()) compileExpression(value)
					return ""
				} catch (e) {
					return (e as Error).message
				}
			},
			"series:expr"
		)
		series(expr, (s, v: string) => (s.expr = v))
		const from = new TextProperty(
			"From x",
			"",
			"Start of the formula, empty: minimum of the axis",
			undefined,
			"series:from"
		)
		series(from, (s, v: string) => (s.from = v))
		const to = new TextProperty(
			"To x",
			"",
			"End of the formula, empty: maximum of the axis",
			undefined,
			"series:to"
		)
		series(to, (s, v: string) => (s.to = v))
		const samples = new SliderProperty(
			"Points",
			2,
			2000,
			10,
			new SVG.Number(100),
			true,
			undefined,
			"series:samples"
		)
		series(samples, (s, v: SVG.Number) => (s.samples = Math.round(v.value)))
		const table = new TableDataProperty(
			"",
			"One point per row. Paste a range from a spreadsheet into any cell, Enter adds a row",
			"series:table"
		)
		series(table, (s, v: string) => {
			s.table = v
			this.updateSeriesVisibility()
		})
		const xColumn = new SliderProperty("X column", 1, 20, 1, new SVG.Number(1), true, undefined, "series:xcol")
		series(xColumn, (s, v: SVG.Number) => (s.xColumn = Math.round(v.value)))
		const yColumn = new SliderProperty("Y column", 1, 20, 1, new SVG.Number(2), true, undefined, "series:ycol")
		series(yColumn, (s, v: SVG.Number) => (s.yColumn = Math.round(v.value)))
		const label = new TextProperty("Legend", "", "Name in the legend", undefined, "series:label")
		series(label, (s, v: string) => (s.label = v))
		const color = new ColorProperty("Color", null, undefined, undefined, "series:color")
		series(color, (s, v: SVG.Color | null) => {
			s.color = v ? v.toHex() : undefined
			s.palette = paletteNameOf(v)
		})
		const width = new SliderProperty(
			"Line width",
			0,
			10,
			0.1,
			new SVG.Number(1.2, "pt"),
			true,
			undefined,
			"series:width"
		)
		series(width, (s, v: SVG.Number) => (s.width = v.value))
		const dash = new ChoiceProperty(
			"Line style",
			strokeStyleChoices,
			strokeStyleChoices[0],
			undefined,
			"series:dash"
		)
		series(dash, (s, v: any) => (s.dash = v.key))
		const marker = new ChoiceProperty("Marker", markerChoices, markerChoices[0], undefined, "series:marker")
		series(marker, (s, v: any) => {
			s.marker = v.key
			this.updateSeriesVisibility()
		})
		const markerSize = new SliderProperty(
			"Marker size",
			0.5,
			10,
			0.5,
			new SVG.Number(2, "pt"),
			true,
			undefined,
			"series:msize"
		)
		series(markerSize, (s, v: SVG.Number) => (s.markerSize = v.value))
		const smooth = new BooleanProperty(
			"Smooth",
			false,
			undefined,
			"Draw a smooth curve through the points",
			"series:smooth"
		)
		series(smooth, (s, v: boolean) => (s.smooth = v))

		this.seriesLoaders = () => {
			const s = this.current ?? newSeries("formula")
			kind.value = seriesKindChoices.find((c) => c.key == s.kind)
			expr.value = s.expr
			from.value = s.from
			to.value = s.to
			samples.value = new SVG.Number(s.samples)
			table.value = s.table
			xColumn.value = new SVG.Number(s.xColumn)
			yColumn.value = new SVG.Number(s.yColumn)
			label.value = s.label
			color.value = resolveColor(s.color, s.palette)
			width.value = new SVG.Number(s.width, "pt")
			dash.value = strokeStyleChoices.find((c) => c.key == s.dash) ?? strokeStyleChoices[0]
			marker.value = markerChoices.find((c) => c.key == s.marker) ?? markerChoices[0]
			markerSize.value = new SVG.Number(s.markerSize, "pt")
			smooth.value = s.smooth
		}
		this.formulaProps = [expr, from, to, samples]
		this.tableProps = [table]
		this.columnProps = [xColumn, yColumn]
		this.commonProps = [kind, label, color, width, dash, marker, smooth]
		this.markerSizeProp = markerSize
		for (const property of [
			kind,
			expr,
			from,
			to,
			samples,
			table,
			xColumn,
			yColumn,
			label,
			color,
			width,
			dash,
			marker,
			markerSize,
			smooth,
		]) {
			this.properties.add(category, property as any)
		}
	}
	private seriesLoaders: () => void = () => {}
	private seriesSignature = ""

	private formulaProps: any[] = []
	private tableProps: any[] = []
	private columnProps: any[] = []
	private commonProps: any[] = []
	private markerSizeProp: any

	/** only the settings which belong to the selected plot are shown */
	private updateSeriesVisibility() {
		const s = this.current
		const show = (properties: any[], visible: boolean) =>
			properties.forEach((p) => p.getHTMLElement().classList.toggle("d-none", !visible))
		show(this.commonProps, !!s)
		show(this.formulaProps, !!s && s.kind == "formula")
		show(this.tableProps, !!s && s.kind == "table")
		// the columns only need to be chosen when the table has more than two
		const columns = s ? Math.max(0, ...s.table.split("\n").map((l) => l.trim().split(/[,;\t ]+/).length)) : 0
		show(this.columnProps, !!s && s.kind == "table" && columns > 2)
		show([this.markerSizeProp], !!s && s.marker != "none")
	}

	private loadSeries() {
		this.seriesLoaders()
		this.refreshSeriesChoice()
		this.updateSeriesVisibility()
	}

	/** the list of the plots with their current names */
	private refreshSeriesChoice() {
		const names = this.series.map((s, i) => ({
			key: String(i),
			name: `${i + 1}: ${s.label.trim() || (s.kind == "formula" ? "y = " + (s.expr || "?") : "table")}`,
		}))
		const entries = names.length > 0 ? names : [{ key: "-1", name: "none yet" }]
		// only when something changed: rebuilding the list while typing would reload the fields
		const signature = JSON.stringify(entries) + this.selectedSeries
		if (signature == this.seriesSignature) return
		this.seriesSignature = signature
		this.seriesChoice.setEntries(entries)
		this.seriesChoice.value = entries[names.length > 0 ? this.selectedSeries : 0]
	}

	private addSeries(series: Series) {
		const entries = Palette.instance.entries
		const index = this.series.length
		const entry = entries[seriesPaletteOrder[index % seriesPaletteOrder.length] % entries.length]
		if (entry) {
			series.color = entry.color
			series.palette = entry.name
		}
		this.series.push(series)
		this.selectedSeries = this.series.length - 1
		this.loadSeries()
		this.update()
		Undo.addState()
	}

	private removeSeries() {
		if (!this.current) return
		this.series.splice(this.selectedSeries, 1)
		this.selectedSeries = Math.max(0, Math.min(this.selectedSeries, this.series.length - 1))
		this.loadSeries()
		this.update()
		Undo.addState()
	}

	// ------------------------------------------------------------------ layout

	private get fontPx(): number {
		return ((fontSizes.find((f) => f.key == this.axis.fontSize) ?? defaultFontSize).size * 4) / 3
	}

	/** a rough width of a text for placing labels and the legend (the same in the preview and in the export) */
	private textWidth(text: string): number {
		const plain = text.replace(/\$[^$]*\$/g, "xx").replace(/[\\{}^_]/g, "")
		return plain.length * this.fontPx * 0.55
	}

	/** the settings with usable limits (see normalizeAxis) */
	private get eff(): AxisSettings {
		return normalizeAxis(this.axis)
	}

	private fx(value: number): number {
		const a = this.eff
		return axisFraction(value, a.xMin, a.xMax, a.xLog) * this.size.x
	}
	private fy(value: number): number {
		const a = this.eff
		return this.size.y - axisFraction(value, a.yMin, a.yMax, a.yLog) * this.size.y
	}

	private layout(): Layout {
		const a = this.eff
		const w = this.size.x
		const h = this.size.y
		const tick = ptToPx(a.tickLength)
		const gap = ptToPx(3)
		const font = this.fontPx
		const layout: Layout = {
			axisLines: [],
			arrowEnds: [],
			ticks: [],
			minorTicks: [],
			gridMajor: [],
			gridMinor: [],
			texts: [],
		}
		if (w <= 0 || h <= 0) return layout

		// where the axes are
		const xAxisY = a.style == "origin" && !a.yLog && a.yMin < 0 && a.yMax > 0 ? this.fy(0) : h
		const yAxisX = a.style == "origin" && !a.xLog && a.xMin < 0 && a.xMax > 0 ? this.fx(0) : 0
		if (a.style == "box") {
			// the frame itself is the rectangle of the component
		} else {
			layout.axisLines.push({ a: [0, xAxisY], b: [w, xAxisY] }, { a: [yAxisX, h], b: [yAxisX, 0] })
			if (a.arrows) {
				layout.arrowEnds.push({ at: [w, xAxisY], direction: [1, 0] }, { at: [yAxisX, 0], direction: [0, -1] })
			}
		}
		// the ticks reach `outer` away from the plot area (down for x, left for y) and `inner` into it
		const outer = a.tickDirection == "in" ? 0 : tick
		const inner = a.tickDirection == "out" ? 0 : tick
		const xTicks = axisTicks(a, "x")
		const yTicks = axisTicks(a, "y")

		let xLabelBottom = xAxisY + gap
		let yLabelLeft = yAxisX - gap
		for (const t of xTicks.major) {
			const x = this.fx(t.value)
			layout.ticks.push({ a: [x, xAxisY - inner], b: [x, xAxisY + outer] })
			if (a.grid != "none") layout.gridMajor.push({ a: [x, 0], b: [x, h] })
			if (a.tickLabels) {
				const text = tickLabel(t, a.xLog)
				layout.texts.push({ x, y: xAxisY + outer + gap, text, h: 0, v: -1 })
				xLabelBottom = Math.max(xLabelBottom, xAxisY + outer + gap + font * 1.3)
			}
		}
		for (const value of xTicks.minor) {
			const x = this.fx(value)
			layout.minorTicks.push({ a: [x, xAxisY - inner / 2], b: [x, xAxisY + outer / 2] })
			if (a.grid == "both") layout.gridMinor.push({ a: [x, 0], b: [x, h] })
		}
		for (const t of yTicks.major) {
			const y = this.fy(t.value)
			layout.ticks.push({ a: [yAxisX + inner, y], b: [yAxisX - outer, y] })
			if (a.grid != "none") layout.gridMajor.push({ a: [0, y], b: [w, y] })
			if (a.tickLabels) {
				const text = tickLabel(t, a.yLog)
				layout.texts.push({ x: yAxisX - outer - gap, y, text, h: 1, v: 0 })
				yLabelLeft = Math.min(yLabelLeft, yAxisX - outer - gap - this.textWidth(text))
			}
		}
		for (const value of yTicks.minor) {
			const y = this.fy(value)
			layout.minorTicks.push({ a: [yAxisX + inner / 2, y], b: [yAxisX - outer / 2, y] })
			if (a.grid == "both") layout.gridMinor.push({ a: [0, y], b: [w, y] })
		}

		const xLabel = axisLabelText(a.xLabel, a.xUnit)
		if (xLabel) {
			layout.texts.push({ x: w / 2, y: Math.max(h, xLabelBottom) + gap, text: xLabel, h: 0, v: -1 })
		}
		const yLabel = axisLabelText(a.yLabel, a.yUnit)
		if (yLabel) {
			layout.texts.push({ x: Math.min(0, yLabelLeft) - gap, y: h / 2, text: yLabel, h: 0, v: 1, rotate: -90 })
		}
		if (a.title.trim()) {
			layout.texts.push({ x: w / 2, y: -gap - font * 0.2, text: a.title, h: 0, v: 1 })
		}

		// legend
		const entries = this.series.filter((s) => s.label.trim())
		if (a.legend && entries.length > 0) {
			const pad = ptToPx(4)
			const rowHeight = font * 1.5
			const sample = ptToPx(18)
			const textWidth = Math.max(...entries.map((s) => this.textWidth(s.label)))
			const bw = pad * 3 + sample + textWidth
			const bh = pad * 2 + rowHeight * entries.length
			const margin = ptToPx(5)
			const bx = a.legendPosition.endsWith("e") ? w - margin - bw : margin
			const by = a.legendPosition.startsWith("n") ? margin : h - margin - bh
			layout.legend = {
				box: { x: bx, y: by, w: bw, h: bh },
				entries: entries.map((series, i) => ({
					series,
					y: by + pad + rowHeight * (i + 0.5),
					sampleFrom: bx + pad,
					sampleTo: bx + pad + sample,
					textX: bx + pad * 2 + sample,
				})),
			}
		}
		return layout
	}

	/** the runs of a series in pixels of the plot area */
	private seriesPixelRuns(series: Series): SVG.Point[][] {
		return seriesRuns(series, this.eff).map((run) => run.map(([x, y]) => new SVG.Point(this.fx(x), this.fy(y))))
	}

	private strokeColorString(): string {
		return this.strokeInfo.color == "default" ? defaultStroke : (this.strokeInfo.color as string)
	}

	private seriesColor(series: Series): string {
		return resolveColor(series.color, series.palette)?.toHex() ?? defaultStroke
	}

	private dasharray(series: Series): string {
		const choice = strokeStyleChoices.find((c) => c.key == series.dash) ?? strokeStyleChoices[0]
		const width = ptToPx(series.width)
		return choice.dasharray.map((factor) => width * factor).join(" ")
	}

	// ------------------------------------------------------------------ drawing

	public update(): void {
		super.update()
		// the outline of the component itself is never shown, the box is part of the content
		this.componentVisualization?.stroke({ width: 0 })
		this.renderContent()
		this.requestTextRender()
	}

	public updateTheme(): void {
		super.updateTheme()
		this.componentVisualization?.stroke({ width: 0 })
		this.renderContent()
	}

	private origin(): SVG.Point {
		return this.position.sub(this.size.div(2))
	}

	private renderContent() {
		if (!this.content) return
		this.content.clear()
		const origin = this.origin()
		const layout = this.layout()
		const g = this.content
		g.attr("transform", `translate(${origin.x} ${origin.y})`)
		const stroke = this.strokeColorString()
		const lineWidth = this.strokeInfo.opacity == 0 ? 0 : this.strokeInfo.width.convertToUnit("px").value
		const path = (lines: LinePrim[], style: object) => {
			if (lines.length == 0) return
			g.path(lines.map((l) => `M ${l.a[0]} ${l.a[1]} L ${l.b[0]} ${l.b[1]}`).join(" "))
				.fill("none")
				.stroke(style)
		}
		const gridColor = "var(--bs-secondary-color, #888)"
		path(layout.gridMinor, { color: gridColor, width: 0.4, opacity: 0.4 })
		path(layout.gridMajor, { color: gridColor, width: 0.6, opacity: 0.6 })
		if (this.axis.style == "box") {
			// drawn here, so it follows the style directly (not through the outline of the component)
			g.rect(this.size.x, this.size.y)
				.fill("none")
				.stroke({ color: stroke, width: lineWidth, opacity: this.strokeInfo.opacity })
		}
		path(layout.axisLines, { color: stroke, width: lineWidth, opacity: this.strokeInfo.opacity })
		path(layout.ticks, { color: stroke, width: lineWidth, opacity: this.strokeInfo.opacity })
		path(layout.minorTicks, { color: stroke, width: lineWidth, opacity: this.strokeInfo.opacity })
		for (const end of layout.arrowEnds) {
			const [dx, dy] = end.direction
			const len = 8
			const half = 3
			const tip = end.at
			g.path(
				`M ${tip[0] + dx * 2} ${tip[1] + dy * 2} L ${tip[0] - dx * len - dy * half} ${tip[1] - dy * len + dx * half} L ${tip[0] - dx * (len - 2)} ${tip[1] - dy * (len - 2)} L ${tip[0] - dx * len + dy * half} ${tip[1] - dy * len - dx * half} Z`
			).fill(stroke)
		}

		// the series, clipped to the plot area
		const clipId = this.clipId
		const clip = g.clip().id(clipId)
		clip.add(new SVG.Rect().size(this.size.x, this.size.y))
		const seriesGroup = g.group().clipWith(clip)
		for (const series of this.series) {
			const color = this.seriesColor(series)
			const style = {
				color,
				width: ptToPx(series.width),
				dasharray: this.dasharray(series),
				linecap: "round",
				linejoin: "round",
			}
			for (const run of this.seriesPixelRuns(series)) {
				if (series.width > 0 && run.length >= 2) {
					const d =
						series.smooth ?
							bezierPathData(smoothPath(run, false, 1), false)
						:	"M " + run.map((p) => `${p.x} ${p.y}`).join(" L ")
					seriesGroup.path(d).fill("none").stroke(style)
				}
				if (series.marker != "none") {
					for (const p of run)
						this.drawMarker(seriesGroup, p, series.marker, ptToPx(series.markerSize), color)
				}
			}
		}

		if (layout.legend) {
			const { box, entries } = layout.legend
			g.rect(box.w, box.h).move(box.x, box.y).fill("var(--bs-body-bg)").stroke({ color: stroke, width: 0.6 })
			for (const entry of entries) {
				const color = this.seriesColor(entry.series)
				g.line(entry.sampleFrom, entry.y, entry.sampleTo, entry.y).stroke({
					color,
					width: ptToPx(entry.series.width),
					dasharray: this.dasharray(entry.series),
				})
				if (entry.series.marker != "none") {
					this.drawMarker(
						g,
						new SVG.Point((entry.sampleFrom + entry.sampleTo) / 2, entry.y),
						entry.series.marker,
						ptToPx(entry.series.markerSize),
						color
					)
				}
			}
		}
		this.layoutCache = layout
	}
	private layoutCache: Layout | undefined

	private drawMarker(parent: SVG.G, p: SVG.Point, marker: MarkerKey, r: number, color: string) {
		const stroke = { color, width: 1 }
		switch (marker) {
			case "dot":
				parent
					.circle(2 * r)
					.center(p.x, p.y)
					.fill(color)
				break
			case "circle":
				parent
					.circle(2 * r)
					.center(p.x, p.y)
					.fill("none")
					.stroke(stroke)
				break
			case "cross":
				parent
					.path(
						`M ${p.x - r} ${p.y - r} L ${p.x + r} ${p.y + r} M ${p.x - r} ${p.y + r} L ${p.x + r} ${p.y - r}`
					)
					.fill("none")
					.stroke(stroke)
				break
			case "plus":
				parent
					.path(`M ${p.x - r} ${p.y} L ${p.x + r} ${p.y} M ${p.x} ${p.y - r} L ${p.x} ${p.y + r}`)
					.fill("none")
					.stroke(stroke)
				break
			case "square":
				parent
					.rect(2 * r, 2 * r)
					.center(p.x, p.y)
					.fill(color)
				break
			case "triangle":
				parent.path(`M ${p.x} ${p.y - r} L ${p.x + r} ${p.y + r} L ${p.x - r} ${p.y + r} Z`).fill(color)
				break
		}
	}

	private requestTextRender() {
		if (this.renderRequested) return
		this.renderRequested = true
		requestAnimationFrame(() => this.renderTexts())
	}

	/** the texts need MathJax and are drawn after the changes of a frame */
	private renderTexts() {
		this.renderRequested = false
		removeTextSVG(this.textSVG)
		this.textSVG = undefined
		const layout = this.layoutCache
		if (!layout) return
		const origin = this.origin()
		const group = new SVG.G()
		const color =
			this.strokeInfo.color == "default" ? "var(--bs-emphasis-color)" : (this.strokeInfo.color as string)
		const width = 240
		const height = 60
		const place = (t: TextPrim) => {
			const box = new SVG.Box(
				t.h == 0 ? t.x - width / 2
				: t.h == 1 ? t.x - width
				: t.x,
				t.v == 0 ? t.y - height / 2
				: t.v == 1 ? t.y - height
				: t.y,
				width,
				height
			)
			const textGroup = convertTextToNativeSVGText(
				{
					text: t.text,
					align:
						t.h == 0 ? 1
						: t.h == 1 ? 2
						: 0,
					justify: t.v,
					fontSize: this.axis.fontSize,
					color,
				},
				box
			)
			if (t.rotate) textGroup.transform(new SVG.Matrix({ rotate: t.rotate, origin: [t.x, t.y] }))
			group.add(textGroup)
		}
		layout.texts.forEach(place)
		if (layout.legend) {
			for (const entry of layout.legend.entries) {
				place({ x: entry.textX, y: entry.y, text: entry.series.label, h: -1, v: 0 })
			}
		}
		group.transform(new SVG.Matrix({ translate: [origin.x, origin.y] }))
		group.node.style.pointerEvents = "none"
		this.textSVG = group
		this.visualization.add(group)
	}

	public rotate(angleDeg: number): void {}
	public flip(horizontal: boolean): void {}

	public recalculateSnappingPoints(matrix?: SVG.Matrix): void {
		const halfSize = this.size.div(2)
		const relPositions = basicDirections
			.filter((anchor) => anchor.key != "default")
			.map((anchor) => ({ anchorname: anchor.name, relPos: halfSize.mul(anchor.direction) }))
		if (!this.snappingPoints || this.snappingPoints.length == 0) {
			for (const element of relPositions) {
				this.snappingPoints.push(new SnapPoint(this, element.anchorname, element.relPos.add(halfSize)))
			}
		} else {
			relPositions.forEach((element, index) => {
				this.snappingPoints[index].updateRelPosition(element.relPos.add(halfSize))
				this.snappingPoints[index].recalculate()
			})
		}
	}

	public isInsideSelectionRectangle(selectionRectangle: SVG.Box): boolean {
		const rect = new SVG.Box(
			this.position.x - this.size.x / 2,
			this.position.y - this.size.y / 2,
			this.size.x,
			this.size.y
		)
		return rectRectIntersection(rect, selectionRectangle, 0)
	}

	// ------------------------------------------------------------------ save

	public toJson(): AxisSaveObject {
		const data = super.toJson() as AxisSaveObject
		data.type = AxisComponent.jsonID
		data.size = this.size.simplifyForJson()
		const changed: Partial<AxisSettings> = {}
		for (const key of Object.keys(this.axis) as (keyof AxisSettings)[]) {
			if (this.axis[key] !== defaultAxisSettings[key]) (changed as any)[key] = this.axis[key]
		}
		data.axis = changed
		data.series = this.series.map((s) => ({ ...s }))
		return data
	}

	protected applyJson(saveObject: AxisSaveObject): void {
		super.applyJson(saveObject)
		this.axis = { ...defaultAxisSettings, ...(saveObject.axis ?? {}) }
		if ((saveObject.axis as any)?.ticksIn) this.axis.tickDirection = "in"
		this.series = (saveObject.series ?? []).map((s) => ({ ...newSeries(s.kind), ...s }))
		this.selectedSeries = 0
		this.loaders.forEach((load) => load())
		this.loadSeries()
		this.update()
		this.componentVisualization.show()
		this.updateTheme()
	}

	static fromJson(saveObject: AxisSaveObject): AxisComponent {
		return new AxisComponent()
	}

	public copyForPlacement(): CircuitComponent {
		const copy = new AxisComponent()
		return copy
	}

	private addSeriesQuiet(series: Series) {
		const entry = Palette.instance.entries[seriesPaletteOrder[0] % Palette.instance.entries.length]
		if (entry) {
			series.color = entry.color
			series.palette = entry.name
		}
		series.expr = "x^2/10"
		this.series.push(series)
		this.loadSeries()
		this.update()
	}

	// ------------------------------------------------------------------ TikZ and SVG

	public requiredTikzLibraries(): string[] {
		const libraries = new Set<string>()
		if (this.axis.arrows) libraries.add("arrows.meta")
		for (const s of this.series) {
			const library = markerOptions[s.marker].library
			if (library) libraries.add(library)
		}
		return [...libraries]
	}

	public toTikzString(): string {
		const layout = this.layout()
		const h = this.size.y
		const w = this.size.x
		// local pixel coordinates (y down) to the coordinates in the shifted scope (cm, y up)
		const c = (x: number, y: number) => `(${roundTikz(pxToCm(x))},${roundTikz(pxToCm(h - y))})`

		// the options which draw like the stroke of the component
		const base: TikzNodeCommand = { options: [], additionalNodes: [] }
		super.buildTikzCommand(base)
		const lineOptions = base.options.filter(
			(o) =>
				o == "draw" ||
				o.startsWith("draw=") ||
				o.startsWith("draw opacity") ||
				o.startsWith("line width") ||
				o.startsWith("dash pattern")
		)
		const fillOptions = base.options.filter((o) => o.startsWith("fill"))
		const draw = lineOptions.length > 0 ? lineOptions : ["draw"]
		const hasDraw = lineOptions.some((o) => o == "draw" || o.startsWith("draw="))
		const stroke = hasDraw ? draw : ["draw"]
		const lines: string[] = []
		const out = (s: string) => lines.push("\t" + s)

		const origin = new SVG.Point(this.position.x - w / 2, this.position.y + h / 2)
		lines.push(`\\begin{scope}[shift={${origin.toTikzString()}}]`)

		if (fillOptions.length > 0) out(`\\path[${fillOptions.join(", ")}] ${c(0, 0)} rectangle ${c(w, h)};`)
		const lineList = (list: LinePrim[], options: string[]) =>
			list.length > 0 &&
			out(`\\draw[${options.join(", ")}] ` + list.map((l) => `${c(...l.a)} -- ${c(...l.b)}`).join(" ") + ";")
		lineList(layout.gridMinor, ["gray!30", "line width=0.2pt"])
		lineList(layout.gridMajor, ["gray!50", "line width=0.3pt"])
		if (this.axis.style == "box") out(`\\draw[${stroke.join(", ")}] ${c(0, 0)} rectangle ${c(w, h)};`)
		const noDash = stroke.filter((o) => !o.startsWith("dash pattern"))
		for (let i = 0; i < layout.axisLines.length; i++) {
			const l = layout.axisLines[i]
			const arrow = this.axis.arrows ? ["-{Stealth[length=2mm]}"] : []
			out(`\\draw[${[...noDash, ...arrow].join(", ")}] ${c(...l.a)} -- ${c(...l.b)};`)
		}
		lineList(layout.ticks, noDash)
		lineList(layout.minorTicks, noDash)

		// series, clipped to the plot area
		if (this.series.length > 0) {
			out(`\\begin{scope}`)
			out(`\t\\clip ${c(0, 0)} rectangle ${c(w, h)};`)
			for (const s of this.series) {
				const color = (resolveColor(s.color, s.palette) as any)?.toTikzString?.() ?? "black"
				const dashChoice = strokeStyleChoices.find((x) => x.key == s.dash) ?? strokeStyleChoices[0]
				const options = [`color=${color}`, `line width=${roundTikz(s.width)}pt`]
				if (dashChoice.dasharray[1] != 0) {
					const pattern: string[] = []
					for (let i = 0; i + 1 < dashChoice.dasharray.length; i += 2) {
						pattern.push(
							`on ${roundTikz(s.width * dashChoice.dasharray[i])}pt`,
							`off ${roundTikz(s.width * dashChoice.dasharray[i + 1])}pt`
						)
					}
					options.push(`dash pattern={${pattern.join(" ")}}`)
				}
				for (const run of this.seriesPixelRuns(s)) {
					if (s.width > 0 && run.length >= 2) {
						if (s.smooth) {
							const points = smoothPath(run, false, 1)
							let d = `${c(points[0].x, points[0].y)}`
							for (let i = 1; i + 2 < points.length + 0; i += 3) {
								d += ` .. controls ${c(points[i].x, points[i].y)} and ${c(points[i + 1].x, points[i + 1].y)} .. ${c(points[i + 2].x, points[i + 2].y)}`
							}
							out(`\t\\draw[${options.join(", ")}] ${d};`)
						} else {
							out(`\t\\draw[${options.join(", ")}] ` + run.map((p) => c(p.x, p.y)).join(" -- ") + ";")
						}
					}
					if (s.marker != "none") {
						out(
							`\t\\draw[color=${color}] plot[only marks, mark=${markerOptions[s.marker].tikz}, mark size=${roundTikz(s.markerSize)}pt] coordinates {${run.map((p) => c(p.x, p.y)).join(" ")}};`
						)
					}
				}
			}
			out(`\\end{scope}`)
		}

		// texts
		const fontString = this.axis.fontSize == defaultFontSize.key ? "" : `\\${this.axis.fontSize} `
		const colorTikz =
			this.strokeInfo.color == "default" ?
				undefined
			:	resolveColor(this.strokeInfo.color, this.strokeInfo.palette)?.toTikzString()
		const textColor = (content: string) => (colorTikz ? `\\textcolor${colorTikz}{${content}}` : content)
		const anchorName = (h: number, v: number) => {
			const vertical =
				v == -1 ? "north"
				: v == 1 ? "south"
				: ""
			const horizontal =
				h == -1 ? "west"
				: h == 1 ? "east"
				: ""
			return [vertical, horizontal].filter(Boolean).join(" ") || "center"
		}
		const node = (t: TextPrim) => {
			const options = [`anchor=${anchorName(t.h, t.v)}`, "inner sep=0pt"]
			if (t.rotate) options.push(`rotate=${-t.rotate}`)
			out(`\\node[${options.join(", ")}] at ${c(t.x, t.y)} {${textColor(fontString + cellToLatex(t.text))}};`)
		}
		layout.texts.forEach(node)

		if (layout.legend) {
			const { box, entries } = layout.legend
			out(
				`\\draw[${[...noDash, "fill=white"].join(", ")}] ${c(box.x, box.y)} rectangle ${c(box.x + box.w, box.y + box.h)};`
			)
			for (const entry of entries) {
				const color =
					(resolveColor(entry.series.color, entry.series.palette) as any)?.toTikzString?.() ?? "black"
				out(
					`\\draw[color=${color}, line width=${roundTikz(entry.series.width)}pt] ${c(entry.sampleFrom, entry.y)} -- ${c(entry.sampleTo, entry.y)};`
				)
				if (entry.series.marker != "none") {
					out(
						`\\draw[color=${color}] plot[only marks, mark=${markerOptions[entry.series.marker].tikz}, mark size=${roundTikz(entry.series.markerSize)}pt] coordinates {${c((entry.sampleFrom + entry.sampleTo) / 2, entry.y)}};`
					)
				}
				node({ x: entry.textX, y: entry.y, text: entry.series.label, h: -1, v: 0 })
			}
		}
		lines.push(`\\end{scope}`)
		return lines.join("\n")
	}

	public toSVG(defs: Map<string, SVG.Element>): SVG.Element {
		// the texts are drawn after the changes of a frame, so make sure they are there
		this.renderContent()
		this.renderTexts()
		const copiedSVG = super.toSVG(defs)
		for (const textElement of [...(copiedSVG.find("text") as SVG.List<SVG.Text>)]) {
			const transform = textElement.transform()
			const fontSize = new SVG.Number(textElement.attr("font-size")).convertToUnit("px").value
			const g = new SVG.G()
			g.fill(textElement.fill())
			g.transform(transform)
			for (const tspan of textElement.find("tspan") as SVG.List<SVG.Tspan>) {
				const d = textToSVG.getD(tspan.node.textContent, {
					x: Number.parseFloat(tspan.node.getAttribute("x")),
					y: Number.parseFloat(tspan.node.getAttribute("y")),
					fontSize: fontSize,
				})
				g.add(new SVG.Path({ d: d }))
			}
			textElement.parent().add(g)
			textElement.remove()
		}
		return copiedSVG
	}

	public remove(): void {
		removeTextSVG(this.textSVG)
		super.remove()
	}
}
