import path from 'path'
import { fileURLToPath } from 'node:url'
import chai from 'chai'
import { Tinq, RecursionError } from '../src/index.mjs'
import { readJSONFile } from './test-utils.mjs'
import { useScope } from '../src/scope.mjs'

var assert = chai.assert

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tinq = new Tinq()

chai.config.includeStack = true;

describe('Compiled Data Extraction', function () {

  describe('converting extracted logic trees to TINQ ASTs', function () {

    const testPdfCases = [
      {
        file: 'conditional-fallback.pdf.json',
        data: { PrimaryName: '', Contact: { Name: 'Ada' }, Enabled: true },
        expected: { DisplayName: 'Ada', Flag: 'Yes' },
      },
      {
        file: 'conditional-values.pdf.json',
        data: {
          Kind: 'person', Name: 'Ada',
          Contact: { Address: { Street: '1 Example Street', City: 'Example City' } },
        },
        expected: {
          PersonName: 'Ada', OrganizationName: '[Kind!="person"?Name:null]',
          Street: '1 Example Street', City: 'Example City',
        },
      },
      {
        file: 'nested-members.pdf.json',
        data: { Team: { Lead: { Name: 'Ada' }, Backup: { Name: 'Ben' } }, PreferredName: '' },
        expected: { LeadName: 'Ada', BackupName: 'Ben', DisplayName: 'Ada', RepeatedName: 'Ada' },
      },
      {
        file: 'formatted-values.pdf.json',
        data: { EventDate: new Date(2020, 0, 2), HasItems: true, Items: ['A', 'B'] },
        expected: { EventDate: '01/02/2020', SelectedItems: 'A,B' },
      },
      {
        file: 'optional-members.pdf.json',
        data: {
          Office: {
            Name: 'Example Office', District: 'Central', Region: { Code: 'EX' },
            Address: { Street: '1 Example Street', City: 'Example City' },
          },
        },
        expected: {
          OfficeName: 'Example Office', Street: '1 Example Street', City: 'Example City',
          Region: 'EX', District: 'Central District',
        },
      },
      {
        file: 'repeated-members.pdf.json',
        data: {
          Team: {
            Lead: { Name: 'Ada', Address: { Street: '1 Example Street', City: 'Example City' } },
            Backup: { Name: 'Ben', Address: { Street: '2 Example Street', City: 'Sample City' } },
          },
          LeadTitle: 'Coordinator', BackupTitle: 'Assistant',
        },
        expected: {
          LeadName: 'Ada', LeadStreet: '1 Example Street', LeadCity: 'Example City', LeadTitle: 'Coordinator',
          BackupName: 'Ben', BackupStreet: '2 Example Street', BackupCity: 'Sample City', BackupTitle: 'Assistant',
        },
      },
    ]
    testPdfCases.forEach(({ file, data, expected }) => {
      it(`extracts synthetic PDF-style fields from ${file}`, async function () {
        const logic = await readJSONFile(path.join(__dirname, 'files', 'pdf', file))
        const result = tinq.extractData(logic, data)
        assert.deepEqual(JSON.parse(result.data.toJson()), expected)
      })
    })
  })
})

function GetTemplatePath(templateName) {
    return path.join(__dirname, 'files', 'docx', templateName)
}

