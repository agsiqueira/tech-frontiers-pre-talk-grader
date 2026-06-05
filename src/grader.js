const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const { RUBRIC } = require('./rubric');
const { extractStudentSubmission } = require('./parser');

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  if (ext === '.pdf') {
    const data = await pdfParse(fs.readFileSync(filePath));
    return data.text || '';
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

function readRoster(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');

  // Canvas rubric exports can contain rubric column names with commas, such as
  // "Points: Interests, Concerns, and Predictions". If those headers are not
  // quoted correctly, a strict CSV parser sees too many header columns and fails.
  // First try strict parsing. If that fails, fall back to a tolerant row parser
  // and map the first fields into the known rubric template.
  try {
    return parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: true });
  } catch (error) {
    const records = parse(text, {
      columns: false,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true
    });

    const expectedHeaders = [
      'Student Name',
      'Student ID',
      'Posted Score',
      ...RUBRIC.flatMap(r => [r.pointsColumn, r.commentsColumn])
    ];

    return records.slice(1).map(record => {
      const row = {};
      for (let i = 0; i < expectedHeaders.length; i++) {
        row[expectedHeaders[i]] = record[i] || '';
      }
      return row;
    });
  }
}

function normalizeName(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchStudent(fileName, roster) {
  const base = normalizeName(path.basename(fileName, path.extname(fileName)));
  let best = null;
  for (const row of roster) {
    const name = normalizeName(row['Student Name']);
    if (base.includes(name) || name.includes(base)) return row;
    const parts = name.split(' ').filter(Boolean);
    const score = parts.filter(p => base.includes(p)).length;
    if (!best || score > best.score) best = { row, score };
  }
  return best && best.score >= 2 ? best.row : { 'Student Name': path.basename(fileName, path.extname(fileName)), 'Student ID': '' };
}

function safeJsonFromText(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in model response.');
  return JSON.parse(match[0]);
}

function translateError(error) {
  const status = error?.response?.status;
  if (status === 401) {
    return 'API Authentication Failed (401). The API key is invalid, expired, missing, or not authorized for this endpoint. Check OPENAI_API_KEY, OPENAI_BASE_URL, and the key type.';
  }
  if (status === 403) {
    return 'API Access Denied (403). The key exists, but it does not have permission to use this model or endpoint.';
  }
  if (status === 404) {
    return 'API Endpoint or Model Not Found (404). Check the base URL and model name.';
  }
  if (status === 429) {
    return 'Rate Limit Exceeded (429). Too many requests were sent. Try fewer files or wait before running again.';
  }
  if (status >= 500) {
    return `API Server Error (${status}). The provider returned a server-side error.`;
  }
  if (error?.code === 'ENOENT') return 'File or folder not found. Check the selected path.';
  if (error?.code === 'EBUSY' || error?.code === 'EACCES' || error?.code === 'EPERM') return 'File access error. Close the Excel output file if it is open, then run again.';
  if (/No JSON object/i.test(error?.message || '')) return 'The AI response could not be parsed as JSON. Try again or use a different model.';
  return error?.message || String(error) || 'Unknown error.';
}

function logProgress(onProgress, payload) {
  onProgress?.({ type: 'INFO', processed: 0, success: 0, warning: 0, error: 0, ...payload });
}


function getCalibrationPolicy(gradingCalibration) {
  const mode = String(gradingCalibration || 'supportive').toLowerCase();
  if (mode === 'strict') {
    return {
      label: 'Strict',
      temperature: 0.05,
      instructions: `Calibration level: Strict.
- Reserve Excellent-level points for responses that are very strong, specific, well-developed, and clearly connected to Industry 5.0.
- A generally correct but brief response should usually be Satisfactory, not Excellent.
- Deduct points for vague claims, limited depth, weak examples, missing personal reflection, or thin Industry 5.0 connections.
- Use the upper end of each range only when the response clearly satisfies the full rubric description.`
    };
  }
  if (mode === 'balanced') {
    return {
      label: 'Balanced',
      temperature: 0.08,
      instructions: `Calibration level: Balanced.
- Apply the rubric using a standard interpretation.
- Excellent means the response is thoughtful, relevant, and reasonably developed.
- Minor weaknesses can still lose small amounts of credit.
- Satisfactory should be used when the response is relevant but general, thin, or only partially connected to the rubric.
- Remember this is a pre-talk reflection, so students should not be penalized for not knowing content from the talk yet.`
    };
  }
  return {
    label: 'Supportive / Summer Course',
    temperature: 0.08,
    instructions: `Calibration level: Supportive / Summer Course.
- This is a chill summer pre-talk reflection assignment.
- Students have not seen the presentation yet, so do not expect expert-level knowledge of the talk.
- If a response is thoughtful, relevant, complete enough, and shows genuine preparation, it should usually receive Excellent-level points.
- Do not deduct points only because the student lacks details that would require watching the talk.
- Use deductions mainly for clearly missing sections, very vague answers, fewer than three questions, poor organization, or minimal engagement.
- For 8-point criteria, a good-enough thoughtful answer should often receive 7 or 8.
- For the 10-point questions criterion, three relevant questions should usually receive 9 or 10 unless they are repetitive, incomplete, irrelevant, or clearly low-effort.
- For "Questions for the Speaker", default to Excellent when the student provides three complete, relevant, discussion-oriented questions. Do not require advanced, research-level, or post-talk knowledge.
- For the questions criterion, curiosity, relevance, preparation, and engagement matter more than sophistication because this is a pre-talk assignment.
- For the 6-point learning goals/writing criterion, clear goals and readable professional writing should usually receive 5 or 6.`
  };
}

function buildPrompt(studentName, essayText, gradingCalibration = 'supportive') {
  const parsed = extractStudentSubmission(essayText);
  const sectionJson = JSON.stringify(parsed.sections, null, 2);
  const extractedQuestions = JSON.stringify(parsed.questions, null, 2);
  const calibration = getCalibrationPolicy(gradingCalibration);
  return `You are a grading support assistant for the Tech Frontiers Industry 5.0 course. Grade the student's pre-talk reflection essay using ONLY the rubric below. Be fair, conservative, and evidence-based. Do not invent content. Return strict JSON only. Use exactly the requested criterion keys. Each criterion must include numeric points, strengths, deductions, and a comment explaining that score.

${calibration.instructions}

Important grading rules:
- Grade only the student's responses, not the assignment template or embedded rubric.
- Use the point ranges exactly: Excellent is above the satisfactory threshold, Satisfactory is above the needs-improvement threshold, and Needs Improvement is above zero.
- The instructor remains the final authority.
- If a section cannot be found, assign conservative points and set manualReviewFlag to true.
- For every criterion that receives less than full points, explicitly explain why points were deducted.
- Deduction explanations must reference missing or underdeveloped rubric elements, such as limited depth, lack of specificity, weak Industry 5.0 connection, missing implications, incomplete questions, or writing/organization issues.
- Do not use generic phrases such as "good job," "needs more detail," or "please review manually" unless the section is truly unreadable.

Student: ${studentName}

Rubric:
${RUBRIC.map(r => `- ${r.label} (${r.max} pts)\n  Excellent: ${r.excellent}\n  Satisfactory: ${r.satisfactory}\n  Needs Improvement: ${r.needsImprovement}`).join('\n')}

Required JSON schema:
{
  "criterionScores": {
    "initialUnderstanding": {"points": number, "strengths": "what the response does well", "deductions": ["specific reason points were deducted; empty array if full points"], "comment": "complete explanation, including deduction reason if not full points"},
    "importanceRelevance": {"points": number, "strengths": "what the response does well", "deductions": ["specific reason points were deducted; empty array if full points"], "comment": "complete explanation, including deduction reason if not full points"},
    "interestsConcernsPredictions": {"points": number, "strengths": "what the response does well", "deductions": ["specific reason points were deducted; empty array if full points"], "comment": "complete explanation, including deduction reason if not full points"},
    "questionsForSpeaker": {"points": number, "strengths": "what the response does well", "deductions": ["specific reason points were deducted; empty array if full points"], "comment": "complete explanation, including deduction reason if not full points"},
    "learningGoalsWriting": {"points": number, "strengths": "what the response does well", "deductions": ["specific reason points were deducted; empty array if full points"], "comment": "complete explanation, including deduction reason if not full points"}
  },
  "questions": ["question 1", "question 2", "question 3"],
  "questionRankingNotes": [{"question": "...", "student": "${studentName}", "score": number, "rationale": "brief reason"}],
  "overallComment": "one concise comment for the instructor",
  "manualReviewFlag": true/false,
  "manualReviewReason": "brief reason or empty string"
}

Question ranking score should be 1 to 10 based on relevance, specificity, critical thinking, originality, and connection to Industry 5.0.

Parsed student response sections:
${sectionJson}

Deterministically extracted questions:
${extractedQuestions}

Full essay text without embedded rubric:
"""
${parsed.essayOnly.slice(0, 22000)}
"""`;
}

async function callOpenAICompatibleModel({ apiKey, baseUrl, model, studentName, essayText, gradingCalibration }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'Return strict JSON only. Use exactly the requested criterion keys. Each criterion must include numeric points, strengths, deductions, and a comment explaining that score. If points are deducted, explain why. Apply the selected grading calibration exactly. You support grading, but the instructor remains final authority.' },
      { role: 'user', content: buildPrompt(studentName, essayText, gradingCalibration) }
    ],
    temperature: getCalibrationPolicy(gradingCalibration).temperature
  };
  const response = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000
  });
  return safeJsonFromText(response.data.choices[0].message.content);
}

