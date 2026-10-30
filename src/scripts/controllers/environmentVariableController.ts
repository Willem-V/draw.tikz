import {
	ButtonGridProperty,
	ChoiceEntry,
	ChoiceProperty,
	MainController,
	PreviewChoiceEntry,
	PreviewChoiceProperty,
	SectionHeaderProperty,
} from "../internal"

export type StylePreset = "default" | "american" | "european"

type TikzSetting = {
	environment: string[]
	ctikzset: string[]
}

export type GlobalTikzSettings = Record<OptionsChoice, string>

// export type GlobalSettings = {
// 	voltageStyle?: "american" | "european" | "straight" | "raised"
// 	currentStyle?: "american" | "european"
// 	voltageConvention?: "old" |"noold" |"RP" |"EF"
// }

type OptionsChoice =
	| "voltages"
	// | "currents"
	// | "resistors"
	// | "inductors"
	// | "logic"
	| "voltageConvention"
	| "labelOrientation"
	| "transistorArrows"

type GlobalOption = {
	key: OptionsChoice
	name: string
	tikz: "environment" | "ctikzset"
	/** with a preview, the choice is shown as pictures instead of a dropdown */
	choices: { key: string; name: string; tikz: string; preview?: string }[]
	/**
	 * the key of the choice circuitikz uses if nothing is set. Only needed if it differs from the designer default, since the setting has to be exported whenever it differs from the circuitikz default
	 */
	tikzDefault?: string
}

// const globalSettings:Record<OptionsChoice, GlobalOption> = {} as any

const voltageOption: GlobalOption = {
	key: "voltages",
	name: "Voltages",
	tikz: "environment",
	choices: [
		{ key: "american", name: "+ and − signs (American)", tikz: "american voltages" },
		{ key: "european", name: "Curved arrow (European)", tikz: "european voltages" },
		{ key: "straight", name: "Straight arrow", tikz: "straight voltages" },
		{ key: "raised", name: "Raised arrow", tikz: "raised voltages" },
	],
}

// const currentOption: GlobalOption = {
// 	key: "currents",
// 	name: "Current Style",
// 	tikz: "environment",
// 	choices: [
// 		{ key: "american", name: "American Currents", tikz: "american currents" },
// 		{ key: "european", name: "European Currents", tikz: "european currents" },
// 	],
// }

// const resistorOption: GlobalOption = {
// 	key: "resistors",
// 	name: "Resistor Style",
// 	tikz: "environment",
// 	choices: [
// 		{ key: "american", name: "American Resistors", tikz: "american resistors" },
// 		{ key: "european", name: "European Resistors", tikz: "european resistors" },
// 	],
// }

// const inductorOption: GlobalOption = {
// 	key: "inductors",
// 	name: "Inductor Style",
// 	tikz: "environment",
// 	choices: [
// 		{ key: "cute", name: "Cute Inductors", tikz: "cute inductors" },
// 		{ key: "american", name: "American Inductors", tikz: "american inductors" },
// 		{ key: "european", name: "European Inductors", tikz: "european inductors" },
// 	],
// }

// const logicOption: GlobalOption = {
// 	key: "logic",
// 	name: "Logic Style",
// 	tikz: "environment",
// 	choices: [
// 		{ key: "american", name: "American Logic Gates", tikz: "american ports" },
// 		{ key: "european", name: "European Logic Gates", tikz: "european ports" },
// 		{ key: "ieeestd", name: "IEEE Std Logic Gates", tikz: "ieeestd ports" },
// 	],
// }

const voltageConventionOption: GlobalOption = {
	key: "voltageConvention",
	name: "Voltage direction",
	tikz: "environment",
	choices: [
		{ key: "old", name: "Legacy (old)", tikz: "voltage dir=old" },
		{ key: "RP", name: "Towards the higher potential (RP)", tikz: "voltage dir=RP" },
		{ key: "EF", name: "Along the electric field (EF)", tikz: "voltage dir=EF" },
		{ key: "noold", name: "Standard (noold)", tikz: "voltage dir=nold" },
	],
}

