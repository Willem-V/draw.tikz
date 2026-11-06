import * as SVG from "@svgdotjs/svg.js"

/**
 * The color palette of a drawing: named colors which components can use instead of a fixed color. Changing an entry
 * changes all components which use it. The palette is saved in the drawing file and the entries are defined with
 * \definecolor in the exported TikZ code (with the prefix "dt", so they don't clash with the colors of the document).
 */

export type PaletteEntry = { name: string; color: string }

/** the colors of the Okabe-Ito palette, which can be told apart with all types of color blindness */
export const defaultPalette: PaletteEntry[] = [
	{ name: "Black", color: "#000000" },
	{ name: "Orange", color: "#e69f00" },
	{ name: "Sky blue", color: "#56b4e9" },
	{ name: "Green", color: "#009e73" },
	{ name: "Yellow", color: "#f0e442" },
	{ name: "Blue", color: "#0072b2" },
	{ name: "Vermilion", color: "#d55e00" },
	{ name: "Purple", color: "#cc79a7" },
]

export type PaletteChange =
	| { type: "update"; name: string }
	| { type: "rename"; name: string; newName: string }
	| { type: "remove"; name: string }
	| { type: "reset" }

/** the name of a palette color in TikZ: letters only (digits and spaces are written out so xcolor accepts it) */
export function tikzColorName(name: string): string {
	const digits = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
	const words = name
		.replace(/[0-9]/g, (digit) => " " + digits[Number(digit)] + " ")
		.split(/[^A-Za-z]+/)
		.filter((word) => word)
		.map((word) => word[0].toUpperCase() + word.slice(1))
	return "dt" + (words.join("") || "Color")
}

/**
 * a color of the palette. It is a normal color for everything which draws it, but also knows the entry it comes from.
 */
export class PaletteColor extends SVG.Color {
	public paletteName: string

	constructor(name: string, color: string) {
		super(color)
		this.paletteName = name
	}

	toTikzString(): string {
		return `{${tikzColorName(this.paletteName)}}`
	}
}

/** something which has to follow changes of the palette, e.g. a ColorProperty */
export interface PaletteUser {
	onPaletteChange(change: PaletteChange): void
}

export class Palette {
	private static _instance: Palette
	public static get instance(): Palette {
		return Palette._instance ?? (Palette._instance = new Palette())
	}

	private _entries: PaletteEntry[] = defaultPalette.map((entry) => ({ ...entry }))
	public get entries(): readonly PaletteEntry[] {
		return this._entries
	}

	private users: WeakRef<PaletteUser>[] = []
	/** called after every change, e.g. to redraw the palette editor */
	public onChange: () => void = () => {}

	public addUser(user: PaletteUser) {
		this.users.push(new WeakRef(user))
	}

	private notify(change: PaletteChange) {
		this.users = this.users.filter((ref) => ref.deref() !== undefined)
		for (const user of [...this.users]) {
			user.deref()?.onPaletteChange(change)
		}
		this.onChange()
	}

	public getColor(name: string): PaletteColor | undefined {
		const entry = this._entries.find((entry) => entry.name == name)
		return entry ? new PaletteColor(entry.name, entry.color) : undefined
	}

	/** a name which is not used yet and gives a different TikZ name */
	public uniqueName(wanted: string): string {
		const taken = (name: string) =>
			this._entries.some((entry) => entry.name == name || tikzColorName(entry.name) == tikzColorName(name))
		let name = wanted.trim() || "Color"
		for (let index = 2; taken(name); index++) {
			name = `${wanted.trim() || "Color"} ${index}`
		}
		return name
	}

	public add(name: string, color: string): string {
		const unique = this.uniqueName(name)
		this._entries.push({ name: unique, color: toHex(color) })
		this.onChange()
		return unique
	}

	public setColor(name: string, color: string) {
		const entry = this._entries.find((entry) => entry.name == name)
		if (entry && entry.color != toHex(color)) {
			entry.color = toHex(color)
			this.notify({ type: "update", name: name })
		}
	}

	public rename(name: string, newName: string) {
		const entry = this._entries.find((entry) => entry.name == name)
		if (!entry || !newName.trim() || newName == name) {
			return
		}
		const unique = this.uniqueName(newName)
		entry.name = unique
		this.notify({ type: "rename", name: name, newName: unique })
	}

	/** components which used the color keep it as a normal color */
	public remove(name: string) {
		const index = this._entries.findIndex((entry) => entry.name == name)
		if (index >= 0) {
			this._entries.splice(index, 1)
			this.notify({ type: "remove", name: name })
		}
	}

	/**
	 * @returns undefined if the palette is the default one, which is not saved in the drawing
	 */
	public toJson(): PaletteEntry[] | undefined {
		const same =
			this._entries.length == defaultPalette.length &&
			this._entries.every(
				(entry, i) => entry.name == defaultPalette[i].name && entry.color == defaultPalette[i].color
			)
		return same ? undefined : this._entries.map((entry) => ({ ...entry }))
	}

	/** loads the palette of a drawing (before its components are created), the default palette if there is none */
	public fromJson(entries?: PaletteEntry[]) {
		const source = Array.isArray(entries) && entries.length > 0 ? entries : defaultPalette
		this._entries = source.map((entry) => ({ name: String(entry.name), color: toHex(entry.color) }))
		this.notify({ type: "reset" })
	}

	/** the \definecolor commands of the palette entries which are used in the exported code */
	public tikzDefinitions(code: string): string[] {
		return this._entries
			.filter((entry) => code.includes(`{${tikzColorName(entry.name)}}`))
			.map((entry) => {
				const color = new SVG.Color(entry.color).rgb()
				return `\\definecolor{${tikzColorName(entry.name)}}{RGB}{${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}}`
			})
	}
}

function toHex(color: string): string {
	try {
		return new SVG.Color(color).toHex()
	} catch {
		return "#000000"
	}
}

/**
 * the color of a saved component: the palette entry, if the color comes from the palette and the entry still exists (so
 * changes of the palette in the file apply), otherwise the saved color
 */
export function resolveColor(color: string | undefined, paletteName?: string): SVG.Color | null {
	if (paletteName) {
		const fromPalette = Palette.instance.getColor(paletteName)
		if (fromPalette) {
			return fromPalette
		}
	}
	return color && color != "default" ? new SVG.Color(color) : null
}

/** the name of the palette entry of a color, if it is from the palette */
export function paletteNameOf(color: SVG.Color | null | undefined): string | undefined {
	return color instanceof PaletteColor ? color.paletteName : undefined
}
