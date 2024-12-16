import { createMap } from './utils.mjs';
import { Lexer } from './lexer.mjs'
import { Parser, AST } from './parser.mjs';

export { Lexer, Parser, AST }

const defaultParserOptions = {
	csp: false, // csp == true uses interpreter instead of compiler (interesting for test/debug, but otherwise why?)
	expensiveChecks: true,
	includeLocation: true,
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
	constructor (typeDefs = [untypedDefault], parseOptions = defaultParserOptions) {
		const typeDict = this.typeDict = {}
		typeDefs.forEach(typeDef => typeDict[typeDef.name] = typeDef)
		this.lexer = new Lexer(defaultLexerOptions)
		this.parser = new Parser(this.lexer, typeDict, parseOptions)
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
