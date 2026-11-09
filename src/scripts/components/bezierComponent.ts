import * as SVG from "@svgdotjs/svg.js"
import {
	AdjustDragHandler,
	ArrowTip,
	arrowTips,
	ChoiceProperty,
	defaultArrowTip,
	BooleanProperty,
	ButtonGridProperty,
	CanvasController,
	CircuitComponent,
	defaultStroke,
	Fillable,
	FillInfo,
	MainController,
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
	TikzPathCommand,
} from "../internal"
import { lineRectIntersection, resizeSVG, selectedBoxWidth, selectionSize } from "../utils/selectionHelper"
import { bezierPathData, sampleBezier, simplifyPolyline, smoothPath } from "../utils/curves"

export type BezierSaveObject = PathSaveObject & {
	fill?: FillInfo
	stroke?: StrokeInfo
	closed?: boolean
	/** false: the control points are edited by hand (points: anchor, control, control, anchor, ...) */
	auto?: boolean
	smoothness?: number
	startArrow?: string
	endArrow?: string
}

/**
 * A curve through some anchor points. By default the curve is smooth by itself (just place and move the anchors, the smoothness
 * is adjustable). Without "Smooth automatically" the control points are part of the curve and have their own handles.
 * The free-hand variant records the mouse movement and fits the curve to it.
 */
export class BezierComponent extends Strokable(Fillable(PathComponent)) {
	private static jsonID = "bezier"
	static {
		CircuitComponent.jsonSaveMap.set(BezierComponent.jsonID, BezierComponent)
	}

	declare public componentVisualization: SVG.Path
	declare protected dragElement: SVG.Path

	private closedProperty: BooleanProperty
	private autoProperty: BooleanProperty
	private smoothnessProperty: SliderProperty
	private controlLines: SVG.Path
	private startTipChoice: ChoiceProperty<ArrowTip>
	private endTipChoice: ChoiceProperty<ArrowTip>
	private startTipElement: SVG.Element | null = null
	private endTipElement: SVG.Element | null = null

	private size = new SVG.Point()
	/** while placing: the anchors, the last one follows the cursor (free-hand: all recorded points) */
	private draft: SVG.Point[] = []
	/** the reference point index of every handle */
	private handleIndices: number[] = []

	public constructor(private freehand = false) {
		super()
		this.snappingPoints = []
		CanvasController.instance.canvas.add(this.visualization)
		this.displayName = freehand ? "Free-hand curve" : "Curve"
		this.position = new SVG.Point()

		this.componentVisualization = CanvasController.instance.canvas.path().fill("none")
		this.dragElement = CanvasController.instance.canvas.path()
		this.dragElement.attr({ "fill": "transparent", "stroke": "transparent", "stroke-width": selectionSize })
		this.controlLines = CanvasController.instance.canvas.path().fill("none").hide()
		this.controlLines.stroke({ color: "var(--bs-cyan)", width: 1, dasharray: "3 3" })
		this.controlLines.node.style.pointerEvents = "none"
		this.visualization.add(this.componentVisualization)
		this.visualization.add(this.dragElement)
		this.visualization.add(this.controlLines)

		this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Curve", undefined, "bezier:header"))
		this.closedProperty = new BooleanProperty(
			"Closed",
			false,
			undefined,
			"Connect the end with the start",
			"bezier:closed"
		)
		this.closedProperty.addChangeListener((ev) => this.setClosed(ev.value))
		this.properties.add(PropertyCategories.options, this.closedProperty)

		this.autoProperty = new BooleanProperty(
			"Smooth automatically",
			true,
			undefined,
			"The curve follows the anchor points by itself. Switch off to edit the control points",
			"bezier:auto"
		)
		this.autoProperty.addChangeListener((ev) => {
			if (ev.value) this.autoControls()
			this.rebuildHandles()
			this.update()
		})
		this.properties.add(PropertyCategories.options, this.autoProperty)

		this.smoothnessProperty = new SliderProperty(
			"Smoothness",
			0,
			1,
			0.05,
			new SVG.Number(1),
			undefined,
			undefined,
			"bezier:smoothness"
		)
		this.smoothnessProperty.addChangeListener(() => {
			if (this.autoProperty.value) {
				this.autoControls()
				this.update()
			}
		})
		this.properties.add(PropertyCategories.options, this.smoothnessProperty)

		this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Arrows", undefined, "bezier:arrows"))
		this.startTipChoice = new ChoiceProperty("Start", arrowTips, defaultArrowTip, undefined, "arrows:start")
		this.startTipChoice.addChangeListener(() => this.updateTips())
		this.properties.add(PropertyCategories.options, this.startTipChoice)
		this.endTipChoice = new ChoiceProperty("End", arrowTips, defaultArrowTip, undefined, "arrows:end")
		this.endTipChoice.addChangeListener(() => this.updateTips())
		this.properties.add(PropertyCategories.options, this.endTipChoice)
	}

