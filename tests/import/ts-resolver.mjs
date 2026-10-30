// Loader hooks for the import-pipeline test harness, so the in-tree TypeScript files can be loaded directly on Node 20+.
// Production code still goes through Parcel, which handles extensions and TypeScript on its own.
import { readFile, stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

// add a ".ts" extension to extensionless relative imports
export async function resolve(specifier, context, nextResolve) {
	if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.(ts|mjs|js|cjs|json)$/.test(specifier)) {
		const parentPath = fileURLToPath(context.parentURL ?? import.meta.url)
		const base = new URL(specifier, pathToFileURL(parentPath))
		const candidate = base.pathname + ".ts"
		try {
			await stat(candidate)
			return nextResolve(specifier + ".ts", context)
		} catch {
			// fall through to default resolution
		}
	}
	return nextResolve(specifier, context)
}

// strip the types of .ts files with the TypeScript compiler (type-only imports, e.g. from ../internal, are dropped)
export async function load(url, context, nextLoad) {
	if (!url.endsWith(".ts")) return nextLoad(url, context)
	const source = await readFile(fileURLToPath(url), "utf8")
	const output = ts.transpileModule(source, {
		fileName: fileURLToPath(url),
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
	})
	return { format: "module", source: output.outputText, shortCircuit: true }
}
