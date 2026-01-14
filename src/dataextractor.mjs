import { ASTInterpreterBase } from './astinterpreter.mjs'
import { isTruthy } from "./utils.mjs";
import { useScope, ExternalFile } from "./scope.mjs"
import { AST } from "./ast.mjs";
import { DataAggregator } from './dataaggregator.mjs'
import { uuidv4 } from './uuid.mjs'

export class DataExtractor extends ASTInterpreterBase {
  constructor (externals = null) {
    super()
    this.externals = externals || [] // queue of ALL externals encountered in the extraction or its parents
    this.requires = [] // externals on which this extraction depends (directly)
    this.missing = {}
    this.errors = []
    this.data = new DataAggregator()
  }

  assembleData (ast, scope, outputName = undefined) {
    let evaluator = this.compile(ast)
    evaluator(useScope(scope))
    delete this.data.stack
    const wrapper = new ExternalFile(null, this.data, outputName)
    if (this.requires.length > 0) {
      wrapper.requires = this.requires.map(e => e.id)
    }
    return wrapper
  }

  fieldKey (ast, keyType) {
    let key = ast.key || AST.serialize(ast)
    if (keyType === 'b') {
      key += ast.key ? keyType : '_BOOL'
    } else if (keyType === 'i') {
      key = {
        list: key,
        item: key + (ast.key ? keyType : '_ITEM'),
        punc: key + (ast.key ? 'p' : '_PUNC'),
      }
    }
    return key
  }

  templateElement () {}

  contentField (valueFn, scope, key, ast) {
    this._setContent(key, valueFn(scope), ast)
  }

  _setContent (ident, value, ast) {
    if (value === null || typeof value === 'undefined') {
      if (ast) {
        const expr = AST.serialize(ast)
        this.missing[expr] = true
        value = this._missingValuePlaceholder(expr, ast)
      }
    } else if (typeof value === 'object') {
      if (value instanceof ExternalFile) {
        this.data.set(ident, this._registerExternal(value))
        return
      } else if (value.errors || value.missing) {
        // value is a yatte EvaluationResult, probably because of nested template evaluation
        if (value.missing && value.missing.length > 0) {
          value.missing.forEach((expr) => { this.missing[expr] = true })
        }
        if (value.errors && value.errors.length > 0) {
          value.errors.forEach((errmsg) => { this.errors.push(errmsg) })
        }
        value = value.valueOf() // get the actual evaluated value
      }
    }
    if (value === '') {
      this.data.set(ident, undefined)
    } else if (typeof value === 'object') { // setContent should only be used to output simple scalar values
      this.data.set(ident, String(value)) // possibly bad input; coerce to string representation
    } else {
      this.data.set(ident, value)
    }
  }

  _lookupExternal (extFile) {
    // see if this externalFile+data has already been encountered/added
    return this.externals.find(ex => ex.isEqualTo(extFile))
  }

  _registerExternal (extFile) {
    // see if this externalFile+data has already been encountered/added
    let existing = this._lookupExternal(extFile)
    if (!existing) {
      extFile.id = uuidv4() // assign unique ID
      this.externals.push(extFile)
      existing = extFile
    }
    if (!this.requires.includes(existing)) {
      this.requires.push(existing)
    }
    return existing
  }

  conditionalField (testFn, consequentFn, alternateFn, scope, key) {
    const testValue = testFn(scope)
    if (this._setCondition(key, testValue)) {
      consequentFn(scope)
    } else if (alternateFn) {
      alternateFn(scope)
    }
  }

  _setCondition (ident, value) {
    const bValue = isTruthy(value)
    this.data.set(ident, bValue)
    return bValue
  }

  listField (listFn, lambdaContentFn, scope, key) {
    const listScope = listFn(scope)
    this._startList(key.list)
    if (listScope.type === 'array') {
      listScope.forEachScope(itemScope => {
        this._startListItem(key.item)
        lambdaContentFn.call(undefined, itemScope)
        this._endListItem(key.punc, itemScope._punc)
      })
    }
    this._endList(key.list)
  }

  _startList (listIdent) {
    // begin list context:
    this.data.pushList(listIdent)
  }

  _startListItem (itemIdent) {
    // begin child object context -- individual item in a list context
    this.data.pushObject(itemIdent)
  }

  _endListItem (puncIdent, punc) {
    // set the list punctuation
    this._setContent(puncIdent, punc)
    // end object context
    this.data.popObject()
  }

  _endList (listIdent) {
    // end list context:
    this.data.popList()
  }

  _missingValuePlaceholder (expr, ast) {
    if (ast && ast.type === AST.FilterExpression && !ast.lambda) {
      return this._missingValuePlaceholder(AST.serialize(ast.input), ast.input)
    }
    return '[' + expr + ']'
  }
}
