import * as SVG from "@svgdotjs/svg.js"
import {
	EnvironmentVariableController,
	AdjustDragHandler,
	BooleanProperty,
	buildTikzStringFromNodeCommand,
	CanvasController,
	ChoiceEntry,
	ChoiceProperty,
	CircuitComponent,
	ComponentSymbol,
	defaultFill,
	defaultStroke,
	EnumOption,
	GridSizeProperty,
	InfoProperty,
	MainController,
	NodeComponent,
	NodeSaveObject,
	PropertyCategories,
	SaveController,
	SectionHeaderProperty,
	SelectionController,
	SliderProperty,
	SnappingInfo,
	SnapPoint,
	SymbolLineWidth,
	SymbolOption,
	TikzNodeCommand,
	Variant,
	variantSymbol,
} from "../internal"
import { resizeSVG, roundTikz, selectedBoxWidth } from "../utils/selectionHelper"
import { createSizeProperties, SizeProperties } from "../utils/sizeProperties"
import { gridScales, gridSpacingPx, mainPins, maxDefaultSizeChange, roundScale } from "../utils/gridFit"

// TODO don't use <use> element as the component visualisation, but directly the symbol's children

type ShapeSizeSaveObject = { width?: number; height?: number; rightHeight?: number; lockAspectRatio?: boolean }

export type NodeSymbolSaveObject = NodeSaveObject & {
	id: string
	options?: string[]
	/** MOS transistors: how it is drawn, drawings of older versions only have the options arrowmos and emptycircle */
	transistorStyle?: TransistorStyle
	portSize?: ShapeSizeSaveObject
	blockSize?: ShapeSizeSaveObject
	pins?: Partial<Record<PinSide, number>>
	squarePins?: boolean
}

/**
 * the logic ports which can be resized via the circuitikz keys tripoles/<name>/width and tripoles/<name>/height
 */
/** the CircuiTikZ option which draws the arrow of a MOS transistor (instead of the circle at the gate of a PMOS) */
const arrowmosOption = "arrowmos"
const emptyCircleOption = "emptycircle"
const noCircleOption = "nocircle"

/**
 * how a MOS transistor is drawn: with an arrow or, for a PMOS, with a circle at the gate. "default" follows the transistor
 * setting of the drawing, the others overwrite it for a single transistor.
 */
type TransistorStyle = "default" | "arrow" | "emptyCircle" | "filledCircle" | "none"
const transistorStyleNames: Record<TransistorStyle, string> = {
	default: "Drawing default",
	arrow: "Arrow",
	emptyCircle: "Empty circle",
	filledCircle: "Filled circle",
	none: "No arrow",
}
const resizablePorts = ["european blank port", "european blank not port"]
const defaultPortWidth = 1.4
const defaultPortHeight = 0.65
/**
 * the size keys of logic ports are relative to 1.4cm (logic ports/scale=1)
 */
const portSizeUnit = new SVG.Number(1.4, "cm").convertToUnit("px").value
const portThickStroke = 1.06267
const portThinStroke = 0.53134
/**
 * the circuitikz geometry of the european logic ports (see \pgfcircdeclareeurologicport in pgfcirctripoles.tex)
 */
const portReserved = 0.6
const portOrigin = 0.8
const portInputs = 2

/**
 * the circuitikz muxdemux shape (without inset) with a configurable number of pins on each side. It is available as
 * the block with pins (a rectangle, Lh = Rh) and as the mux (a trapezoid with independent left and right height).
 */
type MuxdemuxKind = "pinBlock" | "mux"
const muxdemuxNames: Record<MuxdemuxKind, string> = { pinBlock: "muxdemux", mux: "mux" }
const pinSides = ["left", "right", "top", "bottom"] as const
type PinSide = (typeof pinSides)[number]
/**
 * the sizes are given like w, Lh and Rh in muxdemux def
 */
const muxdemuxDefaults: Record<
	MuxdemuxKind,
	{ width: number; height: number; rightHeight: number; pins: Record<PinSide, number> }
> = {
	pinBlock: { width: 4, height: 4, rightHeight: 4, pins: { left: 2, right: 2, top: 0, bottom: 0 } },
	mux: { width: 2, height: 4, rightHeight: 2, pins: { left: 4, right: 1, top: 0, bottom: 2 } },
}
/**
 * all muxdemux distances are relative to multipoles/muxdemux/base len (0.4) times 1.4cm
 */
const muxdemuxUnit = 0.4 * portSizeUnit
/**
 * multipoles/external pins width
 */
const muxdemuxLeadLength = 0.2 * portSizeUnit
/**
 * the muxdemux def key for the number of pins, the anchor name and the outward direction (y upwards) of each side
 */
const pinSideInfo: Record<PinSide, { key: string; anchor: string; direction: SVG.Point }> = {
	left: { key: "NL", anchor: "lpin", direction: new SVG.Point(-1, 0) },
	right: { key: "NR", anchor: "rpin", direction: new SVG.Point(1, 0) },
	top: { key: "NT", anchor: "tpin", direction: new SVG.Point(0, 1) },
	bottom: { key: "NB", anchor: "bpin", direction: new SVG.Point(0, -1) },
}

type ShapeKind = "port" | MuxdemuxKind

const scaledStroke = (width: number) => `calc(var(--line-scale, 1) * ${width}px)`

/**
 * a pin of a generated variant at the given symbol coordinates
 */
function shapeAnchor(name: string, point: SVG.Point, mid: SVG.Point) {
	const relative = point.sub(mid)
	return {
		name: name,
		x: new SVG.Number(relative.x, "px"),
		y: new SVG.Number(relative.y, "px"),
		point: relative,
		isDefault: false,
	}
}