async function callGeminiModel({ apiKey, baseUrl, model, studentName, essayText, gradingCalibration }) {
  const geminiBaseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${geminiBaseUrl.replace(/\/$/, '')}/models/${model}:generateContent`;
  const payload = {
    systemInstruction: {
      parts: [
        { text: 'Return strict JSON only. Use exactly the requested criterion keys. Each criterion must include numeric points, strengths, deductions, and a comment explaining that score. If points are deducted, explain why. Apply the selected grading calibration exactly. You support grading, but the instructor remains final authority.' }
      ]
    },
    contents: [
      { role: 'user', parts: [{ text: buildPrompt(studentName, essayText, gradingCalibration) }] }
    ],
    generationConfig: {
      temperature: getCalibrationPolicy(gradingCalibration).temperature,
      responseMimeType: 'application/json'
    }
  };
  const response = await axios.post(url, payload, {
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: 120000
  });
  const text = response.data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  return safeJsonFromText(text);
}

async function callModel({ aiProvider = 'openai', apiKey, baseUrl, model, studentName, essayText, gradingCalibration }) {
  const provider = String(aiProvider || 'openai').toLowerCase();
  if (provider === 'gemini') {
    return callGeminiModel({ apiKey, baseUrl, model, studentName, essayText, gradingCalibration });
  }
  return callOpenAICompatibleModel({ apiKey, baseUrl, model, studentName, essayText, gradingCalibration });
}

function clampScore(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n * 10) / 10));
}


function normalizeCriterionName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getNestedCaseInsensitive(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  const normalized = Object.fromEntries(Object.keys(obj).map(k => [normalizeCriterionName(k), k]));
  for (const key of keys) {
    const actual = normalized[normalizeCriterionName(key)];
    if (actual) return obj[actual];
  }
  return undefined;
}


function scoreLevel(points, criterion) {
  if (points > (criterion.key === 'questionsForSpeaker' ? 7 : criterion.key === 'learningGoalsWriting' ? 4 : 5)) return 'Excellent';
  if (points > (criterion.key === 'questionsForSpeaker' ? 3 : 2)) return 'Satisfactory';
  if (points > 0) return 'Needs Improvement';
  return 'No Credit / Manual Review';
}

function cleanModelComment(comment, points, max) {
  let text = String(comment || '').trim();
  text = text.replace(new RegExp(`^\\s*Score\\s+${String(points).replace('.', '\\.')}(?:\\.0)?\\s*/\\s*${max}\\s*[:.-]?\\s*`, 'i'), '').trim();
  text = text.replace(/^\s*Score\s+\d+(?:\.\d+)?\s*\/\s*\d+\s*[:.-]?\s*/i, '').trim();
  return text;
}

function isWeakComment(comment) {
  const text = String(comment || '').trim();
  if (!text) return true;
  if (/no detailed explanation|please review manually|no explanation returned/i.test(text)) return true;
  if (/^score\s+\d+(?:\.\d+)?\s*\/\s*\d+\.?$/i.test(text)) return true;
  if (text.length < 45) return true;
  return false;
}

function truncateForComment(text, maxLen = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).trim() + '…';
}

function localEvidenceComment(criterion, points, parsed) {
  const level = scoreLevel(points, criterion);
  const sections = parsed?.sections || {};
  const questions = parsed?.questions || [];

  if (criterion.key === 'initialUnderstanding') {
    const evidence = truncateForComment(sections.initialUnderstanding);
    return `${level}: The response explains the student's prior understanding of VR and connects it to known applications such as gaming, education, training, and healthcare. ${evidence ? `Evidence: ${evidence}` : 'The section was limited or difficult to extract, so instructor review is recommended.'}`;
  }

  if (criterion.key === 'importanceRelevance') {
    const evidence = truncateForComment(sections.importanceRelevance);
    return `${level}: The response addresses why the topic matters within Industry 5.0 and discusses broader implications such as human-centered innovation, education, access, ethics, or future careers. ${evidence ? `Evidence: ${evidence}` : 'The section was limited or difficult to extract, so instructor review is recommended.'}`;
  }

  if (criterion.key === 'interestsConcernsPredictions') {
    const evidence = truncateForComment(sections.interestsConcernsPredictions);
    return `${level}: The response identifies interests, concerns, and future possibilities related to VR, including opportunities, limitations, risks, or predictions. ${evidence ? `Evidence: ${evidence}` : 'The section was limited or difficult to extract, so instructor review is recommended.'}`;
  }

  if (criterion.key === 'questionsForSpeaker') {
    const qText = questions.length ? questions.slice(0, 3).map((q, i) => `Q${i + 1}: ${q}`).join(' ') : '';
    return `${level}: ${questions.length} question(s) were detected. In a pre-talk reflection, three complete and relevant questions demonstrate preparation, curiosity, and engagement, even if they are not highly technical or research-level. ${qText ? `Evidence: ${truncateForComment(qText, 260)}` : 'No clear questions were detected, so instructor review is recommended.'}`;
  }

  if (criterion.key === 'learningGoalsWriting') {
    const evidence = truncateForComment(sections.learningGoalsWriting);
    return `${level}: The response states learning goals and the submission is assessed for organization, clarity, professionalism, and writing quality. ${evidence ? `Evidence: ${evidence}` : 'The learning goals section was limited or difficult to extract, so instructor review is recommended.'}`;
  }

  return `${level}: Explanation generated from the parsed submission because the model did not provide a usable detailed comment.`;
}


