'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { completeOnboarding } from '@/app/onboarding/actions';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { Wallpaper } from '@/components/shell/wallpaper';
import { AI_SWITCH, AiDisclosure } from '@/components/settings/ai-consent';
import { CurrencySelect, ModuleChoices, TimeZoneSelect } from '@/components/settings/place-fields';
import { safeAction } from '@/lib/client/safe-action';
import { ALL_MODULES, DEFAULT_PERSON_LOCALE, type ModuleId } from '@/lib/locale/person';
import { guessFromBrowser } from '@/lib/locale/options';
import { DESKTOP_LAYOUT } from '@/lib/shell/desktop';

const STEPS = [
  { title: 'What should Orbis call you?', lead: 'Used in your brief and greetings. You can leave it blank and add it later.' },
  { title: 'Where are you?', lead: 'Orbis plans your day in this time zone and shows money in this currency.' },
  { title: 'What do you want to keep track of?', lead: 'Each one is a tab. Switch any off and it stays out of your way.' },
  { title: 'Use AI features?', lead: 'You can change this any time in Settings → AI & privacy.' },
];

/**
 * First run: four short steps (name, place, modules, AI), then Today. Shown by
 * /active until the person's settings row is stamped onboarded. Each step is a
 * form, so Enter moves on; the heading takes focus on every step, and errors
 * are announced.
 */
export function Onboarding({ initialName, initialAi, aiAvailable, externalDocumentIndexing }: Readonly<{ initialName: string; initialAi: boolean; aiAvailable: boolean; externalDocumentIndexing: boolean }>) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [place, setPlace] = useState({ timeZone: DEFAULT_PERSON_LOCALE.timeZone, currency: DEFAULT_PERSON_LOCALE.currency });
  const [modules, setModules] = useState<ModuleId[]>([...ALL_MODULES]);
  // Starts where the person's AI setting already is, so finishing never changes it unasked.
  const [ai, setAi] = useState(initialAi);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    // The browser's zone is only known here, not in the server render.
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlace(guessFromBrowser(zone));
  }, []);

  useEffect(() => {
    // Every step after the first announces itself by moving focus to its heading.
    if (moved.current) heading.current?.focus();
  }, [step]);

  function go(next: number) {
    moved.current = true;
    setMessage('');
    setStep(next);
  }

  function finish(openSecurity: boolean) {
    setMessage('');
    startTransition(async () => {
      // Where the app opens once this is done: Today, or Settings → Security.
      const url = new URL(window.location.href);
      if (openSecurity) url.searchParams.set('tab', 'security');
      else url.searchParams.delete('tab');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      const result = await safeAction(completeOnboarding)({ preferredName: name, timeZone: place.timeZone, currency: place.currency, modules, aiEnabled: ai });
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < STEPS.length - 1) go(step + 1);
    else finish(false);
  }

  const last = step === STEPS.length - 1;
  const { title, lead } = STEPS[step];
  let submitLabel = last ? 'Finish' : 'Continue';
  if (pending) submitLabel = 'Finishing…';

  let body: ReactNode;
  if (step === 0) {
    body = <label className="fd-field wide" htmlFor="ob-name">Name to use<input id="ob-name" autoComplete="given-name" maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Your preferred name" /></label>;
  } else if (step === 1) {
    body = <>
      <TimeZoneSelect id="ob-zone" value={place.timeZone} onChange={(timeZone) => setPlace({ ...place, timeZone })} />
      <CurrencySelect id="ob-currency" value={place.currency} onChange={(currency) => setPlace({ ...place, currency })} locale={DEFAULT_PERSON_LOCALE.locale} />
    </>;
  } else if (step === 2) {
    body = <ModuleChoices idPrefix="ob-module" value={modules} onChange={setModules} />;
  } else {
    body = <div className="pf-notify">
      <label className="pf-master">
        <span>
          <strong><Sparkles size={13} aria-hidden="true" /> {AI_SWITCH.title}</strong>
          <small>{AI_SWITCH.detail}</small>
        </span>
        <input type="checkbox" role="switch" aria-label={AI_SWITCH.title} checked={ai} onChange={(event) => setAi(event.currentTarget.checked)} disabled={!aiAvailable || pending} />
      </label>
      {!aiAvailable && <p className="fd-note">This setting isn’t available right now. You can turn it on later in Settings.</p>}
      <AiDisclosure externalDocumentIndexing={externalDocumentIndexing} />
      <p className="fd-note">Your device PIN keeps Orbis locked. To change it, or lock Orbis now, open Security when you finish.</p>
    </div>;
  }

  return (
    <main className="stage ob-stage" data-desktop={DESKTOP_LAYOUT || undefined}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="phone">
        <div className="phone-screen">
          <Wallpaper />
          <div className="screen-body field ob">
            <div className="ob-column">
              <div className="fd-brand ob-brand">
                <OrbisMark size={26} />
                <p className="fd-date">Step {step + 1} of {STEPS.length}</p>
              </div>
              <ol className="ob-progress" aria-hidden="true">
                {STEPS.map((item, index) => <li key={item.title} className={index <= step ? 'done' : undefined} />)}
              </ol>
              <form className="fd-form ob-form" onSubmit={submit} aria-labelledby="ob-title" noValidate>
                <h1 id="ob-title" ref={heading} tabIndex={-1}>{title}</h1>
                <p className="fd-lead">{lead}</p>
                {body}
                <div role="alert" className="ob-alert">{message && <p className="fd-msg bad">{message}</p>}</div>
                <div className="fd-act ob-act">
                  {step > 0 && <button className="ghost" type="button" onClick={() => go(step - 1)} disabled={pending}>Back</button>}
                  <button type="submit" disabled={pending}>{submitLabel}</button>
                  {last && <button className="ghost" type="button" onClick={() => finish(true)} disabled={pending}>Finish and open Security</button>}
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