/**
 * The class representing all node components which are based on static symbols from the symbol database, i.e. node circuitikz symbols
 */
export class NodeSymbolComponent extends SymbolLineWidth(NodeComponent) {
	private static jsonID = "node"
	static {
		CircuitComponent.jsonSaveMap.set(NodeSymbolComponent.jsonID, NodeSymbolComponent)
	}
	/**
	 * All the possible symbol variants for this node component.
	 */
	public referenceSymbol: ComponentSymbol

	protected optionProperties: Map<BooleanProperty, SymbolOption>
	protected optionEnumProperties: Map<ChoiceProperty<ChoiceEntry>, EnumOption>
	protected componentVariant: Variant

	protected scaleProperty: SliderProperty
	/** sizes at which all pins are on the grid (the free scale is the off-grid alternative) */
	protected gridSizeProperty: GridSizeProperty

	/**
	 * resizable ports (see resizablePorts), the block with pins and the mux are drawn here instead of taken from the symbol database
	 */
	private shapeKind: ShapeKind
	/**
	 * only available for generated shapes: the size in circuitikz units (see shapeUnit)
	 */
	private shapeSize: SizeProperties
	/**
	 * the symbol of generated shapes is drawn per instance
	 */
	private shapeSymbol: SVG.Symbol
	/**
	 * the direction of a handle is (±1, 0) for the width and (x, ±1) for the height: x is 0 for the height of the whole shape, -1 or 1 for the left or right height of the mux
	 */
	private shapeResizeHandles: { direction: SVG.Point; element: SVG.Element }[] = []
	/**
	 * only available for the muxdemux shapes: the number of pins on each side
	 */
	private pinCounts: Record<PinSide, SliderProperty>
	/**
	 * only available for the mux: the height of the right side (Rh), the height property is the left side (Lh)
	 */
	private muxRightHeight: SliderProperty
	/**
	 * only available for the mux: if the pins on the slanted sides stick out straight
	 */
	private muxSquarePins: BooleanProperty

	constructor(symbol: ComponentSymbol) {
		super()
		this.displayName = symbol.displayName
		this.referenceSymbol = symbol

		this.optionProperties = new Map()
		this.optionEnumProperties = new Map()

		this.scaleState = new SVG.Point(1, 1)
		this.scaleProperty = new SliderProperty(
			"Scale",
			0.1,
			10,
			0.01,
			new SVG.Number(1),
			true,
			undefined,
			"manipulation:scale"
		)
		this.scaleProperty.addChangeListener((ev) => {
			this.scaleState = new SVG.Point(
				Math.sign(this.scaleState.x) * ev.value.value,
				Math.sign(this.scaleState.y) * ev.value.value
			)
			this.update()
		})
		this.shapeKind =
			resizablePorts.includes(symbol.tikzName) ? "port"
			: symbol.tikzName == muxdemuxNames.pinBlock ? "pinBlock"
			: symbol.tikzName == muxdemuxNames.mux ? "mux"
			: undefined
		if (this.shapeKind) {
			// width and height replace the scale for generated shapes
			const [width, height] = this.defaultShapeSize()
			this.shapeSize =
				this.shapeKind == "port" ?
					createSizeProperties(
						width,
						height,
						"Relative to 1.4cm, as in circuitikz (the width includes the leads). Can also be changed with the handles on the port.",
						"manipulation:port",
						() => this.updateOptions()
					)
				: this.shapeKind == "pinBlock" ?
					createSizeProperties(
						width,
						height,
						"Relative to 0.56cm, as w and Lh of the circuitikz muxdemux (without the leads). Can also be changed with the handles on the block.",
						"manipulation:pinBlock",
						() => this.updateOptions(),
						{ max: 40 }
					)
				:	createSizeProperties(
						width,
						height,
						"Relative to 0.56cm, as w and Lh of the circuitikz muxdemux (without the leads). Can also be changed with the handles on the mux.",
						"manipulation:mux",
						() => this.updateOptions(),
						{ max: 40, heightLabel: "Left height", linked: [this.createMuxRightHeight()] }
					)
			this.properties.add(PropertyCategories.manipulation, this.shapeSize.width)
			this.properties.add(PropertyCategories.manipulation, this.shapeSize.height)
			if (this.muxRightHeight) {
				this.properties.add(PropertyCategories.manipulation, this.muxRightHeight)
			}
			this.properties.add(PropertyCategories.manipulation, this.shapeSize.lockAspectRatio)
		} else {
			this.gridSizeProperty = new GridSizeProperty(() => this.gridScales(), new SVG.Point(1, 1))
			this.gridSizeProperty.addChangeListener((ev) => this.applyGridSize(ev.value))
			this.properties.add(PropertyCategories.manipulation, this.gridSizeProperty)
			this.scaleProperty.label = "Free scale"
			this.properties.add(PropertyCategories.manipulation, this.scaleProperty)
		}

		// initialize UI for options handling
		if (symbol.possibleOptions.length > 0 || symbol.possibleEnumOptions.length > 0) {
			this.properties.add(
				PropertyCategories.options,
				new SectionHeaderProperty("Options", undefined, "options:header")
			)
			// the gate circle of a PMOS is one of the options "nocircle" and "emptycircle"
			const gateCircleOptions = symbol.possibleEnumOptions.find((enumOption) =>
				enumOption.options.some((option) => option.name == emptyCircleOption)
			)
			this.hasGateCircle = gateCircleOptions !== undefined
			if (symbol.possibleOptions.some((option) => option.name == arrowmosOption)) {
				// replaces the options arrowmos and emptycircle
				const styles: TransistorStyle[] =
					this.hasGateCircle ?
						["default", "arrow", "emptyCircle", "filledCircle"]
					:	["default", "arrow", "none"]
				const entries = styles.map((style) => ({ key: style, name: transistorStyleNames[style] }))
				this.transistorStyle = new ChoiceProperty("Style", entries, entries[0], undefined, "options:transistorStyle")
				this.transistorStyle.addChangeListener(() => this.updateOptions())
				this.properties.add(PropertyCategories.options, this.transistorStyle)
			}
			for (const option of symbol.possibleOptions) {
				if (this.transistorStyle && option.name == arrowmosOption) {
					continue
				}
				const property = new BooleanProperty(
					option.displayName ?? option.name,
					false,
					false,
					undefined,
					"options:option" + option.name
				)
				property.addChangeListener((ev) => {
					this.updateOptions()
				})
				this.optionProperties.set(property, option)
				this.properties.add(PropertyCategories.options, property)
			}
			for (const enumOption of symbol.possibleEnumOptions) {
				if (this.transistorStyle && enumOption === gateCircleOptions) {
					continue
				}
				let choices: ChoiceEntry[] = enumOption.selectNone ? [{ key: "-", name: "--default--" }] : []
				enumOption.options.forEach((option) => {
					choices.push({ key: option.name, name: option.displayName ?? option.name })
				})
				const property = new ChoiceProperty(
					enumOption.displayName,
					choices,
					choices[0],
					undefined,
					"options:enum_" + enumOption.displayName
				)

				property.addChangeListener((ev) => {
					this.updateOptions()
				})
				this.optionEnumProperties.set(property, enumOption)
				this.properties.add(PropertyCategories.options, property)
			}
		}

		if (this.isMuxdemux()) {
			this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Pins", undefined, "options:pins"))
			this.pinCounts = {} as Record<PinSide, SliderProperty>
			for (const side of pinSides) {
				const property = new SliderProperty(
					side[0].toUpperCase() + side.slice(1),
					0,
					16,
					1,
					new SVG.Number(this.muxdemuxDefaults().pins[side]),
					true,
					"Number of pins on the " + side + " side",
					"options:pins_" + side
				)
				property.addChangeListener((ev) => {
					this.updateOptions()
				})
				this.pinCounts[side] = property
				this.properties.add(PropertyCategories.options, property)
			}
			if (this.shapeKind == "mux") {
				this.muxSquarePins = new BooleanProperty(
					"Square pins",
					false,
					undefined,
					"The pins on the slanted top and bottom side stick out straight up/down to the same height (square pins=1)",
					"options:squarePins"
				)
				this.muxSquarePins.addChangeListener((ev) => {
					this.updateOptions()
				})
				this.properties.add(PropertyCategories.options, this.muxSquarePins)
			}
		}

		this.componentVariant = symbol.getVariant(this.optionsFromProperties())
		if (this.shapeKind) {
			this.shapeSymbol = CanvasController.instance.canvas.defs().symbol()
			this.componentVariant = this.shapeVariant(this.componentVariant)
		}
		this.size = new SVG.Point(this.componentVariant.viewBox.w, this.componentVariant.viewBox.h)
		this.defaultTextPosition = this.componentVariant.textPosition.point.add(this.componentVariant.mid)

		this.componentVisualization = CanvasController.instance.canvas.use(variantSymbol(this.componentVariant))
		this.componentVisualization.fill("none")
		this.componentVisualization.stroke(defaultStroke)
		this.componentVisualization.node.style.color = defaultStroke
		this.referencePosition = this.componentVariant.mid
		this.visualization.add(this.componentVisualization)
		this.dragElement = this.componentVisualization

		this.addInfo()

		this.createSnappingPoints()
		this.useDefaultGridSize()
	}

