import { CalendarClock, Link2, Video } from 'lucide-react';
import { MeetingLink } from '@/components/career/bits';
import { dayTime } from '@/components/career/format';
import type { CareerProfile, InterviewPrep } from '@/lib/career/types';

/** The interview prep pack: when and how, what they'll likely test with the stories to tell, what to ask, and the gaps to frame honestly. */
export function PrepPack({ prep, profile }: Readonly<{ prep: InterviewPrep; profile: CareerProfile | null }>) {
  const facts = new Map((profile?.facts ?? []).map((fact) => [fact.id, fact.text]));
  const { logistics } = prep;
  return (
    <section className="cr-block cr-prep" aria-labelledby="cr-prep-title">
      <h2 className="fd-label" id="cr-prep-title">Interview prep</h2>
      <ul className="cr-logistics">
        <li><CalendarClock size={14} aria-hidden="true" /><span>{logistics.at ? dayTime(logistics.at) : 'Time not given yet'}</span></li>
        {logistics.format && <li><Video size={14} aria-hidden="true" /><span>{logistics.format}</span></li>}
        {logistics.link && <li><Link2 size={14} aria-hidden="true" /><MeetingLink url={logistics.link} /></li>}
      </ul>

      {prep.likelyTopics.length > 0 && <h3 className="cr-sub">What they’ll likely test</h3>}
      {prep.likelyTopics.map((topic) => (
        <details className="cr-topic" key={topic.topic}>
          <summary><b>{topic.topic}</b><span>{topic.why}</span></summary>
          {topic.stories.length > 0 && (
            <ul>
              {topic.stories.map((story) => (
                <li key={story.factId}>
                  <span>{story.prompt}</span>
                  {facts.get(story.factId) && <small>From your profile: {facts.get(story.factId)}</small>}
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}

      {prep.questionsToAsk.length > 0 && (
        <>
          <h3 className="cr-sub">Questions to ask them</h3>
          <ul className="cr-plain">{prep.questionsToAsk.map((question) => <li key={question}>{question}</li>)}</ul>
        </>
      )}

      {prep.gaps.length > 0 && (
        <>
          <h3 className="cr-sub">Gaps to prepare for</h3>
          <ul className="cr-gaps">
            {prep.gaps.map((gap) => <li key={gap.skill}><b>{gap.skill}</b><span>{gap.framing}</span></li>)}
          </ul>
        </>
      )}
    </section>
  );
}
