import {
	ComponentSymbol,
	CoordinateShift,
	DiagnosticsCollector,
	DrawStatement,
	ImportResult,
	MainController,
	NodeStatement,
	TikzCoordinate,
	TikzDocument,
	TikzOption,
	TikzOptionList,
	TikzPathConnector,
	TikzPathElement,
	TikzStatement,
	basicDirections,
	parseTikz,
	strokeStyleChoices,
} from "../internal"
import type { ComponentSaveObject, PositionedLabel } from "../internal"

/**
 * Stage 6/7 — translate a parsed {@link TikzDocument} into Designer
 * {@link ComponentSaveObject}s. The output plugs straight into `applyImportResult`, which hands
 * each entry to `CircuitComponent.fromJson`.
 *
 * The translation is deliberately best-effort:
 *  • Anything we can't map lands in diagnostics (warning for "skipped", info for "approximated").
 *  • We never throw — a surprising construct is always better to flag and skip than to abort.
 *  • Diagnostics carry the original line/column so the Import Report modal can point at the
 *    offending source.
 *
 * The transformer isn't a full CircuiTikZ compiler. It's a pragmatic importer whose target is
 * CircuiTikZ output produced by Designer, and hand-written CircuiTikZ that stays within the set
 * of primitives Designer itself can produce. Things it understands:
 *
 *   • `\draw (a,b) to[R=1] (c,d);`             → PathSymbolComponent
 *   • `\draw (a,b) -- (c,d);` / `-|` / `|-`    → WireComponent(s)
 *   • `\draw (a,b) -- (c,d) -- (e,f);`         → multi-segment WireComponent
 *   • `\node[nmos] (M1) at (x,y) {};`          → NodeSymbolComponent
 *   • `\node (n1) at (x,y) {text};`            → RectangleComponent with text
 *   • Named references `(R1)` / `(R1.north)`   → resolved against earlier coordinates
 *   • `\coordinate (p) at (x,y);`              → adds a named point (no component)
 *   • `\ctikzset{...}`, `\usetikzlibrary{...}` → already hoisted by the parser; ignored here
 *
 * Things it doesn't handle (and why):
 *   • Arbitrary Bezier curves / `plot` / `arc`  — Designer has no equivalent primitive.
 *   • `pic`, `rectangle`, `circle` filled shapes — partial support via shape detection below.
 */
/**
 * Finds the position of an anchor (e.g. "D" of `\node[nmos] (M1)`) of an imported component, given as a save object.
 * The app creates the component to get the exact position (rotation, mirroring, options). Without a resolver (e.g. in the
 * tests) anchors fall back to the position of the component.
 */
export type AnchorResolver = (component: ComponentSaveObject, anchor: string) => { x: number; y: number } | undefined

export function transformTikz(sourceText: string, resolveAnchor?: AnchorResolver): ImportResult {
	const collector = new DiagnosticsCollector(sourceText)
	const doc = parseTikz(sourceText, collector)
	const ctx = new TransformContext(collector, resolveAnchor)

	const components: ComponentSaveObject[] = []
	for (const stmt of doc.statements) {
		try {
			const produced = transformStatement(stmt, ctx)
			if (produced && produced.length > 0) components.push(...produced)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			collector.error("Internal error while converting a statement — skipping it.", {
				line: stmt.line,
				column: stmt.column,
				code: "transform-internal",
				suggestion: "Raw message: " + msg,
			})
		}
	}

	// If we parsed something but produced nothing, and there are no errors yet, that's a notable
	// silent failure — surface it so the user isn't left staring at an empty canvas wondering why.
	if (components.length === 0 && doc.statements.length > 0 && !collector.hasErrors()) {
		collector.warning("The CircuiTikZ code parsed cleanly but didn't produce any components I could render.", {
			code: "transform-empty",
			suggestion:
				"Check that the file contains \\draw / \\node statements at the top level. Lines hidden inside a \\begin{tikzpicture} are fine — just make sure they use recognised components.",
		})
	}

	const hasErrors = collector.hasErrors()
	return {
		format: "tikz",
		success: components.length > 0 && !hasErrors ? true : components.length > 0,
		components,
		diagnostics: collector.all(),
		sourceText,
	}
}

// ===================================================================================== //
// Transform context: symbol lookup, named-point table, diagnostics
// ===================================================================================== //

/**
 * CircuiTikZ short-form aliases. In CircuiTikZ itself, `to[R=1k]` expands into the currently
 * configured resistor symbol (american or european depending on `\ctikzset{resistors/style=...}`).
 * The Designer's symbol library stores the expanded names (`"american resistor"`, …) so we need
 * this map to resolve the short form.
 *
 * Each entry lists candidate long-names in preference order — if the first isn't available (some
 * bundles ship only one style), the next is tried. Lowercase keys; lookup lowercases the input.
 */
const CIRCUITIKZ_ALIASES: Record<string, string[]> = {
	// Passives
	r: ["american resistor", "european resistor", "generic"],
	vr: ["american potentiometer", "european potentiometer", "american resistor"],
	l: ["american inductor", "cute inductor", "european inductor"],
	vl: ["american inductor", "cute inductor"],
	c: ["capacitor"],
	vc: ["capacitor"],
	// Diodes
	d: ["empty diode", "full diode", "empty led", "full led"],
	led: ["empty led", "full led"],
	zd: ["empty Zener diode", "full Zener diode"],
	zzd: ["empty ZZener diode", "full ZZener diode"],
	sd: ["empty Schottky diode", "full Schottky diode"],
	td: ["empty tunnel diode", "full tunnel diode"],
	pd: ["empty photodiode", "full photodiode"],
	tvsd: ["empty TVS diode", "full TVS diode"],
	sr: ["empty Shockley diode", "full Shockley diode"],
	// Sources
	v: ["american voltage source", "european voltage source", "battery"],
	i: ["american current source", "european current source"],
	sv: ["sinusoidal voltage source", "american voltage source"],
	si: ["sinusoidal current source", "american current source"],
	iv: ["american voltage source"],
	// Meters
	ammeter: ["ammeter"],
	voltmeter: ["voltmeter"],
	ohmmeter: ["rmeter"],
	// Switches / misc
	sw: ["cute switch", "switch"],
	short: [], // `to[short]` means "just a wire" — empty candidate list so we fall through to wire.
	battery: ["battery"],
	battery1: ["battery1"],
	battery2: ["battery2"],
	lamp: ["lamp"],
	bulb: ["lamp"],
	ground: ["ground"],
	// supplies: CircuiTikZ has vdd/vss as aliases of vcc/vee
	vdd: ["vcc"],
	vss: ["vee"],
}