	/**
	 * only the main terminals align the symbol to the grid, the other pins still connect to other components
	 */
	private createSnappingPoints() {
		const main = mainPins(this.componentVariant.pins)
		this.snappingPoints = this.componentVariant.pins.map((pin) => {
			const snapPoint = new SnapPoint(this, pin.name, pin.point.add(this.componentVariant.mid))
			snapPoint.snapsToGrid = main.includes(pin)
			return snapPoint
		})
	}

	/**
	 * grid first: a new symbol gets the grid size closest to its normal size, so its pins are on the grid.
	 * Loading a drawing sets the saved scale afterwards.
	 */
	private useDefaultGridSize() {
		const scales = this.gridSizeProperty ? this.gridScales() : []
		if (scales.length == 0) {
			return
		}
		const deviation = (scale: SVG.Point) => Math.abs(Math.log(scale.x)) + Math.abs(Math.log(scale.y))
		const closest = scales.reduce((best, scale) => (deviation(scale) < deviation(best) ? scale : best))
		if (Math.max(Math.abs(Math.log(closest.x)), Math.abs(Math.log(closest.y))) > maxDefaultSizeChange) {
			return
		}
		this.scaleState = new SVG.Point(roundScale(closest.x), roundScale(closest.y))
		this.scaleProperty.updateValue(new SVG.Number(roundScale(closest.x)), true, false)
	}

	private isMuxdemux(): boolean {
		return this.shapeKind == "pinBlock" || this.shapeKind == "mux"
	}

	private muxdemuxDefaults() {
		return muxdemuxDefaults[this.shapeKind as MuxdemuxKind]
	}

	private createMuxRightHeight(): SliderProperty {
		this.muxRightHeight = new SliderProperty(
			"Right height",
			0.1,
			40,
			0.05,
			new SVG.Number(muxdemuxDefaults.mux.rightHeight),
			false,
			"Relative to 0.56cm, as Rh of the circuitikz muxdemux. Can also be changed with the handles on the right side of the mux.",
			"manipulation:mux:rightHeight"
		)
		this.muxRightHeight.addChangeListener((ev) => {
			this.updateOptions()
		})
		return this.muxRightHeight
	}

