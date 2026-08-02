import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import { knowledgeQuestions } from '../data/questions.js'

export default function KnowledgeAssessment({ onClose, onComplete, previousScore }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const results = useMemo(() => knowledgeQuestions.map((q) => answers[q.id] === q.answer), [answers])
  const finished = index === knowledgeQuestions.length
  const score = Math.round((results.filter(Boolean).length / knowledgeQuestions.length) * 100)

  if (finished) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="knowledge-title">
        <section className="knowledge-modal results-modal">
          <div className="result-ring" style={{ '--score': `${score * 3.6}deg` }}><strong>{score}</strong><span>/ 100</span></div>
          <h2 id="knowledge-title">Knowledge assessment complete</h2>
          <p>{results.filter(Boolean).length} of {knowledgeQuestions.length} answers correct. Review incorrect responses with the evaluator before the practical exercise.</p>
          <div className="result-list">
            {knowledgeQuestions.map((q, i) => (
              <div className={results[i] ? 'result-row correct' : 'result-row incorrect'} key={q.id}>
                {results[i] ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                <span><b>{q.domain}</b>{q.explanation}</span>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => { setAnswers({}); setIndex(0) }}>Retake</button>
            <button className="primary-button" onClick={() => { onComplete(score); onClose() }}>Continue to practical</button>
          </div>
        </section>
      </div>
    )
  }

  const question = knowledgeQuestions[index]
  const answered = answers[question.id] !== undefined

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="knowledge-title">
      <section className="knowledge-modal">
        <div className="modal-topline">
          <button className="icon-button" onClick={onClose} aria-label="Close knowledge assessment"><ArrowLeft /></button>
          <div><span>General knowledge</span><strong>{index + 1} of {knowledgeQuestions.length}</strong></div>
          {previousScore !== null && <span className="previous-score">Prior {previousScore}%</span>}
        </div>
        <div className="question-progress"><span style={{ width: `${((index + 1) / knowledgeQuestions.length) * 100}%` }} /></div>
        <p className="question-domain">{question.domain}</p>
        <h2 id="knowledge-title">{question.prompt}</h2>
        <div className="answer-list">
          {question.choices.map((choice, choiceIndex) => {
            const selected = answers[question.id] === choiceIndex
            return <button key={choice} className={`answer ${selected ? 'selected' : ''}`} onClick={() => setAnswers((current) => ({ ...current, [question.id]: choiceIndex }))}><span>{String.fromCharCode(65 + choiceIndex)}</span>{choice}</button>
          })}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Back</button>
          <button className="primary-button" disabled={!answered} onClick={() => setIndex((i) => i + 1)}>{index === knowledgeQuestions.length - 1 ? 'Finish assessment' : 'Next question'}<ArrowRight size={18} /></button>
        </div>
      </section>
    </div>
  )
}
