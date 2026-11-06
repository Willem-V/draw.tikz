import * as SVG from "@svgdotjs/svg.js"
import {
	basicDirections,
	BooleanProperty,
	buildTikzStringFromNodeCommand,
	buildTikzStringFromPathCommand,
	CanvasController,
	ChoiceProperty,
	CircuitComponent,
	ColorProperty,
	convertTextToNativeSVGText,
	defaultBasicDirection,
	defaultFontSize,
	defaultStroke,
	FontSize,
	fontSizes,
	MathjaxParser,
	PropertyCategories,
	RadioButtonProperty,
	SectionHeaderProperty,
	ShapeComponent,
	ShapeSaveObject,
	SliderProperty,
	SnapPoint,
	TextAlign,
	TextAreaProperty,
	textToSVG,
	TikzNodeCommand,
	TikzPathCommand,
} from "../internal"
import { cellToLatex } from "../utils/latexText"
import { removeTextSVG } from "../utils/svgText"
import { paletteNameOf, resolveColor } from "../utils/palette"
import { rectRectIntersection, roundTikz } from "../utils/selectionHelper"

export type TableSaveObject = ShapeSaveObject & {
	/** the rows are lines and the cells are separated by & */
	content?: string
	outer?: boolean
	innerHorizontal?: boolean
	innerVertical?: boolean
	headerLine?: boolean
	align?: TextAlign
	fontSize?: string
	innerSep?: string
	textColor?: string
	textPalette?: string
}

const defaultContent = "A & B & C\n1 & 2 & 3\n4 & 5 & 6"

/** the cells of the text of a table: rows are lines, cells are separated by & or tabs (pasted from a spreadsheet) */
export function parseTableContent(content: string): string[][] {
	const rows = content
		.replace(/\r/g, "")
		.split("\n")
		.map((line) => line.split(/\t|&/).map((cell) => cell.trim()))
	while (rows.length > 1 && rows[rows.length - 1].every((cell) => cell === "")) {
		rows.pop()
	}
	const columns = Math.max(1, ...rows.map((row) => row.length))
	return rows.map((row) => [...row, ...Array(columns - row.length).fill("")])
}

/**
 * A table: a grid of cells with text (and math), drawn with lines and exported as TikZ lines and nodes.
 * The width and height are distributed equally over the columns and rows, resize the table with the handles.
 */
export class TableComponent extends ShapeComponent {
	private static jsonID = "table"
	static {
		CircuitComponent.jsonSaveMap.set(TableComponent.jsonID, TableComponent)
	}

	declare protected dragElement: SVG.Rect

	private contentProperty: TextAreaProperty
	private outerProperty: BooleanProperty
	private horizontalProperty: BooleanProperty
	private verticalProperty: BooleanProperty
	private headerProperty: BooleanProperty
	private alignProperty: RadioButtonProperty<{ key: string; name: string; isMaterialSymbol: boolean; numberID: any }>
	private fontSizeProperty: ChoiceProperty<FontSize>
	private innerSepProperty: SliderProperty
	private textColorProperty: ColorProperty

	private gridLines: SVG.Path
	private headerLine: SVG.Path
	private textSVG: SVG.G

	public constructor() {
		super()
		this.displayName = "Table"

		this.componentVisualization = CanvasController.instance.canvas.rect(0, 0)
		this.componentVisualization.hide()
		this.gridLines = CanvasController.instance.canvas.path().fill("none")
		this.headerLine = CanvasController.instance.canvas.path().fill("none")
		this.dragElement = CanvasController.instance.canvas.rect(0, 0)
		this.dragElement.attr({ fill: "transparent", stroke: "none" })

		this.visualization.add(this.componentVisualization)
		this.visualization.add(this.gridLines)
		this.visualization.add(this.headerLine)
		this.visualization.add(this.dragElement)

		this.properties.add(PropertyCategories.text, new SectionHeaderProperty("Table", undefined, "table:header"))
		this.contentProperty = new TextAreaProperty(
			defaultContent,
			"One row per line, cells separated by &. Pasted spreadsheet cells (tabs) work too. $...$ is math",
			"table:content"
		)
		this.contentProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.contentProperty)