	private defaultShapeSize(): [number, number] {
		return this.shapeKind == "port" ?
				[defaultPortWidth, defaultPortHeight]
			:	[this.muxdemuxDefaults().width, this.muxdemuxDefaults().height]
	}

	/**
	 * the length in px the size properties of the generated shape are relative to
	 */
	private shapeUnit(): number {
		return this.shapeKind == "port" ? portSizeUnit : muxdemuxUnit
	}

	/**
	 * half width and half height of the generated shape in px (the right and up values in circuitikz)
	 */
	private shapeHalfSize(): SVG.Point {
		return new SVG.Point(
			(Math.max(this.shapeSize.width.value.value, 0.01) * this.shapeUnit()) / 2,
			(Math.max(this.shapeSize.height.value.value, 0.01) * this.shapeUnit()) / 2
		)
	}

	/**
	 * converts a point in circuitikz shape coordinates (origin in the center of the shape, y upwards) to symbol coordinates
	 */
	private shapeToSymbol(point: SVG.Point): SVG.Point {
		return this.shapeKind == "port" ? this.portShapeToSymbol(point) : this.muxdemuxShapeToSymbol(point)
	}

	/**
	 * (re)draws the symbol of the generated shape with the current size and returns the matching variant
	 * @param baseVariant the variant from the symbol database, which is used for everything not depending on the size
	 */
	private shapeVariant(baseVariant: Variant): Variant {
		return this.shapeKind == "port" ? this.portVariant(baseVariant) : this.muxdemuxVariant(baseVariant)
	}

	/**
	 * converts a point in circuitikz shape coordinates (origin in the center of the box, y upwards) to symbol coordinates
	 */
	private portShapeToSymbol(point: SVG.Point): SVG.Point {
		const half = this.shapeHalfSize()
		return new SVG.Point(point.x + half.x + portThinStroke / 2, -point.y + half.y + portThickStroke / 2)
	}

	private portVariant(baseVariant: Variant): Variant {
		const { x: right, y: up } = this.shapeHalfSize()
		const toSymbol = (x: number, y: number) => this.portShapeToSymbol(new SVG.Point(x, y))
		const step = (2 * up) / portInputs
		const inputY = (index: number) => up + step / 2 - index * step

		this.shapeSymbol.clear()
		const g = this.shapeSymbol.group().attr({ stroke: defaultStroke, "stroke-miterlimit": 10 })
		const boxCorner = toSymbol(-portReserved * right, up)
		// transparent area, such that the port can also be selected by clicking inside
		g.rect(2 * portReserved * right, 2 * up)
			.move(boxCorner.x, boxCorner.y)
			.fill("transparent")
			.stroke("none")
		const box = g
			.rect(2 * portReserved * right, 2 * up)
			.move(boxCorner.x, boxCorner.y)
			.fill("none")
			.attr("stroke-width", portThickStroke)
		box.node.style.strokeWidth = scaledStroke(portThickStroke)

		const leads: [SVG.Point, SVG.Point][] = []
		for (let index = 1; index <= portInputs; index++) {
			leads.push([toSymbol(-right, inputY(index)), toSymbol(-portReserved * right, inputY(index))])
		}
		leads.push([toSymbol(right, 0), toSymbol(portReserved * right, 0)])
		if (this.referenceSymbol.tikzName.includes(" not ")) {
			// the small triangle marking the inverted output
			leads.push([toSymbol(0.9 * right, 0), toSymbol(portReserved * right, 0.3 * up)])
		}
		for (const [start, end] of leads) {
			const line = g.line(start.x, start.y, end.x, end.y).fill("none").attr("stroke-width", portThinStroke)
			line.node.style.strokeWidth = scaledStroke(portThinStroke)
		}

		const mid = toSymbol(portOrigin * right, 0)
		const anchor = (name: string, point: SVG.Point) => shapeAnchor(name, point, mid)
		const pins = [anchor("out", toSymbol(right, 0))]
		for (let index = 1; index <= portInputs; index++) {
			pins.push(anchor("in " + index, toSymbol(-right, inputY(index))))
		}

		return {
			...baseVariant,
			mid: mid,
			viewBox: new SVG.Box(0, 0, 2 * right + portThinStroke, 2 * up + portThickStroke),
			symbol: this.shapeSymbol,
			symbolArrowEnd: undefined,
			pins: pins,
			textPosition: { ...anchor("text", toSymbol(0, 0)), isDefault: baseVariant.textPosition?.isDefault ?? false },
			maxStroke: portThickStroke,
		}
	}

	private pinCount(side: PinSide): number {
		return Math.max(0, Math.round(this.pinCounts[side].value.value))
	}

	/**
	 * half the height of the right side in px (the same as the left side for the block with pins)
	 */
	private muxdemuxRightHalfHeight(): number {
		if (this.shapeKind == "mux") {
			return (Math.max(this.muxRightHeight.value.value, 0.01) * muxdemuxUnit) / 2
		}
		return this.shapeHalfSize().y
	}

	/**
	 * the y coordinate of the top side of the box at x (the bottom side is the mirrored top side)
	 */
	private muxdemuxTopAt(x: number): number {
		const half = this.shapeHalfSize()
		return half.y + ((x + half.x) / (2 * half.x)) * (this.muxdemuxRightHalfHeight() - half.y)
	}

