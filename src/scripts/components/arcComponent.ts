import * as SVG from "@svgdotjs/svg.js"
import {
	BooleanProperty,
	CanvasController,
	CircuitComponent,
	defaultStroke,
	Fillable,
	FillInfo,
	PathComponent,
	PathSaveObject,
	PropertyCategories,
	SectionHeaderProperty,
	SelectionController,
	SnappingInfo,
	SnapPoint,
	Strokable,
	StrokeInfo,
	TikzPathCommand,
} from "../internal"
import { roundTikz, selectedBoxWidth, selectionSize } from "../utils/selectionHelper"

export type ArcSaveObject = PathSaveObject & {
	fill?: FillInfo
	stroke?: StrokeInfo
	pie?: boolean
}

/**
 * A circular arc. The reference points are the center, the start of the arc (its distance from the center is the radius) and
 * a point in the direction of the end of the arc. The arc runs counterclockwise from the start to the end, like in TikZ.
 */
export class ArcComponent extends Strokable(Fillable(PathComponent)) {
	private static jsonID = "arc"
	static {
		CircuitComponent.jsonSaveMap.set(ArcComponent.jsonID, ArcComponent)
	}

	declare public componentVisualization: SVG.Path
	declare protected dragElement: SVG.Path

	private pieProperty: BooleanProperty
	private size = new SVG.Point()

