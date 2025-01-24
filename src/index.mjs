import { createMap } from './utils.mjs'
import { TemplateParser } from './templateparser.mjs'
import { Lexer } from './lexer.mjs'
import { Parser } from './parser.mjs'
import { AST } from './ast.mjs'

export { Lexer, Parser, TemplateParser as Templater, AST }

const defaultParserOptions = {
	interpreter: false, // true uses interpreter instead of compiler
	expensiveChecks: true,
	includeLocation: false,
	literals: {
		true: true,
		false: false,
		null: null,
		undefined: undefined,
	}
	//isIdentifierStart: undefined, //isFunction(identStart) && identStart,
	//isIdentifierContinue: undefined //isFunction(identContinue) && identContinue
}

const defaultLexerOptions = {}

const untypedDefault = {
	name: '*',
	type: '*',
	properties: [{ name: '*', type: '*', isList: '*' }],
	functions: [{ name: '*', type: '*', isList: '*', params: [{ allowedTypes: 'expr', optional: true, repeated: true }] }],
	filters: [{ name: '*', type: '*', isList: '*', params: [{ allowedTypes: 'expr', optional: true, repeated: true }] }],
}

export class Compiler {
	constructor (typeDefs = [untypedDefault], parseOptions = {}) {
		const options = { ...defaultParserOptions }
		for (const prop of Object.keys(parseOptions)) {
			options[prop] = parseOptions[prop]
		}
		const typeDict = this.typeDict = {}
		typeDefs.forEach(typeDef => typeDict[typeDef.name] = typeDef)
		this.lexer = new Lexer(defaultLexerOptions)
		this.parser = new Parser(this.lexer, typeDict, options)
		this.templater = new TemplateParser(this.parser)
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
	parse (src, contextStack) {
		if (typeof src !== "string") {
			throw new TypeError(
				"src must be a string, instead saw '" + typeof src + "'"
			);
		}
		const ast = this.parser.parse(src)
		return ast
	}

	/**
	 * Compiles src and returns a function that executes src on a target object.
	 * The compiled function is cached under compile.cache[src] to speed up further calls.
	 *
	 * @param {string} src
	 * @returns {function}
	 */
	compile (src, contextStack) {
		if (typeof src !== 'string') {
			throw new TypeError("src must be a string, instead saw '" + typeof src + "'")
		}
		let func = this.cache && this.cache[src]
		if (!func) {
			func = this.parser.compile(src)
			if (func && func.ast) {
				func.normalized = AST.serialize(func.ast)
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
}