/**
 * CircuiTikZ long anchor names and the names of the pins in the symbol library
 */
const ANCHOR_ALIASES: Record<string, string> = {
	drain: "D",
	source: "S",
	gate: "G",
	base: "B",
	collector: "C",
	emitter: "E",
	start: "START",
	end: "END",
}

class TransformContext {
	/** `MainController.instance.symbols` snapshot — captured once per import for speed. */
	private readonly symbols: ComponentSymbol[]
	/**
	 * Index from tikzName (both the canonical version and the dash-separated variant seen in
	 * CircuiTikZ) to the ComponentSymbol.
	 */
	private readonly symbolsByTikzName: Map<string, ComponentSymbol> = new Map()
	/** Resolved named points (`\coordinate (p) at (0,0)` or `\node (M1) at (...)`). */
	private readonly namedPoints: Map<string, { x: number; y: number }> = new Map()
	/** Named components (`\node[nmos] (M1)`, `to[R, name=R1]`), to resolve their anchors like `(M1.D)` */
	readonly namedComponents: Map<string, ComponentSaveObject> = new Map()

	constructor(
		public readonly collector: DiagnosticsCollector,
		private readonly resolveAnchor?: AnchorResolver
	) {
		this.symbols = MainController.instance?.symbols ?? []
		for (const s of this.symbols) {
			if (s.tikzName) {
				this.symbolsByTikzName.set(s.tikzName, s)
				// Some CircuiTikZ authors write "american-resistor" for "american resistor" when
				// dashes are stripped from spaces — accept both.
				this.symbolsByTikzName.set(s.tikzName.replace(/\s+/g, "-"), s)
				// Lowercase variant so case-insensitive lookup works for all symbols.
				this.symbolsByTikzName.set(s.tikzName.toLowerCase(), s)
			}
		}
	}

	findSymbol(name: string): ComponentSymbol | undefined {
		// 1. Direct match (canonical, dash-to-space, or lowercased form).
		const direct =
			this.symbolsByTikzName.get(name) ??
			this.symbolsByTikzName.get(name.replace(/-/g, " ")) ??
			this.symbolsByTikzName.get(name.toLowerCase())
		if (direct) return direct
		// 2. CircuiTikZ short-form aliases (R, V, L, C, D, ...). Try each candidate long-name in
		// preference order until one resolves.
		const aliases = CIRCUITIKZ_ALIASES[name.toLowerCase()]
		if (aliases) {
			for (const candidate of aliases) {
				const hit = this.symbolsByTikzName.get(candidate) ?? this.symbolsByTikzName.get(candidate.toLowerCase())
				if (hit) return hit
			}
		}
		return undefined
	}

	rememberPoint(name: string, point: { x: number; y: number }): void {
		this.namedPoints.set(name, point)
	}

	rememberComponent(name: string, component: ComponentSaveObject): void {
		this.namedComponents.set(name, component)
	}

	/**
	 * the position of a named point, a named component or an anchor of a named component (`M1.D`, `M1.drain`, `ic.pin 15`)
	 * @param anchor the anchor as parsed separately, otherwise it can be part of the name (`M1.D`, e.g. in `(M1.D |- R1)`)
	 */
	lookupPoint(name: string, anchor?: string): { x: number; y: number } | undefined {
		if (!anchor) {
			const point = this.namedPoints.get(name)
			if (point) return point
			const dot = name.indexOf(".")
			if (dot < 0) return undefined
			anchor = name.slice(dot + 1)
			name = name.slice(0, dot)
		}
		const component = this.namedComponents.get(name)
		const anchorPos = component ? this.anchorOf(component, anchor) : undefined
		if (!anchorPos && this.namedPoints.has(name)) {
			this.collector.info(`The anchor '${name}.${anchor}' is not known, using the position of '${name}'.`, {
				code: "transform-anchor-unknown",
			})
		}
		return anchorPos ?? this.namedPoints.get(name)
	}

	/**
	 * the position of an anchor of a component, see {@link AnchorResolver}
	 */
	anchorOf(component: ComponentSaveObject, anchor: string): { x: number; y: number } | undefined {
		if (!this.resolveAnchor) return undefined
		return this.resolveAnchor(component, ANCHOR_ALIASES[anchor.toLowerCase()] ?? anchor)
	}
}

// ===================================================================================== //
// Statement dispatch
// ===================================================================================== //

function transformStatement(stmt: TikzStatement, ctx: TransformContext): ComponentSaveObject[] | null {
	switch (stmt.kind) {
		case "draw":
			return transformDraw(stmt, ctx)
		case "node":
			return transformNode(stmt, ctx)
		// Environment-level statements were hoisted by the parser already.
		case "begin-tikzpicture":
		case "end-tikzpicture":
		case "ctikzset":
		case "usetikzlibrary":
			return null
		case "unknown":
			// A diagnostic was already emitted at parse-time; no extra noise here.
			return null
		default:
			return null
	}
}

// ===================================================================================== //
// \draw and \path statements
// ===================================================================================== //

/**
 * Convert a `\draw` statement into one or more save objects. A single `\draw` can produce:
 *  • zero components (if it's malformed or empty),
 *  • one path-symbol (`\draw (a) to[R] (b);`),
 *  • one or more wire segments joined at corner points,
 *  • embedded node components for any inline `node[...]{...}` in the path.
 */