	public constructor() {
		super()
		this.pointLimit = 3
		this.snappingPoints = []
		CanvasController.instance.canvas.add(this.visualization)
		this.displayName = "Arc"
		this.position = new SVG.Point()

		this.componentVisualization = CanvasController.instance.canvas.path().fill("none")
		this.dragElement = CanvasController.instance.canvas.path()
		this.dragElement.attr({ "fill": "none", "stroke": "transparent", "stroke-width": selectionSize })
		this.visualization.add(this.componentVisualization)
		this.visualization.add(this.dragElement)

		this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Arc", undefined, "arc:header"))
		this.pieProperty = new BooleanProperty(
			"Pie slice",
			false,
			undefined,
			"Close the arc over the center, so it can be filled like a slice",
			"arc:pie"
		)
		this.pieProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.pieProperty)
	}

	/** center, start, end on the circle (end is projected to the circle), the angles in radians in the canvas coordinates (y down) */
	private geometry() {
		const points = this.referencePoints
		const center = points[0] ?? new SVG.Point()
		const start = points[1] ?? center
		const endDirection = points[2] ?? start
		const radius = start.sub(center).abs()
		const angleStart = Math.atan2(start.y - center.y, start.x - center.x)
		let angleEnd = Math.atan2(endDirection.y - center.y, endDirection.x - center.x)
		if (endDirection.eq(center)) angleEnd = angleStart
		const end = center.add(new SVG.Point(Math.cos(angleEnd), Math.sin(angleEnd)).mul(radius))
		// counterclockwise on the screen: the canvas angle decreases
		let sweep = (angleStart - angleEnd) % (2 * Math.PI)
		if (sweep < 0) sweep += 2 * Math.PI
		if (sweep < 1e-9 && !endDirection.eq(start)) sweep = 2 * Math.PI
		return { center, start, end, radius, angleStart, sweep }
	}

	protected movePointTo(index: number, position: SVG.Point): void {
		if (index == 0 && this.referencePoints.length > 1) {
			const delta = position.sub(this.referencePoints[0])
			this.referencePoints = this.referencePoints.map((point) => point.add(delta))
		} else {
			this.referencePoints[index] = new SVG.Point(position)
		}
		this.update()
	}

	public update(): void {
		if (this.referencePoints.length > 0) {
			const { center, start, end, radius, sweep } = this.geometry()
			let d = `M ${start.x} ${start.y}`
			if (radius > 0 && sweep > 1e-9) {
				if (sweep > 2 * Math.PI - 1e-6) {
					const opposite = center.mul(2).sub(start)
					d += ` A ${radius} ${radius} 0 1 0 ${opposite.x} ${opposite.y} A ${radius} ${radius} 0 1 0 ${start.x} ${start.y}`
				} else {
					d += ` A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 0 ${end.x} ${end.y}`
				}
				if (this.pieProperty.value) d += ` L ${center.x} ${center.y} Z`
			}
			this.componentVisualization.plot(d)
			this.dragElement.plot(d)
			this.dragElement.attr({
				fill: this.pieProperty.value && this.fillInfo.opacity > 0 ? "transparent" : "none",
			})
			const bbox = this.componentVisualization.bbox()
			this._bbox = bbox
			this.size = new SVG.Point(bbox.w, bbox.h)
			this.position = new SVG.Point(bbox.cx, bbox.cy)
			this.referencePosition = this.position.sub(new SVG.Point(bbox.x, bbox.y))
		}
		this.recalculateSelectionVisuals()
		this.recalculateSnappingPoints()
		this.recalculateResizePoints()
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
		if (this.referencePoints.length < 3) return
		const { center, start, end } = this.geometry()
		const positions = [center, start, end]
		if (!this.snappingPoints || this.snappingPoints.length != positions.length) {
			this.snappingPoints.forEach((snapPoint) => snapPoint.show(false))
			this.snappingPoints = positions.map((point, i) => new SnapPoint(this, ["center", "start", "end"][i], point))
		} else {
			const recalcMatrix = new SVG.Matrix()
			positions.forEach((point, i) => {
				this.snappingPoints[i].updateRelPosition(point)
				this.snappingPoints[i].recalculate(recalcMatrix)
			})
		}
	}

	public viewSelected(show: boolean): void {
		super.viewSelected(show)
		this.resizable(this.isSelected && show && SelectionController.instance.currentlySelectedComponents.length == 1)
	}

	public isInsideSelectionRectangle(selectionRectangle: SVG.Box): boolean {
		// the box of the arc is a good enough approximation, the border of the box has to be touched for unfilled arcs
		const bbox = this._bbox
		return !(
			bbox.x > selectionRectangle.x2 ||
			bbox.x2 < selectionRectangle.x ||
			bbox.y > selectionRectangle.y2 ||
			bbox.y2 < selectionRectangle.y
		)
	}

	public updateTheme(): void {
		const strokeColor = this.strokeInfo.color == "default" ? defaultStroke : this.strokeInfo.color
		this.componentVisualization?.stroke({
			color: strokeColor,
			opacity: this.strokeInfo.opacity,
			width: this.strokeInfo.opacity == 0 ? 0 : this.strokeInfo.width.convertToUnit("px").value,
			dasharray: this.strokeStyleProperty.value.dasharray
				.map((factor) => this.strokeInfo.width.times(factor).toString())
				.join(" "),
		})
		this.componentVisualization?.fill({
			color: this.fillInfo.color == "default" ? "none" : this.fillInfo.color,
			opacity: this.fillInfo.opacity,
		})
	}

	public placeStep(pos: SVG.Point, ev?: Event): boolean {
		const finished = super.placeStep(pos, ev)
		this.update()
		return finished
	}

	public placeFinish(): void {
		if (this.finishedPlacing) return
		super.placeFinish()
		this.updateTheme()
	}

	public copyForPlacement(): CircuitComponent {
		return new ArcComponent()
	}

	public toJson(): ArcSaveObject {
		const data = super.toJson() as ArcSaveObject
		data.type = ArcComponent.jsonID
		if (this.pieProperty.value) data.pie = true
		return data
	}

	protected applyJson(saveObject: ArcSaveObject): void {
		super.applyJson(saveObject)
		this.pieProperty.value = saveObject.pie ?? false
		this.update()
		this.updateTheme()
	}

	static fromJson(saveObject: ArcSaveObject): ArcComponent {
		return new ArcComponent()
	}

	protected buildTikzCommand(command: TikzPathCommand): void {
		super.buildTikzCommand(command)
		const { center, start, end, radius, angleStart, sweep } = this.geometry()
		// TikZ has the y axis pointing up
		const startDeg = -(angleStart * 180) / Math.PI
		const endDeg = startDeg + (sweep * 180) / Math.PI
		const radiusCm = roundTikz(new SVG.Number(radius, "px").convertToUnit("cm").value)
		const arc = `arc[start angle=${roundTikz(startDeg)}, end angle=${roundTikz(endDeg)}, radius=${radiusCm}cm]`
		if (this.pieProperty.value) {
			command.coordinates = [start, center, "cycle"]
			command.connectors = [arc + " --", "--"]
		} else {
			// the empty end coordinate only fulfills the format of the builder
			command.coordinates = [start, ""]
			command.connectors = [arc]
		}
	}

	public requiredTikzLibraries(): string[] {
		return []
	}
}
