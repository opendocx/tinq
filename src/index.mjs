import { createMap } from './utils.mjs'
import { TemplateParser } from './templateparser.mjs'
import { ExpressionParser } from './parser.mjs'
import { AST } from './ast.mjs'
import { ASTInterpreter } from "./astinterpreter.mjs";
import { ASTCompiler } from "./astcompiler.mjs";
import filters from "./filters.mjs"
import { extractLogic } from "./extractlogic.mjs"
import { DataExtractor } from './dataextractor.mjs'
import { LogicTreeImporter } from './legacy.mjs'
import { Scope, EnumerationScope, ExternalFile, useScope, scopeFactory } from './scope.mjs'
import { RecursionError } from './recursionerror.mjs'

export { ExpressionParser, TemplateParser, AST, Scope, EnumerationScope, ExternalFile, scopeFactory, RecursionError }

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

export class Tinq {
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

  extractTemplateLogic (src) { // accepts either a string or an already-parsed template AST
    let ast
    if (typeof src === 'string') {
      ast = this.parseTemplate(src)
    } else if (src && typeof src === 'object') {
      ast = src
    } else {
      throw new TypeError(`src must be a string or AST object; instead saw '${typeof src}'`)
    }
    // HOWEVER, the first thing extractLogic() does is to convert the AST into a (legacy)
    // content array, which is then simplified using legacy code ported over from Yatte.
    const logicTree = extractLogic(ast)
    // Note that extractLogic is mostly legacy code ported over from Yatte.
    // The first thing it does is convert the given AST into a Yatte content array, and
    // it also returns a content array. HOWEVER, because those content arrays are more
    // condensed than TINQ ASTs, we're just returning it directly here rather than
    // converting it back.
    return logicTree
    // At some point we may consider cleaning this up by rewriting extractLogic to work directly
    // with Tinq's AST format. But for now, we use both.
  }

  // Imported field nodes retain their source `id` as `fieldNum`. If a field's
  // expression cannot be parsed, the thrown parser error carries `fieldNum`
  // too; its message and type are unchanged. Unnumbered fields omit it.
  logicToTemplateAst (logicTree) {
    const importer = new LogicTreeImporter(this)
    return importer.arrayToBlock(logicTree, AST.Program)
  }

  extractData (ast, scope, externals = undefined, outputName = undefined) { // accepts EITHER a TINQ AST or a Yatte-style logic tree
    if (Array.isArray(ast)) {
      ast = this.logicToTemplateAst(ast)
    } // (else _hopefully_ the ast is already simplified)
    // use the ast to extract the necessary data from a data context:
    const extractor = new DataExtractor(externals)
    const result = extractor.assembleData(ast, scope, outputName)
    return result
  }