describe('Generating XML data for DOCX templates', function () {
  it('data extraction should execute with an empty context', async function () {
    const templatePath = GetTemplatePath('SimpleWill.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const aggr = tinq.extractData(logic, {})
    const str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C1>[Testator.Name]</C1><C3>[Testator.City]</C3><C4>[Testator.County]</C4><C5>[Testator.State]</C5><C6>[Representative.Name]</C6><C7>[Representative.City]</C7><C8>[Representative.County]</C8><C9>[Representative.State]</C9><C10>[Representative.Gender.HeShe]</C10><C12b>false</C12b><L18></L18><C27>[GoverningLaw]</C27><C29>[SigningDate]</C29><C33>[Testator.Gender.HimHer]</C33><C34>[Testator.Gender.HisHer]</C34><C37>[Witness1Name]</C37><C38>[Witness2Name]</C38><C39>[GoverningLaw]</C39><C40>[NotaryCounty]</C40></_odx>')
  })
  it('data extraction should avoid infinite recursion when templates have circular references', async function () {
    const logic = [{"type":"Content","expr":"Name","id":"1","key":"C1"}]
    const scope = { Name: tinq.compileExternal('Name', logic) }
    assert.throws(() => tinq.extractData(logic, scope), RecursionError)
  })
  it('data extraction should execute against a populated context', async function () {
    const templatePath = GetTemplatePath('SimpleWill.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const aggr = tinq.extractData(logic, SimpleWillDemoContext)
    const str = aggr.data.toXml('_odx')
    assert.strictEqual(str,
      '<?xml version="1.0"?><_odx><C1>John Smith</C1><C3>Jonestown</C3><C4>Lebanon</C4><C5>Pennsylvania</C5><C6>Casey Example</C6><C7>Philadelphia</C7><C8>Philadelphia</C8><C9>Pennsylvania</C9><C10>she</C10><C12b>true</C12b><C13>Tina Turner</C13><C14>Los Angeles</C14><C15>Los Angeles</C15><C16>California</C16><L18><L18i><C19>1</C19><C20>st</C20><C21>Kelly Smith</C21><C22>1234 Anystreet, Allentown, PA</C22><C23>Daughter</C23><C24>5555</C24><C25>My cat.</C25><L18p/></L18i><L18i><C19>2</C19><C20>nd</C20><C21>John Smith Jr.</C21><C22>2 Example Street, Example City, PA</C22><C23>Son</C23><C24>4444</C24><C25>My house.</C25><L18p/></L18i><L18i><C19>3</C19><C20>rd</C20><C21>Alex Example</C21><C22>Unknown</C22><C23>Friend</C23><C24>[SSNLast4]</C24><C25>My book collection.</C25><L18p/></L18i><L18i><C19>4</C19><C20>th</C20><C21>Sam Example</C21><C22>Boulder, CO</C22><C23>Friend</C23><C24>[SSNLast4]</C24><C25>Everything else.</C25><L18p/></L18i></L18><C27>Pennsylvania</C27><C29>10th day of March, 2019</C29><C33>him</C33><C34>his</C34><C37>John Doe</C37><C38>Marilyn Monroe</C38><C39>PENNSYLVANIA</C39><C40>ALLEGHENY</C40></_odx>')
  })
  it('js function should not contain multiple definitions for the same data value', async function () {
    const templatePath = GetTemplatePath('redundant_ifs.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const aggr = tinq.extractData(logic, { A: true, B: false })
    const str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C1b>true</C1b><C5b>false</C5b></_odx>')
  })
  it('xml should include TF answers for content fields separate from if fields', async function () {
    const templatePath = GetTemplatePath('Syntax.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const aggr = tinq.extractData(logic, { IsTaxPlanning: false })
    const str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C1>false</C1><C1b>false</C1b></_odx>')
  })
  it('list testing', async function () {
    const templatePath = GetTemplatePath('Lists.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const aggr = tinq.extractData(logic, BradyTestData)
    const str = aggr.data.toXml('_odx')
    // note: lists do not (currently) get optimized in the XML -- every time a template repeats through a list, another copy of the list is stored in the XML. This is because I haven't done the work yet to optimize that part.
    // it works well enough this way, but in the future (if the XML chunks are so big they're slowing something down) we can optimize it better.
    assert.strictEqual(str,
      '<?xml version="1.0"?><_odx><L1><L1i><C2>Greg</C2><L1p>, </L1p></L1i><L1i><C2>Marcia</C2><L1p>, </L1p></L1i><L1i><C2>Peter</C2><L1p>, </L1p></L1i><L1i><C2>Jan</C2><L1p>, </L1p></L1i><L1i><C2>Bobby</C2><L1p> and </L1p></L1i><L1i><C2>Cindy</C2><L1p/></L1i></L1><L4><L4i><C2>Greg</C2><C6>09/30/1954</C6><L4p>;</L4p></L4i><L4i><C2>Marcia</C2><C6>08/05/1956</C6><L4p>;</L4p></L4i><L4i><C2>Peter</C2><C6>11/07/1957</C6><L4p>;</L4p></L4i><L4i><C2>Jan</C2><C6>04/29/1958</C6><L4p>;</L4p></L4i><L4i><C2>Bobby</C2><C6>12/19/1960</C6><L4p>; and</L4p></L4i><L4i><C2>Cindy</C2><C6>08/14/1961</C6><L4p>.</L4p></L4i></L4></_odx>')
  })
  it('should assemble data XML that includes unanswered placeholders', async function () {
    const templatePath = GetTemplatePath('SimpleWill2.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const data = {
      GoverningLaw: 'Utah',
      SigningDate: new Date(2019, 3, 26),
    }
    const aggr = tinq.extractData(logic, data)
    const str = aggr.data.toXml('_odx')
    assert.strictEqual(str,
      '<?xml version="1.0"?><_odx><C1>[Testator.Name]</C1><C3>[Testator.City]</C3><C4>[Testator.County]</C4><C5>[Testator.State]</C5><C6>[Representative.Name]</C6><C7>[Representative.City]</C7><C8>[Representative.County]</C8><C9>[Representative.State]</C9><C10>[Representative.Gender.HeShe]</C10><C12b>false</C12b><L18></L18><C27>Utah</C27><C29>26th day of April, 2019</C29><C33>[Testator.Gender.HimHer]</C33><C34>[Testator.Gender.HisHer]</C34><L37></L37><C41>UTAH</C41><C42>[NotaryCounty]</C42><L44></L44><C49>[WitnessNames[0]]</C49><L50></L50></_odx>')

  })
  it('should produce usable XML when an unconditional usage of a variable follows a conditional one', async function () {
    const templatePath = GetTemplatePath('cond-uncond.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const data = {
      x: true,
      a: 'testing'
    }
    const aggr = tinq.extractData(logic, data)
    const str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C1b>true</C1b><C2>testing</C2></_odx>')
  })
  it('should produce usable XML for a simple "if x then x" template', async function () {
    // making sure x is emitted only once, whether it is truthy or falsy, so we don't get XML errors
    const templatePath = GetTemplatePath('self-cond.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const data = {
      x: 'testing'
    }
    let aggr = tinq.extractData(logic, data)
    let str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C2b>true</C2b><C2>testing</C2></_odx>')
    // now evaluate the helper against NO data context, to test its functionality
    aggr = tinq.extractData(logic, {})
    str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C2b>false</C2b></_odx>')
  })
  it('should create the expected XML for ifpoa.docx', async function () {
    const templatePath = GetTemplatePath('ifpoa.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const data = { ClientName: 'John Doe', DPOAType: new String('Contingent') } // eslint-disable-line
    let aggr = tinq.extractData(logic, data)
    let str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C1>John Doe</C1><C3b>true</C3b><C4b>false</C4b></_odx>')
    // now evaluate the helper against NO data context, to test its functionality
    aggr = tinq.extractData(logic, {})
    str = aggr.data.toXml('_odx')
    assert.strictEqual(str, '<?xml version="1.0"?><_odx><C1>[ClientName]</C1><C3b>false</C3b><C4b>false</C4b></_odx>')
  })
  it('should create the expected XML for BeneficiaryList.docx', async function () {
    const templatePath = GetTemplatePath('BeneficiaryList.docx')
    const logic = await readJSONFile(templatePath + '.json')
    const data = {
      Beneficiaries: [
        { Name: 'Joe Bloggs' },
        { Name: 'Bob Syuruncle' },
        { Name: 'Joe Blow' },
        { Name: 'Astruas Bob' },
      ]
    }
    let aggr = tinq.extractData(logic, data)
    let str = aggr.data.toXml('_odx')
    const expectedXml = '<?xml version="1.0"?><_odx><L1><L1i><C2>Joe Bloggs</C2><L1p/></L1i></L1><L4><L4i><C2>Bob Syuruncle</C2><L4p/></L4i><L4i><C2>Joe Blow</C2><L4p/></L4i></L4><C7b>true</C7b><C8>Astruas Bob</C8></_odx>'
    assert.strictEqual(str, expectedXml)
    // now evaluate again with data in locals, and something else in scope, and make sure it still works
    let otherData = useScope(data).pushScope({ global: 'stuff' })
    aggr = tinq.extractData(logic, otherData)
    str = aggr.data.toXml('_odx')
    assert.strictEqual(str, expectedXml)
  })
})

const SimpleWillDemoContext = {
  Testator: {
    Name: 'John Smith',
    City: 'Jonestown',
    State: 'Pennsylvania',
    County: 'Lebanon',
    Gender: { Name: 'Male', HeShe: 'he', HimHer: 'him', HisHer: 'his', HisHers: 'his' }
  },
  GoverningLaw: 'Pennsylvania',
  SigningDate: new Date(2019, 2, 10),
  Witness1Name: 'John Doe',
  Witness2Name: 'Marilyn Monroe',
  NotaryCounty: 'Allegheny',
  NominateBackup: true,
  Representative: {
    Name: 'Casey Example',
    City: 'Philadelphia',
    State: 'Pennsylvania',
    County: 'Philadelphia',
    Gender: { Name: 'Female', HeShe: 'she', HimHer: 'her', HisHer: 'her', HisHers: 'hers' }
  },
  BackupRepresentative: {
    Name: 'Tina Turner',
    City: 'Los Angeles',
    State: 'California',
    County: 'Los Angeles',
    Gender: { Name: 'Female', HeShe: 'she', HimHer: 'her', HisHer: 'her', HisHers: 'hers' }
  },
  Beneficiaries: [
    {
      Name: 'Kelly Smith',
      Address: '1234 Anystreet, Allentown, PA',
      Relationship: 'Daughter',
      SSNLast4: '5555',
      PropertyBequeath: 'My cat.'
    },
    {
      Name: 'John Smith Jr.',
      Address: '2 Example Street, Example City, PA',
      Relationship: 'Son',
      SSNLast4: '4444',
      PropertyBequeath: 'My house.'
    },
    {
      Name: 'Alex Example',
      Address: 'Unknown',
      Relationship: 'Friend',
      PropertyBequeath: 'My book collection.'
    },
    {
      Name: 'Sam Example',
      Address: 'Boulder, CO',
      Relationship: 'Friend',
      PropertyBequeath: 'Everything else.'
    },
  ],
}

const BradyTestData = {
  Children: [
    {
      Name: 'Greg',
      Birthdate: new Date(1954, 8, 30)
    },
    {
      Name: 'Marcia',
      Birthdate: new Date(1956, 7, 5)
    },
    {
      Name: 'Peter',
      Birthdate: new Date(1957, 10, 7)
    },
    {
      Name: 'Jan',
      Birthdate: new Date(1958, 3, 29)
    },
    {
      Name: 'Bobby',
      Birthdate: new Date(1960, 11, 19)
    },
    {
      Name: 'Cindy',
      Birthdate: new Date(1961, 7, 14)
    }
  ]
}
