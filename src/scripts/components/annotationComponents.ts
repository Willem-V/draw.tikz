import * as SVG from "@svgdotjs/svg.js"
import {
	BooleanProperty,
	CanvasController,
	ChoiceProperty,
	CircuitComponent,
	convertTextToNativeSVGText,
	defaultFontSize,
	defaultStroke,
	FontSize,
	fontSizes,
	PathComponent,
	PathSaveObject,
	PropertyCategories,
	SectionHeaderProperty,
	SelectionController,
	SliderProperty,
	SnappingInfo,
	SnapPoint,
	Strokable,
	StrokeInfo,
	TextProperty,
	TikzPathCommand,
	buildTikzStringFromPathCommand,
	buildTikzStringFromNodeCommand,
	TikzNodeCommand,
} from "../internal"
import { cellToLatex } from "../utils/latexText"
import { resolveColor } from "../utils/palette"
import { lineRectIntersection, roundTikz, selectedBoxWidth, selectionSize } from "../utils/selectionHelper"
import { removeTextSVG, textsToPaths } from "../utils/svgText"

type Primitive =
	/** a stroked polyline */
	| { kind: "line"; points: SVG.Point[] }
	/** a stroked cubic Bezier curve: point, control, control, point, control, control, point, ... */
	| { kind: "curve"; points: SVG.Point[] }
	/** a filled polygon (arrow heads) */
	| { kind: "fill"; points: SVG.Point[] }

type Label = { at: SVG.Point; text: string; angle: number }

const ptToPx = (pt: number) => new SVG.Number(pt, "pt").convertToUnit("px").value
const mmToPx = (mm: number) => new SVG.Number(mm, "mm").convertToUnit("px").value

export type AnnotationSaveObject = PathSaveObject & { stroke?: StrokeInfo; text?: string; fontSize?: string }

/**
 * Base of the dimension line and the brace: two reference points, a drawing made of lines, curves and filled arrow heads, and a
 * text. The preview and the TikZ export are made from the same primitives, so they look the same.
 */
abstract class AnnotationComponent extends Strokable(PathComponent) {
	declare protected dragElement: SVG.Path

	protected textProperty: TextProperty
	protected fontSizeProperty: ChoiceProperty<FontSize>
	private drawing: SVG.G
	private textSVG: SVG.G
	private size = new SVG.Point()
	private primitivesCache: Primitive[] = []
	private labelCache: Label | undefined

