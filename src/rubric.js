const RUBRIC = [
  {
    key: 'initialUnderstanding',
    pointsColumn: 'Points: Initial Understanding of the Topic',
    commentsColumn: 'Comments: Initial Understanding of the Topic',
    label: 'Initial Understanding of the Topic',
    max: 8,
    excellent: '8 to >5 pts: Thoughtful and well-developed reflection on prior knowledge, assumptions, and understanding of the topic. Strong engagement and clear connections to emerging technologies and Industry 5.0 concepts.',
    satisfactory: '5 to >2 pts: Reasonable discussion of prior understanding and basic engagement, but may lack depth, specificity, or clear connections.',
    needsImprovement: '2 to >0 pts: Minimal, unclear, or incomplete reflection with limited engagement or little evidence of prior consideration.'
  },
  {
    key: 'importanceRelevance',
    pointsColumn: 'Points: Importance and Relevance',
    commentsColumn: 'Comments: Importance and Relevance',
    label: 'Importance and Relevance',
    max: 8,
    excellent: '8 to >5 pts: Clearly explains importance within Industry 5.0 and thoughtfully discusses societal, industrial, ethical, educational, or human-centered implications.',
    satisfactory: '5 to >2 pts: Identifies some relevant implications and basic understanding of why the topic matters, but discussion may be general or underdeveloped.',
    needsImprovement: '2 to >0 pts: Limited or superficial discussion of relevance with minimal understanding of broader implications.'
  },
  {
    key: 'interestsConcernsPredictions',
    pointsColumn: 'Points: Interests, Concerns, and Predictions',
    commentsColumn: 'Comments: Interests, Concerns, and Predictions',
    label: 'Interests, Concerns, and Predictions',
    max: 8,
    excellent: '8 to >5 pts: Meaningful and reflective discussion of opportunities, concerns, risks, challenges, or future implications. Demonstrates curiosity and thoughtful analysis.',
    satisfactory: '5 to >2 pts: Addresses interests or concerns with limited depth, specificity, or critical reflection.',
    needsImprovement: '2 to >0 pts: Minimal, vague, incomplete, or disconnected reflection on future implications, concerns, or opportunities.'
  },
  {
    key: 'questionsForSpeaker',
    pointsColumn: 'Points: Questions for the Speaker',
    commentsColumn: 'Comments: Questions for the Speaker',
    label: 'Questions for the Speaker',
    max: 10,
    excellent: '10 to >7 pts: Three or more thoughtful, relevant, and well-developed questions showing curiosity, critical thinking, and engagement.',
    satisfactory: '7 to >3 pts: At least three relevant questions showing some engagement, though they may be general or lack depth.',
    needsImprovement: '3 to >0 pts: Questions are missing, incomplete, overly simplistic, or show limited engagement.'
  },
  {
    key: 'learningGoalsWriting',
    pointsColumn: 'Points: Personal Learning Goals and Writing Quality',
    commentsColumn: 'Comments: Personal Learning Goals and Writing Quality',
    label: 'Personal Learning Goals and Writing Quality',
    max: 6,
    excellent: '6 to >4 pts: Clear learning goals with strong organization, clarity, professionalism, and writing quality.',
    satisfactory: '4 to >2 pts: Learning goals are present and understandable, with minor organizational, clarity, or professionalism issues.',
    needsImprovement: '2 to >0 pts: Learning goals are unclear or missing, and writing may be disorganized, difficult to follow, or contain significant issues.'
  }
];
module.exports = { RUBRIC };
