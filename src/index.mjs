import { createMap } from './utils.mjs'
import { TemplateParser } from './templateparser.mjs'
import { ExpressionParser } from './parser.mjs'
import { AST } from './ast.mjs'
import { ASTInterpreter } from "./astinterpreter.mjs";
import { ASTCompiler } from "./astcompiler.mjs";
import filters from "./filters.mjs"
import { extractLogic } from "./extractlogic.mjs"

export { ExpressionParser, TemplateParser, AST }

const defaultOptions = {
	interpreter: false, // true uses interpreter instead of compiler
	includeLocation: false, // true includes character location metadata in AST
}

const untypedDefault = {
	name: '*',
	type: '*',
	properties: [{ name: '*', type: '*', isList: '*' }],
	functions: [{ name: '*', type: '*', isList: '*', params: [{ allowedTypes: 'expr', optional: true, repeated: true }] }],
	filters: [{ name: '*', type: '*', isList: '*', params: [{ allowedTypes: 'expr', optional: true, repeated: true }] }],
}

const filterAliases = {}
// initialize filterAliases
for (const name in filters) {
	const func = filters[name]
	if (func && func.aliases) {
		func.aliases.forEach(alias => {
			filterAliases[alias] = func
		})
	}
}
export function GetFilter (name) {
	return filters[name] || filterAliases[name]
}

export class Tinql {
	constructor (options = {}, typeDefs = [untypedDefault]) {
		this.options = { ...defaultOptions }
		for (const prop of Object.keys(options)) {
			this.options[prop] = options[prop]
		}
		const typeDict = this.typeDict = {}
		typeDefs.forEach(typeDef => typeDict[typeDef.name] = typeDef)
		this.expressioner = new ExpressionParser(GetFilter, { includeLocation: this.options.includeLocation })
		this.templater = new TemplateParser(this.expressioner)
		this.astCompiler = this.options.interpreter
			? new ASTInterpreter(GetFilter)
			: new ASTCompiler(GetFilter)

		/**
		 * A cache containing all compiled functions. The src is used as key.
		 * Set this to false to disable the cache.
		 *
		 * @type {object}
		 */
		this.cache = createMap()
	}

	/**
	 * Lexes and parses src and returns an AST.
	 *
	 * @param {string} src
	 * @returns {object}
	 */
	parseExpression (src) {
		if (typeof src !== "string") {
			throw new TypeError(`src must be a string; instead saw '${typeof src}'`)
		}
		const ast = this.expressioner.ast(src)
		return ast
	}

	parseTemplate (src) {
		if (typeof src !== "string") {
			throw new TypeError(`src must be a string; instead saw '${typeof src}'`)
		}
		const ast = this.templater.ast(src)
		return ast
	}

	extractTemplateLogic (src) {
		let ast
		if (typeof src === 'string') {
			ast = this.parseTemplate(src)
		} else if (src && typeof src === 'object') {
			ast = src
		} else {
			throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
		}
		return extractLogic(ast)
	}

	compileExpression (src) {
		let func = this.cache && this.cache[src]
		if (!func) {
			let ast
			if (typeof src === 'string') {
				ast = this.parseExpression(src)
			} else if (src && typeof src === 'object') {
				ast = src
			} else {
				throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
			}
			func = this.compile(ast)
			if (func) {
				func.normalized = AST.serialize(ast)
			}
			if (this.cache) {
				this.cache[src] = func
				if (src !== func.normalized) {
					this.cache[func.normalized] = func
				}
			}
		}
		return func
	}

	compileTemplate (src) {
		let ast
		if (typeof src === 'string') {
			ast = this.parseTemplate(src)
		} else if (src && typeof src === 'object') {
			ast = src
		} else {
			throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
		}
		return this.compile(ast)
	}

	/**
	 * Compiles ast and returns a function that executes ast on a target object.
	 * The compiled function is cached under compile.cache[src] to speed up further calls.
	 *
	 * @param {string} src
	 * @returns {function}
	 */
	compile (ast) {
		if (typeof ast !== 'object') {
			throw new TypeError("ast must be an already-parsed AST object; instead saw '" + typeof ast + "'")
		}
		let func = this.astCompiler.compile(ast)
		return func
	}
}