	/** the arrow tips at the ends of an open curve (the symbols are the ones of the wires) */
	private updateTips() {
		const color = this.strokeInfo.color == "default" ? defaultStroke : (this.strokeInfo.color as string)
		const scale = this.strokeInfo.width.convertToUnit("pt").value * 4.5 + 2.8
		const strokeWidth = this.strokeInfo.width.convertToUnit("px").value / scale
		const points = this.referencePoints
		const make = (choice: ArrowTip, tip: SVG.Point, from: SVG.Point, old: SVG.Element | null) => {
			old?.remove()
			if (choice.key == defaultArrowTip.key || this.closedProperty.value || points.length < 2) return null
			const group = CanvasController.instance.canvas.group()
			group.addTo(this.visualization)
			group.stroke({ color, opacity: this.strokeInfo.opacity })
			group.fill({ color, opacity: this.strokeInfo.opacity })
			for (const element of document.getElementById(choice.key).children) {
				group.node.append(element.cloneNode(true))
			}
			const direction = tip.sub(from)
			const angle = (Math.atan2(direction.y, direction.x) * 180) / Math.PI
			const ref = choice.refXY ?? new SVG.Point(-1, -0.5)
			group.transform(
				new SVG.Matrix({ translate: tip.toArray(), rotate: angle, scale: [scale, scale] }).multiply({
					translate: ref.toArray(),
				})
			)
			group.attr("stroke-width", strokeWidth * (choice.strokeFactor ?? 0))
			return group
		}
		// the direction at the ends: from the nearest point which is not the end itself
		const first = points[0]
		const last = points.at(-1)
		const afterFirst = points.slice(1).find((p) => !p.eq(first)) ?? first
		const beforeLast =
			points
				.slice(0, -1)
				.reverse()
				.find((p) => !p.eq(last)) ?? last
		this.startTipElement = make(this.startTipChoice.value, first, afterFirst, this.startTipElement)
		this.endTipElement = make(this.endTipChoice.value, last, beforeLast, this.endTipElement)
	}

	private get smoothness(): number {
		return this.smoothnessProperty.value.value
	}

	/** the anchors of the curve (the other reference points are control points) */
	private anchors(): SVG.Point[] {
		return this.referencePoints.filter((_, index) => index % 3 == 0)
	}

	private setClosed(closed: boolean) {
		if (this.referencePoints.length < 4 && closed) {
			this.closedProperty.value = false
			return
		}
		const anchors = this.anchors()
		if (this.autoProperty.value) {
			this.referencePoints = smoothPath(anchors, closed, this.smoothness)
		} else if (closed) {
			const last = anchors.at(-1)
			const first = anchors[0]
			this.referencePoints.push(last.add(first.sub(last).div(3)), first.sub(first.sub(last).div(3)))
		} else {
			this.referencePoints = this.referencePoints.slice(0, 3 * anchors.length - 2)
		}
		this.rebuildHandles()
		this.update()
	}

	private autoControls() {
		this.referencePoints = smoothPath(this.anchors(), this.closedProperty.value, this.smoothness)
	}

	protected movePointTo(index: number, position: SVG.Point): void {
		const target = new SVG.Point(position)
		if (!this.autoProperty.value && index % 3 == 0) {
			// the control points follow their anchor
			const delta = target.sub(this.referencePoints[index])
			const n = this.referencePoints.length
			for (const neighbour of [index - 1, index + 1]) {
				const i = this.closedProperty.value ? (neighbour + n) % n : neighbour
				if (i >= 0 && i < n) this.referencePoints[i] = this.referencePoints[i].add(delta)
			}
		}
		this.referencePoints[index] = target
		if (this.autoProperty.value) this.autoControls()
		this.update()
	}