	protected constructor(name: string, textLabel: string) {
		super()
		this.snappingPoints = []
		CanvasController.instance.canvas.add(this.visualization)
		this.displayName = name
		this.position = new SVG.Point()
		this.drawing = CanvasController.instance.canvas.group()
		this.dragElement = CanvasController.instance.canvas.path()
		this.dragElement.attr({ "fill": "none", "stroke": "transparent", "stroke-width": selectionSize })
		this.visualization.add(this.drawing)
		this.visualization.add(this.dragElement)

		this.properties.add(
			PropertyCategories.text,
			new SectionHeaderProperty("Text", undefined, "annotation:text-header")
		)
		this.textProperty = new TextProperty(textLabel, "", "$math$ is possible", undefined, "annotation:text")
		this.textProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.textProperty)
		this.fontSizeProperty = new ChoiceProperty("Fontsize", fontSizes, defaultFontSize, undefined, "text:fontsize")
		this.fontSizeProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.fontSizeProperty)
	}

	protected get fontPx(): number {
		return (this.fontSizeProperty.value.size * 4) / 3
	}

	protected textWidth(text: string): number {
		const plain = text.replace(/\$[^$]*\$/g, "xx").replace(/[\\{}^_]/g, "")
		return plain.length * this.fontPx * 0.55
	}

	/** the drawing for the current reference points */
	protected abstract build(): { primitives: Primitive[]; label?: Label }

	protected strokeColor(): string {
		return this.strokeInfo.color == "default" ? defaultStroke : (this.strokeInfo.color as string)
	}

	public update(): void {
		if (this.referencePoints.length >= 2) {
			const { primitives, label } = this.build()
			this.primitivesCache = primitives
			this.labelCache = label
			this.render()
			const box = this.drawing.bbox()
			this._bbox = box
			this.size = new SVG.Point(box.w, box.h)
			this.position = new SVG.Point(box.cx, box.cy)
			this.referencePosition = this.position.sub(new SVG.Point(box.x, box.y))
		}
		this.recalculateSelectionVisuals()
		this.recalculateSnappingPoints()
		this.recalculateResizePoints()
	}

	private pathData(prim: Primitive): string {
		const f = (p: SVG.Point) => `${p.x} ${p.y}`
		if (prim.kind == "curve") {
			let d = `M ${f(prim.points[0])}`
			for (let i = 1; i + 2 < prim.points.length; i += 3) {
				d += ` C ${f(prim.points[i])} ${f(prim.points[i + 1])} ${f(prim.points[i + 2])}`
			}
			return d
		}
		return "M " + prim.points.map(f).join(" L ") + (prim.kind == "fill" ? " Z" : "")
	}

	private render() {
		const color = this.strokeColor()
		const width = this.strokeInfo.opacity == 0 ? 0 : this.strokeInfo.width.convertToUnit("px").value
		this.drawing.clear()
		for (const prim of this.primitivesCache) {
			const path = this.drawing.path(this.pathData(prim))
			if (prim.kind == "fill") {
				path.fill({ color, opacity: this.strokeInfo.opacity }).stroke("none")
			} else {
				path.fill("none").stroke({
					color,
					opacity: this.strokeInfo.opacity,
					width,
					dasharray: this.strokeStyleProperty.value.dasharray
						.map((factor) => this.strokeInfo.width.times(factor).toString())
						.join(" "),
				})
			}
		}
		this.dragElement.plot(
			this.primitivesCache
				.filter((p) => p.kind != "fill")
				.map((p) => this.pathData(p))
				.join(" ") || "M 0 0"
		)
		this.renderText()
	}

	private renderText() {
		removeTextSVG(this.textSVG)
		this.textSVG = undefined
		const label = this.labelCache
		if (!label || !label.text.trim()) return
		const width = 240
		const height = 60
		const group = convertTextToNativeSVGText(
			{
				text: label.text,
				align: 1,
				justify: 0,
				fontSize: this.fontSizeProperty.value.key,
				color:
					this.strokeInfo.color == "default" ? "var(--bs-emphasis-color)" : (this.strokeInfo.color as string),
			},
			new SVG.Box(label.at.x - width / 2, label.at.y - height / 2, width, height)
		)
		group.transform(new SVG.Matrix({ rotate: label.angle, origin: [label.at.x, label.at.y] }))
		group.node.style.pointerEvents = "none"
		this.textSVG = group
		this.visualization.add(group)
	}

	public updateTheme(): void {
		if (this.referencePoints.length >= 2) this.render()
	}

	protected recalculateSelectionVisuals(): void {
		if (this.selectionElement) {
			const additionalWidth = selectedBoxWidth + this.strokeInfo.width.convertToUnit("px").value + 2
			this.selectionElement
				.size(this.size.x + additionalWidth, this.size.y + additionalWidth)
				.center(this.position.x, this.position.y)
		}
	}

	public getSnappingInfo(): SnappingInfo {
		return { trackedSnappingPoints: this.snappingPoints, additionalSnappingPoints: [] }
	}

	public recalculateSnappingPoints(matrix?: SVG.Matrix): void {
		const points = this.referencePoints
		if (points.length < 2) return
		if (!this.snappingPoints || this.snappingPoints.length != points.length) {
			this.snappingPoints.forEach((snapPoint) => snapPoint.show(false))
			this.snappingPoints = points.map((point) => new SnapPoint(this, "", point))
		} else {
			const recalcMatrix = new SVG.Matrix()
			points.forEach((point, index) => {
				this.snappingPoints[index].updateRelPosition(point)
				this.snappingPoints[index].recalculate(recalcMatrix)
			})
		}
	}

	public viewSelected(show: boolean): void {
		super.viewSelected(show)
		this.resizable(this.isSelected && show && SelectionController.instance.currentlySelectedComponents.length == 1)
	}

	public isInsideSelectionRectangle(selectionRectangle: SVG.Box): boolean {
		for (const prim of this.primitivesCache) {
			const points = prim.points
			for (let i = 0; i + 1 < points.length; i++) {
				if (
					lineRectIntersection(
						[
							[points[i].x, points[i].y],
							[points[i + 1].x, points[i + 1].y],
						],
						selectionRectangle
					)
				) {
					return true
				}
			}
		}
		return false
	}

	public placeStep(pos: SVG.Point, ev?: Event): boolean {
		const finished = super.placeStep(pos, ev)
		if (this.referencePoints.length >= 2) this.update()
		return finished
	}

	public placeMove(pos: SVG.Point, ev?: Event): void {
		super.placeMove(pos, ev)
		if (this.referencePoints.length >= 2) this.update()
	}

	public placeFinish(): void {
		super.placeFinish()
		this.update()
		this.updateTheme()
	}

	public toJson(): AnnotationSaveObject {
		const data = super.toJson() as AnnotationSaveObject
		if (this.textProperty.value) data.text = this.textProperty.value
		if (this.fontSizeProperty.value.key !== defaultFontSize.key) data.fontSize = this.fontSizeProperty.value.key
		return data
	}

	protected applyJson(saveObject: AnnotationSaveObject): void {
		super.applyJson(saveObject)
		this.textProperty.value = saveObject.text ?? ""
		this.fontSizeProperty.value = fontSizes.find((f) => f.key == saveObject.fontSize) ?? defaultFontSize
	}

	protected buildTikzCommand(command: TikzPathCommand): void {
		super.buildTikzCommand(command)
	}

	public toTikzString(): string {
		const base: TikzPathCommand = { options: [], coordinates: [], connectors: [], additionalNodes: [] }
		this.buildTikzCommand(base)
		const strokeOptions = base.options.filter(
			(o) =>
				o == "draw" ||
				o.startsWith("draw=") ||
				o.startsWith("draw opacity") ||
				o.startsWith("line width") ||
				o.startsWith("dash pattern")
		)
		const colorTikz = resolveColor(
			this.strokeInfo.color == "default" ? undefined : this.strokeInfo.color,
			this.strokeInfo.palette
		)?.toTikzString()
		const strings: string[] = []
		for (const prim of this.primitivesCache) {
			if (prim.kind == "fill") {
				strings.push(
					buildTikzStringFromPathCommand({
						options: [`fill=${colorTikz ?? "black"}`],
						coordinates: [...prim.points, "cycle"],
						connectors: prim.points.map(() => "--"),
						additionalNodes: [],
					})
				)
				continue
			}
			const connectors: string[] = []
			const coordinates: (string | SVG.Point)[] = []
			if (prim.kind == "line") {
				coordinates.push(...prim.points)
				prim.points.slice(1).forEach(() => connectors.push("--"))
			} else {
				for (let i = 0; i + 3 < prim.points.length + 0; i += 3) {
					coordinates.push(prim.points[i])
					connectors.push(
						`.. controls ${prim.points[i + 1].toTikzString()} and ${prim.points[i + 2].toTikzString()} ..`
					)
				}
				coordinates.push(prim.points.at(-1))
			}
			strings.push(
				buildTikzStringFromPathCommand({
					options: [...strokeOptions],
					coordinates,
					connectors,
					additionalNodes: [],
				})
			)
		}
		const label = this.labelCache
		if (label && label.text.trim()) {
			const fontString =
				this.fontSizeProperty.value.key == defaultFontSize.key ? "" : `\\${this.fontSizeProperty.value.name} `
			let content = fontString + cellToLatex(label.text)
			if (colorTikz) content = `\\textcolor${colorTikz}{${content}}`
			const node: TikzNodeCommand = {
				options: ["anchor=center", "inner sep=0pt"],
				position: label.at,
				content,
				additionalNodes: [],
			}
			if (Math.abs(label.angle) > 1e-6) node.options.push("rotate=" + roundTikz(-label.angle))
			strings.push(buildTikzStringFromNodeCommand(node))
		}
		return strings.join("\n\t")
	}

	public toSVG(defs: Map<string, SVG.Element>): SVG.Element {
		const copiedSVG = super.toSVG(defs)
		textsToPaths(copiedSVG)
		return copiedSVG
	}
}