  compileExpression (src) {
    const isAstInput = src && typeof src === 'object'
    let cacheKey = isAstInput ? astCacheKey(src) : src
    let func = this.cache && this.cache[cacheKey]
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
        this.cache[cacheKey] = func
        if (!isAstInput && cacheKey !== func.normalized) {
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

  compileExternal (templateInfo, ast, fileName = undefined) {
    let result, evaluateName
    if (typeof fileName === 'string') {
      evaluateName = this.compileTemplate(fileName)
    }
    if (typeof ast === 'object') { // use AST to evaluate & extract data from scope
      result = scope => {
        // look up parentExternals in scope, create it if not there already
        scope = useScope(scope)
        const root = scope.root()
        const isDependant = Boolean(root.externals)
        const externals = isDependant ? root.externals : (root.externals = [])
        const extracted = this.extractData(ast, scope, externals,
          evaluateName && evaluateName(scope))
        extracted.template = templateInfo
        if (isDependant) {
          return externals.find(ex => ex.isEqualTo(extracted)) || extracted
        } // else
        if (externals.length === 0) return extracted
        return [...externals, extracted]
      }
    } else if (typeof ast === 'string') { // AST is a template; evaluate that template to get its text result:
      const evaluate = this.compileTemplate(ast)
      result = scope => new ExternalFile(templateInfo, evaluate(scope),
        evaluateName && evaluateName(scope)) // and return that result as its own external
    }
    result.ast = true
    // so when result is seen as a function during evaluation, it will be recognized as expecting the scope
    // as its parameter (and will therefore be called automatically, as we want it to be)
    return result
  }

  compileBatch (batchTemplate) {
    const evaluate = this.compileExternal('batch', typeof batchTemplate === 'object'
      ? batchTemplate
      : this.parseTemplate(batchTemplate)
    )
    const result = scope => {
      let interim = evaluate(scope)
      if (Array.isArray(interim)) {
        const batch = interim.pop()
        const index = interim.reduce((acc, curr) => {
          acc[curr.id] = curr
          return acc
        }, {})
        batch.requires.forEach((id, idx) => index[id].outputOrder = idx + 1)
      } else {
        interim.outputOrder = 1
        interim = [interim]
      }
      return interim
    }
    return result
  }
}

function astCacheKey (ast) {
  return 'ast:' + AST.serialize(ast) + ':frames:' + JSON.stringify(collectFrameMetadata(ast))
}

function collectFrameMetadata (ast, path = '$', result = []) {
  if (!ast || typeof ast !== 'object') return result
  if (ast.frame) {
    result.push([path, ast.type, ast.frame])
  }
  switch (ast.type) {
    case AST.Program:
    case AST.TemplateBlock:
      ast.body.forEach((node, index) => collectFrameMetadata(node, path + '.body[' + index + ']', result))
      break
    case AST.ContentField:
      collectFrameMetadata(ast.expression, path + '.expression', result)
      break
    case AST.ConditionalField:
      collectFrameMetadata(ast.test, path + '.test', result)
      collectFrameMetadata(ast.consequent, path + '.consequent', result)
      collectFrameMetadata(ast.alternate, path + '.alternate', result)
      break
    case AST.ListField:
      collectFrameMetadata(ast.expression, path + '.expression', result)
      collectFrameMetadata(ast.content, path + '.content', result)
      break
    case AST.MemberExpression:
      collectFrameMetadata(ast.object, path + '.object', result)
      collectFrameMetadata(ast.property, path + '.property', result)
      break
    case AST.CallExpression:
      collectFrameMetadata(ast.callee, path + '.callee', result)
      ast.arguments.forEach((node, index) => collectFrameMetadata(node, path + '.arguments[' + index + ']', result))
      break
    case AST.FilterExpression:
      collectFrameMetadata(ast.input, path + '.input', result)
      ast.arguments.forEach((node, index) => collectFrameMetadata(node, path + '.arguments[' + index + ']', result))
      break
    case AST.LambdaExpression:
      collectFrameMetadata(ast.expression, path + '.expression', result)
      break
    case AST.SortKeyExpression:
      collectFrameMetadata(ast.key, path + '.key', result)
      break
    case AST.ArrayExpression:
      ast.elements.forEach((node, index) => collectFrameMetadata(node, path + '.elements[' + index + ']', result))
      break
    case AST.ObjectExpression:
      ast.properties.forEach((node, index) => collectFrameMetadata(node, path + '.properties[' + index + ']', result))
      break
    case AST.Property:
      collectFrameMetadata(ast.key, path + '.key', result)
      collectFrameMetadata(ast.value, path + '.value', result)
      break
    case AST.BinaryExpression:
    case AST.LogicalExpression:
      collectFrameMetadata(ast.left, path + '.left', result)
      collectFrameMetadata(ast.right, path + '.right', result)
      break
    case AST.UnaryExpression:
      collectFrameMetadata(ast.argument, path + '.argument', result)
      break
    case AST.ConditionalExpression:
      collectFrameMetadata(ast.test, path + '.test', result)
      collectFrameMetadata(ast.consequent, path + '.consequent', result)
      collectFrameMetadata(ast.alternate, path + '.alternate', result)
      break
  }
  return result
}
