import hotkeys from "hotkeys-js"
import { HintBar } from "./hintBar"

/**
 * How a new wire segment goes from the previous point to the cursor, like the routing modes of EDA/PCB tools
 */
export enum WireMode {
	/** horizontal and vertical lines with one bend (TikZ -| and |-) */
	Orthogonal = "orthogonal",
	/** a 45° diagonal and a horizontal or vertical line */
	Diagonal = "45°",
	/** a straight line at any angle */
	Free = "free",
}

const modeOrder = [WireMode.Orthogonal, WireMode.Diagonal, WireMode.Free]
const storageKey = "drawtikz-wire-mode"

/**
 * The wire mode chosen by the user (remembered in the browser) and its keys while a wire is drawn:
 * Space switches the mode, / flips the bend to the other end of the segment.
 */
export class WireModes {
	private static _mode: WireMode = loadMode()
	public static get mode(): WireMode {
		return WireModes._mode
	}

	/** the bend is at the other end of the segment: vertical first (orthogonal) or straight first (45°) */
	public static flipped = false

	/** redraws the wire which is currently drawn */
	private static onChange: (() => void) | null = null

	/**
	 * activates the keys and shows the current mode while a wire is drawn
	 * @param onChange called after the mode or bend changed
	 */
	public static startPlacing(onChange: () => void) {
		if (WireModes.onChange) {
			WireModes.stopPlacing()
		}
		WireModes.onChange = onChange
		WireModes.flipped = false
		hotkeys("space", WireModes.nextMode)
		hotkeys("/", WireModes.flipBend)
		WireModes.showHints()
	}

	public static stopPlacing() {
		if (!WireModes.onChange) {
			return
		}
		WireModes.onChange = null
		hotkeys.unbind("space", WireModes.nextMode)
		hotkeys.unbind("/", WireModes.flipBend)
		HintBar.clear()
	}

	private static nextMode(ev: KeyboardEvent) {
		ev.preventDefault()
		WireModes._mode = modeOrder[(modeOrder.indexOf(WireModes._mode) + 1) % modeOrder.length]
		saveMode(WireModes._mode)
		WireModes.showHints()
		WireModes.onChange?.()
	}

	private static flipBend(ev: KeyboardEvent) {
		ev.preventDefault()
		WireModes.flipped = !WireModes.flipped
		WireModes.onChange?.()
	}

	private static showHints() {
		HintBar.show("Wire mode", WireModes._mode, [
			{ key: "Space", action: "change mode" },
			{ key: "/", action: "flip bend" },
		])
	}
}

function loadMode(): WireMode {
	try {
		const stored = localStorage.getItem(storageKey) as WireMode
		return modeOrder.includes(stored) ? stored : WireMode.Orthogonal
	} catch {
		return WireMode.Orthogonal
	}
}

function saveMode(mode: WireMode) {
	try {
		localStorage.setItem(storageKey, mode)
	} catch {
		// the mode is only a convenience, it is fine if it is not remembered
	}
}