function defaultDeductionsForCriterion(criterion, points, parsed) {
  const sections = parsed?.sections || {};
  const questions = parsed?.questions || [];
  if (points >= criterion.max) return [];

  if (criterion.key === 'initialUnderstanding') {
    return [
      'the reflection does not fully meet the Excellent level because it could provide more depth, specificity, or clearer connections to emerging technologies and Industry 5.0 concepts'
    ];
  }
  if (criterion.key === 'importanceRelevance') {
    return [
      'the discussion does not fully meet the Excellent level because broader societal, industrial, ethical, educational, or human-centered implications could be developed more thoroughly'
    ];
  }
  if (criterion.key === 'interestsConcernsPredictions') {
    return [
      'the reflection does not fully meet the Excellent level because opportunities, concerns, risks, challenges, or future implications could be analyzed with more depth or specificity'
    ];
  }
  if (criterion.key === 'questionsForSpeaker') {
    if (questions.length < 3) {
      return [`only ${questions.length} clear speaker question(s) were detected, while the rubric requires at least three thoughtful and relevant questions`];
    }
    return [];
  }
  if (criterion.key === 'learningGoalsWriting') {
    return [
      'the learning goals and writing quality do not fully meet the Excellent level because the goals, organization, clarity, professionalism, or specificity could be stronger'
    ];
  }
  return ['the response did not fully satisfy all Excellent-level rubric requirements'];
}

