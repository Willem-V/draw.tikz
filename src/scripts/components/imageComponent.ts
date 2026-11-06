import * as SVG from "@svgdotjs/svg.js"
import {
	basicDirections,
	BooleanProperty,
	ButtonGridProperty,
	CanvasController,
	CircuitComponent,
	defaultBasicDirection,
	PropertyCategories,
	SectionHeaderProperty,
	ShapeComponent,
	ShapeSaveObject,
	SnapPoint,
	TextProperty,
	TikzNodeCommand,
	buildTikzStringFromNodeCommand,
	Undo,
} from "../internal"
import { rectRectIntersection, roundTikz } from "../utils/selectionHelper"

export type ImageSaveObject = ShapeSaveObject & {
	/** the picture for the preview: a data URL (downscaled for big pictures) */
	data?: string
	/** the file name in \includegraphics */
	path?: string
	/** width / height of the picture */
	aspect?: number
	lockAspect?: boolean
}

/** the longest side of the picture which is kept in the drawing (the export uses the original file) */
const maxPreviewSide = 900

/**
 * the file as a data URL for the preview in the drawing. Big bitmaps are scaled down, since the export refers to the file
 * itself and the drawing file should stay small.
 */
export async function readImageFile(file: File): Promise<{ data: string; aspect: number }> {
	const original = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(file)
	})
	const image = await new Promise<HTMLImageElement>((resolve, reject) => {
		const element = new Image()
		element.onload = () => resolve(element)
		element.onerror = () => reject(new Error("This file is not a picture which the browser can show"))
		element.src = original
	})
	const width = image.naturalWidth || 100
	const height = image.naturalHeight || 100
	const aspect = width / height
	const isVector = file.type == "image/svg+xml"
	if (isVector || Math.max(width, height) <= maxPreviewSide) {
		return { data: original, aspect }
	}
	const scale = maxPreviewSide / Math.max(width, height)
	const canvas = document.createElement("canvas")
	canvas.width = Math.round(width * scale)
	canvas.height = Math.round(height * scale)
	canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height)
	// photos stay jpeg, everything else (screenshots, plots with transparency) png
	return { data: canvas.toDataURL(file.type == "image/jpeg" ? "image/jpeg" : "image/png", 0.85), aspect }
}

/** opens the dialog to choose a picture */
export function chooseImageFile(): Promise<File | undefined> {
	return new Promise((resolve) => {
		const input = document.createElement("input")
		input.type = "file"
		input.accept = "image/png,image/jpeg,image/svg+xml,image/gif,image/webp,.png,.jpg,.jpeg,.svg"
		input.addEventListener("change", () => resolve(input.files?.[0]), { once: true })
		input.addEventListener("cancel", () => resolve(undefined), { once: true })
		input.click()
	})
}

/**
 * A picture (png, jpeg, svg) in the drawing, e.g. a photo, a plot or a logo. The drawing contains a preview of the picture,
 * the export refers to the file (\includegraphics{path}), so the path has to be valid from the LaTeX document.
 */
export class ImageComponent extends ShapeComponent {
	private static jsonID = "image"
	static {
		CircuitComponent.jsonSaveMap.set(ImageComponent.jsonID, ImageComponent)
	}

	declare protected dragElement: SVG.Rect

	private data = ""
	private aspect = 1
	private pathProperty: TextProperty
	private lockProperty: BooleanProperty
	private imageElement: SVG.Image

