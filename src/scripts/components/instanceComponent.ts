import * as SVG from "@svgdotjs/svg.js"
import {
	CircuitComponent,
	GroupComponent,
	GroupSaveObject,
	InfoProperty,
	MainController,
	PropertyCategories,
	SelectionController,
	SelectionMode,
	ToolbarGroup,
} from "../internal"
import { ComponentLibrary, ComponentUser, componentsFromFile } from "../utils/componentLibrary"

export type InstanceSaveObject = GroupSaveObject & {
	/** path of the component file */
	source: string
	/** where the origin of the file is */
	origin: { x: number; y: number }
	angle?: number
	mirrored?: boolean
}

/** how deep instances can be nested (an instance in a file of an instance ...) */
const maxDepth = 16

/**
 * An instance of a component file: only the path of the file, its position, rotation and flip are stored in the drawing.
 * The components are loaded from the file, so the instance updates when the file changes. The components of an instance
 * can't be edited, the instance is moved, rotated and flipped as a whole. "Make independent copy" turns it into normal
 * components.
 *
 * The file is placed with its origin (0, 0) at `origin`, first mirrored (if `mirrored`) and then rotated by `angle`
 * around the origin, like the transformation of a node. Flipping and rotating the instance changes these values.
 */
export class InstanceComponent extends GroupComponent {
	private static instanceJsonID = "instance"
	static {
		CircuitComponent.jsonSaveMap.set(InstanceComponent.instanceJsonID, InstanceComponent)
	}

	/** the paths of the files which are currently loaded (to find cycles) */
	private static loading: string[] = []

	public source: string
	private origin: SVG.Point
	private angle: number
	private mirrored: boolean
	/** why the file could not be loaded */
	private error: string | undefined
	private placeholder: SVG.G | undefined

	constructor(source: string, origin = new SVG.Point(0, 0), angle = 0, mirrored = false) {
		super([])
		this.source = source
		this.origin = origin
		this.angle = angle
		this.mirrored = mirrored
		this.displayName = "Component " + source
		this.properties.add(PropertyCategories.manipulation, new InfoProperty("Linked to", escapeHTML(source)))
		ComponentLibrary.instance.addUser(this)
		this.reload()
		// like the group, the instance is selected after it was created
		SelectionController.instance.selectComponents([this], SelectionMode.RESET)
	}

	/**
	 * an instance which can be placed with the ComponentPlacer like a symbol
	 */
	public static newForPlacement(source: string): InstanceComponent {
		const instance = new InstanceComponent(source)
		// the constructor selects the instance, but components are not selected while they are placed
		SelectionController.instance.selectComponents([], SelectionMode.RESET)
		instance.draggable(false)
		return instance
	}

	protected toolbarGroups(): ToolbarGroup[] {
		return [
			{
				label: "Linked component",
				buttons: [
					{
						icon: "link_off",
						text: "Make independent copy",
						tooltip:
							"Replace the instance by a copy of its components, which doesn't change with the file anymore",
						onClick: () => this.ungroup(),
					},
				],
			},
		]
	}

	/**
	 * (re)creates the components from the file, e.g. when the file changed
	 */
	public reload() {
		const wasSelected = this.isSelected
		for (const component of this.groupedComponents) {
			component.remove()
		}
		this.groupedComponents = []
		this.error = undefined

		const children = this.loadComponents()
		for (const component of children) {
			// the components of the file were added to the drawing, they belong to the instance instead
			const index = MainController.instance.circuitComponents.indexOf(component)
			if (index >= 0) {
				MainController.instance.circuitComponents.splice(index, 1)
			}
			component.parentGroup = this
			component.viewSelected(false)
			this.visualization.add(component.visualization)
		}
		this.groupedComponents = children
		this.snappingPoints = children.map((component) => component.snappingPoints).flat()
		this.showPlaceholder(children.length == 0)
		this.update()
		if (wasSelected) {
			this.viewSelected(true)
		}
	}

