import {
	CircuitComponent,
	MainController,
	SectionHeaderProperty,
	SelectionController,
	SelectionMode,
	Undo,
} from "../internal"

/**
 * The layers of the drawing for the general settings: all components from the top to the bottom, each can be hidden (also not
 * exported) or locked (cannot be selected by clicking or with the selection rectangle) and selected from the list.
 */
export class LayersEditor {
	public static createHTML(): HTMLDivElement {
		const container = document.createElement("div")
		container.id = "layersEditor"
		container.classList.add("container-fluid", "w-100", "m-0", "px-0")
		container.appendChild(new SectionHeaderProperty("Layers").getHTMLElement())
		const list = document.createElement("div")
		list.classList.add("d-flex", "flex-column", "gap-1", "px-2", "pb-2")
		container.appendChild(list)
		container.addEventListener("layers:refresh", () => LayersEditor.render(list))
		LayersEditor.render(list)
		return container
	}

	/** rebuilds the list, call when the general settings are shown */
	public static refresh() {
		document.getElementById("layersEditor")?.dispatchEvent(new Event("layers:refresh"))
	}

	private static describe(component: CircuitComponent): string {
		const anyComponent = component as any
		const text: string | undefined = anyComponent.textAreaProperty?.value || anyComponent.mathJaxLabel?.value
		return text ? `${component.displayName}: ${String(text).split("\n")[0].slice(0, 24)}` : component.displayName
	}

	private static render(list: HTMLElement) {
		list.innerHTML = ""
		const components = [...MainController.instance.circuitComponents].reverse()
		if (components.length == 0) {
			list.textContent = "Nothing drawn yet"
			return
		}
		const iconButton = (icon: string, title: string, active: boolean, onClick: () => void) => {
			const button = document.createElement("button")
			button.type = "button"
			button.classList.add("btn", "btn-sm", active ? "btn-secondary" : "btn-outline-secondary")
			button.title = title
			button.innerHTML = `<span class="material-symbols-outlined" style="font-size:1rem">${icon}</span>`
			button.addEventListener("click", onClick)
			return button
		}
		for (const component of components) {
			const row = document.createElement("div")
			row.classList.add("input-group", "input-group-sm")
			const name = document.createElement("button")
			name.type = "button"
			name.classList.add("btn", "btn-outline-secondary", "text-start", "flex-grow-1", "text-truncate")
			name.textContent = LayersEditor.describe(component)
			name.addEventListener("click", () => {
				if (component.locked || component.hidden) return
				SelectionController.instance.selectComponents([component], SelectionMode.RESET)
			})
			row.append(
				name,
				iconButton(
					component.hidden ? "visibility_off" : "visibility",
					"Hide (also not exported)",
					component.hidden,
					() => {
						component.setHidden(!component.hidden)
						Undo.addState()
						LayersEditor.render(list)
					}
				),
				iconButton(
					component.locked ? "lock" : "lock_open",
					"Lock (cannot be selected)",
					component.locked,
					() => {
						component.setLocked(!component.locked)
						Undo.addState()
						LayersEditor.render(list)
					}
				)
			)
			list.appendChild(row)
		}
	}
}
