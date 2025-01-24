import { AST } from "./ast.mjs"
import { TemplateLexer, ChunkMode } from "./templatelexer.mjs"

export class TemplateParser {
  constructor (exprParser, options) {
    this.lexer = new TemplateLexer()
    this.options = options
    this.ast = new TemplateASTBuilder(this.lexer, exprParser, options)
  }

  parse (text) {
    return this.ast.ast(text)
  }

  compile (text) {
    return this.astCompiler.compile(text)
  }
}

class TemplateASTBuilder {
  constructor (lexer, exprParser, options) {
    this.lexer = lexer
    this.exprParser = exprParser
    this.options = options
  }

  ast (text) { // top-level asts/programs are reserved for templates
    this.text = text
    this.tokens = this.lexer.lex(text, ChunkMode.TEXT)

    const value = this.program()

    if (this.tokens.length !== 0) {
      this.throwError("when not expected", this.tokens[0])
    }

    return value
  }

  addLoc (node, start, end) {
    if (this.options?.includeLocation && typeof start === "number") {
      node.loc = { start: { column: start } }
      if (typeof end === "number") {
        node.loc.end = { column: end }
      }
    }
    return node
  }

  program () {
    const body = this.blockBody()
    return this.addLoc(
      { type: AST.Program, body: body },
      0,
      body && body.length && body[0].loc && body[0].loc.end && body[0].loc.end.column
    )
  }

  templateBlock (body) {
    if (!body) {
      body = this.blockBody()
    }
    return {
      type: AST.TemplateBlock,
      body,
    }
  }

  blockBody () {
    const body = []
    let ast
    while ((ast = this.parseBlockElement())) {
      body.push(ast)
    }
    // either we encountered a token that should always end a block (elseif, else, endif, endlist, endlevel)
    // or we are out of tokens
    return body
  }

  levelBlock () {
    if (this.expectField('level')) {
      const body = this.blockBody()
      if (this.expectField('endlevel')) {
        return this.templateBlock(body)
      } else {
        // error
        debugger
      }
    }
  }

  templateElement (text = undefined) {
    let token
    if (!text) {
      token = this.expect()
    }
    return {
      type: AST.TemplateElement,
      text: text || token.text,
    }
  }

  parseBlockElement () {
    let token = this.peek()
    if (token) {
      if (token.token === 'Quasi') { // consume & return it
        return this.templateElement()
      } else if (token.token === 'Field') {
        let fieldToken
        if ((fieldToken = this.peekField('if', 'list', 'level'))) {
          if (fieldToken.type === 'if')
            return this.conditionalBlock(false)
          if (fieldToken.type === 'list')
            return this.listBlock()
          // else
          return this.levelBlock()
        }
        if (isTerminalField(token.text)) {
          return false
        }
        // else it must be a content field (the only option left)
        return this.contentField()
      }
    }
    return false
  }

  conditionalBlock (isAlternate = false) {
    // consume if or elseif
    let token, altToken, endToken
    if ((token = this.expectField(isAlternate ? 'elseif' : 'if'))) {
      // consume block content until we reach the end of a block
      let consequent = this.blockBody()
      let alternate
      // first check for elseif, then else, then endif:
      let expectEnd = true
      if (this.peekField('elseif')) {
        alternate = this.conditionalBlock(true)
        expectEnd = false // the end will have been consumed by the recursion
      } else if ((altToken = this.expectField('else'))) {
        alternate = this.templateBlock()
      }
      if (expectEnd) {
        endToken = this.expectField('endif')
        if (!endToken) {
          this.throwError('when expecting an {[endif]}', this.peek())
        }
      }
      return {
        type: AST.ConditionalBlock,
        test: this.exprParser.parse(token.content),
        consequent: consequent.length === 1 ? consequent[0] : this.templateBlock(consequent),
        alternate: alternate || null,
        fieldNum: token.fieldNum,
        altFieldNum: altToken ? altToken.fieldNum : undefined,
        endFieldNum: expectEnd ? endToken.fieldNum : undefined,
      }
    }
    return false

    // consume block content until we reach either...
    //    - elseif (in which case we recurse to create a nested conditional field)
    //    - else (in which case we consume and then go until we reach the endif)
    //    - endif (in which case it is consumed and then we finish)
  }

  listBlock () {
    // consume list
    let token, endToken
    if ((token = this.expectField('list'))) {
      // consume block content until we reach & consume the endlist
      const body = this.blockBody()
      if ((endToken = this.expectField('endlist'))) {
        this.appendPuncPlaceholder(body)
        return {
          type: AST.ListBlock,
          expression: this.exprParser.parse(token.content),
          body,
          fieldNum: token.fieldNum,
          endFieldNum: endToken.fieldNum,
        }
      } else {
        this.throwError('when expecting an {[endlist]}', this.peek())
      }
    }
    return false
  }