	public moveRel(delta: SVG.Point): void {
		super.moveRel(delta)
	}

	public update(): void {
		const closed = this.closedProperty.value
		const points = this.referencePoints
		const d = bezierPathData(points, closed)
		this.componentVisualization.plot(d)
		this.dragElement.plot(d)
		const unfilled = this.fillInfo.color == "default" || this.fillInfo.opacity == 0
		this.dragElement.attr({ fill: closed && !unfilled ? "transparent" : "none" })

		if (points.length > 0) {
			const bbox = this.componentVisualization.bbox()
			this._bbox = bbox
			this.size = new SVG.Point(bbox.w, bbox.h)
			this.position = new SVG.Point(bbox.cx, bbox.cy)
			this.referencePosition = this.position.sub(new SVG.Point(bbox.x, bbox.y))
		}

		// the lines from the anchors to their control points
		if (!this.autoProperty.value && this.isResizing) {
			let lines = ""
			const n = points.length
			for (let i = 0; i < n; i += 3) {
				for (const j of [i - 1, i + 1]) {
					const k = closed ? (j + n) % n : j
					if (k >= 0 && k < n) lines += `M ${points[i].x} ${points[i].y} L ${points[k].x} ${points[k].y} `
				}
			}
			this.controlLines.plot(lines || "M 0 0").show()
		} else {
			this.controlLines.hide()
		}

		this.updateTips()
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
		const anchors = this.anchors()
		if (!this.snappingPoints || this.snappingPoints.length != anchors.length) {
			this.snappingPoints.forEach((snapPoint) => snapPoint.show(false))
			this.snappingPoints = anchors.map((point) => new SnapPoint(this, "", point))
		} else {
			const recalcMatrix = new SVG.Matrix()
			anchors.forEach((point, index) => {
				this.snappingPoints[index].updateRelPosition(point)
				this.snappingPoints[index].recalculate(recalcMatrix)
			})
		}
	}

	public viewSelected(show: boolean): void {
		super.viewSelected(show)
		this.resizable(this.isSelected && show && SelectionController.instance.currentlySelectedComponents.length == 1)
	}

	protected recalculateResizePoints() {
		if (this.resizableSVGs.length == this.handleIndices.length) {
			this.handleIndices.forEach((pointIndex, i) => {
				const point = this.referencePoints[pointIndex]
				if (point) this.resizableSVGs[i].center(point.x, point.y)
			})
		}
	}

	private rebuildHandles() {
		if (!this.isResizing) return
		this.isResizing = false
		this.resizable(true)
	}

	public resizable(enable: boolean): void {
		if (this.isResizing == enable) {
			return
		}
		this.isResizing = enable
		for (const pointSVG of this.resizableSVGs) {
			AdjustDragHandler.snapDrag(this, pointSVG, false)
			pointSVG?.remove()
		}
		this.resizableSVGs = []
		this.handleIndices = []
		if (enable) {
			for (let index = 0; index < this.referencePoints.length; index++) {
				const isAnchor = index % 3 == 0
				if (!isAnchor && this.autoProperty.value) continue
				const elementSVG = resizeSVG()
				elementSVG.node.style.cursor = "move"
				if (!isAnchor) elementSVG.opacity(0.7)
				this.resizableSVGs.push(elementSVG)
				this.handleIndices.push(index)
				let start = new SVG.Point()
				AdjustDragHandler.snapDrag(this, elementSVG, true, {
					dragStart: () => {
						start = new SVG.Point(this.referencePoints[index])
					},
					dragMove: (pos) => this.movePointTo(index, pos),
					dragEnd: () => start.eq(this.referencePoints[index]),
				})
			}
		}
		this.update()
	}

	public isInsideSelectionRectangle(selectionRectangle: SVG.Box): boolean {
		if (this.referencePoints.length < 2) return false
		const samples = sampleBezier(this.referencePoints, this.closedProperty.value)
		for (let i = 0; i + 1 < samples.length; i++) {
			if (
				lineRectIntersection(
					[
						[samples[i].x, samples[i].y],
						[samples[i + 1].x, samples[i + 1].y],
					],
					selectionRectangle
				)
			) {
				return true
			}
		}
		return false
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
		if (this.referencePoints.length > 0) this.updateTips()
	}

	// ---- placing ----

