import * as SVG from "@svgdotjs/svg.js"
import {
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

// TODO don't use <use> element as the component visualisation, but directly the symbol's children

export type NodeSymbolSaveObject = NodeSaveObject & {
	id: string
	options?: string[]
	portSize?: { width?: number; height?: number; lockAspectRatio?: boolean }
}

/**
 * the logic ports which can be resized via the circuitikz keys tripoles/<name>/width and tripoles/<name>/height
 */
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

	/**
	 * only available for resizable ports (see resizablePorts): the size in units of 1.4cm, like circuitikz
	 */
	private portSize: SizeProperties
	/**
	 * the symbol of resizable ports is generated per instance
	 */
	private portSymbol: SVG.Symbol
	private portResizeHandles: { direction: SVG.Point; element: SVG.Element }[] = []

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
		if (resizablePorts.includes(symbol.tikzName)) {
			// width and height replace the scale for resizable ports
			this.portSize = createSizeProperties(
				defaultPortWidth,
				defaultPortHeight,
				"Relative to 1.4cm, as in circuitikz (the width includes the leads). Can also be changed with the handles on the port.",
				"manipulation:port",
				() => this.updateOptions()
			)
			this.properties.add(PropertyCategories.manipulation, this.portSize.width)
			this.properties.add(PropertyCategories.manipulation, this.portSize.height)
			this.properties.add(PropertyCategories.manipulation, this.portSize.lockAspectRatio)
		} else {
			this.properties.add(PropertyCategories.manipulation, this.scaleProperty)
		}

		// initialize UI for options handling
		if (symbol.possibleOptions.length > 0 || symbol.possibleEnumOptions.length > 0) {
			this.properties.add(
				PropertyCategories.options,
				new SectionHeaderProperty("Options", undefined, "options:header")
			)
			for (const option of symbol.possibleOptions) {
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

		this.componentVariant = symbol.getVariant(this.optionsFromProperties())
		if (resizablePorts.includes(symbol.tikzName)) {
			this.initPortSize()
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

		this.snappingPoints = this.componentVariant.pins.map(
			(pin) => new SnapPoint(this, pin.name, pin.point.add(this.componentVariant.mid))
		)
	}

	private initPortSize() {
		this.portSymbol = CanvasController.instance.canvas.defs().symbol()
		this.componentVariant = this.portVariant(this.componentVariant)
	}

	/**
	 * half width and half height of the port in px (the right and up values in circuitikz)
	 */
	private portHalfSize(): SVG.Point {
		return new SVG.Point(
			(Math.max(this.portSize.width.value.value, 0.01) * portSizeUnit) / 2,
			(Math.max(this.portSize.height.value.value, 0.01) * portSizeUnit) / 2
		)
	}

	/**
	 * converts a point in circuitikz shape coordinates (origin in the center of the box, y upwards) to symbol coordinates
	 */
	private portShapeToSymbol(point: SVG.Point): SVG.Point {
		const half = this.portHalfSize()
		return new SVG.Point(point.x + half.x + portThinStroke / 2, -point.y + half.y + portThickStroke / 2)
	}

	/**
	 * (re)draws the symbol of a resizable port with the current size and returns the matching variant
	 * @param baseVariant the variant from the symbol database, which is used for everything not depending on the size
	 */
	private portVariant(baseVariant: Variant): Variant {
		const { x: right, y: up } = this.portHalfSize()
		const toSymbol = (x: number, y: number) => this.portShapeToSymbol(new SVG.Point(x, y))
		const scaledStroke = (width: number) => `calc(var(--line-scale, 1) * ${width}px)`
		const step = (2 * up) / portInputs
		const inputY = (index: number) => up + step / 2 - index * step

		this.portSymbol.clear()
		const g = this.portSymbol.group().attr({ stroke: defaultStroke, "stroke-miterlimit": 10 })
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
		const anchor = (name: string, point: SVG.Point) => {
			const relative = point.sub(mid)
			return {
				name: name,
				x: new SVG.Number(relative.x, "px"),
				y: new SVG.Number(relative.y, "px"),
				point: relative,
				isDefault: false,
			}
		}
		const pins = [anchor("out", toSymbol(right, 0))]
		for (let index = 1; index <= portInputs; index++) {
			pins.push(anchor("in " + index, toSymbol(-right, inputY(index))))
		}

		return {
			...baseVariant,
			mid: mid,
			viewBox: new SVG.Box(0, 0, 2 * right + portThinStroke, 2 * up + portThickStroke),
			symbol: this.portSymbol,
			symbolArrowEnd: undefined,
			pins: pins,
			textPosition: { ...anchor("text", toSymbol(0, 0)), isDefault: baseVariant.textPosition?.isDefault ?? false },
			maxStroke: portThickStroke,
		}
	}

	public viewSelected(show: boolean): void {
		super.viewSelected(show)
		this.resizable(this.isSelected && show && SelectionController.instance.currentlySelectedComponents.length == 1)
	}

	public resizable(resize: boolean): void {
		if (!this.portSymbol || resize == this.isResizing) {
			return
		}
		this.isResizing = resize
		if (resize) {
			const directions = [new SVG.Point(1, 0), new SVG.Point(-1, 0), new SVG.Point(0, 1), new SVG.Point(0, -1)]
			for (const direction of directions) {
				const element = resizeSVG()
				element.node.style.cursor = direction.x ? "ew-resize" : "ns-resize"
				let startSize: [number, number]
				// the opposite side of the port stays in place when changing the width
				let fixedPoint: SVG.Point
				AdjustDragHandler.snapDrag(this, element, true, {
					dragStart: (pos) => {
						startSize = [this.portSize.width.value.value, this.portSize.height.value.value]
						fixedPoint = this.portHandlePoint(direction.mul(-1))
					},
					dragMove: (pos) => {
						const inverse = this.getTransformMatrix().inverse()
						const local = pos.transform(inverse)
						if (direction.x) {
							const width = Math.abs(local.x - fixedPoint.transform(inverse).x) / portSizeUnit
							this.portSize.width.updateValue(new SVG.Number(Math.max(0.2, Math.round(width * 1000) / 1000)), true)
							this.moveRel(fixedPoint.sub(this.portHandlePoint(direction.mul(-1))))
						} else {
							const center = this.portShapeToSymbol(new SVG.Point(0, 0))
							const height = (2 * Math.abs(local.y - center.y)) / portSizeUnit
							this.portSize.height.updateValue(
								new SVG.Number(Math.max(0.1, Math.round(height * 1000) / 1000)),
								true
							)
						}
					},
					dragEnd: () => {
						return startSize[0] != this.portSize.width.value.value || startSize[1] != this.portSize.height.value.value
					},
				})
				this.portResizeHandles.push({ direction: direction, element: element })
			}
			this.updatePortResizeHandles()
		} else {
			for (const handle of this.portResizeHandles) {
				AdjustDragHandler.snapDrag(this, handle.element, false)
				handle.element.remove()
			}
			this.portResizeHandles = []
		}
	}

	/**
	 * the position of a resize handle in world coordinates: the ends of the leads for the width, the middle of the top/bottom side of the box for the height
	 */
	private portHandlePoint(direction: SVG.Point): SVG.Point {
		const half = this.portHalfSize()
		return this.portShapeToSymbol(new SVG.Point(direction.x * half.x, direction.y * half.y)).transform(
			this.getTransformMatrix()
		)
	}

	private updatePortResizeHandles() {
		for (const handle of this.portResizeHandles) {
			const point = this.portHandlePoint(handle.direction)
			handle.element.center(point.x, point.y)
		}
	}

	public remove(): void {
		super.remove()
		this.resizable(false)
		this.portSymbol?.remove()
	}

	protected optionsFromProperties(): SymbolOption[] {
		const selectedOptions: SymbolOption[] = []
		this.optionProperties.forEach((option, property) => {
			if (property.value) {
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
		if (this.portSymbol) {
			this.componentVariant = this.portVariant(this.componentVariant)
		}
		this.referencePosition = this.componentVariant.mid
		this.componentVisualization.node.setAttribute("href", "#" + variantSymbol(this.componentVariant).id())
		this.size = new SVG.Point(this.componentVariant.viewBox.w, this.componentVariant.viewBox.h)
		this.defaultTextPosition = this.componentVariant.textPosition.point.add(this.componentVariant.mid)

		this.snappingPoints = this.componentVariant.pins.map(
			(pin) => new SnapPoint(this, pin.name, pin.point.add(this.componentVariant.mid))
		)
		this.update()
	}

	public getSnappingInfo(): SnappingInfo {
		return {
			trackedSnappingPoints: this.snappingPoints,
			additionalSnappingPoints: [new SnapPoint(this, "center", this.componentVariant.mid)],
		}
	}

	public update() {
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
		this.updatePortResizeHandles()
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
		if (this.name.value) {
			data.name = this.name.value
		}

		if (this.portSymbol) {
			const portSize: NodeSymbolSaveObject["portSize"] = {}
			if (this.portSize.width.value.value != defaultPortWidth) {
				portSize.width = this.portSize.width.value.value
			}
			if (this.portSize.height.value.value != defaultPortHeight) {
				portSize.height = this.portSize.height.value.value
			}
			if (this.portSize.lockAspectRatio.value) {
				portSize.lockAspectRatio = true
			}
			if (Object.keys(portSize).length > 0) {
				data.portSize = portSize
			}
		}

		return data
	}

	public toTikzString(): string {
		let command: TikzNodeCommand = {
			options: [this.referenceSymbol.tikzName],
			additionalNodes: [],
		}
		this.buildTikzCommand(command)
		return buildTikzStringFromNodeCommand(command)
	}

	protected buildTikzCommand(command: TikzNodeCommand): void {
		command.options.push(...this.referenceSymbol.optionsToStringArray(this.optionsFromProperties()))
		command.options.push(...this.lineWidthTikzOptions())
		if (this.portSymbol) {
			const key = "/tikz/circuitikz/tripoles/" + this.referenceSymbol.tikzName
			if (this.portSize.width.value.value != defaultPortWidth) {
				command.options.push(key + "/width=" + roundTikz(this.portSize.width.value.value))
			}
			if (this.portSize.height.value.value != defaultPortHeight) {
				command.options.push(key + "/height=" + roundTikz(this.portSize.height.value.value))
			}
		}
		super.buildTikzCommand(command)
	}

	protected applyJson(saveObject: NodeSymbolSaveObject): void {
		super.applyJson(saveObject)
		if (this.portSymbol) {
			this.portSize.width.value = new SVG.Number(saveObject.portSize?.width ?? defaultPortWidth)
			this.portSize.height.value = new SVG.Number(saveObject.portSize?.height ?? defaultPortHeight)
			this.portSize.lockAspectRatio.value = saveObject.portSize?.lockAspectRatio ?? false
		}
		let options = saveObject.options ?? []
		this.setPropertiesFromOptions(this.referenceSymbol.getOptionsFromOptionNames(options))
		this.scaleProperty.value = new SVG.Number(Math.abs(this.scaleState.x))
		if (this.portSymbol && (Math.abs(this.scaleState.x) != 1 || Math.abs(this.scaleState.y) != 1)) {
			// older saves could scale ports: convert to the equivalent size
			const round = (value: number) => new SVG.Number(Math.round(value * 1000) / 1000)
			this.portSize.width.value = round(this.portSize.width.value.value * Math.abs(this.scaleState.x))
			this.portSize.height.value = round(this.portSize.height.value.value * Math.abs(this.scaleState.y))
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