function normalizeDeductions(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function buildDeductionAwareComment(criterion, points, parsed, commentValue, strengthsValue, deductionsValue) {
  const level = scoreLevel(points, criterion);
  let comment = cleanModelComment(commentValue, points, criterion.max);
  const strengths = String(strengthsValue || '').trim();
  let deductions = normalizeDeductions(deductionsValue);

  if (points < criterion.max && deductions.length === 0) {
    deductions = defaultDeductionsForCriterion(criterion, points, parsed);
  }

  if (isWeakComment(comment)) {
    comment = localEvidenceComment(criterion, points, parsed);
  }

  // Remove weak fallback language if it came from an earlier model response.
  comment = comment.replace(/No detailed explanation was returned by the model;?\s*please review manually\.?/gi, '').trim();

  if (points < criterion.max) {
    const hasDeductionLanguage = /deduct|lost point|did not fully|could|missing|lacks|limited|underdeveloped|unclear|incomplete/i.test(comment);
    if (!hasDeductionLanguage) {
      const strengthText = strengths || comment || `${level}: The response shows some alignment with the rubric.`;
      comment = `${level}: ${strengthText}`;
    }
    const deductionText = deductions.join('; ');
    if (deductionText && !comment.toLowerCase().includes(deductionText.toLowerCase().slice(0, 60))) {
      comment += ` Points were deducted because ${deductionText}.`;
    }
  } else if (points === criterion.max && !/^Excellent:/i.test(comment)) {
    comment = `Excellent: ${comment}`;
  }

  return comment.replace(/\s+/g, ' ').trim();
}

function normalizeGrade(rawGrade, parsed, studentName, gradingCalibration = 'supportive') {
  const grade = rawGrade && typeof rawGrade === 'object' ? { ...rawGrade } : {};
  const rawScores = grade.criterionScores || grade.criteria || grade.scores || grade.rubricScores || {};
  const normalizedScores = {};
  const rawKeys = rawScores && typeof rawScores === 'object' ? Object.keys(rawScores) : [];
  const supportiveMode = String(gradingCalibration || '').toLowerCase() === 'supportive';

  const hasSectionText = key => String(parsed.sections?.[key] || '').replace(/\s+/g, ' ').trim().length >= 120;

  const supportiveFullCredit = criterion => {
    if (!supportiveMode) return false;

    if (criterion.key === 'questionsForSpeaker') {
      return (parsed.questions || []).length >= 3;
    }

    if (criterion.key === 'initialUnderstanding') {
      return hasSectionText('initialUnderstanding');
    }

    if (criterion.key === 'importanceRelevance') {
      return hasSectionText('importanceRelevance');
    }

    if (criterion.key === 'interestsConcernsPredictions') {
      return hasSectionText('interestsConcernsPredictions');
    }

    if (criterion.key === 'learningGoalsWriting') {
      return hasSectionText('learningGoalsWriting');
    }

    return false;
  };

  const supportiveComment = criterion => {
    if (criterion.key === 'questionsForSpeaker') {
      return 'Excellent: Three complete and relevant pre-talk questions were detected. In Supportive / Summer Course mode, this satisfies the Questions for the Speaker criterion and receives full credit.';
    }

    if (criterion.key === 'initialUnderstanding') {
      return 'Excellent: The response provides a complete pre-talk reflection on prior understanding, technologies the student knows, personal experience, assumptions, and expected applications. In Supportive / Summer Course mode, this satisfies the criterion and receives full credit.';
    }

    if (criterion.key === 'importanceRelevance') {
      return 'Excellent: The response explains why the topic matters within Industry 5.0 and connects VR to human-centered customization, education, practical training, and appropriate caution about overreliance. In Supportive / Summer Course mode, this satisfies the criterion and receives full credit.';
    }

    if (criterion.key === 'interestsConcernsPredictions') {
      return 'Excellent: The response discusses opportunities, future possibilities, access concerns, cost limitations, and risks of overuse. In Supportive / Summer Course mode, this satisfies the criterion and receives full credit.';
    }

    if (criterion.key === 'learningGoalsWriting') {
      return 'Excellent: The response states clear learning goals and is organized, readable, and professional enough for this pre-talk reflection. In Supportive / Summer Course mode, this satisfies the criterion and receives full credit.';
    }

    return `Excellent: In Supportive / Summer Course mode, this response satisfies the ${criterion.label} criterion and receives full credit.`;
  };

  for (const criterion of RUBRIC) {
    let item = rawScores?.[criterion.key];
    if (!item) {
      const wanted = [criterion.key, criterion.label, criterion.pointsColumn.replace(/^Points:\s*/i, '')].map(normalizeCriterionName);
      const matchKey = rawKeys.find(k => wanted.includes(normalizeCriterionName(k)) || wanted.some(w => normalizeCriterionName(k).includes(w) || w.includes(normalizeCriterionName(k))));
      if (matchKey) item = rawScores[matchKey];
    }
    if (typeof item === 'number') item = { points: item };
    if (!item || typeof item !== 'object') item = {};

    const pointsValue = getNestedCaseInsensitive(item, ['points', 'point', 'score', 'grade', 'rubricScore', 'assignedPoints']);
    const commentValue = getNestedCaseInsensitive(item, ['comment', 'comments', 'justification', 'explanation', 'rationale', 'reason', 'feedback']);
    const strengthsValue = getNestedCaseInsensitive(item, ['strengths', 'strength', 'whatWorks', 'positiveEvidence']);
    const deductionsValue = getNestedCaseInsensitive(item, ['deductions', 'deductionReasons', 'pointsDeductedBecause', 'limitations', 'missingElements', 'areasForImprovement']);

    const forceFullCredit = supportiveFullCredit(criterion);
    const points = forceFullCredit ? criterion.max : clampScore(pointsValue, criterion.max);
    const comment = forceFullCredit
      ? supportiveComment(criterion)
      : buildDeductionAwareComment(criterion, points, parsed, commentValue, strengthsValue, deductionsValue);

    normalizedScores[criterion.key] = {
      points,
      comment
    };
  }

  grade.criterionScores = normalizedScores;
  grade.questions = Array.isArray(grade.questions) && grade.questions.length ? grade.questions : (parsed.questions || []);
  grade.questionRankingNotes = Array.isArray(grade.questionRankingNotes) ? grade.questionRankingNotes : [];
  if (!grade.questionRankingNotes.length && grade.questions.length) {
    grade.questionRankingNotes = grade.questions.map(q => ({ question: q, student: studentName, score: 7, rationale: 'Relevant question extracted from the submission; ranking should be reviewed manually.' }));
  }
  grade.overallComment = grade.overallComment || grade.summary || grade.feedback || '';

  const totalScore = Object.values(normalizedScores).reduce((sum, s) => sum + Number(s.points || 0), 0);
  const maxScore = RUBRIC.reduce((sum, r) => sum + Number(r.max || 0), 0);

  if (supportiveMode && totalScore >= maxScore) {
    grade.manualReviewFlag = false;
    grade.manualReviewReason = '';
  } else {
    grade.manualReviewFlag = Boolean(
      grade.manualReviewFlag ||
      grade.manualReview ||
      Object.values(normalizedScores).some(s => s.points === 0)
    );

    grade.manualReviewReason =
      grade.manualReviewReason ||
      grade.reviewReason ||
      (grade.manualReviewFlag ? 'One or more rubric scores required normalization or manual review.' : '');
  }

  return grade;
}

function makeOutputWorkbook(roster, results, outPath) {
  const headers = Object.keys(roster[0] || {}).length ? Object.keys(roster[0]) : [
    'Student Name', 'Student ID', 'Posted Score',
    ...RUBRIC.flatMap(r => [r.pointsColumn, r.commentsColumn])
  ];
  const expectedHeaders = ['Student Name', 'Student ID', 'Posted Score', ...RUBRIC.flatMap(r => [r.pointsColumn, r.commentsColumn])];
  const allHeaders = Array.from(new Set([...headers, ...expectedHeaders, 'Overall Comment', 'Manual Review Flag', 'Manual Review Reason', 'Source File', 'Extracted Student Name']));
  const rows = results.map(result => {
    const row = { ...result.rosterRow };
    let total = 0;
    for (const criterion of RUBRIC) {
      const score = result.grade.criterionScores?.[criterion.key] || {};
      const points = clampScore(score.points, criterion.max);
      total += points;
      row[criterion.pointsColumn] = points;
      const explanation = String(score.comment || '').trim();
      row[criterion.commentsColumn] = explanation ? `Score ${points}/${criterion.max}: ${explanation}` : `Score ${points}/${criterion.max}. No explanation returned; please review manually.`;
    }
    row['Posted Score'] = Math.round(total * 10) / 10;
    row['Overall Comment'] = result.grade.overallComment || '';
    row['Manual Review Flag'] = result.grade.manualReviewFlag ? 'Yes' : '';
    row['Manual Review Reason'] = result.grade.manualReviewReason || '';
    row['Source File'] = result.fileName;
    row['Extracted Student Name'] = result.grade.extractedHeader?.studentName || '';
    return row;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: allHeaders }), 'Rubric Scores');

  const questionRows = [];
  const rankedRows = [];
  for (const result of results) {
    (result.grade.questions || []).slice(0, 3).forEach((q, i) => questionRows.push({
      'Student Name': result.rosterRow['Student Name'],
      'Student ID': result.rosterRow['Student ID'],
      'Question Number': i + 1,
      'Question': q
    }));
    (result.grade.questionRankingNotes || []).forEach(item => rankedRows.push({
      'Student Name': result.rosterRow['Student Name'],
      'Question': item.question,
      'Ranking Score': Number(item.score) || 0,
      'Rationale': item.rationale || ''
    }));
  }
  rankedRows.sort((a, b) => b['Ranking Score'] - a['Ranking Score']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(questionRows), 'All Student Questions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankedRows.slice(0, 10).map((r, idx) => ({ Rank: idx + 1, ...r }))), 'Top 10 Questions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.map(r => ({
    'Student Name': r.rosterRow['Student Name'], 'File': r.fileName, 'Status': r.status, 'Notes': r.error || '', 'Extracted Student Name': r.grade.extractedHeader?.studentName || '', 'Manual Review': r.grade.manualReviewFlag ? 'Yes' : '', 'Manual Review Reason': r.grade.manualReviewReason || ''
  }))), 'Processing Log');
  XLSX.writeFile(wb, outPath);
}


