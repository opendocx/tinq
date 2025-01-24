import path from 'path'
import { fileURLToPath } from 'node:url'
import { Parser, Lexer, AST } from '../src/index.mjs'
import chai from 'chai'
import { TemplateLexer, ChunkMode } from '../src/templatelexer.mjs'
import { readJSONFile } from './test-utils.mjs'
var assert = chai.assert

const __dirname = path.dirname(fileURLToPath(import.meta.url))

chai.config.includeStack = true;

describe('Lexing templates', function () {

  const lexer = new TemplateLexer()

  describe('raw chunking', function () {

    const mode = ChunkMode.RAW

    it('should correctly lex a simple raw template with solo field', function () {
      lexer.lex('{[field]}', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 1)
      assert.equal(tokens[0].text, 'field')
    })

    it('should lex simple raw template (1)', function () {
      lexer.lex('a{[field]}', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 2)
      assert.equal(tokens[0].text, 'a')
      assert.equal(tokens[1].text, 'field')
    })

    it('should lex simple raw template (2)', function () {
      lexer.lex('This is a {[adjective]} test.', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 3)
      assert.isNotTrue(tokens[1].soloLine)
    })

    it('should lex simple raw template (3)', function () {
      lexer.lex('line 1\n{[line 2]}\nline 3', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 3)
      assert.isNotTrue(tokens[1].soloLine)
    })
  })

  describe('text chunking', function () {

    const mode = ChunkMode.TEXT

    it('should correctly lex a simple text template with solo field', function () {
      lexer.lex('{[field]}', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 1)
      assert.equal(tokens[0].text, 'field')
      assert.isNotTrue(tokens[0].soloLine)
    })

    it('should lex simple text template (1)', function () {
      lexer.lex('a{[field]}', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 2)
      assert.equal(tokens[0].text, 'a')
      assert.equal(tokens[1].text, 'field')
      assert.isNotTrue(tokens[0].soloLine)
    })

    it('should lex simple text template (2)', function () {
      lexer.lex('This is a {[adjective]} test.', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 3)
      assert.isNotTrue(tokens[1].soloLine)
    })

    it('should lex simple text template (3)', function () {
      lexer.lex('line 1\n{[line 2]}\nline 3', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 3)
      assert.equal(tokens[0].text, 'line 1\n') // line 1 ends with \n
      assert.equal(tokens[1].text, 'line 2') // line 2's field has correct text
      assert.isTrue(tokens[1].soloLine) // soloLine indicates line 2's \n
      assert.equal(tokens[2].text, 'line 3') // does not begin with \n
    })
    it('should lex simple text template (4)', function () {
      lexer.lex('line 1\n{[line 2]}', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 2)
      assert.isNotTrue(tokens[1].soloLine)
    })
    it('should lex simple text template (5)', function () {
      lexer.lex('line 1\n{[line 2]}\n', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 2)
      assert.isTrue(tokens[1].soloLine)
    })
    it('should lex simple text template (6)', function () {
      lexer.lex('{[line 1]}\nline 2', mode)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 2)
      assert.isTrue(tokens[0].soloLine)
      assert.equal(tokens[1].text, 'line 2') // does not begin with \n
    })
  })

  describe('json chunking', function () {

    it('should correctly lex field JSON extracted from a DOCX', async function () {
      const testFilePath = path.join(__dirname, 'files', 'SimpleWill.docxobj.json')
      const x = await readJSONFile(testFilePath)
      lexer.lex(x, ChunkMode.JSON)
      const tokens = lexer.tokens
      assert.equal(tokens.length, 82)
    })
  })
})