  appendPuncPlaceholder (body) {
    if (!body.some(elem => elem.type === AST.ContentField
      && elem.expression.type === AST.Identifier
      && elem.expression.name === '_punc'
    )) {
      const last = body.length > 0 && body[body.length - 1]
      if (last && last.type === AST.TemplateElement && last.text.endsWith('\n')) {
        // punc field must be inserted BEFORE last line break -- is a split required?
        if (last.text.length > 1) { // split it -- TODO: make this Windows-text-friendly by supporting \r\n
          last.text = last.text.slice(0,-1)
          body.push(this.templateElement('\n'))
        }
        // insert punc field BEFORE last template element
        body.splice(-1, 0, this.contentField('_punc'))
      } else {
        body.push(this.contentField('_punc'))
      }
    }
  }

  contentField (expr = undefined) {
    let token
    if (!expr) {
      token = this.expect()
      expr = token.text
    }
    const result = {
      type: AST.ContentField,
      expression: this.exprParser.parse(expr),
    }
    if (token && token.fieldNum) {
      result.fieldNum = token.fieldNum
    }
    return result
  }

  // expressionStatement () {
  //   const start = this.tokens[0].index
  //   const expr = this.filterChain()
  //   return this.addLoc({ type: AST.ContentField, expression: expr }, start, expr.loc && expr.loc.end && expr.loc.end.column)
  // }

  throwError (msg, token) {
    throw new Error(`Encountered ${this.describeToken(token)} ${msg}`)
  }

  describeToken (token) {
    let result = ''
    if (!token) {
      result += 'end of template'
    } else {
      let pos = `at character position ${token.index + 1}`
      if (token.token === 'Field') {
        result += `{[${token.text}]} `
        if (token.fieldNum) {
          result += `in field ${token.fieldNum} (${pos})`
        } else {
          result += ` ${pos}`
        }
      } else if (token.token === 'Quasi') {
        result += `template content '${token.text}' ${pos}`
      }
    }
    return result
  }

  consume (e1) {
    if (this.tokens.length === 0) {
      throw new Error(`Unexpected end of expression: ${this.text}`)
    }

    const token = this.expect(e1)
    if (!token) {
      this.throwError("is unexpected, expecting [" + e1 + "]", this.peek())
    }
    return token
  }

  peekToken () {
    if (this.tokens.length === 0) {
      throw new Error(`Unexpected end of template: ${this.text}`)
    }
    return this.tokens[0]
  }

  peekField (...names) {
    const token = this.peek()
    if (token && token.token === 'Field') {
      for (const name of names) {
        const content = getFieldContent(name, token.text)
        if (content) {
          token.type = name
          token.content = content
          return token
        }
      }
    }
    return false
  }

  peekEndField () {
    return this.peekField('else', 'elseif', 'endif', 'endlist', 'endlevel')
  }

  peek (e1, e2, e3, e4) {
    return this.peekAhead(0, e1, e2, e3, e4)
  }

  peekAhead (i, e1, e2, e3, e4) {
    if (this.tokens.length > i) {
      const token = this.tokens[i]
      const t = token.text
      if (
        t === e1 ||
        t === e2 ||
        t === e3 ||
        t === e4 ||
        (!e1 && !e2 && !e3 && !e4)
      ) {
        return token
      }
    }
    return false
  }

  expect (e1, e2, e3, e4) {
    const token = this.peek(e1, e2, e3, e4)
    if (token) {
      this.tokens.shift()
      return token
    }
    return false
  }

  expectField (...names) {
    const token = this.peek()
    if (token && token.token === 'Field') {
      for (const name of names) {
        const content = getFieldContent(name, token.text)
        if (content) {
          this.tokens.shift()
          token.type = name
          token.content = content
          return token
        }
      }
    }
    return false
  }
}

const _fieldREs = {}

function getFieldContent (name, text) {
  const re = _fieldREs[name] || (_fieldREs[name] = new RegExp('^\\s*' + name + '\\s*(.*)$'))
  const match = re.exec(text)
  if (match !== null) {
    return match[1] || true
  }
  return false
}

function isTerminalField (text) {
  for (const endname of ['else', 'elseif', 'endif', 'endlist', 'endlevel']) {
    if (getFieldContent(endname, text)) {
      return true
    }
  }
  return false
}