const labelOrientationOption: GlobalOption = {
	key: "labelOrientation",
	name: "Label Orientation",
	tikz: "ctikzset",
	choices: [
		{ key: "smart", name: "Readable (smart)", tikz: "label/align=smart" },
		{ key: "rotate", name: "Rotated with the component", tikz: "label/align=rotate" },
		{ key: "straight", name: "Always horizontal", tikz: "label/align=straight" },
	],
}

/**
 * the PMOS symbol of CircuiTikZ: with an empty circle at the gate, or with the arrow at the end of the source lead
 */
function transistorPreview(withArrow: boolean): string {
	const arrow = "M25.86325 19.4474V22.49428L19.05075 19.4474L25.86325 16.40054Z"
	const circle =
		"M14.60638 29.63372c0-1.16872-.94744-2.11617-2.11618-2.11617-1.16872 0-2.11615.94745-2.11615 2.11617s.94743 2.11618 2.11615 2.11618c1.16874 0 2.11618-.94744 2.11618-2.11618Z"
	return `<svg viewBox="-1 -1 40 61" width="34" height="52" fill="none" stroke="currentColor" stroke-width=".8" stroke-linejoin="round">
		<path d="M37.57.26569v19.18203h-18.51952M19.05087 39.81972h18.51952v19.18204"/>
		<path stroke-width="1.6" d="M19.05087 15.08254v29.10236m-4.4445-24.73718v20.372"/>
		${
			withArrow ?
				`<path d="M14.60638 29.63372h-14.34069"/><path d="${arrow}" fill="currentColor" stroke="none"/>`
			:	`<path d="M10.37 29.63372H.26569"/><path d="${circle}"/>`
		}
	</svg>`
}

const transistorArrowOption: GlobalOption = {
	key: "transistorArrows",
	name: "Transistors",
	tikz: "ctikzset",
	choices: [
		{
			key: "legacy",
			name: "Without arrow (a PMOS has an empty circle at the gate)",
			tikz: "transistors/arrow pos=end",
			preview: transistorPreview(false),
		},
		{
			key: "end",
			name: "With arrow (at the end of the terminal)",
			tikz: "transistors/arrow pos=end",
			preview: transistorPreview(true),
		},
	],
	// the symbols always draw the arrows at the end of the terminal, so this is always set (never equal to a choice)
	tikzDefault: "always",
}

const STYLE_PRESETS: Record<StylePreset, Partial<Record<OptionsChoice, string>>> = {
	default: {
		voltages: "european",
		// currents: "european",
		// resistors: "american",
		// inductors: "cute",
		// logic: "american",
		voltageConvention: "noold",
		labelOrientation: "smart",
		transistorArrows: "end",
	},
	american: {
		// currents: "american",
		voltages: "american",
		// resistors: "american",
		// inductors: "american",
		// logic: "american",
	},
	european: {
		// currents: "european",
		voltages: "european",
		// resistors: "european",
		// inductors: "european",
		// logic: "european",
	},
}

export class EnvironmentVariableController {
	private static _instance: EnvironmentVariableController

	private globalSettings: GlobalTikzSettings

	private htmlElement: HTMLDivElement

	private propertyMap: Map<OptionsChoice, ChoiceProperty<ChoiceEntry>> = new Map()
	private optionsMap: Map<OptionsChoice, GlobalOption> = new Map()

	public static get instance(): EnvironmentVariableController {
		if (!EnvironmentVariableController._instance) {
			EnvironmentVariableController._instance = new EnvironmentVariableController()
		}
		return EnvironmentVariableController._instance
	}

	private constructor() {
		// Initialization code here

		const allOptions = [
			voltageOption,
			// currentOption,
			// resistorOption,
			// inductorOption,
			// logicOption,
			voltageConventionOption,
			labelOrientationOption,
			transistorArrowOption,
		]

		let defaults = STYLE_PRESETS["default"]

		this.globalSettings = {} as GlobalTikzSettings

		for (const option of allOptions) {
			const initial = option.choices.find((choice) => choice.key === defaults[option.key])
			const choiceProperty =
				option.choices.every((choice) => choice.preview) ?
					new PreviewChoiceProperty(
						option.name,
						option.choices as PreviewChoiceEntry[],
						initial as PreviewChoiceEntry
					)
				:	new ChoiceProperty(option.name, option.choices, initial)
			this.propertyMap.set(option.key, choiceProperty)

			this.globalSettings[option.key] = defaults[option.key]

			choiceProperty.addChangeListener((ev) => {
				this.globalSettings[option.key] = ev.value.key
				this.updateComponents()
			})

			this.optionsMap.set(option.key, option)
		}
	}

