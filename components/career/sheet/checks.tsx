import { Check, Download, FileText, X } from 'lucide-react';
import type { AtsReport, TruthRemoval } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

/** What the truth check took out, and why. Empty is good news, and says so. */
export function RemovedList({ removed }: Readonly<{ removed: TruthRemoval[] }>) {
  return (
    <section className="cr-block" aria-labelledby="cr-removed-title">
      <h2 className="fd-label" id="cr-removed-title">Removed because it couldn’t be backed up</h2>
      {removed.length === 0 ? (
        <p className="cr-block-note">Nothing. Every line traces back to a fact in your profile.</p>
      ) : (
        <ul className="cr-removed">
          {removed.map((item) => (
            <li key={`${item.where}-${item.text}`}>
              <small>{item.where}</small>
              <s>{item.text}</s>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The ATS read-back: pass or fail in words, keyword coverage, and each check with its fix. */
export function AtsCard({ report }: Readonly<{ report: AtsReport | null }>) {
  if (!report) {
    return (
      <section className="cr-block" aria-labelledby="cr-ats-title">
        <h2 className="fd-label" id="cr-ats-title">ATS check</h2>
        <p className="cr-block-note">The check runs once the PDF is rendered.</p>
      </section>
    );
  }
  const coverage = Math.round(report.keywordCoverage * 100);
  return (
    <section className="cr-block" aria-labelledby="cr-ats-title">
      <div className="fd-label-row">
        <h2 className="fd-label" id="cr-ats-title">ATS check</h2>
        <span className={`cr-verdict ${report.passed ? 'ok' : 'bad'}`}>
          {report.passed ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <X size={12} strokeWidth={3} aria-hidden="true" />}
          {report.passed ? 'Passes' : 'Needs a fix'}
        </span>
      </div>
      <div className="cr-ats-stats">
        <div>
          <b>{coverage}%</b>
          <span>of the job’s terms found</span>
          <div className="cr-meter" aria-hidden="true"><i style={{ width: `${coverage}%` }} /></div>
        </div>
        <div>
          <b>{report.pages}</b>
          <span>{report.pages === 1 ? 'page' : 'pages'}{report.pages > 2 ? ', over the 2-page limit' : ''}</span>
        </div>
      </div>
      {report.missingKeywords.length > 0 && (
        <p className="cr-missing-terms">
          <span>Not in your resume:</span> {report.missingKeywords.join(', ')}
        </p>
      )}
      <ul className="cr-checks">
        {report.checks.map((check) => (
          <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
            {check.ok ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <X size={12} strokeWidth={3} aria-hidden="true" />}
            <span><span className="sr-only">{check.ok ? 'Passed: ' : 'Failed: '}</span>{check.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The tailored files, signed for an hour. */
export function FilesRow({ files }: Readonly<{ files: ApplicationDetail['files'] }>) {
  const items: Array<[string, string | null, string]> = [['PDF', files.pdf, 'For email and most forms'], ['DOCX', files.docx, 'When a form wants Word']];
  return (
    <section className="cr-block" aria-labelledby="cr-files-title">
      <h2 className="fd-label" id="cr-files-title">Files</h2>
      <div className="cr-files">
        {items.map(([kind, url, note]) => (url ? (
          <a key={kind} className="cr-file" href={url} download>
            <FileText size={18} aria-hidden="true" />
            <span><b>Resume.{kind.toLowerCase()}</b><small>{note}</small></span>
            <Download size={15} aria-hidden="true" />
          </a>
        ) : (
          <div key={kind} className="cr-file off">
            <FileText size={18} aria-hidden="true" />
            <span><b>Resume.{kind.toLowerCase()}</b><small>Not rendered yet</small></span>
          </div>
        )))}
      </div>
    </section>
  );
}