	/** the curve of the draft while placing */
	private applyDraft() {
		this.referencePoints = smoothPath(this.draft, false, this.smoothness)
		this.update()
	}

	public placeMove(pos: SVG.Point, ev?: Event): void {
		if (this.draft.length == 0) return
		if (this.freehand) {
			if (pos.sub(this.draft.at(-1)).abs() >= 3) {
				this.draft.push(pos.clone())
				this.applyDraft()
			}
		} else {
			this.draft[this.draft.length - 1] = pos.clone()
			this.applyDraft()
		}
	}

	public placeStep(pos: SVG.Point, ev?: Event): boolean {
		if (this.finishedPlacing) {
			return true
		}
		if (this.draft.length == 0) {
			this.draft = this.freehand ? [pos.clone()] : [pos.clone(), pos.clone()]
			this.visualization.show()
			this.updateTheme()
			return false
		}
		if (this.freehand) {
			// the second click ends the drawing
			return true
		}
		if (this.draft.at(-2).eq(pos)) {
			return true
		}
		this.draft.push(pos.clone())
		this.applyDraft()
		return false
	}

	public placeFinish(): void {
		if (this.finishedPlacing) {
			return
		}
		let anchors = [...this.draft]
		if (!this.freehand) anchors.pop()
		if (this.freehand) anchors = simplifyPolyline(anchors, 2.5)
		if (anchors.length >= 2 && anchors.at(-1).eq(anchors.at(-2))) anchors.pop()
		if (anchors.length < 2) {
			MainController.instance.removeComponent(this)
			return
		}
		this.draft = []
		this.referencePoints = smoothPath(anchors, false, this.smoothness)
		this.finishedPlacing = true
		this.update()
		this.updateTheme()
	}

	public copyForPlacement(): CircuitComponent {
		return new BezierComponent(this.freehand)
	}

	// ---- save / export ----

	public toJson(): BezierSaveObject {
		const data = super.toJson() as BezierSaveObject
		data.type = BezierComponent.jsonID
		if (this.closedProperty.value) data.closed = true
		if (!this.autoProperty.value) data.auto = false
		if (this.smoothness !== 1) data.smoothness = this.smoothness
		if (this.startTipChoice.value.key !== defaultArrowTip.key) data.startArrow = this.startTipChoice.value.key
		if (this.endTipChoice.value.key !== defaultArrowTip.key) data.endArrow = this.endTipChoice.value.key
		return data
	}

	protected applyJson(saveObject: BezierSaveObject): void {
		super.applyJson(saveObject)
		this.closedProperty.value = saveObject.closed ?? false
		this.autoProperty.value = saveObject.auto ?? true
		this.smoothnessProperty.value = new SVG.Number(saveObject.smoothness ?? 1)
		this.startTipChoice.value = arrowTips.find((tip) => tip.key == saveObject.startArrow) ?? defaultArrowTip
		this.endTipChoice.value = arrowTips.find((tip) => tip.key == saveObject.endArrow) ?? defaultArrowTip
		this.freehand = false
		this.update()
		this.updateTheme()
	}

	static fromJson(saveObject: BezierSaveObject): BezierComponent {
		return new BezierComponent()
	}

	protected buildTikzCommand(command: TikzPathCommand): void {
		super.buildTikzCommand(command)
		// the options are set, the coordinates are the anchors and the control points of the segments
		const points = this.referencePoints
		const closed = this.closedProperty.value
		if (!closed) {
			const start = this.startTipChoice.value
			const end = this.endTipChoice.value
			if (start.key !== defaultArrowTip.key || end.key !== defaultArrowTip.key) {
				command.options.push(
					(start.key !== defaultArrowTip.key ? start.tikz : "") +
						"-" +
						(end.key !== defaultArrowTip.key ? end.tikz : "")
				)
			}
		}
		command.coordinates = []
		command.connectors = []
		const anchors = this.anchors()
		anchors.forEach((anchor, i) => {
			command.coordinates.push(anchor)
			const hasNext = closed || i < anchors.length - 1
			if (hasNext) {
				const c1 = points[3 * i + 1]
				const c2 = points[3 * i + 2]
				command.connectors.push(`.. controls ${c1.toTikzString()} and ${c2.toTikzString()} ..`)
			}
		})
		if (closed) {
			command.coordinates.push("cycle")
		}
	}

	public requiredTikzLibraries(): string[] {
		return []
	}
}