function transformDraw(stmt: DrawStatement, ctx: TransformContext): ComponentSaveObject[] {
	const produced: ComponentSaveObject[] = []

	// 1. Resolve all coordinates in order and note which connector separates each pair.
	const resolved = resolvePathElements(stmt.elements, ctx, stmt.line)
	if (resolved.points.length < 2) {
		// Nothing drawable. If there's an embedded node, emit that; otherwise warn.
		if (resolved.embeddedNodes.length > 0) {
			for (const en of resolved.embeddedNodes) produced.push(en)
			return produced
		}
		ctx.collector.info("A \\draw statement didn't have at least two coordinates — ignoring it.", {
			line: stmt.line,
			column: stmt.column,
			code: "transform-draw-sparse",
		})
		return produced
	}

	// 2. Shape detection — `(a) rectangle (b)` produces a RectangleComponent.
	const shapeElem = resolved.connectors.find((c) => c.keyword === "rectangle" || c.keyword === "circle")
	if (shapeElem && resolved.points.length === 2) {
		if (shapeElem.keyword === "rectangle") {
			produced.push(buildRectangleSave(resolved.points[0], resolved.points[1], stmt))
		} else {
			produced.push(buildEllipseSave(resolved.points[0], resolved.points[1], stmt))
		}
		for (const en of resolved.embeddedNodes) produced.push(en)
		return produced
	}

	// 3. Walk the connector list and emit a path-symbol for each `to[Symbol=...]` clause, grouping
	// runs of plain connectors (--, -|, |-) into wires. This handles both the simple
	//   \draw (a) to[R=1k] (b);
	// and the chained CircuiTikZ idiom
	//   \draw (a) to[V] (b) to[R] (c) to[R] (d) -- (a);
	// without the chained form collapsing into a single unadorned wire.
	const topLevelHit = stmt.options ? findSymbolInOptions(stmt.options.entries, ctx, false) : null
	let topLevelApplied = false

	// Wire-run buffer state.
	let wireStart = -1
	let wireDirs: string[] = []
	let wireStartArrow: string | undefined
	let wireEndArrow: string | undefined

	const flushWire = (endPointIdx: number) => {
		if (wireStart === -1) return
		const segPoints = resolved.points.slice(wireStart, endPointIdx + 1)
		if (segPoints.length >= 2) {
			const save: any = {
				type: "wire",
				points: segPoints,
				directions: wireDirs.slice(),
				stroke: strokeFromOptions(stmt.options?.entries ?? []),
			}
			if (wireStartArrow) save.startArrow = wireStartArrow
			if (wireEndArrow) save.endArrow = wireEndArrow
			produced.push(save as ComponentSaveObject)
		}
		wireStart = -1
		wireDirs = []
		wireStartArrow = undefined
		wireEndArrow = undefined
	}

	for (let i = 0; i < resolved.connectors.length; i++) {
		const c = resolved.connectors[i]
		let symbolHit: { symbol: ComponentSymbol; options: TikzOption[]; matchedKey: string } | null = null
		if (c.toOptions) symbolHit = findSymbolInOptions(c.toOptions.entries, ctx, false)
		// `\draw[R] (a) -- (b)` idiom: top-level symbol applies to the single segment if no
		// to-clause claimed it. We only apply it once.
		if (!symbolHit && topLevelHit && !topLevelApplied && resolved.connectors.length === 1) {
			symbolHit = topLevelHit
			topLevelApplied = true
		}

		if (symbolHit) {
			flushWire(i)
			produced.push(buildPathSymbolSave(symbolHit, resolved.points[i], resolved.points[i + 1], stmt, ctx))
			continue
		}

		// Plain connector — extend the current wire run.
		if (wireStart === -1) wireStart = i
		const op = c.operator
		let dir = "--"
		if (op === "-|") dir = "-|"
		else if (op === "|-") dir = "|-"
		else if (op === "->") wireEndArrow = wireEndArrow ?? "to.tip"
		else if (op === "<-") wireStartArrow = wireStartArrow ?? "to.tip"
		else if (op === "<->") {
			wireStartArrow = wireStartArrow ?? "to.tip"
			wireEndArrow = wireEndArrow ?? "to.tip"
		} else if (op !== "--" && op !== "to") {
			ctx.collector.info(`Treating path connector '${op}' as a straight wire.`, {
				line: c.line,
				column: c.column,
				code: "transform-connector",
			})
		}
		wireDirs.push(dir)
	}
	flushWire(resolved.points.length - 1)

	for (const en of resolved.embeddedNodes) produced.push(en)
	return produced
}

// ------------- Resolve a path's elements into a coord / connector sequence --------------- //

interface ResolvedPath {
	/** Concrete points in Designer pixel space — first to last along the path. */
	points: { x: number; y: number }[]
	/** One less than `points.length`; describes what joined points[i] to points[i+1]. */
	connectors: ResolvedConnector[]
	/** Embedded `node[...]{...}` save-objects picked up along the path. */
	embeddedNodes: ComponentSaveObject[]
}

interface ResolvedConnector {
	operator: string
	/** A path-keyword picked up between coordinates, e.g. "to", "rectangle", "circle". */
	keyword?: string
	toOptions?: TikzOptionList
	line: number
	column: number
}