const dimensionTips = [
	{ key: "stealth", name: "stealth" },
	{ key: "latex", name: "latex" },
	{ key: "bar", name: "bar" },
	{ key: "none", name: "none" },
]

export type DimensionSaveObject = AnnotationSaveObject & {
	offset?: number
	tip?: string
	tipLength?: number
	extension?: boolean
	textAbove?: boolean
}

/**
 * A dimension line like in technical drawings: the measured points, a parallel line with arrow heads at the offset, extension
 * lines and a text (e.g. the length) in the middle.
 */
export class DimensionLineComponent extends AnnotationComponent {
	private static jsonID = "dimension"
	static {
		CircuitComponent.jsonSaveMap.set(DimensionLineComponent.jsonID, DimensionLineComponent)
	}

	private offsetProperty: SliderProperty
	private tipProperty: ChoiceProperty<{ key: string; name: string }>
	private tipLengthProperty: SliderProperty
	private extensionProperty: BooleanProperty
	private aboveProperty: BooleanProperty

	public constructor() {
		super("Dimension line", "Text")
		this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Dimension", undefined, "dim:header"))
		this.offsetProperty = new SliderProperty(
			"Offset",
			-200,
			200,
			1,
			new SVG.Number(12, "pt"),
			false,
			"Distance of the dimension line from the measured points, negative for the other side",
			"dim:offset"
		)
		this.offsetProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.offsetProperty)
		this.tipProperty = new ChoiceProperty("Arrow heads", dimensionTips, dimensionTips[0], undefined, "dim:tip")
		this.tipProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.tipProperty)
		this.tipLengthProperty = new SliderProperty(
			"Arrow length",
			0.5,
			10,
			0.5,
			new SVG.Number(2.5, "mm"),
			true,
			undefined,
			"dim:tiplength"
		)
		this.tipLengthProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.tipLengthProperty)
		this.extensionProperty = new BooleanProperty(
			"Extension lines",
			true,
			undefined,
			"Lines from the measured points to the dimension line",
			"dim:extension"
		)
		this.extensionProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.extensionProperty)
		this.aboveProperty = new BooleanProperty(
			"Text above the line",
			false,
			undefined,
			"Otherwise the text interrupts the line",
			"dim:above"
		)
		this.aboveProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.aboveProperty)
		this.selectionElement = CanvasController.instance.canvas.rect(0, 0).hide()
	}

	protected build(): { primitives: Primitive[]; label?: Label } {
		const [p1, p2] = this.referencePoints
		const delta = p2.sub(p1)
		const length = delta.abs()
		if (length < 1e-6) return { primitives: [] }
		const u = delta.div(length)
		const n = new SVG.Point(-u.y, u.x) // to the right of the direction (screen)
		const offset = ptToPx(this.offsetProperty.value.value)
		const q1 = p1.add(n.mul(offset))
		const q2 = p2.add(n.mul(offset))
		const primitives: Primitive[] = []
		const sign = offset < 0 ? -1 : 1

		if (this.extensionProperty.value && Math.abs(offset) > ptToPx(3)) {
			const gap = ptToPx(1.5) * sign
			const over = ptToPx(2) * sign
			primitives.push({ kind: "line", points: [p1.add(n.mul(gap)), q1.add(n.mul(over))] })
			primitives.push({ kind: "line", points: [p2.add(n.mul(gap)), q2.add(n.mul(over))] })
		}

		const tipLength = mmToPx(this.tipLengthProperty.value.value)
		const tip = this.tipProperty.value.key
		const width = tipLength * 0.3
		const head = (at: SVG.Point, dir: SVG.Point) => {
			// dir points away from the line, the head sits on the end of the line
			const back = at.sub(dir.mul(tipLength))
			if (tip == "stealth") {
				return [
					{
						kind: "fill",
						points: [at, back.add(n.mul(width)), at.sub(dir.mul(tipLength * 0.7)), back.sub(n.mul(width))],
					} as Primitive,
				]
			}
			if (tip == "latex") {
				return [{ kind: "fill", points: [at, back.add(n.mul(width)), back.sub(n.mul(width))] } as Primitive]
			}
			if (tip == "bar") {
				return [
					{
						kind: "line",
						points: [at.add(n.mul(tipLength * 0.5)), at.sub(n.mul(tipLength * 0.5))],
					} as Primitive,
				]
			}
			return []
		}
		const inset =
			tip == "stealth" ? tipLength * 0.7
			: tip == "latex" ? tipLength
			: 0
		const text = this.textProperty.value.trim()
		const mid = q1.add(q2).div(2)
		let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI
		if (angle > 90) angle -= 180
		if (angle <= -90) angle += 180
		const along = new SVG.Point(Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180))

		const a = q1.add(u.mul(inset))
		const b = q2.sub(u.mul(inset))
		if (text && !this.aboveProperty.value) {
			const half = this.textWidth(text) / 2 + ptToPx(2)
			const gapStart = mid.sub(along.mul(half))
			const gapEnd = mid.add(along.mul(half))
			// the parts of the line before and after the text
			const forward = u.x * along.x + u.y * along.y > 0
			const first = forward ? gapStart : gapEnd
			const second = forward ? gapEnd : gapStart
			if (first.sub(a).dot(u) > 0) primitives.push({ kind: "line", points: [a, first] })
			if (b.sub(second).dot(u) > 0) primitives.push({ kind: "line", points: [second, b] })
		} else {
			primitives.push({ kind: "line", points: [a, b] })
		}
		primitives.push(...head(q1, u.mul(-1)), ...head(q2, u))

		let label: Label | undefined
		if (text) {
			// "up" of the text frame
			const up = new SVG.Point(Math.sin((angle * Math.PI) / 180), -Math.cos((angle * Math.PI) / 180))
			const at = this.aboveProperty.value ? mid.add(up.mul(this.fontPx * 0.7 + ptToPx(2))) : mid
			label = { at, text, angle }
		}
		return { primitives, label }
	}

	public requiredTikzLibraries(): string[] {
		return []
	}

	public copyForPlacement(): CircuitComponent {
		return new DimensionLineComponent()
	}

	public toJson(): DimensionSaveObject {
		const data = super.toJson() as DimensionSaveObject
		data.type = DimensionLineComponent.jsonID
		data.offset = this.offsetProperty.value.value
		data.tip = this.tipProperty.value.key
		data.tipLength = this.tipLengthProperty.value.value
		if (!this.extensionProperty.value) data.extension = false
		if (this.aboveProperty.value) data.textAbove = true
		return data
	}

	protected applyJson(saveObject: DimensionSaveObject): void {
		super.applyJson(saveObject)
		this.offsetProperty.value = new SVG.Number(saveObject.offset ?? 12, "pt")
		this.tipProperty.value = dimensionTips.find((t) => t.key == saveObject.tip) ?? dimensionTips[0]
		this.tipLengthProperty.value = new SVG.Number(saveObject.tipLength ?? 2.5, "mm")
		this.extensionProperty.value = saveObject.extension ?? true
		this.aboveProperty.value = saveObject.textAbove ?? false
		this.update()
		this.updateTheme()
	}

	static fromJson(saveObject: DimensionSaveObject): DimensionLineComponent {
		return new DimensionLineComponent()
	}
}