		const lineProperty = (label: string, value: boolean, id: string, tooltip: string) => {
			const property = new BooleanProperty(label, value, undefined, tooltip, id)
			property.addChangeListener(() => {
				this.update()
				this.updateTheme()
			})
			this.properties.add(PropertyCategories.stroke, property)
			return property
		}
		this.outerProperty = lineProperty("Outer border", true, "table:outer", "Line around the table")
		this.horizontalProperty = lineProperty("Row lines", true, "table:horizontal", "Lines between the rows")
		this.verticalProperty = lineProperty("Column lines", true, "table:vertical", "Lines between the columns")
		this.headerProperty = lineProperty(
			"Header line",
			true,
			"table:header-line",
			"A thicker line below the first row"
		)

		const alignOptions = [
			{ key: "LEFT", name: "format_align_left", isMaterialSymbol: true, numberID: TextAlign.LEFT },
			{ key: "CENTER", name: "format_align_center", isMaterialSymbol: true, numberID: TextAlign.CENTER },
			{ key: "RIGHT", name: "format_align_right", isMaterialSymbol: true, numberID: TextAlign.RIGHT },
		]
		this.alignProperty = new RadioButtonProperty("Align", alignOptions, alignOptions[1], undefined, "table:align")
		this.alignProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.alignProperty)

		this.fontSizeProperty = new ChoiceProperty("Fontsize", fontSizes, defaultFontSize, undefined, "text:fontsize")
		this.fontSizeProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.fontSizeProperty)

		this.innerSepProperty = new SliderProperty(
			"Cell padding",
			0,
			10,
			0.1,
			new SVG.Number(3, "pt"),
			undefined,
			undefined,
			"table:padding"
		)
		this.innerSepProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.innerSepProperty)

		this.textColorProperty = new ColorProperty("Color", null, undefined, undefined, "text:color")
		this.textColorProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.text, this.textColorProperty)

		this.selectionElement = CanvasController.instance.canvas.rect(0, 0).hide()
	}

	private get cells(): string[][] {
		return parseTableContent(this.contentProperty.value ?? "")
	}

	/** the lines between the cells in the local coordinates of the table (x and y from 0 to the size) */
	private innerLines(): { from: SVG.Point; to: SVG.Point; header: boolean }[] {
		const cells = this.cells
		const rows = cells.length
		const columns = cells[0].length
		const lines: { from: SVG.Point; to: SVG.Point; header: boolean }[] = []
		for (let row = 1; row < rows; row++) {
			const header = row == 1 && this.headerProperty.value
			if (header || this.horizontalProperty.value) {
				const y = (this.size.y * row) / rows
				lines.push({ from: new SVG.Point(0, y), to: new SVG.Point(this.size.x, y), header })
			}
		}
		if (this.verticalProperty.value) {
			for (let column = 1; column < columns; column++) {
				const x = (this.size.x * column) / columns
				lines.push({ from: new SVG.Point(x, 0), to: new SVG.Point(x, this.size.y), header: false })
			}
		}
		return lines
	}

	public update(): void {
		super.update()
		const matrix = this.getTransformMatrix()
		const path = (header: boolean) =>
			this.innerLines()
				.filter((line) => line.header == header)
				.map((line) => `M ${line.from.x} ${line.from.y} L ${line.to.x} ${line.to.y}`)
				.join(" ")
		this.gridLines.plot(path(false) || "M 0 0")
		this.gridLines.transform(matrix)
		this.headerLine.plot(path(true) || "M 0 0")
		this.headerLine.transform(matrix)
		this.updateText()
	}

	public updateTheme(): void {
		super.updateTheme()
		const strokeColor = this.strokeInfo.color == "default" ? defaultStroke : this.strokeInfo.color
		const width = this.strokeInfo.opacity == 0 ? 0 : this.strokeInfo.width.convertToUnit("px").value
		const dasharray = this.strokeStyleProperty.value.dasharray
			.map((factor) => this.strokeInfo.width.times(factor).toString())
			.join(" ")
		this.gridLines?.stroke({ color: strokeColor, opacity: this.strokeInfo.opacity, width: width, dasharray })
		this.headerLine?.stroke({ color: strokeColor, opacity: this.strokeInfo.opacity, width: width * 2 })
		if (!this.outerProperty.value) {
			this.componentVisualization?.stroke({ width: 0 })
		}
	}

	private updateText() {
		removeTextSVG(this.textSVG)
		const cells = this.cells
		const rows = cells.length
		const columns = cells[0].length
		const padding = this.innerSepProperty.value.convertToUnit("px").value
		const cellWidth = this.size.x / columns
		const cellHeight = this.size.y / rows
		const origin = this.position.sub(this.size.div(2))
		const group = new SVG.G()
		const color = this.textColorProperty.value?.toString() || "var(--bs-emphasis-color)"
		for (let row = 0; row < rows; row++) {
			for (let column = 0; column < columns; column++) {
				const text = cells[row][column]
				if (!text) continue
				const w = Math.max(0, cellWidth - 2 * padding)
				const h = Math.max(0, cellHeight - 2 * padding)
				const box = new SVG.Box(
					origin.x + column * cellWidth + padding,
					origin.y + row * cellHeight + padding,
					w,
					h
				)
				group.add(
					convertTextToNativeSVGText(
						{
							text: text,
							align: this.alignProperty.value.numberID,
							justify: 0,
							fontSize: this.fontSizeProperty.value.key,
							color: color,
						},
						box
					)
				)
			}
		}
		group.transform(new SVG.Matrix({ rotate: -this.rotationDeg, origin: [this.position.x, this.position.y] }))
		group.node.style.pointerEvents = "none"
		this.textSVG = group
		this.visualization.add(group)
	}

	public recalculateSnappingPoints(matrix?: SVG.Matrix): void {
		const halfSize = this.size.div(2)
		const relPositions = basicDirections
			.filter((anchor) => anchor.key != defaultBasicDirection.key)
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
		return rectRectIntersection(rect, selectionRectangle, this.rotationDeg)
	}

	public toJson(): TableSaveObject {
		const data = super.toJson() as TableSaveObject
		data.type = TableComponent.jsonID
		data.size = this.size.simplifyForJson()
		data.content = this.contentProperty.value
		if (!this.outerProperty.value) data.outer = false
		if (!this.horizontalProperty.value) data.innerHorizontal = false
		if (!this.verticalProperty.value) data.innerVertical = false
		if (!this.headerProperty.value) data.headerLine = false
		if (this.alignProperty.value.numberID !== TextAlign.CENTER) data.align = this.alignProperty.value.numberID
		if (this.fontSizeProperty.value.key !== defaultFontSize.key) data.fontSize = this.fontSizeProperty.value.key
		if (this.innerSepProperty.value.value !== 3) data.innerSep = this.innerSepProperty.value.toString()
		if (this.textColorProperty.value) {
			data.textColor = this.textColorProperty.value.toString()
			data.textPalette = paletteNameOf(this.textColorProperty.value)
		}
		return data
	}

	protected applyJson(saveObject: TableSaveObject): void {
		super.applyJson(saveObject)
		this.contentProperty.value = saveObject.content ?? defaultContent
		this.outerProperty.value = saveObject.outer ?? true
		this.horizontalProperty.value = saveObject.innerHorizontal ?? true
		this.verticalProperty.value = saveObject.innerVertical ?? true
		this.headerProperty.value = saveObject.headerLine ?? true
		const align = saveObject.align ?? TextAlign.CENTER
		this.alignProperty.value =
			Object.values(this.alignProperty.options).find((item) => item.numberID == align) ??
			this.alignProperty.options[1]
		this.fontSizeProperty.value = fontSizes.find((item) => item.key == saveObject.fontSize) ?? defaultFontSize
		this.innerSepProperty.value = new SVG.Number(saveObject.innerSep ?? "3pt")
		this.textColorProperty.value = resolveColor(saveObject.textColor, saveObject.textPalette)
		this.update()
		this.componentVisualization.show()
		this.updateTheme()
	}

	static fromJson(saveObject: TableSaveObject): TableComponent {
		return new TableComponent()
	}

	public copyForPlacement(): CircuitComponent {
		return new TableComponent()
	}

	/** the tikz options which draw a line like the border of the table */
	private lineOptions(options: string[]): string[] {
		return options.filter(
			(option) =>
				option == "draw" ||
				option.startsWith("draw=") ||
				option.startsWith("draw opacity") ||
				option.startsWith("line width") ||
				option.startsWith("dash pattern")
		)
	}

	public toTikzString(): string {
		const matrix = this.getTransformMatrix()
		const cells = this.cells
		const rows = cells.length
		const columns = cells[0].length
		const strokeWidth = this.strokeInfo.width.convertToUnit("px").value

		// the rectangle with the fill and the border
		const node: TikzNodeCommand = { options: [], additionalNodes: [] }
		node.options.push("shape=rectangle")
		super.buildTikzCommand(node)
		const lineOptions = this.lineOptions(node.options)
		if (!this.outerProperty.value) {
			node.options = node.options.filter((option) => !lineOptions.includes(option))
		}
		node.options.push(
			"minimum width=" +
				roundTikz(new SVG.Number(this.size.x - strokeWidth, "px").convertToUnit("cm").value) +
				"cm",
			"minimum height=" +
				roundTikz(new SVG.Number(this.size.y - strokeWidth, "px").convertToUnit("cm").value) +
				"cm"
		)

		// the text of the cells
		const padding = this.innerSepProperty.value.convertToUnit("px").value
		const cellWidth = this.size.x / columns
		const cellHeight = this.size.y / rows
		const align = this.alignProperty.value.numberID as TextAlign
		const anchor =
			align == TextAlign.LEFT ? "west"
			: align == TextAlign.RIGHT ? "east"
			: "center"
		const fontString =
			this.fontSizeProperty.value.key == defaultFontSize.key ? "" : `\\${this.fontSizeProperty.value.name} `
		for (let row = 0; row < rows; row++) {
			for (let column = 0; column < columns; column++) {
				if (!cells[row][column]) continue
				const x =
					(column +
						(align == TextAlign.LEFT ? 0
						: align == TextAlign.RIGHT ? 1
						: 0.5)) *
					cellWidth
				const local = new SVG.Point(
					x +
						(align == TextAlign.LEFT ? padding
						: align == TextAlign.RIGHT ? -padding
						: 0),
					(row + 0.5) * cellHeight
				)
				let content = fontString + cellToLatex(cells[row][column])
				if (this.textColorProperty.value) {
					content = "\\textcolor" + this.textColorProperty.value.toTikzString() + "{" + content + "}"
				}
				const options = [
					"anchor=" + anchor,
					"inner sep=0pt",
					`text width=${roundTikz(new SVG.Number(Math.max(0, cellWidth - 2 * padding), "px").convertToUnit("cm").value)}cm`,
					align == TextAlign.LEFT ? "align=left"
					: align == TextAlign.RIGHT ? "align=right"
					: "align=center",
				]
				if (this.rotationDeg != 0) options.push("rotate=" + this.rotationDeg)
				node.additionalNodes.push({
					options: options,
					position: local.transform(matrix),
					content: content,
					additionalNodes: [],
				})
			}
		}

		const strings = [buildTikzStringFromNodeCommand(node)]
		if (lineOptions.some((option) => option == "draw" || option.startsWith("draw="))) {
			for (const line of this.innerLines()) {
				const options = [...lineOptions]
				if (line.header) {
					options.push(
						"line width=" +
							roundTikz(new SVG.Number(strokeWidth * 2, "px").convertToUnit("pt").value) +
							"pt"
					)
				}
				const command: TikzPathCommand = {
					options: options,
					coordinates: [line.from.transform(matrix), line.to.transform(matrix)],
					connectors: ["--"],
					additionalNodes: [],
				}
				strings.push(buildTikzStringFromPathCommand(command))
			}
		}
		return strings.join("\n\t")
	}

	public toSVG(defs: Map<string, SVG.Element>): SVG.Element {
		const copiedSVG = super.toSVG(defs)
		// text as paths, so it shows up in programs without the fonts
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
}
