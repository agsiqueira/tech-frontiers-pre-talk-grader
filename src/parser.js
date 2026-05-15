function normalizeText(text) {
  return (text || '')
    .replace(/\r/g, '\n')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanHeaderValue(value) {
  return (value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeader(text) {
  const out = {};
  const patterns = {
    studentName: /Student\s+Name\s*:\s*([^\n]+)/i,
    moduleNumber: /Module\s+Number\s*:\s*([^\n]+)/i,
    presentationTitle: /Presentation\s+Title\s*:\s*([^\n]+)/i,
    speakerName: /Speaker\s+Name\s*:\s*([^\n]+)/i
  };
  for (const [key, re] of Object.entries(patterns)) {
    const m = text.match(re);
    if (m) out[key] = cleanHeaderValue(m[1]);
  }
  return out;
}

function sectionBetween(text, startRe, endRe, opts = {}) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const after = text.slice(start);
  let contentStart = start;

  // Most prose sections begin with "Response:". The speaker-question section usually does not.
  // Only jump to Response when requested or when it appears before the next section marker.
  if (opts.afterResponse !== false) {
    const responseMatch = after.match(/\bResponse\s*:/i);
    const endProbe = after.search(endRe);
    if (responseMatch && (endProbe < 0 || responseMatch.index < endProbe)) {
      contentStart = start + responseMatch.index + responseMatch[0].length;
    }
  }

  const rest = text.slice(contentStart);
  const end = rest.search(endRe);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

function trimTemplateQuestionInstructions(section) {
  // Keep the actual question labels, but remove the prompt/example block that comes before them.
  const firstQuestion = section.search(/(?:^|\n)\s*(?:Question\s*)?(?:Q)?\s*1\s*[:.)-]/i);
  if (firstQuestion >= 0) return section.slice(firstQuestion).trim();
  return section;
}

function pushCleanQuestion(questions, q) {
  const cleaned = (q || '')
    .replace(/^[-•*\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return;
  if (!cleaned.includes('?')) return;
  if (/^(How do you see this technology changing|What ethical concerns should society consider|What are the biggest challenges preventing wider adoption)/i.test(cleaned)) return;
  if (!questions.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) questions.push(cleaned);
}

function extractQuestions(text) {
  const normalized = normalizeText(text);
  const section = sectionBetween(
    normalized,
    /Section\s*4\s*[-:]?\s*Questions\s+for\s+the\s+Speaker/i,
    /Section\s*5\s*[-:]?\s*Personal\s+Learning\s+Goals/i,
    { afterResponse: false }
  );

  const questions = [];
  const working = trimTemplateQuestionInstructions(section);

  // Format: Question 1: text, Question 2: text, Question 3: text
  let re = /(?:^|\n)\s*Question\s*([1-9][0-9]*)\s*[:.)-]\s*([\s\S]*?)(?=(?:\n\s*Question\s*[1-9][0-9]*\s*[:.)-])|$)/gi;
  let match;
  while ((match = re.exec(working)) !== null) pushCleanQuestion(questions, match[2]);

  // Format: Q1: text, Q2: text, Q3: text
  if (questions.length < 3) {
    re = /(?:^|\n)\s*Q\s*([1-9][0-9]*)\s*[:.)-]\s*([\s\S]*?)(?=(?:\n\s*Q\s*[1-9][0-9]*\s*[:.)-])|$)/gi;
    while ((match = re.exec(working)) !== null) pushCleanQuestion(questions, match[2]);
  }

  // Format: 1. text? 2. text? 3. text?
  if (questions.length < 3) {
    re = /(?:^|\n)\s*([1-9][0-9]*)\s*[:.)-]\s*([^\n]+\?)/gi;
    while ((match = re.exec(working)) !== null) pushCleanQuestion(questions, match[2]);
  }

  // Fallback: collect question-mark lines from the section, excluding example prompts.
  if (questions.length < 3) {
    const lines = working.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) pushCleanQuestion(questions, line);
  }

  // Last fallback: collect question sentences from the actual Section 4 block.
  if (questions.length < 3) {
    const sentences = working.match(/[^\n?]+\?/g) || [];
    for (const sentence of sentences) pushCleanQuestion(questions, sentence);
  }

  return questions.slice(0, 10);
}

function extractStudentSubmission(text) {
  const normalized = normalizeText(text);
  const rubricStart = normalized.search(/Pre-Talk\s+Reflection\s+Essay\s+Rubric/i);
  const essayOnly = rubricStart >= 0 ? normalized.slice(0, rubricStart).trim() : normalized;
  const header = extractHeader(essayOnly);
  const sections = {
    initialUnderstanding: sectionBetween(essayOnly, /Section\s*1\s*[-:]?\s*Initial\s+Understanding\s+of\s+the\s+Topic/i, /Section\s*2\s*[-:]?\s*Importance\s+and\s+Relevance/i),
    importanceRelevance: sectionBetween(essayOnly, /Section\s*2\s*[-:]?\s*Importance\s+and\s+Relevance/i, /Section\s*3\s*[-:]?\s*Interests,?\s+Concerns,?\s+and\s+Predictions/i),
    interestsConcernsPredictions: sectionBetween(essayOnly, /Section\s*3\s*[-:]?\s*Interests,?\s+Concerns,?\s+and\s+Predictions/i, /Section\s*4\s*[-:]?\s*Questions\s+for\s+the\s+Speaker/i),
    questionsForSpeaker: sectionBetween(essayOnly, /Section\s*4\s*[-:]?\s*Questions\s+for\s+the\s+Speaker/i, /Section\s*5\s*[-:]?\s*Personal\s+Learning\s+Goals/i, { afterResponse: false }),
    learningGoalsWriting: sectionBetween(essayOnly, /Section\s*5\s*[-:]?\s*Personal\s+Learning\s+Goals/i, /$/)
  };
  const questions = extractQuestions(essayOnly);
  return { header, sections, questions, essayOnly };
}

module.exports = { normalizeText, extractStudentSubmission, extractQuestions };