	/**
	 * the lead of a pin in circuitikz shape coordinates, see the muxdemux shape in pgfcircmultipoles.tex
	 * @param index the pin number, starting at 1 (top to bottom on the left and right side, left to right on the top and bottom side)
	 * @returns the start of the lead on the box and its end (the anchor)
	 */
	private muxdemuxLead(side: PinSide, index: number): [SVG.Point, SVG.Point] {
		const half = this.shapeHalfSize()
		const direction = pinSideInfo[side].direction
		const count = this.pinCount(side)
		if (direction.x) {
			const sideHalfHeight = direction.x < 0 ? half.y : this.muxdemuxRightHalfHeight()
			const start = new SVG.Point(direction.x * half.x, sideHalfHeight - ((index - 0.5) * 2 * sideHalfHeight) / count)
			return [start, start.add(direction.mul(muxdemuxLeadLength))]
		}
		const x = -half.x + ((index - 0.5) * 2 * half.x) / count
		const start = new SVG.Point(x, direction.y * this.muxdemuxTopAt(x))
		if (this.muxSquarePins?.value) {
			const outer = Math.max(half.y, this.muxdemuxRightHalfHeight()) + muxdemuxLeadLength
			return [start, new SVG.Point(x, direction.y * outer)]
		}
		return [start, start.add(direction.mul(muxdemuxLeadLength))]
	}

	/**
	 * how far the box and the leads extend from the center in each direction in px
	 */
	private muxdemuxExtents(): Record<PinSide, number> {
		const half = this.shapeHalfSize()
		const boxHalfHeight = Math.max(half.y, this.muxdemuxRightHalfHeight())
		const extents = { left: half.x, right: half.x, top: boxHalfHeight, bottom: boxHalfHeight }
		for (const side of pinSides) {
			for (let index = 1; index <= this.pinCount(side); index++) {
				const end = this.muxdemuxLead(side, index)[1]
				extents.left = Math.max(extents.left, -end.x)
				extents.right = Math.max(extents.right, end.x)
				extents.top = Math.max(extents.top, end.y)
				extents.bottom = Math.max(extents.bottom, -end.y)
			}
		}
		return extents
	}

	private muxdemuxShapeToSymbol(point: SVG.Point): SVG.Point {
		const extents = this.muxdemuxExtents()
		return new SVG.Point(point.x + extents.left + portThickStroke / 2, -point.y + extents.top + portThickStroke / 2)
	}

	/**
	 * (re)draws the symbol of the block with pins or the mux with the current size and pins and returns the matching variant
	 */
	private muxdemuxVariant(baseVariant: Variant): Variant {
		const half = this.shapeHalfSize()
		const rightHalfHeight = this.muxdemuxRightHalfHeight()
		const toSymbol = (point: SVG.Point) => this.muxdemuxShapeToSymbol(point)

		this.shapeSymbol.clear()
		const g = this.shapeSymbol.group().attr({ stroke: defaultStroke, "stroke-miterlimit": 10 })
		const corners = [
			new SVG.Point(-half.x, half.y),
			new SVG.Point(half.x, rightHalfHeight),
			new SVG.Point(half.x, -rightHalfHeight),
			new SVG.Point(-half.x, -half.y),
		]
			.map(toSymbol)
			.map((point) => [point.x, point.y] as [number, number])
		// transparent area, such that the shape can also be selected by clicking inside
		g.polygon(corners).fill("transparent").stroke("none")
		const box = g.polygon(corners).fill("none").attr("stroke-width", portThickStroke)
		box.node.style.strokeWidth = scaledStroke(portThickStroke)

		const mid = toSymbol(new SVG.Point(0, 0))
		const pins: Variant["pins"] = []
		for (const side of pinSides) {
			for (let index = 1; index <= this.pinCount(side); index++) {
				const [start, end] = this.muxdemuxLead(side, index).map(toSymbol)
				const line = g.line(start.x, start.y, end.x, end.y).fill("none").attr("stroke-width", portThinStroke)
				line.node.style.strokeWidth = scaledStroke(portThinStroke)
				pins.push(shapeAnchor(pinSideInfo[side].anchor + " " + index, end, mid))
			}
		}

		const extents = this.muxdemuxExtents()
		return {
			...baseVariant,
			mid: mid,
			viewBox: new SVG.Box(
				0,
				0,
				extents.left + extents.right + portThickStroke,
				extents.top + extents.bottom + portThickStroke
			),
			symbol: this.shapeSymbol,
			symbolArrowEnd: undefined,
			pins: pins,
			textPosition: { ...shapeAnchor("text", mid, mid), isDefault: baseVariant.textPosition?.isDefault ?? false },
			maxStroke: portThickStroke,
		}
	}

	public viewSelected(show: boolean): void {
		super.viewSelected(show)
		this.resizable(this.isSelected && show && SelectionController.instance.currentlySelectedComponents.length == 1)
	}