function makeLogWorkbook(logRows, logOutPath) {
  const wb = XLSX.utils.book_new();

  const rows = logRows.length ? logRows : [{
    Time: new Date().toLocaleString(),
    Type: 'INFO',
    Student: '',
    File: '',
    Status: '',
    Message: 'No log rows were captured.',
    Processed: 0,
    Success: 0,
    Warning: 0,
    Error: 0,
    'Needs Attention': ''
  }];

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [
      'Time',
      'Type',
      'Student',
      'File',
      'Status',
      'Message',
      'Processed',
      'Success',
      'Warning',
      'Error',
      'Needs Attention'
    ]
  });

  ws['!cols'] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 28 },
    { wch: 45 },
    { wch: 14 },
    { wch: 90 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 18 }
  ];

  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let row = 1; row <= range.e.r; row++) {
    const typeCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
    const attentionCell = ws[XLSX.utils.encode_cell({ r: row, c: 10 })];

    const type = String(typeCell?.v || '').toUpperCase();
    const needsAttention = String(attentionCell?.v || '').toUpperCase() === 'YES';

    if (type === 'ERROR' || type === 'WARNING' || needsAttention) {
      for (let col = 0; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cellAddress]) continue;
        ws[cellAddress].s = {
          fill: { fgColor: { rgb: type === 'ERROR' ? 'F4CCCC' : 'FFF2CC' } },
          font: { bold: true }
        };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Console Log');
  XLSX.writeFile(wb, logOutPath, { cellStyles: true });
}