export type BraceSaveObject = AnnotationSaveObject & { amplitude?: number; mirror?: boolean }

/**
 * A curly brace between two points with an optional text at its tip. It is exported as an ordinary Bezier path, so no TikZ
 * library is needed.
 */
export class BraceComponent extends AnnotationComponent {
	private static jsonID = "brace"
	static {
		CircuitComponent.jsonSaveMap.set(BraceComponent.jsonID, BraceComponent)
	}

	private amplitudeProperty: SliderProperty
	private mirrorProperty: BooleanProperty

	public constructor() {
		super("Brace", "Label")
		this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Brace", undefined, "brace:header"))
		this.amplitudeProperty = new SliderProperty(
			"Height",
			1,
			100,
			1,
			new SVG.Number(10, "pt"),
			false,
			"Height of the brace",
			"brace:amplitude"
		)
		this.amplitudeProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.amplitudeProperty)
		this.mirrorProperty = new BooleanProperty(
			"Other side",
			false,
			undefined,
			"Put the brace on the other side",
			"brace:mirror"
		)
		this.mirrorProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.mirrorProperty)
		this.selectionElement = CanvasController.instance.canvas.rect(0, 0).hide()
	}

	protected build(): { primitives: Primitive[]; label?: Label } {
		const [a, b] = this.referencePoints
		const delta = b.sub(a)
		const length = delta.abs()
		if (length < 1e-6) return { primitives: [] }
		const u = delta.div(length)
		const outward = new SVG.Point(u.y, -u.x).mul(this.mirrorProperty.value ? -1 : 1)
		const r = Math.max(0.01, Math.min(ptToPx(this.amplitudeProperty.value.value) / 2, length / 4))
		const k = 0.552
		const l = length
		// local coordinates: x along the brace, y towards the tip
		const to = (x: number, y: number) => a.add(u.mul(x)).add(outward.mul(y))
		const lineAsCurve = (x1: number, y1: number, x2: number, y2: number) => [
			to(x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3),
			to(x1 + ((x2 - x1) * 2) / 3, y1 + ((y2 - y1) * 2) / 3),
			to(x2, y2),
		]
		const points = [
			to(0, 0),
			to(0, k * r),
			to((1 - k) * r, r),
			to(r, r),
			...lineAsCurve(r, r, l / 2 - r, r),
			to(l / 2 - r + k * r, r),
			to(l / 2, r + (1 - k) * r),
			to(l / 2, 2 * r),
			to(l / 2, r + (1 - k) * r),
			to(l / 2 + (1 - k) * r, r),
			to(l / 2 + r, r),
			...lineAsCurve(l / 2 + r, r, l - r, r),
			to(l - (1 - k) * r, r),
			to(l, k * r),
			to(l, 0),
		]
		const label = this.textProperty.value.trim()
		return {
			primitives: [{ kind: "curve", points }],
			label:
				label ?
					{ at: to(l / 2, 2 * r + this.fontPx * 0.8 + ptToPx(2)), text: this.textProperty.value, angle: 0 }
				:	undefined,
		}
	}

	public requiredTikzLibraries(): string[] {
		return []
	}

	public copyForPlacement(): CircuitComponent {
		return new BraceComponent()
	}

	public toJson(): BraceSaveObject {
		const data = super.toJson() as BraceSaveObject
		data.type = BraceComponent.jsonID
		data.amplitude = this.amplitudeProperty.value.value
		if (this.mirrorProperty.value) data.mirror = true
		return data
	}

	protected applyJson(saveObject: BraceSaveObject): void {
		super.applyJson(saveObject)
		this.amplitudeProperty.value = new SVG.Number(saveObject.amplitude ?? 10, "pt")
		this.mirrorProperty.value = saveObject.mirror ?? false
		this.update()
		this.updateTheme()
	}

	static fromJson(saveObject: BraceSaveObject): BraceComponent {
		return new BraceComponent()
	}
}