	public resizable(resize: boolean): void {
		if (!this.shapeSymbol || resize == this.isResizing) {
			return
		}
		this.isResizing = resize
		if (resize) {
			const directions = [new SVG.Point(1, 0), new SVG.Point(-1, 0)]
			for (const x of this.shapeKind == "mux" ? [-1, 1] : [0]) {
				directions.push(new SVG.Point(x, 1), new SVG.Point(x, -1))
			}
			for (const direction of directions) {
				const element = resizeSVG()
				element.node.style.cursor = direction.y ? "ns-resize" : "ew-resize"
				const currentSize = () => [size.width, size.height, this.muxRightHeight].map((property) => property?.value.value)
				let startSize: number[]
				// the opposite side of the port stays in place when changing the width
				let fixedPoint: SVG.Point
				const size = this.shapeSize
				const rounded = (value: number, min: number) => new SVG.Number(Math.max(min, Math.round(value * 1000) / 1000))
				AdjustDragHandler.snapDrag(this, element, true, {
					dragStart: (pos) => {
						startSize = currentSize()
						fixedPoint = this.shapeHandlePoint(direction.mul(-1))
					},
					dragMove: (pos) => {
						const inverse = this.getTransformMatrix().inverse()
						const local = pos.transform(inverse)
						// all other sizes change symmetrically around the center of the shape
						const center = this.shapeToSymbol(new SVG.Point(0, 0))
						const height = rounded((2 * Math.abs(local.y - center.y)) / this.shapeUnit(), 0.1)
						if (!direction.y && this.shapeKind == "port") {
							const width = Math.abs(local.x - fixedPoint.transform(inverse).x) / this.shapeUnit()
							size.width.updateValue(rounded(width, 0.2), true)
							this.moveRel(fixedPoint.sub(this.shapeHandlePoint(direction.mul(-1))))
						} else if (!direction.y) {
							size.width.updateValue(rounded((2 * Math.abs(local.x - center.x)) / this.shapeUnit(), 0.1), true)
						} else if (direction.x > 0) {
							this.muxRightHeight.updateValue(height, true)
						} else {
							size.height.updateValue(height, true)
						}
					},
					dragEnd: () => {
						return currentSize().some((value, index) => value != startSize[index])
					},
				})
				this.shapeResizeHandles.push({ direction: direction, element: element })
			}
			this.updateShapeResizeHandles()
		} else {
			for (const handle of this.shapeResizeHandles) {
				AdjustDragHandler.snapDrag(this, handle.element, false)
				handle.element.remove()
			}
			this.shapeResizeHandles = []
		}
	}

	/**
	 * the position of a resize handle in world coordinates: the middle of the sides of the box (the corners for the left and right height of the mux), except for the width of ports, which is changed at the ends of the leads
	 */
	private shapeHandlePoint(direction: SVG.Point): SVG.Point {
		const half = this.shapeHalfSize()
		const halfHeight = direction.x > 0 && direction.y && this.isMuxdemux() ? this.muxdemuxRightHalfHeight() : half.y
		return this.shapeToSymbol(new SVG.Point(direction.x * half.x, direction.y * halfHeight)).transform(
			this.getTransformMatrix()
		)
	}

	private updateShapeResizeHandles() {
		for (const handle of this.shapeResizeHandles) {
			const point = this.shapeHandlePoint(handle.direction)
			handle.element.center(point.x, point.y)
		}
	}

	public remove(): void {
		super.remove()
		this.resizable(false)
		this.shapeSymbol?.remove()
	}

	/** MOS transistors: the style which overwrites the drawing default */
	private transistorStyle: ChoiceProperty<ChoiceEntry> | undefined
	/** the symbol has a circle at the gate (PMOS) */
	private hasGateCircle = false
	/** the style the current variant was chosen with, to notice when the setting of the drawing changes it */
	private appliedStyle: TransistorStyle | undefined

	/**
	 * how a MOS transistor is drawn, with the transistor setting of the drawing for the default style
	 */
	private resolvedStyle(): TransistorStyle | undefined {
		if (!this.transistorStyle) {
			return undefined
		}
		const style = this.transistorStyle.value.key as TransistorStyle
		if (style != "default") {
			return style
		}
		if (EnvironmentVariableController.instance.getGlobalSettings().transistorArrows == "end") {
			return "arrow"
		}
		return this.hasGateCircle ? "emptyCircle" : "none"
	}

	protected optionsFromProperties(): SymbolOption[] {
		const selectedOptions: SymbolOption[] = []
		this.appliedStyle = this.resolvedStyle()
		// an arrow replaces the circle at the gate of a PMOS
		const styleOptions = {
			arrow: this.hasGateCircle ? [arrowmosOption, noCircleOption] : [arrowmosOption],
			emptyCircle: [emptyCircleOption],
		}[this.appliedStyle as string]
		const allOptions = [
			...this.referenceSymbol.possibleOptions,
			...this.referenceSymbol.possibleEnumOptions.flatMap((enumOption) => enumOption.options),
		]
		for (const name of styleOptions ?? []) {
			selectedOptions.push(allOptions.find((option) => option.name == name))
		}
		this.optionProperties.forEach((option, property) => {
			if (property.value && !selectedOptions.includes(option)) {
				selectedOptions.push(option)
			}
		})
		this.optionEnumProperties.forEach((option, property) => {
			if (property.value.key != "-") {
				selectedOptions.push(
					option.options.find((o) => {
						return o.name == property.value.key
					})
				)
			}
		})
		return selectedOptions
	}

	/**
	 * the style for a transistor of a drawing without styles (older versions), which keeps its look
	 */
	private styleFromOptions(options: string[]): TransistorStyle {
		const names = options.map((option) => option.toLowerCase().replaceAll(" ", ""))
		if (names.includes(arrowmosOption)) {
			return "arrow"
		}
		if (names.includes(emptyCircleOption)) {
			return "emptyCircle"
		}
		return this.hasGateCircle ? "filledCircle" : "none"
	}

	protected addInfo() {
		this.properties.add(PropertyCategories.info, new SectionHeaderProperty("Info"))
		// the tikz id of the component. e.g. "nmos" in "\node[nmos] at (0,0){};"
		this.properties.add(PropertyCategories.info, new InfoProperty("ID", this.referenceSymbol.tikzName))
	}

	protected setPropertiesFromOptions(options: SymbolOption[]) {
		this.optionProperties.forEach((value, property) => {
			if (options.find((op) => op.name == value.name)) {
				property.value = true
			} else {
				property.value = false
			}
		})
		this.optionEnumProperties.forEach((enumOption, property) => {
			let foundOption = false
			for (const option of enumOption.options) {
				if (options.find((op) => op.name == option.name)) {
					foundOption = true
					property.value = property.entries.find((entry) => entry.key == option.name)
					break
				}
			}
			if (!foundOption) {
				property.value = property.entries[0]
			}
		})
		this.updateOptions()
	}