	public getGlobalSettings(): GlobalTikzSettings {
		return this.globalSettings
	}

	private updateComponents() {
		for (const key of this.propertyMap.keys()) {
			this.globalSettings[key as OptionsChoice] = this.propertyMap.get(key as OptionsChoice).value.key
		}
		MainController.instance.circuitComponents.forEach((component) => {
			component.update()
		})
	}

	private applyStylePreset = (style: StylePreset) => {
		let preset = STYLE_PRESETS[style]
		for (const key of Object.keys(preset)) {
			const property = this.propertyMap.get(key as OptionsChoice)
			property.updateValue(
				property.entries.find((entry) => entry.key === preset[key as OptionsChoice]),
				true,
				false
			)
		}
		this.updateComponents()
	}

	public getHTML(): HTMLDivElement {
		if (this.htmlElement) return this.htmlElement

		this.htmlElement = document.createElement("div")
		this.htmlElement.id = "envVarView"
		this.htmlElement.classList.add("container-fluid", "w-100", "m-0", "gap-3", "px-0")

		this.htmlElement.appendChild(new SectionHeaderProperty("Drawing style").getHTMLElement())
		let presetButtons = new ButtonGridProperty(
			3,
			[
				["Default", "reset_settings"],
				["American", "attach_money"],
				["European", "euro"],
			],
			[
				(ev) => {
					this.applyStylePreset("default")
				},
				(ev) => {
					this.applyStylePreset("american")
				},
				(ev) => {
					this.applyStylePreset("european")
				},
			]
		)

		this.htmlElement.appendChild(presetButtons.getHTMLElement())

		this.htmlElement.appendChild(new SectionHeaderProperty("Style details").getHTMLElement())
		for (const property of this.propertyMap.values()) {
			this.htmlElement.appendChild(property.getHTMLElement())
		}

		return this.htmlElement
	}

	public getTikzSettings(): TikzSetting {
		let environment: string[] = []
		let ctikzset: string[] = []

		let defaults = STYLE_PRESETS["default"]
		for (const key of Object.keys(defaults)) {
			const tikzDefault = this.optionsMap.get(key as OptionsChoice).tikzDefault ?? defaults[key]
			if (tikzDefault !== this.globalSettings[key as OptionsChoice]) {
				if (this.optionsMap.get(key as OptionsChoice).tikz === "environment") {
					environment.push(
						this.optionsMap
							.get(key as OptionsChoice)
							.choices.find((choice) => choice.key === this.globalSettings[key as OptionsChoice])!.tikz
					)
				} else {
					ctikzset.push(
						this.optionsMap
							.get(key as OptionsChoice)
							.choices.find((choice) => choice.key === this.globalSettings[key as OptionsChoice])!.tikz
					)
				}
			}
		}

		return { environment, ctikzset }
	}

	public toJson() {
		let saveSettings: GlobalTikzSettings = {} as GlobalTikzSettings
		let defaults = STYLE_PRESETS["default"]
		for (const key of Object.keys(this.globalSettings)) {
			if (this.globalSettings[key as OptionsChoice] !== defaults[key as OptionsChoice]) {
				saveSettings[key as OptionsChoice] = this.globalSettings[key as OptionsChoice]
			}
		}
		return saveSettings
	}

	public fromJson(saveSettings: GlobalTikzSettings) {
		let defaults = STYLE_PRESETS["default"]
		Object.assign(this.globalSettings, defaults)
		Object.assign(this.globalSettings, saveSettings)
		for (const key of Object.keys(this.globalSettings)) {
			let property = this.propertyMap.get(key as OptionsChoice)
			property.updateValue(
				property.entries.find((entry) => entry.key === this.globalSettings[key as OptionsChoice]),
				true,
				false
			)
		}
	}
}
