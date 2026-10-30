import {
	AlignmentMode,
	CanvasController,
	CircuitComponent,
	DistributionMode,
	EditableProperty,
	EnvironmentVariableController,
	GroupComponent,
	IconToolbarProperty,
	MainController,
	layerGroup,
	SectionHeaderProperty,
	SelectionController,
	transformGroups,
	Undo,
} from "../internal"
import { ComponentLibrary } from "../utils/componentLibrary"
import { HintBar } from "../utils/hintBar"

export type FormEntry = {
	originalObject: object
	propertyName: string
	inputType: string
	currentValue: any
}

export enum PropertyCategories {
	manipulation,
	ordering,
	options,
	fill,
	stroke,
	label,
	voltage,
	current,
	text,
	info,
}

export class PropertiesCollection extends Map<PropertyCategories, EditableProperty<any>[]> {
	public add(category: PropertyCategories, property: EditableProperty<any>) {
		if (this.has(category)) {
			this.get(category).push(property)
		} else {
			this.set(category, [property])
		}
	}

	public sorted(): EditableProperty<any>[] {
		let properties: EditableProperty<any>[] = []

		let key = Object.keys(PropertyCategories)[0]
		PropertyCategories[key]
		for (const element in PropertyCategories) {
			if (isNaN(Number(element))) {
				//@ts-ignore
				let category: PropertyCategories = PropertyCategories[element]
				if (this.has(category)) {
					properties.push(...this.get(category))
				}
			}
		}
		return properties
	}
}

export class PropertyController {
	private static _instance: PropertyController
	public static get instance(): PropertyController {
		if (!PropertyController._instance) {
			PropertyController._instance = new PropertyController()
		}
		return PropertyController._instance
	}

	private viewProperties: HTMLDivElement
	private propertiesEntries: HTMLDivElement
	private propertiesTitle: HTMLElement

	private multies: EditableProperty<any>[] = []

	private constructor() {
		this.propertiesTitle = document.getElementById("propertiesTitle") as HTMLElement
		this.viewProperties = document.getElementById("view-properties") as HTMLDivElement
		this.viewProperties.firstElementChild.prepend(MainController.instance.designName.getHTMLElement())
		this.propertiesEntries = document.getElementById("propertiesEntries") as HTMLDivElement
		;(document.getElementById("resetViewButton") as HTMLButtonElement).addEventListener("click", (ev) => {
			CanvasController.instance.resetView()
		})
		;(document.getElementById("fitViewButton") as HTMLButtonElement).addEventListener("click", (ev) => {
			CanvasController.instance.fitView()
		})
	}

	update() {
		let components = SelectionController.instance.currentlySelectedComponents
		this.clearForm()
		HintBar.updateSelection()

		if (components.length > 1) {
			this.setMultiForm(components)
		} else if (components.length === 1) {
			this.setForm(components[0])
		} else {
			this.setFormView()
		}

		MainController.instance.updateTooltips()
	}