	public constructor() {
		super()
		this.displayName = "Image"

		this.componentVisualization = CanvasController.instance.canvas.rect(0, 0)
		this.componentVisualization.hide()
		this.imageElement = CanvasController.instance.canvas.image()
		this.imageElement.attr("preserveAspectRatio", "none")
		this.dragElement = CanvasController.instance.canvas.rect(0, 0)
		this.dragElement.attr({ fill: "transparent", stroke: "none" })
		this.visualization.add(this.imageElement)
		this.visualization.add(this.componentVisualization)
		this.visualization.add(this.dragElement)

		this.properties.add(PropertyCategories.options, new SectionHeaderProperty("Image", undefined, "image:header"))
		this.pathProperty = new TextProperty(
			"File",
			"image.png",
			"The file in \\includegraphics, relative to the LaTeX document, e.g. fig/photo.png",
			undefined,
			"image:path"
		)
		this.pathProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.pathProperty)
		this.lockProperty = new BooleanProperty(
			"Lock aspect ratio",
			true,
			undefined,
			"Keep the proportions of the picture when it is resized",
			"image:lock"
		)
		this.lockProperty.addChangeListener(() => this.update())
		this.properties.add(PropertyCategories.options, this.lockProperty)
		this.properties.add(
			PropertyCategories.options,
			new ButtonGridProperty(1, [["Replace picture", "image"]], [() => this.replacePicture()], true, [
				"Choose another picture file",
			])
		)
		this.selectionElement = CanvasController.instance.canvas.rect(0, 0).hide()
	}

	/** a component for the picture of the file, ready to be placed */
	public static async fromFile(file: File): Promise<ImageComponent> {
		const { data, aspect } = await readImageFile(file)
		const component = new ImageComponent()
		component.setPicture(data, aspect, file.name)
		return component
	}

	private setPicture(data: string, aspect: number, name?: string) {
		this.data = data
		this.aspect = aspect > 0 ? aspect : 1
		this.imageElement.load(data)
		if (name) this.pathProperty.value = name
	}

	private async replacePicture() {
		const file = await chooseImageFile()
		if (!file) return
		try {
			const { data, aspect } = await readImageFile(file)
			this.setPicture(data, aspect, file.name)
			if (this.lockProperty.value) this.size.y = this.size.x / this.aspect
			this.update()
			Undo.addState()
		} catch (e) {
			alert((e as Error).message)
		}
	}

	public update(): void {
		if (this.lockProperty.value && this.size.x > 0) {
			// the width leads, the height follows
			this.size.y = this.size.x / this.aspect
			this.referencePosition = this.size.div(2)
		}
		super.update()
		const matrix = this.getTransformMatrix()
		this.imageElement.size(this.size.x, this.size.y)
		this.imageElement.transform(matrix)
	}

	public updateTheme(): void {
		super.updateTheme()
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

	public toJson(): ImageSaveObject {
		const data = super.toJson() as ImageSaveObject
		data.type = ImageComponent.jsonID
		data.size = this.size.simplifyForJson()
		data.data = this.data
		data.path = this.pathProperty.value
		data.aspect = this.aspect
		if (!this.lockProperty.value) data.lockAspect = false
		return data
	}

	protected applyJson(saveObject: ImageSaveObject): void {
		super.applyJson(saveObject)
		this.lockProperty.value = saveObject.lockAspect ?? true
		this.pathProperty.value = saveObject.path ?? "image.png"
		this.setPicture(saveObject.data ?? "", saveObject.aspect ?? 1)
		this.update()
		this.componentVisualization.show()
		this.updateTheme()
	}

	static fromJson(saveObject: ImageSaveObject): ImageComponent {
		return new ImageComponent()
	}

	public copyForPlacement(): CircuitComponent {
		const copy = new ImageComponent()
		copy.setPicture(this.data, this.aspect, this.pathProperty.value)
		copy.lockProperty.value = this.lockProperty.value
		return copy
	}

	public toTikzString(): string {
		const command: TikzNodeCommand = { options: ["inner sep=0pt", "anchor=center"], additionalNodes: [] }
		command.position = this.position
		if (this.rotationDeg != 0) command.options.push("rotate=" + this.rotationDeg)
		const width = roundTikz(new SVG.Number(this.size.x, "px").convertToUnit("cm").value)
		const height = roundTikz(new SVG.Number(this.size.y, "px").convertToUnit("cm").value)
		const file = this.pathProperty.value.trim().replace(/\\/g, "/")
		command.content = `\\includegraphics[width=${width}cm, height=${height}cm]{${file}}`
		return buildTikzStringFromNodeCommand(command)
	}

	public toSVG(defs: Map<string, SVG.Element>): SVG.Element {
		return super.toSVG(defs)
	}
}