	protected updateOptions() {
		this.componentVariant = this.referenceSymbol.getVariant(this.optionsFromProperties())
		if (this.shapeSymbol) {
			this.componentVariant = this.shapeVariant(this.componentVariant)
		}
		this.referencePosition = this.componentVariant.mid
		this.componentVisualization.node.setAttribute("href", "#" + variantSymbol(this.componentVariant).id())
		this.size = new SVG.Point(this.componentVariant.viewBox.w, this.componentVariant.viewBox.h)
		this.defaultTextPosition = this.componentVariant.textPosition.point.add(this.componentVariant.mid)

		this.createSnappingPoints()
		this.update()
	}

	public getSnappingInfo(): SnappingInfo {
		const center = new SnapPoint(this, "center", this.componentVariant.mid)
		// the center of a symbol with terminals is often between two grid points
		center.snapsToGrid = this.snappingPoints.length < 2
		return {
			trackedSnappingPoints: this.snappingPoints,
			additionalSnappingPoints: [center],
		}
	}

	/** the grid sizes per variant of the symbol (and grid spacing), they are needed after every change */
	private static gridScalesCache = new WeakMap<Variant, { grid: number; scales: SVG.Point[] }>()

	private gridScales(): SVG.Point[] {
		const grid = gridSpacingPx()
		let cached = NodeSymbolComponent.gridScalesCache.get(this.componentVariant)
		if (cached?.grid !== grid) {
			cached = { grid, scales: gridScales(mainPins(this.componentVariant.pins).map((pin) => pin.point), grid) }
			NodeSymbolComponent.gridScalesCache.set(this.componentVariant, cached)
		}
		return cached.scales
	}

	/**
	 * scales the symbol to a grid size and moves it so its pins are on the grid
	 */
	private applyGridSize(scale: SVG.Point) {
		this.scaleState = new SVG.Point(
			Math.sign(this.scaleState.x) * roundScale(scale.x),
			Math.sign(this.scaleState.y) * roundScale(scale.y)
		)
		this.scaleProperty.updateValue(new SVG.Number(roundScale(scale.x)), true, false)
		this.update()
		const pins = this.componentVariant.pins
		const pin = this.snappingPoints[pins.indexOf(mainPins(pins)[0])]
		if (pin) {
			const grid = gridSpacingPx()
			const onGrid = new SVG.Point(Math.round(pin.x / grid) * grid, Math.round(pin.y / grid) * grid)
			this.moveRel(onGrid.sub(pin))
		}
	}

	public update() {
		// changing the transistor setting of the drawing also changes the transistors which are already placed
		if (this.componentVariant && this.resolvedStyle() != this.appliedStyle) {
			this.updateOptions()
			return
		}
		// the size shown in the properties window follows every change of the scale and options (free scale, flipping, loading)
		if (this.gridSizeProperty) {
			this.gridSizeProperty.value = new SVG.Point(Math.abs(this.scaleState.x), Math.abs(this.scaleState.y))
		}
		// the symbol can change with the global transistor arrow position
		const symbolHref = "#" + variantSymbol(this.componentVariant).id()
		if (this.componentVisualization.node.getAttribute("href") != symbolHref) {
			this.componentVisualization.node.setAttribute("href", symbolHref)
		}

		let m = this.getTransformMatrix()
		this.componentVisualization.transform(m)
		this._bbox = this.componentVariant.viewBox.transform(m)

		this.updatePositionedLabel()

		this.recalculateSelectionVisuals()
		this.recalculateSnappingPoints()
		this.updateShapeResizeHandles()
	}

	protected recalculateSelectionVisuals(): void {
		if (this.selectionElement) {
			// use the saved position instead of the bounding box (bbox position fails in safari)
			let bbox = this.componentVariant.viewBox
			let maxStroke = this.componentVariant.maxStroke

			this.selectionElement
				.size(bbox.w + maxStroke + selectedBoxWidth, bbox.h + maxStroke + selectedBoxWidth)
				.transform(
					this.getTransformMatrix().multiply(
						new SVG.Matrix({
							translate: [
								bbox.x - (selectedBoxWidth + maxStroke) / 2,
								bbox.y - (selectedBoxWidth + maxStroke) / 2,
							],
						})
					)
				)
		}
	}

	public toJson(): NodeSymbolSaveObject {
		let data = super.toJson() as NodeSymbolSaveObject
		data.type = NodeSymbolComponent.jsonID
		data.id = this.referenceSymbol.tikzName

		if (this.componentVariant.options.length > 0) {
			data.options = this.componentVariant.options.map((option) => option.displayName ?? option.name)
		}
		if (this.transistorStyle) {
			data.transistorStyle = this.transistorStyle.value.key as TransistorStyle
		}
		if (this.name.value) {
			data.name = this.name.value
		}

		if (this.shapeKind) {
			const [defaultWidth, defaultHeight] = this.defaultShapeSize()
			const size: ShapeSizeSaveObject = {}
			if (this.shapeSize.width.value.value != defaultWidth) {
				size.width = this.shapeSize.width.value.value
			}
			if (this.shapeSize.height.value.value != defaultHeight) {
				size.height = this.shapeSize.height.value.value
			}
			if (this.muxRightHeight && this.muxRightHeight.value.value != muxdemuxDefaults.mux.rightHeight) {
				size.rightHeight = this.muxRightHeight.value.value
			}
			if (this.shapeSize.lockAspectRatio.value) {
				size.lockAspectRatio = true
			}
			if (Object.keys(size).length > 0) {
				data[this.shapeKind == "port" ? "portSize" : "blockSize"] = size
			}
		}
		if (this.pinCounts) {
			const pins: NodeSymbolSaveObject["pins"] = {}
			for (const side of pinSides) {
				if (this.pinCount(side) != this.muxdemuxDefaults().pins[side]) {
					pins[side] = this.pinCount(side)
				}
			}
			if (Object.keys(pins).length > 0) {
				data.pins = pins
			}
		}
		if (this.muxSquarePins?.value) {
			data.squarePins = true
		}

		return data
	}