	private setMultiForm(components: CircuitComponent[]) {
		this.propertiesEntries.classList.remove("d-none")
		this.propertiesTitle.innerText = "Selection"

		const selection = SelectionController.instance
		const transform = transformGroups(
			(angleDeg) => {
				selection.rotateSelection(angleDeg)
				Undo.addState()
			},
			(horizontalAxis) => {
				selection.flipSelection(horizontalAxis)
				Undo.addState()
			},
			"the selection"
		)
		const order = layerGroup(
			() => CanvasController.instance.componentsToForeground(selection.currentlySelectedComponents),
			() => CanvasController.instance.moveComponentsForward(selection.currentlySelectedComponents),
			() => CanvasController.instance.moveComponentsBackward(selection.currentlySelectedComponents),
			() => CanvasController.instance.componentsToBackground(selection.currentlySelectedComponents)
		)
		const align = (mode: AlignmentMode, horizontal: boolean) => () => selection.alignSelection(mode, horizontal)
		const distribute = (mode: DistributionMode, horizontal: boolean) => () =>
			selection.distributeSelection(mode, horizontal)
		const toolbar = new IconToolbarProperty([
			...transform,
			order,
			{
				label: "Group",
				buttons: [
					{
						icon: "group_work",
						text: "Group",
						tooltip: "Group the components, so they are moved and selected together",
						onClick: () => GroupComponent.group(selection.currentlySelectedComponents),
					},
					{
						icon: "bookmark_add",
						text: "Save as component",
						tooltip: "Save the selection as a component for the symbol picker",
						onClick: () => ComponentLibrary.instance.save(selection.currentlySelectedComponents),
					},
				],
			},
			{
				label: "Align",
				buttons: [
					{ icon: "align_horizontal_left", tooltip: "Align left", onClick: align(AlignmentMode.START, true) },
					{
						icon: "align_horizontal_center",
						tooltip: "Align centers horizontally",
						onClick: align(AlignmentMode.CENTER, true),
					},
					{ icon: "align_horizontal_right", tooltip: "Align right", onClick: align(AlignmentMode.END, true) },
					{ icon: "align_vertical_top", tooltip: "Align top", onClick: align(AlignmentMode.START, false) },
					{
						icon: "align_vertical_center",
						tooltip: "Align centers vertically",
						onClick: align(AlignmentMode.CENTER, false),
					},
					{
						icon: "align_vertical_bottom",
						tooltip: "Align bottom",
						onClick: align(AlignmentMode.END, false),
					},
				],
			},
			{
				label: "Distribute",
				buttons: [
					{
						icon: "horizontal_distribute",
						tooltip: "Distribute the centers horizontally",
						onClick: distribute(DistributionMode.CENTER, true),
					},
					{
						icon: "align_justify_space_even",
						tooltip: "Equal horizontal spacing",
						onClick: distribute(DistributionMode.SPACE, true),
					},
					{
						icon: "vertical_distribute",
						tooltip: "Distribute the centers vertically",
						onClick: distribute(DistributionMode.CENTER, false),
					},
					{
						icon: "align_space_even",
						tooltip: "Equal vertical spacing",
						onClick: distribute(DistributionMode.SPACE, false),
					},
				],
			},
		])
		const rows: HTMLElement[] = [toolbar.getHTMLElement()]
		this.propertiesEntries.append(...rows)

		const overlappingProperties: PropertiesCollection = new PropertiesCollection()
		this.multies = []

		let key = Object.keys(PropertyCategories)[0]
		PropertyCategories[key]
		// repeat overlap detection for all possible categories
		for (const element in PropertyCategories) {
			if (!isNaN(Number(element))) {
				continue
			}
			//@ts-ignore
			let category: PropertyCategories = PropertyCategories[element]
			const categoryMap: Map<string, EditableProperty<any>[]> = new Map()

			// in each category, loop over all components
			for (const component of components) {
				const properties = component.properties.get(category)
				if (properties == undefined) {
					continue
				}
				// keep track of all properties of a given id
				for (const property of properties) {
					if (property.id == "") {
						//skip empty ids
						continue
					}
					if (categoryMap.has(property.id)) {
						categoryMap.get(property.id).push(property)
					} else {
						categoryMap.set(property.id, [property])
					}
				}
			}
			const relevantProperties: EditableProperty<any>[] = []
			// remove all properties, which are not present in every component, otherwise add properties
			for (const id of categoryMap.keys()) {
				const properties = categoryMap.get(id)
				if (properties.length < components.length) {
					categoryMap.set(id, [])
				} else {
					// get the multi edit version and save for housekeeping
					const multi = properties[0].getMultiEditVersion(properties)

					this.multies.push(multi)

					relevantProperties.push(multi)
				}
			}
			overlappingProperties.set(category, relevantProperties)
		}
		this.propertiesEntries.append(...overlappingProperties.sorted().map((property) => property.getHTMLElement()))
		SectionHeaderProperty.applyCollapsed(this.propertiesEntries)
	}

	private setForm(component: CircuitComponent) {
		this.propertiesEntries.classList.remove("d-none")
		this.propertiesTitle.innerText = component.displayName
		this.propertiesEntries.append(...component.properties.sorted().map((property) => property.getHTMLElement()))
		SectionHeaderProperty.applyCollapsed(this.propertiesEntries)
	}

	private setFormView() {
		this.viewProperties.classList.remove("d-none")
		this.propertiesTitle.innerText = "General settings"

		if (!document.getElementById("envVarView")) {
			document.getElementById("view-properties").appendChild(EnvironmentVariableController.instance.getHTML())
			SectionHeaderProperty.applyCollapsed(EnvironmentVariableController.instance.getHTML())
		}
	}

	private clearForm() {
		for (const element of this.multies) {
			element.remove()
		}
		this.propertiesTitle.innerText = "Properties"
		this.viewProperties.classList.add("d-none")
		this.propertiesEntries.classList.add("d-none")
		this.propertiesEntries.innerText = ""

		while (this.propertiesEntries.lastElementChild) {
			this.propertiesEntries.removeChild(this.propertiesEntries.lastElementChild)
		}
	}
}
