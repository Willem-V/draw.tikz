import * as SVG from "@svgdotjs/svg.js"
import { CanvasController, EditableProperty, Undo } from "../internal"

/**
 * a number (with unit) edited with an input field and − / + buttons (it was a slider once, hence the name)
 */
export class SliderProperty extends EditableProperty<SVG.Number> {
	public eq(first: SVG.Number, second: SVG.Number): boolean {
		if (first == null || second == null) {
			return false
		}
		return first.eq(second)
	}

	private min: number
	private max: number
	private step: number

	/** can be changed until the input is shown */
	public label: string
	private decreaseButton: HTMLButtonElement
	private increaseButton: HTMLButtonElement
	private numberInput: HTMLInputElement
	private unitLabel: HTMLLabelElement

	private restrictToRange: boolean

	public constructor(
		label: string,
		min: number,
		max: number,
		step: number,
		initalValue?: SVG.Number,
		restrictToRange: boolean = false,
		tooltip = "",
		id: string = ""
	) {
		super(initalValue, tooltip, id)
		this.label = label
		this.min = min
		this.max = max
		this.step = step
		this.restrictToRange = restrictToRange
	}

	/**
	 * how much the − and + buttons change the value. By default a round number (1, 2 or 5 times a power of ten) for about 40
	 * steps over the range, at least the step of the input. Shift+click changes the value by the step of the input.
	 */
	public buttonStep: number

	private get defaultButtonStep(): number {
		const rough = (this.max - this.min) / 40
		const power = 10 ** Math.floor(Math.log10(rough))
		const nice = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough)
		return Math.max(nice, this.step)
	}

	public buildHTML(): HTMLElement {
		let row = this.getRow()

		let col = document.createElement("div") as HTMLDivElement
		col.classList.add("col-12", "my-0", "input-group", "flex-nowrap")

		let nameLabel = document.createElement("label") as HTMLLabelElement
		nameLabel.classList.add("input-group-text", "fs-6", "flex-grow-1")
		nameLabel.innerHTML = this.label
		col.appendChild(nameLabel)

		const stepButton = (symbol: string, direction: -1 | 1) => {
			const button = document.createElement("button") as HTMLButtonElement
			button.type = "button"
			button.classList.add("btn", "btn-outline-secondary", "material-symbols-outlined", "px-2")
			button.innerText = symbol
			button.title = direction < 0 ? "Smaller (Shift: fine step)" : "Larger (Shift: fine step)"
			button.addEventListener("click", (ev) => {
				if (Number.isNaN(this.value.value)) {
					return
				}
				const step = ev.shiftKey ? this.step : (this.buttonStep ?? this.defaultButtonStep)
				// go to the next multiple of the step, so values stay round numbers
				const steps = Math.round(this.value.value / step + direction * 0.5001)
				this.setFromInput(Math.round(steps * step * 1e6) / 1e6, true)
				this.updateNumberInput()
				Undo.addState()
			})
			return button
		}
		this.decreaseButton = stepButton("remove", -1)
		col.appendChild(this.decreaseButton)

		this.numberInput = document.createElement("input") as HTMLInputElement
		this.numberInput.classList.add("form-control", "fs-6", "text-end", "flex-grow-0")
		this.numberInput.style.width = "5.5em"
		this.numberInput.type = "number"
		this.numberInput.placeholder = "–"
		this.numberInput.min = this.min.toString()
		this.numberInput.max = this.max.toString()
		this.numberInput.step = this.step.toString()
		col.appendChild(this.numberInput)

		this.increaseButton = stepButton("add", 1)
		col.appendChild(this.increaseButton)

		this.numberInput.addEventListener("input", () => {
			let newValue = Number.parseFloat(this.numberInput.value)
			if (!isNaN(newValue)) {
				this.setFromInput(newValue, this.restrictToRange)
			}
		})
		this.numberInput.addEventListener("focusout", () => {
			this.updateNumberInput()
			Undo.addState()
		})
		this.numberInput.addEventListener("mousedown", (ev) => {
			CanvasController.instance.draggingFromInput = this.numberInput
		})

		if (this.value.unit) {
			this.unitLabel = document.createElement("label") as HTMLLabelElement
			this.unitLabel.classList.add("input-group-text", "fs-6")
			this.unitLabel.innerText = this.value.unit
			col.appendChild(this.unitLabel)
		}

		this.updateNumberInput()

		row.appendChild(col)
		return row
	}

	/**
	 * @param clamp keep the value between min and max
	 */
	private setFromInput(newValue: number, clamp: boolean) {
		if (clamp) {
			newValue = Math.min(this.max, Math.max(this.min, newValue))
		}
		this.updateValue(new SVG.Number(newValue, this.value.unit))
	}

	protected disable(disabled = true): void {
		this.numberInput.disabled = disabled
		this.decreaseButton.disabled = disabled
		this.increaseButton.disabled = disabled
	}

	private updateNumberInput() {
		// different values of several components: empty with a dash as placeholder
		this.numberInput.value = !Number.isNaN(this.value.value) ? this.value.value.toString() : ""
		if (this.unitLabel) {
			this.unitLabel.innerText = !Number.isNaN(this.value.value) ? this.value.unit : ""
		}
	}

	public updateHTML(): void {
		if (this.numberInput) {
			this.updateNumberInput()
		}
	}

	public getMultiEditVersion(properties: SliderProperty[]): SliderProperty {
		let allEqual = this.equivalent(properties)
		const first = properties[0]
		const result = new SliderProperty(
			this.label,
			this.min,
			this.max,
			this.step,
			allEqual ? properties[0].value : new SVG.Number(NaN, first.value.unit),
			this.restrictToRange,
			this.tooltip,
			this.id
		)

		result.buttonStep = this.buttonStep
		result.addChangeListener((ev) => {
			for (const property of properties) {
				property.updateValue(ev.value, true, true)
			}
		})
		result.getHTMLElement()
		return result
	}
}