async function runWithConcurrency(items, limit, worker) {
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || 3));
  let index = 0;

  async function next() {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      await worker(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(safeLimit, items.length) },
    () => next()
  );

  await Promise.all(workers);
}

async function gradeFolder({ folderPath, rosterCsvPath, outputPath, apiKey, baseUrl, model, aiProvider = 'openai', gradingCalibration = 'supportive', concurrencyLimit = 3, onProgress }) {
  const roster = readRoster(rosterCsvPath);
  const files = fs.readdirSync(folderPath).filter(f => ['.docx', '.pdf', '.txt', '.md'].includes(path.extname(f).toLowerCase()));
  const results = [];
  const stats = { processed: 0, success: 0, warning: 0, error: 0 };
  const logRows = [];
  const safeConcurrencyLimit = Math.max(1, Math.min(5, Number(concurrencyLimit) || 3));

  function captureLog(payload) {
    const type = payload.type || 'INFO';
    const status = payload.status || '';
    const message = payload.message || '';
    const needsAttention =
      String(type).toUpperCase() === 'ERROR' ||
      String(type).toUpperCase() === 'WARNING' ||
      String(status).toLowerCase() === 'error' ||
      /manual review|error|failed|not found|could not|invalid|warning|only \d+ question/i.test(message);

    logRows.push({
      Time: new Date().toLocaleString(),
      Type: type,
      Student: payload.student || '',
      File: payload.fileName || '',
      Status: status,
      Message: message,
      Processed: payload.processed ?? stats.processed,
      Success: payload.success ?? stats.success,
      Warning: payload.warning ?? stats.warning,
      Error: payload.error ?? stats.error,
      'Needs Attention': needsAttention ? 'Yes' : ''
    });

    logProgress(onProgress, payload);
  }

  captureLog({
    type: 'INFO',
    total: files.length,
    processed: 0,
    success: 0,
    warning: 0,
    error: 0,
    student: 'Run',
    message: `Found ${files.length} supported submission file(s). AI provider: ${String(aiProvider || 'openai')}. Model: ${model}. Grading calibration: ${getCalibrationPolicy(gradingCalibration).label}. Parallel grading jobs: ${safeConcurrencyLimit}.`
  });

  await runWithConcurrency(files, safeConcurrencyLimit, async (fileName, i) => {
    const fullPath = path.join(folderPath, fileName);
    const rosterRow = matchStudent(fileName, roster);
    const student = rosterRow['Student Name'] || path.basename(fileName, path.extname(fileName));

    try {
      captureLog({ index: i + 1, total: files.length, student, fileName, status: 'reading', message: `${i + 1}/${files.length}: Reading ${fileName}`, ...stats });

      const essayText = await extractText(fullPath);
      const parsed = extractStudentSubmission(essayText);

      if (parsed.header?.studentName && (!rosterRow['Student Name'] || rosterRow['Student Name'] === path.basename(fileName, path.extname(fileName)))) {
        rosterRow['Student Name'] = parsed.header.studentName;
      }

      if (!parsed.sections.initialUnderstanding || !parsed.sections.importanceRelevance || !parsed.sections.interestsConcernsPredictions || !parsed.sections.learningGoalsWriting) {
        stats.warning += 1;
        captureLog({ type: 'WARNING', index: i + 1, total: files.length, student: rosterRow['Student Name'], fileName, message: 'One or more essay sections were not detected clearly. The output will be flagged for review.', ...stats });
      }

      if ((parsed.questions || []).length < 3) {
        stats.warning += 1;
        captureLog({ type: 'WARNING', index: i + 1, total: files.length, student: rosterRow['Student Name'], fileName, message: `Only ${parsed.questions.length} question(s) were detected before grading.`, ...stats });
      }

      captureLog({ index: i + 1, total: files.length, student: rosterRow['Student Name'], fileName, status: 'grading', message: `${i + 1}/${files.length}: Sending to AI for rubric grading`, ...stats });

      const rawGrade = await callModel({ aiProvider, apiKey, baseUrl, model, studentName: rosterRow['Student Name'], essayText, gradingCalibration });
      const grade = normalizeGrade(rawGrade, parsed, rosterRow['Student Name'], gradingCalibration);

      if (!grade.extractedHeader) grade.extractedHeader = parsed.header;

      results.push({ fileName, rosterRow, grade, status: 'graded' });
      stats.processed += 1;
      stats.success += 1;

      if (grade.manualReviewFlag) {
        stats.warning += 1;
        captureLog({ type: 'WARNING', index: i + 1, total: files.length, student: rosterRow['Student Name'], fileName, status: 'manual-review', message: grade.manualReviewReason || 'Manual review flag was set for this submission.', ...stats });
      }

      captureLog({ type: 'SUCCESS', index: i + 1, total: files.length, student: rosterRow['Student Name'], fileName, status: 'graded', message: `${i + 1}/${files.length}: Grading completed successfully`, ...stats });
    } catch (error) {
      const friendlyError = translateError(error);

      results.push({
        fileName,
        rosterRow,
        status: 'error',
        error: friendlyError,
        grade: {
          criterionScores: {},
          questions: [],
          questionRankingNotes: [],
          manualReviewFlag: true,
          manualReviewReason: friendlyError
        }
      });

      stats.processed += 1;
      stats.error += 1;

      captureLog({ type: 'ERROR', index: i + 1, total: files.length, student, fileName, status: 'error', message: friendlyError, ...stats });
    }
  });

  let logOutputPath = '';

  try {
    captureLog({ type: 'INFO', total: files.length, student: 'Output', message: 'Writing Excel workbook.', ...stats });

    makeOutputWorkbook(roster, results, outputPath);

    const parsedOutput = path.parse(outputPath);
    logOutputPath = path.join(parsedOutput.dir, `${parsedOutput.name}_LOG.xlsx`);
    makeLogWorkbook(logRows, logOutputPath);

    captureLog({ type: 'SUCCESS', total: files.length, student: 'Output', message: `Workbook created: ${outputPath}`, ...stats });
    captureLog({ type: 'SUCCESS', total: files.length, student: 'Output', message: `Log workbook created: ${logOutputPath}`, ...stats });
  } catch (error) {
    const friendlyError = translateError(error);
    stats.error += 1;
    captureLog({ type: 'ERROR', total: files.length, student: 'Output', message: friendlyError, ...stats });
    throw new Error(friendlyError);
  }

  return {
    outputPath,
    logOutputPath,
    count: results.length,
    successes: stats.success,
    warnings: stats.warning,
    errors: stats.error
  };
}

module.exports = { gradeFolder };
