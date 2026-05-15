const mammoth = require('mammoth');
const { extractStudentSubmission } = require('./src/parser');
const file = process.argv[2];
if (!file) {
  console.error('Usage: node sample_parse.js path/to/submission.docx');
  process.exit(1);
}
mammoth.extractRawText({ path: file }).then(result => {
  const parsed = extractStudentSubmission(result.value);
  console.log(JSON.stringify({ header: parsed.header, questions: parsed.questions, sections: Object.fromEntries(Object.entries(parsed.sections).map(([k,v]) => [k, v.slice(0,160)])) }, null, 2));
});