	private loadComponents(): CircuitComponent[] {
		const text = ComponentLibrary.instance.getText(this.source)
		if (text === undefined) {
			this.error = "not loaded"
			return []
		}
		if (InstanceComponent.loading.includes(this.source) || InstanceComponent.loading.length >= maxDepth) {
			this.error = "contains itself"
			return []
		}
		InstanceComponent.loading.push(this.source)
		let components: CircuitComponent[] = []
		try {
			components = componentsFromFile(JSON.parse(text))
		} catch (e) {
			console.error(`draw.tikz: could not load the component "${this.source}"`, e)
			this.error = "could not be loaded"
		} finally {
			InstanceComponent.loading.pop()
		}
		for (const component of components) {
			if (this.mirrored) {
				component.moveRel(component.position.mul(new SVG.Point(0, -2)))
				component.flip(true)
			}
			if (this.angle != 0) {
				component.moveTo(component.position.rotate(this.angle, new SVG.Point(0, 0)))
				component.rotate(this.angle)
			}
			component.moveRel(this.origin)
		}
		return components
	}

	private showPlaceholder(show: boolean) {
		this.placeholder?.remove()
		this.placeholder = undefined
		if (!show) {
			return
		}
		const box = this.emptyBox()
		const group = new SVG.G()
		group
			.rect(box.w, box.h)
			.move(box.x, box.y)
			.fill("none")
			.stroke({ color: "var(--bs-danger)", width: 1, dasharray: "4 3" })
		const unavailable = this.error == "not loaded" && !ComponentLibrary.instance.isLoaded(this.source)
		group
			.text(`${this.source}${this.error ? " (" + (unavailable ? "missing" : this.error) + ")" : ""}`)
			.font({ size: 10, anchor: "middle" })
			.fill("var(--bs-danger)")
			.move(box.cx, box.cy - 6)
		group.node.style.pointerEvents = "none"
		this.placeholder = group
		this.visualization.add(group)
	}

	protected emptyBox(): SVG.Box {
		const origin = this.origin ?? new SVG.Point(0, 0)
		return new SVG.Box(origin.x - 40, origin.y - 20, 80, 40)
	}

	public moveRel(delta: SVG.Point): void {
		this.origin = this.origin.add(delta)
		super.moveRel(delta)
	}

	public moveTo(position: SVG.Point): void {
		this.origin = this.origin.add(position.sub(this.position))
		super.moveTo(position)
	}

	public rotate(angleDeg: number): void {
		this.origin = this.origin.rotate(angleDeg, this.position)
		this.angle = normalizeAngle(this.angle + angleDeg)
		super.rotate(angleDeg)
		this.showPlaceholderIfEmpty()
	}

	public flip(horizontal: boolean): void {
		const pivot = this.position
		if (horizontal) {
			this.origin = new SVG.Point(this.origin.x, 2 * pivot.y - this.origin.y)
			this.angle = normalizeAngle(-this.angle)
		} else {
			this.origin = new SVG.Point(2 * pivot.x - this.origin.x, this.origin.y)
			this.angle = normalizeAngle(180 - this.angle)
		}
		this.mirrored = !this.mirrored
		super.flip(horizontal)
		this.showPlaceholderIfEmpty()
	}

	private showPlaceholderIfEmpty() {
		if (this.groupedComponents.length == 0) {
			this.showPlaceholder(true)
		}
	}

	public remove(): void {
		ComponentLibrary.instance.removeUser(this)
		super.remove()
	}

	public toJson(): InstanceSaveObject {
		const data: InstanceSaveObject = {
			type: InstanceComponent.instanceJsonID,
			components: [],
			source: this.source,
			origin: { x: this.origin.x, y: this.origin.y },
		}
		if (this.angle != 0) {
			data.angle = this.angle
		}
		if (this.mirrored) {
			data.mirrored = true
		}
		return data
	}

	public static fromJson(saveObject: InstanceSaveObject): InstanceComponent {
		return new InstanceComponent(
			saveObject.source,
			new SVG.Point(saveObject.origin?.x ?? 0, saveObject.origin?.y ?? 0),
			saveObject.angle ?? 0,
			saveObject.mirrored ?? false
		)
	}

	public copyForPlacement(): CircuitComponent {
		return InstanceComponent.newForPlacement(this.source)
	}

	public placeFinish(): void {
		this.draggable(true)
	}
}

function normalizeAngle(angle: number): number {
	return ((((angle + 180) % 360) + 360) % 360) - 180
}

function escapeHTML(text: string): string {
	return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
}