function resolvePathElements(elements: TikzPathElement[], ctx: TransformContext, stmtLine: number): ResolvedPath {
	const points: { x: number; y: number }[] = []
	const connectors: ResolvedConnector[] = []
	const embeddedNodes: ComponentSaveObject[] = []
	// Pending connector bookkeeping — the operator/keyword collected since the last coordinate.
	let pendingConn: ResolvedConnector | null = null

	const flushPendingIfCoordinatePresent = () => {
		// When a connector was declared but didn't get a trailing coordinate (e.g. trailing "--"),
		// we drop it silently.
		pendingConn = null
	}

	for (let i = 0; i < elements.length; i++) {
		const el = elements[i]
		switch (el.kind) {
			case "coord": {
				const last = points[points.length - 1]
				const abs = coordToAbsolute(el.coord, ctx, last, el.line)
				if (!abs) break
				// Apply ++ relative semantics.
				let p = abs
				if (el.relative && last) p = { x: last.x + abs.x, y: last.y + abs.y }
				points.push(p)
				if (pendingConn && points.length > 1) {
					connectors.push(pendingConn)
					pendingConn = null
				}
				break
			}
			case "named-point": {
				const pt = ctx.lookupPoint(el.name, el.anchor)
				if (!pt) {
					ctx.collector.warning(`Named point '${el.name}' isn't defined — skipping the coordinate.`, {
						line: el.line,
						column: el.column,
						code: "transform-named-point",
						suggestion: "Named points must be declared with \\coordinate or \\node earlier in the file.",
					})
					flushPendingIfCoordinatePresent()
					break
				}
				points.push(applyShift(pt, el.shift))
				if (pendingConn && points.length > 1) {
					connectors.push(pendingConn)
					pendingConn = null
				}
				break
			}
			case "connector": {
				// Multiple connectors in a row usually means the source wrote something like "-- --";
				// just use the latest one.
				pendingConn = { operator: el.operator, line: el.line, column: el.column }
				break
			}
			case "to": {
				// "to[options]" — like a single connector with options attached.
				pendingConn = {
					operator: "to",
					keyword: "to",
					toOptions: el.options,
					line: el.line,
					column: el.column,
				}
				break
			}
			case "embedded-node": {
				// Embedded nodes attach to the previous coordinate — convert and continue.
				const pos = points[points.length - 1]
				if (pos) {
					// Register the node's name (if any) so later `(drain)` or `(M1)` references
					// can resolve. Covers both `coordinate (drain)` (pure bookkeeping, no body)
					// and `node[nmos] (M1) {}` (named symbol placement).
					if (el.name) ctx.rememberPoint(el.name, pos)
					const save = buildEmbeddedNodeSave(el, pos, ctx)
					if (save) embeddedNodes.push(save)
				} else {
					ctx.collector.info("An inline node appeared before any coordinate — skipping it.", {
						line: el.line,
						column: el.column,
						code: "transform-embedded-node-orphan",
					})
				}
				break
			}
			case "unknown-element": {
				// A stray keyword — "rectangle", "circle", "arc", etc. Tag as the connector's
				// keyword so shape detection can use it.
				if (pendingConn) {
					pendingConn.keyword = el.source.trim() || pendingConn.keyword
				} else {
					pendingConn = {
						operator: "--",
						keyword: el.source.trim(),
						line: el.line,
						column: el.column,
					}
					if (el.source.trim() !== "rectangle" && el.source.trim() !== "circle") {
						ctx.collector.info(
							`Path keyword '${el.source.trim()}' isn't fully supported — treating it as a straight connection.`,
							{
								line: el.line,
								column: el.column,
								code: "transform-path-keyword",
							}
						)
					}
				}
				break
			}
		}
	}

	void stmtLine // reserved for future "path didn't start with a coordinate" diagnostics
	return { points, connectors, embeddedNodes }
}

// ------------- Path-symbol detection --------------------------------------------------- //

/**
 * Walk option entries looking for the first one whose key matches a known symbol's tikzName —
 * directly or through the CircuiTikZ short-form alias table.
 * `nodeMode` restricts to node symbols for \node statements.
 * `matchedKey` is the original option key the user wrote (e.g. "R") — needed later to recognise
 * the "R=1k" label idiom when the symbol's long tikzName is "american resistor".
 */
function findSymbolInOptions(
	entries: TikzOption[],
	ctx: TransformContext,
	nodeMode: boolean
): { symbol: ComponentSymbol; options: TikzOption[]; matchedKey: string } | null {
	for (const e of entries) {
		const candidate = ctx.findSymbol(e.key)
		if (candidate && candidate.isNodeSymbol === nodeMode) {
			return { symbol: candidate, options: entries, matchedKey: e.key }
		}
	}
	return null
}

// ------------- PathSymbolComponent save-object ------------------------------------------- //