	public toTikzString(): string {
		let command: TikzNodeCommand = {
			// both muxdemux shapes are the same circuitikz shape
			options: [this.isMuxdemux() ? "muxdemux" : this.referenceSymbol.tikzName],
			additionalNodes: [],
		}
		this.buildTikzCommand(command)
		return buildTikzStringFromNodeCommand(command)
	}

	protected buildTikzCommand(command: TikzNodeCommand): void {
		command.options.push(...this.referenceSymbol.optionsToStringArray(this.optionsFromProperties()))
		command.options.push(...this.lineWidthTikzOptions())
		if (this.shapeKind == "port") {
			const key = "/tikz/circuitikz/tripoles/" + this.referenceSymbol.tikzName
			if (this.shapeSize.width.value.value != defaultPortWidth) {
				command.options.push(key + "/width=" + roundTikz(this.shapeSize.width.value.value))
			}
			if (this.shapeSize.height.value.value != defaultPortHeight) {
				command.options.push(key + "/height=" + roundTikz(this.shapeSize.height.value.value))
			}
		} else if (this.isMuxdemux()) {
			// all values are given, since they differ from the muxdemux defaults
			const definition = [
				"Lh=" + roundTikz(this.shapeSize.height.value.value),
				"Rh=" + roundTikz(this.muxdemuxRightHalfHeight() * 2 / muxdemuxUnit),
				"w=" + roundTikz(this.shapeSize.width.value.value),
			]
			for (const side of pinSides) {
				definition.push(pinSideInfo[side].key + "=" + this.pinCount(side))
			}
			if (this.muxSquarePins?.value) {
				definition.push("square pins=1")
			}
			command.options.push("muxdemux def={" + definition.join(", ") + "}")
		}
		super.buildTikzCommand(command)
	}

	protected applyJson(saveObject: NodeSymbolSaveObject): void {
		super.applyJson(saveObject)
		if (this.shapeKind) {
			const [defaultWidth, defaultHeight] = this.defaultShapeSize()
			const size = this.shapeKind == "port" ? saveObject.portSize : saveObject.blockSize
			this.shapeSize.width.value = new SVG.Number(size?.width ?? defaultWidth)
			this.shapeSize.height.value = new SVG.Number(size?.height ?? defaultHeight)
			this.shapeSize.lockAspectRatio.value = size?.lockAspectRatio ?? false
			if (this.muxRightHeight) {
				this.muxRightHeight.value = new SVG.Number(size?.rightHeight ?? muxdemuxDefaults.mux.rightHeight)
			}
		}
		if (this.pinCounts) {
			for (const side of pinSides) {
				this.pinCounts[side].value = new SVG.Number(saveObject.pins?.[side] ?? this.muxdemuxDefaults().pins[side])
			}
		}
		if (this.muxSquarePins) {
			this.muxSquarePins.value = saveObject.squarePins ?? false
		}
		let options = saveObject.options ?? []
		if (this.transistorStyle) {
			this.transistorStyle.value = this.transistorStyle.entries.find(
				(entry) => entry.key == (saveObject.transistorStyle ?? this.styleFromOptions(options))
			)
		}
		this.setPropertiesFromOptions(this.referenceSymbol.getOptionsFromOptionNames(options))
		this.scaleProperty.value = new SVG.Number(Math.abs(this.scaleState.x))
		if (this.shapeKind && (Math.abs(this.scaleState.x) != 1 || Math.abs(this.scaleState.y) != 1)) {
			// older saves could scale ports: convert to the equivalent size
			const round = (value: number) => new SVG.Number(Math.round(value * 1000) / 1000)
			this.shapeSize.width.value = round(this.shapeSize.width.value.value * Math.abs(this.scaleState.x))
			this.shapeSize.height.value = round(this.shapeSize.height.value.value * Math.abs(this.scaleState.y))
			this.scaleState = new SVG.Point(Math.sign(this.scaleState.x), Math.sign(this.scaleState.y))
			this.scaleProperty.value = new SVG.Number(1)
			this.updateOptions()
		}
		this.update()
		this.updateTheme()
	}

	public static fromJson(saveObject: NodeSymbolSaveObject): NodeSymbolComponent {
		let symbol: ComponentSymbol

		if (SaveController.instance.currentlyLoadedSaveVersion != "") {
			symbol = MainController.instance.symbols.find((symbol) => symbol.tikzName == saveObject.id)
		} else {
			let idParts = saveObject.id.split("_")
			symbol = MainController.instance.symbols.find(
				(symbol) => symbol.tikzName == idParts[1].replaceAll("-", " ")
			)
			saveObject.options = idParts.slice(2)
		}
		if (symbol) {
			let nodeComponent: NodeSymbolComponent = new NodeSymbolComponent(symbol)
			return nodeComponent
		} else {
			console.error("no node symbol found for saveObject: " + JSON.stringify(saveObject))
			return null
		}
	}

	public copyForPlacement(): NodeSymbolComponent {
		let newComponent = new NodeSymbolComponent(this.referenceSymbol)
		newComponent.rotationDeg = this.rotationDeg
		newComponent.scaleState = new SVG.Point(this.scaleState)
		return newComponent
	}
}