function buildPathSymbolSave(
	hit: { symbol: ComponentSymbol; options: TikzOption[]; matchedKey: string },
	start: { x: number; y: number },
	end: { x: number; y: number },
	stmt: DrawStatement,
	ctx: TransformContext
): ComponentSaveObject {
	// Collect any extra options the symbol recognises — best-effort string matching against
	// possibleOptions and enumOptions.
	const recognised = recognisedSymbolOptions(hit)

	// Capture `name=...` and `<label>=value` where present. We recognise `=value` on the symbol's
	// primary key as the component label (the "R=1k" idiom). The primary key is whatever the user
	// wrote — either the CircuiTikZ short form (R) or the canonical tikzName (american resistor).
	let label: string | undefined
	let labelOtherSide = false
	let name: string | undefined
	for (const o of hit.options) {
		if (!o.value) continue
		if (o.key === hit.matchedKey || o.key === hit.symbol.tikzName || o.key === "l" || o.key === "l^") {
			label = o.value
		} else if (o.key === "l_") {
			label = o.value
			labelOtherSide = true
		} else if (o.key === "name") {
			name = o.value
		}
	}

	const save: any = {
		type: "path",
		id: hit.symbol.tikzName,
		points: [start, end],
	}
	if (recognised.length > 0) save.options = recognised
	if (name) {
		save.name = name
		// `(R1)` is the middle, anchors like `(R1.start)` are resolved via the component
		ctx.rememberPoint(name, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
		ctx.rememberComponent(name, save)
	}
	if (label) {
		save.label = { value: labelToMath(label), otherSide: labelOtherSide }
	}
	return save as ComponentSaveObject
}

/**
 * the value of a label for the label property of the app, which is always math: `{$R_L$}` → `R_L`, `1k` → `\text{1k}`
 */
function labelToMath(raw: string): string {
	let text = raw.trim()
	while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim()
	const math = /^\$(.*)\$$/s.exec(text)
	return math ? math[1] : `\\text{${text}}`
}

// ------------- Shape primitives --------------------------------------------------------- //

function buildRectangleSave(
	a: { x: number; y: number },
	b: { x: number; y: number },
	stmt: DrawStatement
): ComponentSaveObject {
	const x = (a.x + b.x) / 2
	const y = (a.y + b.y) / 2
	const entries = stmt.options?.entries ?? []
	const stroke = strokeFromOptions(entries)
	// the size in the app includes the line, TikZ draws the line centered on the path
	const lineWidth = lengthToPixels(stroke.width)
	return {
		type: "rect",
		position: { x, y },
		size: { x: Math.abs(a.x - b.x) + lineWidth, y: Math.abs(a.y - b.y) + lineWidth },
		stroke,
		fill: fillFromOptions(entries),
	} as unknown as ComponentSaveObject
}

function buildEllipseSave(
	a: { x: number; y: number },
	b: { x: number; y: number },
	stmt: DrawStatement
): ComponentSaveObject {
	// CircuiTikZ `circle` uses the second coord's x as radius. We support the common form
	// `(cx,cy) circle (r)` by interpreting b as {x:r, y:r}.
	const position = { x: a.x, y: a.y }
	const radius = Math.abs(b.x) || Math.abs(b.y) || 10
	const entries = stmt.options?.entries ?? []
	const stroke = strokeFromOptions(entries)
	// the size of an ellipse in the app is the outer width/height including the line
	const diameter = 2 * radius + lengthToPixels(stroke.width)
	return {
		type: "ellipse",
		position,
		size: { x: diameter, y: diameter },
		stroke,
		fill: fillFromOptions(entries),
	} as unknown as ComponentSaveObject
}

// ===================================================================================== //
// \node and \coordinate statements
// ===================================================================================== //

function transformNode(stmt: NodeStatement, ctx: TransformContext): ComponentSaveObject[] | null {
	const saves = transformSingleNode(stmt, ctx) ?? []
	// the other nodes of the statement: labels of a named component (as exported by this app) or separate nodes
	for (const following of stmt.following ?? []) {
		if (attachNodeAsLabel(following, ctx)) continue
		if (saves.length === 1 && attachNodeAsRectangleText(following, saves[0])) continue
		saves.push(...(transformSingleNode(following, ctx) ?? []))
	}
	return saves.length > 0 ? saves : null
}

function transformSingleNode(stmt: NodeStatement, ctx: TransformContext): ComponentSaveObject[] | null {
	// Resolve the coordinate first so it's available both for the output and for the named-point
	// table.
	let pos: { x: number; y: number } | undefined
	if (stmt.at) {
		const abs = coordToAbsolute(stmt.at, ctx, undefined, stmt.line)
		if (abs) pos = abs
	}

	if (stmt.name && pos) ctx.rememberPoint(stmt.name, pos)

	// \coordinate (without a label) is pure bookkeeping — no visible component.
	if (stmt.command === "coordinate") return null

	if (!pos) {
		ctx.collector.warning("A \\node didn't have an 'at (x,y)' position I could understand — skipping it.", {
			line: stmt.line,
			column: stmt.column,
			code: "transform-node-no-pos",
			suggestion: "Write the position as `at (x,y)` with numeric coordinates.",
		})
		return null
	}

	// Did the user tag it with a node-symbol name?
	if (stmt.options) {
		const hit = findSymbolInOptions(stmt.options.entries, ctx, true)
		if (hit) {
			const save = buildNodeSymbolSave(hit, pos, stmt.name, stmt.label, ctx)
			if (stmt.name) ctx.rememberPoint(stmt.name, save.position)
			return [save]
		}
	}

	const shapeSave = stmt.options ? buildShapeNodeSave(stmt, stmt.options.entries, pos) : null
	if (shapeSave) return [shapeSave]

	// Fall-back: a plain node with a label renders as a rectangle with text.
	const textContent = stmt.label ?? ""
	const save: any = {
		type: "rect",
		position: pos,
		size: { x: estimateTextWidthPx(textContent), y: 24 },
	}
	if (stmt.name) save.name = stmt.name
	if (textContent.length > 0) {
		save.text = { text: textContent }
	}
	return [save as ComponentSaveObject]
}

/**
 * makes a text node placed at an anchor of a named node symbol the label of that symbol, which is how this app exports
 * labels: `\node[nmos] (N1) at (0,0) {} node[anchor=west] at ([xshift=0.1cm]N1.text) {$M_1$};`
 * @returns if the node became a label
 */
function attachNodeAsLabel(stmt: NodeStatement, ctx: TransformContext): boolean {
	const at = stmt.at
	if (at?.kind !== "named" || !at.anchor || !stmt.label || stmt.options?.entries.some((e) => e.key === "draw")) {
		return false
	}
	const component = ctx.namedComponents.get(at.name) as NodeSave | undefined
	if (component?.type !== "node" || component.label) return false

	// `text` is the default label position, otherwise one of the basic directions (`north east` -> `northeast`)
	const directionKey = (name: string) => basicDirections.find((d) => d.key !== "default" && d.name === name)?.key
	let position = at.anchor === "text" ? "default" : directionKey(at.anchor)
	if (!position) return false
	// the anchors of a rotated or mirrored node turn with it, the label position of the app is relative to the canvas
	if (position !== "default" && position !== "center") position = canvasDirectionKey(position, component)
	const anchorName = stmt.options?.entries.find((e) => e.key === "anchor")?.value?.trim() ?? "center"
	const anchor = directionKey(anchorName)
	if (!anchor) return false

	const label: PositionedLabel = { value: labelToMath(stmt.label), anchor, position }
	// the export moves the label away from its anchor by (distance - 0.12cm) with xshift/yshift
	const direction = basicDirections.find((d) => d.key === anchor).direction
	const shiftCm = { x: lengthToPixels(at.shift?.x) / CM_TO_PX, y: lengthToPixels(at.shift?.y) / CM_TO_PX }
	const extra =
		direction.x !== 0 ? -shiftCm.x / direction.x
		: direction.y !== 0 ? shiftCm.y / direction.y
		: 0
	if (Math.abs(extra) > 1e-6) {
		// a string like "0.2cm" is also accepted when loading (keeps svg.js out of the importer)
		label.distance = `${Math.round((0.12 + extra) * 1000) / 1000}cm` as unknown as PositionedLabel["distance"]
	}
	component.label = label
	return true
}

/**
 * a rectangle or ellipse for `\node[shape=rectangle, draw, minimum width=2cm, minimum height=1cm] at (0,0) {text};`, which
 * is also how this app exports them
 */
function buildShapeNodeSave(
	stmt: NodeStatement,
	entries: TikzOption[],
	pos: { x: number; y: number }
): ComponentSaveObject | null {
	const shape = entries.find((e) => e.key === "shape")?.value?.trim() ?? entries.find((e) => SHAPES.has(e.key))?.key
	if (!shape || !SHAPES.has(shape)) return null

	const drawn = entries.some((e) => e.key === "draw")
	const stroke: StrokeSave = drawn ? strokeFromOptions(entries) : { opacity: 0 }
	const lineWidth = drawn ? lengthToPixels(stroke.width) : 0
	const minimum = (key: string) => lengthToPixels(entries.find((e) => e.key === key)?.value)
	const minimumSize = minimum("minimum size")
	let width = Math.max(minimum("minimum width"), minimumSize)
	let height = Math.max(minimum("minimum height"), minimumSize)
	if (shape === "circle") height = width = Math.max(width, height)
	// TikZ grows a node to fit its text, the app does not: at least the estimated text size
	const text = stmt.label?.trim() ?? ""
	if (text) {
		width = Math.max(width, estimateTextWidthPx(text))
		height = Math.max(height, 24)
	}
	if (width === 0 || height === 0) return null

	const save: any = {
		type: shape === "rectangle" ? "rect" : "ellipse",
		position: pos,
		size: { x: width + lineWidth, y: height + lineWidth },
		stroke,
		fill: fillFromOptions(entries),
	}
	const rotation = numericOption(entries, "rotate")
	if (rotation) save.rotation = rotation
	if (stmt.name) save.name = stmt.name
	// only rectangles have text in the app
	if (text && save.type === "rect") save.text = { text: text }
	return save as ComponentSaveObject
}

const SHAPES = new Set(["rectangle", "ellipse", "circle"])

/** the stroke of a save object (StrokeInfo with the width as string, which loading also accepts) */
type StrokeSave = { width?: string; color?: string; opacity?: number; style?: string }

/** line widths of the TikZ style keys in pt */
const LINE_WIDTH_KEYS: Record<string, number> = {
	"ultra thin": 0.1,
	"very thin": 0.2,
	"thin": 0.4,
	"semithick": 0.6,
	"thick": 0.8,
	"very thick": 1.2,
	"ultra thick": 1.6,
}

/**
 * the stroke of a save object from TikZ options like `draw=red, line width=1pt, dashed, draw opacity=0.5`.
 * The width is always set, because TikZ's default (0.4pt) is not the default of the app (1pt).
 */
function strokeFromOptions(entries: TikzOption[]): StrokeSave {
	let width = "0.4pt"
	for (const e of entries) {
		if (e.key === "line width" && e.value && lengthToPixels(e.value) > 0) width = e.value.trim()
		else if (e.value === undefined && e.key in LINE_WIDTH_KEYS) width = LINE_WIDTH_KEYS[e.key] + "pt"
	}
	const stroke: StrokeSave = { width }
	const color = colorFromTikz(entries.find((e) => (e.key === "draw" || e.key === "color") && e.value)?.value)
	if (color) stroke.color = color
	const opacity = numericOption(entries, "draw opacity") ?? numericOption(entries, "opacity")
	if (opacity !== undefined) stroke.opacity = opacity
	const style = strokeStyleKey(entries, lengthToPixels(width))
	if (style) stroke.style = style
	return stroke
}

/**
 * the fill of a save object from `fill=blue, fill opacity=0.3` or nothing if it is not filled
 */
function fillFromOptions(entries: TikzOption[]): { color: string; opacity?: number } | undefined {
	const fill = entries.find((e) => e.key === "fill")
	if (!fill) return undefined
	// `fill` without a color fills with the line color (black by default)
	const color = colorFromTikz(fill.value) ?? colorFromTikz(entries.find((e) => e.key === "color")?.value) ?? "black"
	const opacity = numericOption(entries, "fill opacity") ?? numericOption(entries, "opacity")
	return opacity !== undefined ? { color, opacity } : { color }
}

/**
 * the key of a line style of the app for TikZ's named styles (`densely dashed`) or a `dash pattern={on 4pt off 4pt}` as
 * the app exports it (multiples of the line width)
 */
function strokeStyleKey(entries: TikzOption[], lineWidthPx: number): string | undefined {
	const named = strokeStyleChoices.find((choice) =>
		entries.some((e) => e.value === undefined && e.key === choice.name)
	)
	if (named) return named.key

	const pattern = entries.find((e) => e.key === "dash pattern")?.value
	if (!pattern || !(lineWidthPx > 0)) return undefined
	const lengths = [...pattern.matchAll(/\b(?:on|off)\s+([-+\d.]+\s*[a-z]*)/gi)].map(
		(m) => lengthToPixels(m[1]) / lineWidthPx
	)
	return strokeStyleChoices.find(
		(choice) =>
			choice.dasharray.length === lengths.length &&
			choice.dasharray.every((length, i) => Math.abs(length - lengths[i]) < 0.05)
	)?.key
}

/**
 * a css color for a TikZ color: `{rgb,255:red,10;green,20;blue,30}` (as exported by the app) or a plain color name like
 * `red`. Mixed colors like `red!50` are not supported.
 */
function colorFromTikz(value: string | undefined): string | undefined {
	if (!value) return undefined
	const text = value.trim().replace(/^\{|\}$/g, "")
	const rgb = /^rgb\s*,\s*255\s*:\s*red\s*,\s*(\d+)\s*;\s*green\s*,\s*(\d+)\s*;\s*blue\s*,\s*(\d+)$/.exec(text)
	if (rgb) return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`
	return /^[a-z]+$/i.test(text) ? text.toLowerCase() : undefined
}

/**
 * makes a text node the text of the rectangle before it, which is how this app exports the text of rectangles:
 * `\node[shape=rectangle, ...] at (0,0){} node[anchor=north west, align=left, text width=1.8cm, inner sep=5pt] at (-1,0.5){text};`
 * @returns if the node became the text
 */
function attachNodeAsRectangleText(
	stmt: NodeStatement,
	rect: ComponentSaveObject & { text?: { text: string } }
): boolean {
	const entries = stmt.options?.entries ?? []
	if (rect.type !== "rect" || rect.text || !stmt.label || !entries.some((e) => e.key === "text width")) return false

	const align = ["left", "center", "right", "justify"].indexOf(entries.find((e) => e.key === "align")?.value?.trim())
	// the vertical part of the anchor: north = start, south = end
	const anchor = entries.find((e) => e.key === "anchor")?.value?.trim() ?? "center"
	const justify =
		anchor.startsWith("north") ? -1
		: anchor.startsWith("south") ? 1
		: 0
	const text: any = { text: latexToPlainText(stmt.label), justify }
	if (align >= 0) text.align = align
	const innerSep = entries.find((e) => e.key === "inner sep")?.value?.trim()
	// the export adds the line width to the inner sep
	const lineWidth = lengthToPixels((rect as any).stroke?.width)
	if (innerSep) text.innerSep = `${Math.round((lengthToPixels(innerSep) - lineWidth) * 0.75 * 1000) / 1000}pt`
	rect.text = text
	return true
}

/**
 * undoes the escaping of the text export of rectangles: `\\` is a new line, `\#` is #, ... Math (`$...$`) stays.
 */
function latexToPlainText(latex: string): string {
	const replacements: Record<string, string> = { textasciitilde: "~", textasciicircum: "^", textbackslash: "\\" }
	return latex
		.replace(/^\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\s+/, "")
		.replace(/\\\\\s*/g, "\n")
		.replace(/\\(textasciitilde|textasciicircum|textbackslash)\b/g, (_, name) => replacements[name])
		.replace(/\\([#$%&_{}])/g, "$1")
}

type NodeSave = ComponentSaveObject & {
	label?: PositionedLabel
	rotation?: number
	scale?: { x: number; y: number }
}

/**
 * the canvas direction of an anchor direction of a rotated/mirrored node (the inverse of what the export of the app does)
 */
function canvasDirectionKey(localKey: string, component: NodeSave): string {
	const local = basicDirections.find((d) => d.key === localKey).direction
	const x = local.x * Math.sign(component.scale?.x ?? 1)
	const y = local.y * Math.sign(component.scale?.y ?? 1)
	// rotate by -rotation in canvas coordinates (y down): counterclockwise on screen like TikZ's rotate
	const angle = (-(component.rotation ?? 0) * Math.PI) / 180
	const canvas = { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) }
	let best = localKey
	let bestScore = -Infinity
	for (const d of basicDirections) {
		const length = Math.hypot(d.direction.x, d.direction.y)
		if (!(length > 0)) continue // default (NaN) and center
		const score = (d.direction.x * canvas.x + d.direction.y * canvas.y) / length
		if (score > bestScore) {
			bestScore = score
			best = d.key
		}
	}
	return best
}

/**
 * the save object of a node symbol (`\node[nmos, rotate=90, anchor=D] (M1) at (x,y) {}` or the same inside a \draw)
 */
function buildNodeSymbolSave(
	hit: { symbol: ComponentSymbol; options: TikzOption[]; matchedKey: string },
	pos: { x: number; y: number },
	name: string | undefined,
	label: string | undefined,
	ctx: TransformContext
): ComponentSaveObject & { position: { x: number; y: number } } {
	const entries = hit.options
	const save: any = { type: "node", id: hit.symbol.tikzName, position: pos }
	const options = recognisedSymbolOptions(hit)
	if (options.length > 0) save.options = options
	if (name) save.name = name
	if (label && label.length > 0) save.label = { value: label }

	const rotation = numericOption(entries, "rotate") ?? numericOption(entries, "rotation")
	if (rotation) save.rotation = rotation
	// mirroring, e.g. `xscale=-1` for a pmos with the source at the bottom
	const scale = numericOption(entries, "scale") ?? 1
	const xscale = (numericOption(entries, "xscale") ?? 1) * scale
	const yscale = (numericOption(entries, "yscale") ?? 1) * scale
	if (xscale != 1 || yscale != 1) save.scale = { x: xscale, y: yscale }

	// `anchor=D`: the anchor is at the given position instead of the center
	const anchor = entries.find((e) => e.key === "anchor")?.value
	if (anchor && anchor !== "center") {
		const anchorPos = ctx.anchorOf(save, anchor)
		if (anchorPos) {
			save.position = { x: pos.x + (pos.x - anchorPos.x), y: pos.y + (pos.y - anchorPos.y) }
		} else {
			ctx.collector.info(
				`The anchor '${anchor}' of a ${hit.symbol.tikzName} is not known, placing it by its center.`,
				{
					code: "transform-node-anchor",
				}
			)
		}
	}
	if (name) ctx.rememberComponent(name, save)
	return save
}

/**
 * the options of the symbol (e.g. `bodydiode` of a nmos) which the symbol library knows
 */
function recognisedSymbolOptions(hit: {
	symbol: ComponentSymbol
	options: TikzOption[]
	matchedKey: string
}): string[] {
	const known = new Set<string>()
	for (const o of hit.symbol.possibleOptions) known.add(o.name)
	for (const e of hit.symbol.possibleEnumOptions) for (const o of e.options) known.add(o.name)
	return hit.options
		.filter((o) => o.key !== hit.matchedKey && o.key !== hit.symbol.tikzName && known.has(o.key))
		.map((o) => o.key)
}

function buildEmbeddedNodeSave(
	el: Extract<TikzPathElement, { kind: "embedded-node" }>,
	pos: { x: number; y: number },
	ctx: TransformContext
): ComponentSaveObject | null {
	// Try to match a node-symbol tag first.
	if (el.options) {
		const hit = findSymbolInOptions(el.options.entries, ctx, true)
		if (hit) {
			const save = buildNodeSymbolSave(hit, pos, el.name, el.label, ctx)
			if (el.name) ctx.rememberPoint(el.name, save.position)
			return save
		}
	}
	// Fallback — a labelled rectangle.
	const text = el.label ?? ""
	const save: any = {
		type: "rect",
		position: pos,
		size: { x: estimateTextWidthPx(text), y: 24 },
	}
	if (el.name) save.name = el.name
	if (text.length > 0) save.text = { text }
	return save as ComponentSaveObject
}

// ===================================================================================== //
// Coordinate conversion
// ===================================================================================== //

/**
 * Convert a parsed {@link TikzCoordinate} into Designer pixel space.
 * CircuiTikZ uses centimetres with Y pointing up; Designer uses pixels with Y pointing down.
 *
 * Returns undefined if we can't make sense of the coordinate (e.g. a raw fallback that isn't a
 * recognisable format). That always emits a diagnostic.
 */
function coordToAbsolute(
	coord: TikzCoordinate,
	ctx: TransformContext,
	_relativeOrigin: { x: number; y: number } | undefined,
	fallbackLine: number
): { x: number; y: number } | undefined {
	switch (coord.kind) {
		case "xy": {
			const x = toPixels(coord.x, coord.xUnit ?? "cm")
			const y = -toPixels(coord.y, coord.yUnit ?? "cm")
			return { x, y }
		}
		case "named": {
			const p = ctx.lookupPoint(coord.name, coord.anchor)
			if (p) return applyShift(p, coord.shift)
			ctx.collector.warning(`Coordinate refers to unknown point '${coord.name}'.`, {
				line: coord.line || fallbackLine,
				column: coord.column,
				code: "transform-coord-named",
				suggestion: "Make sure the name was defined earlier with \\coordinate or \\node.",
			})
			return undefined
		}
		case "polar": {
			const theta = (coord.angle * Math.PI) / 180
			const r = toPixels(coord.radius, coord.radiusUnit ?? "cm")
			return { x: Math.cos(theta) * r, y: -Math.sin(theta) * r }
		}
		case "intersection": {
			// TikZ's `(A |- B)` / `(A -| B)` shorthand: take x from one named point and y
			// from the other. Emit a targeted warning if either side is unknown so the user
			// sees which name needs to be declared, rather than a generic "couldn't parse".
			const xp = ctx.lookupPoint(coord.xFrom)
			const yp = ctx.lookupPoint(coord.yFrom)
			if (!xp || !yp) {
				const missing = [!xp && coord.xFrom, !yp && coord.yFrom].filter(Boolean).join(", ")
				ctx.collector.warning(
					`Intersection coordinate references unknown point${missing.includes(",") ? "s" : ""} '${missing}' — using (0,0) as a fallback.`,
					{
						line: coord.line || fallbackLine,
						column: coord.column,
						code: "transform-coord-intersection",
						suggestion: "Both sides of '|-' / '-|' must be declared earlier with \\coordinate or \\node.",
					}
				)
				return { x: xp?.x ?? 0, y: yp?.y ?? 0 }
			}
			return { x: xp.x, y: yp.y }
		}
		case "raw": {
			ctx.collector.warning(
				`Couldn't parse coordinate '${coord.raw}' — using (0,0) as a fallback so the rest of the path still imports.`,
				{
					line: coord.line || fallbackLine,
					column: coord.column,
					code: "transform-coord-raw",
					suggestion: "Supported forms are (x,y), (angle:radius), and named references like (R1).",
				}
			)
			return { x: 0, y: 0 }
		}
	}
}

const CM_TO_PX = 4800 / 127 // matches impSVGNumber.unitConvertMap.cm.px

function toPixels(value: number, unit: string): number {
	switch (unit) {
		case "cm":
			return value * CM_TO_PX
		case "mm":
			return value * (CM_TO_PX / 10)
		case "in":
			return value * 96
		case "pt":
			return value * (4 / 3)
		case "em":
			// Rough approximation: 1em ≈ 10pt at default document size.
			return value * 10 * (4 / 3)
		case "ex":
			return value * 5 * (4 / 3)
		case "px":
			return value
		default:
			return value * CM_TO_PX
	}
}

// ===================================================================================== //
// Utility helpers
// ===================================================================================== //

/**
 * a point moved by `xshift` / `yshift` (TikZ y points up, the canvas y down)
 */
function applyShift(point: { x: number; y: number }, shift: CoordinateShift | undefined): { x: number; y: number } {
	if (!shift) return point
	return { x: point.x + lengthToPixels(shift.x), y: point.y - lengthToPixels(shift.y) }
}

/**
 * a TikZ length like `0.1cm` or `-2pt` in px. Without a unit TikZ uses pt.
 */
function lengthToPixels(length: string | undefined): number {
	const match = length ? /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)\s*$/i.exec(length) : null
	if (!match) return 0
	return toPixels(parseFloat(match[1]), match[2] || "pt")
}

function numericOption(entries: TikzOption[], key: string): number | undefined {
	for (const e of entries) {
		if (e.key === key && e.value) {
			const n = parseFloat(e.value)
			if (!Number.isNaN(n)) return n
		}
	}
	return undefined
}

/**
 * Rough text-width estimate for fallback rectangles. Designer's auto-sizing kicks in once the
 * text field is set, so this only affects the initial placeholder box — better to err a bit wide
 * than to have a tiny unreadable box. ~9px per character is a reasonable mean for 12pt sans.
 */
function estimateTextWidthPx(text: string): number {
	const len = text.length || 1
	return Math.max(40, Math.min(500, len * 9))
}

/** Unused at runtime; kept so downstream modules can reference TikzPathConnector strictly. */
export type __ConnectorAlias = TikzPathConnector
